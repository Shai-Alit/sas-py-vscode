// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import * as vscode from "vscode";

import type {
  CallOptions,
  ServerAdapter,
  ServerResult,
} from "../../../src/server/adapter";
import type { ServerProblem } from "../../../src/server/problems";
import {
  createServerChild,
  deleteServerItem,
  downloadServerItem,
  renameServerItem,
  uploadToServerFolder,
  type ServerCommandDeps,
} from "../../../src/server/serverCommands";
import { SasServerDragAndDropController } from "../../../src/server/serverDragAndDrop";
import { SERVER_VIEW_ID } from "../../../src/server/serverExplorer";
import type { ServerTreeItem } from "../../../src/server/serverTree";
import type { ServerItem } from "../../../src/server/types";

/**
 * The SAS Server view's commands and drag-and-drop (13p-ii), the `vscode`
 * shells over `ServerAdapter`, driven with a stub adapter. Dialogs,
 * notifications and the progress notification are stubbed, as
 * `test/integration/content/transfer.test.ts` does; `vscode.workspace.fs` is
 * the real one, against a temporary directory. The adapter's wire behaviour
 * is `test/unit/server-adapter.test.ts`.
 */

const PROFILE = "profile-1";

function serverItem(itemPath: string, isDirectory: boolean): ServerItem {
  return {
    name: itemPath.slice(itemPath.lastIndexOf("/") + 1),
    path: itemPath,
    isDirectory,
    readOnly: false,
    size: isDirectory ? 4096 : 5,
    modifiedAt: undefined,
    links: [],
  };
}

function node(item: ServerItem, profileId = PROFILE): ServerTreeItem {
  return { kind: "serverItem", item, profileId };
}

const tmp = serverItem("/tmp", true);
const file = serverItem("/tmp/x.py", false);
const folder = serverItem("/tmp/data", true);

type Calls = { method: string; args: unknown[] }[];

/** An adapter whose every method records its call and answers `answer`. */
function fakeAdapter(
  calls: Calls,
  overrides: Partial<Record<keyof ServerAdapter, unknown>> = {},
  profileId = PROFILE,
): ServerAdapter {
  const record =
    (method: string) =>
    (...args: unknown[]): Promise<ServerResult<unknown>> => {
      calls.push({ method, args });
      const override = overrides[method as keyof ServerAdapter];
      if (typeof override === "function") {
        return (
          override as (...a: unknown[]) => Promise<ServerResult<unknown>>
        )(...args);
      }
      return Promise.resolve({ ok: true, value: undefined });
    };
  return {
    profileId,
    createFolder: record("createFolder"),
    createFile: record("createFile"),
    rename: record("rename"),
    move: record("move"),
    delete: record("delete"),
    getChildren: record("getChildren"),
    downloadFile: record("downloadFile"),
  } as unknown as ServerAdapter;
}

function failure(problem: ServerProblem): ServerResult<never> {
  return { ok: false, reason: "failed", problem };
}

interface Harness {
  deps: ServerCommandDeps;
  calls: Calls;
  refreshed: number;
  forgotten: string[];
  errors: string[];
  errorToasts: string[];
  warnings: string[];
  info: string[];
  inputs: vscode.InputBoxOptions[];
  /** What the stubbed input box answers. */
  input: string | undefined;
  /** What the stubbed warning modal answers. */
  confirm: string | undefined;
  /** What the stubbed open dialog returns. */
  pick: vscode.Uri[] | undefined;
  dialogs: number;
  downloadAllowed: boolean;
  /** Press Cancel on the faked progress. */
  cancel: () => void;
}

function harness(
  adapter: (calls: Calls) => ServerAdapter | undefined = (calls) =>
    fakeAdapter(calls),
): Harness {
  const holder = {
    calls: [] as Calls,
    refreshed: 0,
    forgotten: [] as string[],
    errors: [] as string[],
    errorToasts: [] as string[],
    warnings: [] as string[],
    info: [] as string[],
    inputs: [] as vscode.InputBoxOptions[],
    input: undefined as string | undefined,
    confirm: undefined as string | undefined,
    pick: undefined as vscode.Uri[] | undefined,
    dialogs: 0,
    downloadAllowed: true,
    cancel: () => undefined,
  } as Omit<Harness, "deps"> & { deps?: ServerCommandDeps };
  const built = adapter(holder.calls);
  const log = {
    error: (message: string) => holder.errors.push(message),
    warn: () => undefined,
    info: () => undefined,
    debug: () => undefined,
    trace: () => undefined,
    append: () => undefined,
    appendLine: () => undefined,
  } as unknown as vscode.LogOutputChannel;
  holder.deps = {
    currentAdapter: () => built,
    refresh: () => {
      holder.refreshed += 1;
    },
    forgetProfile: (profileId) => holder.forgotten.push(profileId),
    downloadAllowed: () => holder.downloadAllowed,
    log,
    viewId: SERVER_VIEW_ID,
  };
  return holder as Harness;
}

/** Stubs the dialogs, notifications and progress for the life of `body`. */
async function withStubs(
  holder: Harness,
  body: () => Promise<void>,
): Promise<void> {
  const win = vscode.window as unknown as Record<string, unknown>;
  const names = [
    "showInputBox",
    "showOpenDialog",
    "showInformationMessage",
    "showWarningMessage",
    "showErrorMessage",
    "withProgress",
  ] as const;
  const originals = names.map((name) => win[name]);
  const listeners: (() => void)[] = [];
  const token = {
    isCancellationRequested: false,
    onCancellationRequested: (listener: () => void) => {
      listeners.push(listener);
      return { dispose: () => undefined };
    },
  };
  holder.cancel = () => {
    token.isCancellationRequested = true;
    listeners.forEach((listener) => {
      listener();
    });
  };
  win.withProgress = (
    _options: unknown,
    task: (progress: unknown, token: unknown) => Promise<unknown>,
  ) => task({ report: () => undefined }, token);
  win.showInputBox = (options: vscode.InputBoxOptions) => {
    holder.inputs.push(options);
    return Promise.resolve(holder.input);
  };
  win.showOpenDialog = () => {
    holder.dialogs += 1;
    return Promise.resolve(holder.pick);
  };
  win.showInformationMessage = (message: string) => {
    holder.info.push(message);
    return Promise.resolve(undefined);
  };
  win.showWarningMessage = (message: string) => {
    holder.warnings.push(message);
    return Promise.resolve(holder.confirm);
  };
  win.showErrorMessage = (message: string) => {
    holder.errorToasts.push(message);
    return Promise.resolve(undefined);
  };
  try {
    await body();
  } finally {
    names.forEach((name, i) => {
      win[name] = originals[i];
    });
  }
}

function signalOf(options: unknown): AbortSignal | undefined {
  return (options as CallOptions | undefined)?.signal;
}

describe("SAS Server commands (13p-ii)", () => {
  describe("which node a command acts on", () => {
    it("asks for a selection when given no tree item", async () => {
      const holder = harness();
      await withStubs(holder, () => deleteServerItem(holder.deps, undefined));
      assert.equal(holder.errorToasts.length, 1);
      assert.deepEqual(holder.calls, []);
    });

    it("says to connect when the profile holds no session", async () => {
      const holder = harness(() => undefined);
      await withStubs(holder, () => renameServerItem(holder.deps, node(file)));
      assert.match(holder.errorToasts[0] ?? "", /Connect/);
      assert.equal(holder.inputs.length, 0);
    });

    it("refuses a node listed under another profile, and refreshes", async () => {
      const holder = harness();
      await withStubs(holder, () =>
        deleteServerItem(holder.deps, node(file, "other")),
      );
      assert.equal(holder.refreshed, 1);
      assert.match(holder.errorToasts[0] ?? "", /another connection profile/);
      assert.equal(holder.warnings.length, 0);
      assert.deepEqual(holder.calls, []);
    });
  });

  describe("New Folder and New File", () => {
    it("creates a folder under the trimmed name, then refreshes", async () => {
      const holder = harness();
      holder.input = "  results  ";
      await withStubs(holder, () =>
        createServerChild(holder.deps, node(tmp), "folder"),
      );
      const [call] = holder.calls;
      assert.equal(call?.method, "createFolder");
      assert.deepEqual(call.args.slice(0, 2), [tmp, "results"]);
      assert.ok(signalOf(call.args[2]) instanceof AbortSignal);
      assert.equal(holder.refreshed, 1);
    });

    it("creates an empty file, offering untitled.py", async () => {
      const holder = harness();
      holder.input = "x.py";
      await withStubs(holder, () =>
        createServerChild(holder.deps, node(tmp), "file"),
      );
      assert.equal(holder.inputs[0]?.value, "untitled.py");
      const [call] = holder.calls;
      assert.equal(call?.method, "createFile");
      assert.deepEqual(call.args.slice(0, 3), [tmp, "x.py", undefined]);
    });

    it("does nothing when the box is dismissed", async () => {
      const holder = harness();
      await withStubs(holder, () =>
        createServerChild(holder.deps, node(tmp), "folder"),
      );
      assert.deepEqual(holder.calls, []);
      assert.equal(holder.refreshed, 0);
    });

    it("the box refuses an empty name, a separator and a dot name", async () => {
      const holder = harness();
      await withStubs(holder, () =>
        createServerChild(holder.deps, node(tmp), "folder"),
      );
      const options = holder.inputs[0];
      assert.ok(options?.validateInput !== undefined);
      assert.ok(options.validateInput("  "));
      const separator = options.validateInput("a/b");
      assert.ok(typeof separator === "string");
      assert.match(separator, /\//);
      assert.ok(options.validateInput(".."));
      assert.equal(options.validateInput("ok"), undefined);
    });
  });

  describe("Rename", () => {
    it("renames to the trimmed name, selecting the name before its extension", async () => {
      const holder = harness();
      holder.input = " y.py ";
      await withStubs(holder, () => renameServerItem(holder.deps, node(file)));
      assert.deepEqual(holder.inputs[0]?.valueSelection, [0, 1]);
      const [call] = holder.calls;
      assert.equal(call?.method, "rename");
      assert.deepEqual(call.args.slice(0, 2), [file, "y.py"]);
      assert.equal(holder.refreshed, 1);
    });

    it("refuses the root, before the box", async () => {
      const holder = harness();
      await withStubs(holder, () =>
        renameServerItem(holder.deps, { ...node(tmp), rootLabel: "Home" }),
      );
      assert.match(holder.errorToasts[0] ?? "", /top folder can't be renamed/);
      assert.equal(holder.inputs.length, 0);
      assert.deepEqual(holder.calls, []);
    });

    it("the box refuses the name it already has, and an unchanged answer sends nothing", async () => {
      const holder = harness();
      holder.input = "x.py";
      await withStubs(holder, () => renameServerItem(holder.deps, node(file)));
      assert.ok(holder.inputs[0]?.validateInput?.("x.py"));
      assert.deepEqual(holder.calls, []);
    });
  });

  describe("Delete", () => {
    it("asks first, and sends nothing when the modal is dismissed", async () => {
      const holder = harness();
      await withStubs(holder, () => deleteServerItem(holder.deps, node(file)));
      assert.match(holder.warnings[0] ?? "", /Permanently delete "x\.py"/);
      assert.deepEqual(holder.calls, []);
    });

    it("refuses the root, before the modal", async () => {
      const holder = harness();
      holder.confirm = "Delete Permanently";
      await withStubs(holder, () =>
        deleteServerItem(holder.deps, { ...node(tmp), rootLabel: "Home" }),
      );
      assert.match(holder.errorToasts[0] ?? "", /top folder can't be deleted/);
      assert.equal(holder.warnings.length, 0);
      assert.deepEqual(holder.calls, []);
    });

    it("says a folder goes with everything in it, and deletes on confirm", async () => {
      const holder = harness();
      holder.confirm = "Delete Permanently";
      await withStubs(holder, () =>
        deleteServerItem(holder.deps, node(folder)),
      );
      assert.match(holder.warnings[0] ?? "", /everything inside it/);
      const [call] = holder.calls;
      assert.equal(call?.method, "delete");
      assert.equal(call.args[0], folder);
      assert.equal(holder.refreshed, 1);
      assert.deepEqual(holder.errorToasts, []);
    });

    it("logs and shows a failure, and still refreshes", async () => {
      const holder = harness((calls) =>
        fakeAdapter(calls, {
          delete: () =>
            Promise.resolve(
              failure({
                code: "changed-on-server",
                path: "/tmp/x.py",
                error: { status: 412 },
              }),
            ),
        }),
      );
      holder.confirm = "Delete Permanently";
      await withStubs(holder, () => deleteServerItem(holder.deps, node(file)));
      assert.match(holder.errors[0] ?? "", /changed on the SAS server/);
      assert.match(holder.errorToasts[0] ?? "", /changed on the SAS server/);
      assert.equal(holder.refreshed, 1);
      assert.deepEqual(holder.forgotten, []);
    });

    it("forgets a session the change found gone", async () => {
      const holder = harness((calls) =>
        fakeAdapter(calls, {
          delete: () =>
            Promise.resolve(
              failure({
                code: "compute",
                problem: { code: "session-gone", error: { status: 404 } },
              }),
            ),
        }),
      );
      holder.confirm = "Delete Permanently";
      await withStubs(holder, () => deleteServerItem(holder.deps, node(file)));
      assert.deepEqual(holder.forgotten, [PROFILE]);
      assert.equal(holder.errorToasts.length, 1);
    });

    it("stays silent about a failure its own Cancel caused", async () => {
      const holder: Harness = harness((calls) =>
        fakeAdapter(calls, {
          delete: () => {
            holder.cancel();
            return Promise.resolve(
              failure({
                code: "compute",
                problem: { code: "compute-unreachable", detail: "aborted" },
              }),
            );
          },
        }),
      );
      holder.confirm = "Delete Permanently";
      const h = holder;
      await withStubs(h, () => deleteServerItem(h.deps, node(file)));
      assert.deepEqual(h.errorToasts, []);
      assert.deepEqual(h.errors, []);
      assert.equal(h.refreshed, 1);
    });
  });

  describe("Upload and Download", () => {
    let dir: string;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "pov-server-"));
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it("uploads a picked file's bytes into the folder", async () => {
      const local = path.join(dir, "up.txt");
      fs.writeFileSync(local, "hello");
      const holder = harness();
      holder.pick = [vscode.Uri.file(local)];
      await withStubs(holder, () =>
        uploadToServerFolder(holder.deps, node(tmp)),
      );
      const [call] = holder.calls;
      assert.equal(call?.method, "createFile");
      assert.equal(call.args[0], tmp);
      assert.equal(call.args[1], "up.txt");
      assert.equal(Buffer.from(call.args[2] as Uint8Array).toString(), "hello");
      assert.ok(signalOf(call.args[3]) instanceof AbortSignal);
      assert.match(holder.info[0] ?? "", /Uploaded 1 file to "tmp"/);
      assert.equal(holder.refreshed, 1);
    });

    it("words a failed upload with the server's problem", async () => {
      const local = path.join(dir, "up.txt");
      fs.writeFileSync(local, "hello");
      const holder = harness((calls) =>
        fakeAdapter(calls, {
          createFile: () =>
            Promise.resolve(
              failure({
                code: "name-taken",
                path: "/tmp/up.txt",
                error: { status: 409 },
              }),
            ),
        }),
      );
      holder.pick = [vscode.Uri.file(local)];
      await withStubs(holder, () =>
        uploadToServerFolder(holder.deps, node(tmp)),
      );
      assert.match(holder.errorToasts[0] ?? "", /already exists/);
      assert.match(holder.errors[0] ?? "", /^SAS Server: upload of "up\.txt"/);
    });

    it("downloads a folder through its listing, writing each file", async () => {
      const inner = serverItem("/tmp/data/a.csv", false);
      const holder = harness((calls) =>
        fakeAdapter(calls, {
          getChildren: () =>
            Promise.resolve({
              ok: true,
              value: { items: [inner], truncated: false },
            }),
          downloadFile: () =>
            Promise.resolve({
              ok: true,
              value: new TextEncoder().encode("1,2"),
            }),
        }),
      );
      holder.pick = [vscode.Uri.file(dir)];
      await withStubs(holder, () =>
        downloadServerItem(holder.deps, node(folder)),
      );
      assert.equal(
        fs.readFileSync(path.join(dir, "data", "a.csv"), "utf8"),
        "1,2",
      );
      assert.deepEqual(
        holder.calls.map((call) => call.method),
        ["getChildren", "downloadFile"],
      );
      assert.equal(holder.calls[1]?.args[0], inner);
      assert.match(holder.info[0] ?? "", /Downloaded 1 file from "data"/);
    });

    it("refuses a download the context turns off, before the picker", async () => {
      const holder = harness();
      holder.downloadAllowed = false;
      await withStubs(holder, () =>
        downloadServerItem(holder.deps, node(file)),
      );
      assert.match(holder.errorToasts[0] ?? "", /turned off/);
      assert.equal(holder.dialogs, 0);
    });

    it("refuses a name this computer cannot hold, before the picker", async () => {
      const holder = harness();
      await withStubs(holder, () =>
        downloadServerItem(holder.deps, node(serverItem("/tmp/a:b", false))),
      );
      assert.match(holder.errorToasts[0] ?? "", /Rename it on the SAS server/);
      assert.equal(holder.dialogs, 0);
    });

    it("words a file over the cap as too large to download", async () => {
      const holder = harness((calls) =>
        fakeAdapter(calls, {
          downloadFile: () =>
            Promise.resolve(
              failure({
                code: "too-large",
                path: "/tmp/x.py",
                size: 200 * 1024 * 1024,
                limitBytes: 100 * 1024 * 1024,
              }),
            ),
        }),
      );
      holder.pick = [vscode.Uri.file(dir)];
      await withStubs(holder, () =>
        downloadServerItem(holder.deps, node(file)),
      );
      assert.match(
        holder.errorToasts[0] ?? "",
        /100 MB this extension downloads/,
      );
    });
  });
});

describe("SAS Server drag and drop (13p-ii)", () => {
  const MIME = "application/vnd.pythononviya.sasserver";

  function controller(holder: Harness): SasServerDragAndDropController {
    return new SasServerDragAndDropController(holder.deps);
  }

  async function drop(
    holder: Harness,
    target: ServerTreeItem | undefined,
    dragged: unknown[],
  ): Promise<void> {
    const transfer = new vscode.DataTransfer();
    transfer.set(MIME, new vscode.DataTransferItem(dragged));
    await withStubs(holder, () =>
      controller(holder).handleDrop(target, transfer),
    );
  }

  it("drags everything but the root", () => {
    const holder = harness();
    const transfer = new vscode.DataTransfer();
    const root: ServerTreeItem = { ...node(tmp), rootLabel: "Home" };
    controller(holder).handleDrag([root, node(file)], transfer);
    assert.deepEqual(transfer.get(MIME)?.value, [node(file)]);

    const empty = new vscode.DataTransfer();
    controller(holder).handleDrag([root], empty);
    assert.equal(empty.get(MIME), undefined);
  });

  it("moves each item it can into the folder, leaving out its own folder and another profile's", async () => {
    const holder = harness();
    const target = node(serverItem("/srv", true));
    const other = node(serverItem("/srv/already.py", false));
    await drop(holder, target, [node(file), other, node(file, "other")]);
    assert.deepEqual(
      holder.calls.map((call) => [call.method, call.args[0], call.args[1]]),
      [["move", file, target.item]],
    );
    assert.equal(holder.refreshed, 1);
    assert.deepEqual(holder.errorToasts, []);
  });

  it("moves only the folder when something inside it is dragged with it", async () => {
    const holder = harness();
    const target = node(serverItem("/srv", true));
    const inner = serverItem("/tmp/data/in.csv", false);
    const sibling = serverItem("/tmp/database", true);
    await drop(holder, target, [node(inner), node(folder), node(sibling)]);
    assert.deepEqual(
      holder.calls.map((call) => call.args[0]),
      [folder, sibling],
    );
    assert.deepEqual(holder.errorToasts, []);
  });

  it("ignores a drop with no target, a target from another profile, or no payload", async () => {
    const holder = harness();
    await drop(holder, undefined, [node(file)]);
    await drop(holder, node(serverItem("/srv", true), "other"), [node(file)]);
    await drop(holder, node(serverItem("/srv", true)), []);
    assert.deepEqual(holder.calls, []);
    assert.equal(holder.refreshed, 0);
  });

  it("logs every failed move, shows the first, and forgets a gone session", async () => {
    let n = 0;
    const holder = harness((calls) =>
      fakeAdapter(calls, {
        move: () => {
          n += 1;
          return Promise.resolve(
            n === 1
              ? failure({
                  code: "name-taken",
                  path: "/srv/x.py",
                  error: { status: 409 },
                })
              : failure({
                  code: "compute",
                  problem: { code: "session-gone", error: { status: 404 } },
                }),
          );
        },
      }),
    );
    const second = serverItem("/tmp/y.py", false);
    await drop(holder, node(serverItem("/srv", true)), [
      node(file),
      node(second),
    ]);
    assert.equal(holder.errors.length, 2);
    assert.equal(holder.errorToasts.length, 1);
    assert.match(holder.errorToasts[0] ?? "", /already exists/);
    assert.deepEqual(holder.forgotten, [PROFILE]);
    assert.equal(holder.refreshed, 1);
  });

  it("stops at a Cancel, and says nothing about the move it interrupted", async () => {
    const holder: Harness = harness((calls) =>
      fakeAdapter(calls, {
        move: () => {
          holder.cancel();
          return Promise.resolve(
            failure({
              code: "compute",
              problem: { code: "compute-unreachable", detail: "aborted" },
            }),
          );
        },
      }),
    );
    const h = holder;
    await drop(h, node(serverItem("/srv", true)), [
      node(file),
      node(serverItem("/tmp/y.py", false)),
    ]);
    assert.equal(h.calls.length, 1);
    assert.deepEqual(h.errorToasts, []);
    assert.equal(h.refreshed, 1);
  });
});

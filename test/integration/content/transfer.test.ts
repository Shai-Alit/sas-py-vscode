// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import * as vscode from "vscode";

import {
  MAX_TRANSFER_BYTES,
  type ContentAdapter,
  type FileContent,
} from "../../../src/content/adapter";
import type { ContentResult } from "../../../src/content/client";
import type { ContentCommandDeps } from "../../../src/content/contentCommands";
import { CONTENT_VIEW_ID } from "../../../src/content/contentExplorer";
import { download, upload } from "../../../src/content/contentTransfer";
import type { ContentItem } from "../../../src/content/types";

/**
 * Upload and download (13a) — the `vscode` shell in `contentTransfer.ts`,
 * driven with a stub adapter against a real temporary directory, the same
 * direct-construction pattern `cutPaste.test.ts` uses. The dialogs and
 * notifications are stubbed; `vscode.workspace.fs` is the real one (the API
 * freezes it), so a local-disk failure is made with a real path that cannot be
 * written. A test that cancels swaps the progress notification for one whose
 * Cancel it presses itself, through `Harness.cancel`.
 */

const folder: ContentItem = {
  id: "dest",
  name: "Destination",
  type: "child",
  contentType: "folder",
  uri: "/folders/folders/dest",
  links: [
    { rel: "members", href: "/folders/folders/dest/members", method: "GET" },
  ],
};

const file: ContentItem = {
  id: "m1",
  name: "model.py",
  type: "child",
  contentType: "file",
  uri: "/files/files/f1",
  links: [],
};

interface Harness {
  deps: ContentCommandDeps;
  refreshed: (ContentItem | undefined)[];
  errors: string[];
  warns: string[];
  info: string[];
  warnings: string[];
  errorToasts: string[];
  /** What the stubbed open dialog returns. */
  pick: vscode.Uri[] | undefined;
  /** What the stubbed warning modal answers. */
  confirm: string | undefined;
  /** What the stubbed information message answers. */
  infoAnswer: string | undefined;
  /** Commands run through `vscode.commands.executeCommand`, with their argument. */
  commands: { command: string; arg: unknown }[];
  dialogs: number;
  /** Replace the progress notification with one `cancel` can cancel. */
  fakeProgress: boolean;
  /** Press Cancel on the faked progress notification. */
  cancel: () => void;
}

function harness(adapter: Partial<ContentAdapter> | undefined): Harness {
  const holder: Harness = {
    refreshed: [],
    errors: [],
    warns: [],
    info: [],
    warnings: [],
    errorToasts: [],
    pick: undefined,
    confirm: undefined,
    infoAnswer: undefined,
    commands: [],
    dialogs: 0,
    fakeProgress: false,
    cancel: () => {
      throw new Error("set fakeProgress to cancel");
    },
    deps: undefined as unknown as ContentCommandDeps,
  };
  const log = {
    error: (message: string) => holder.errors.push(message),
    warn: (message: string) => holder.warns.push(message),
    info: () => undefined,
    debug: () => undefined,
    trace: () => undefined,
    append: () => undefined,
    appendLine: () => undefined,
  } as unknown as vscode.LogOutputChannel;
  holder.deps = {
    adapter: () => adapter as ContentAdapter | undefined,
    activeEndpoint: () => "https://a.example.com",
    refresh: (item) => {
      holder.refreshed.push(item);
    },
    reveal: () => Promise.resolve(),
    log,
    viewId: CONTENT_VIEW_ID,
  };
  return holder;
}

/** Stubs the dialog and notification functions for the life of `body`. */
async function withStubs(
  holder: Harness,
  body: () => Promise<void>,
): Promise<void> {
  const win = vscode.window as unknown as Record<string, unknown>;
  const cmds = vscode.commands as unknown as Record<string, unknown>;
  const names = [
    "showOpenDialog",
    "showInformationMessage",
    "showWarningMessage",
    "showErrorMessage",
    "withProgress",
  ] as const;
  const originals = names.map((name) => win[name]);
  const originalExecute = cmds.executeCommand;
  cmds.executeCommand = (command: string, arg: unknown) => {
    holder.commands.push({ command, arg });
    return Promise.resolve(undefined);
  };
  if (holder.fakeProgress) {
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
  }
  win.showOpenDialog = () => {
    holder.dialogs += 1;
    return Promise.resolve(holder.pick);
  };
  win.showInformationMessage = (message: string) => {
    holder.info.push(message);
    return Promise.resolve(holder.infoAnswer);
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
    cmds.executeCommand = originalExecute;
  }
}

function ok<T>(value: T): ContentResult<T> {
  return { ok: true, value };
}

/** What the adapter returns for a request its signal aborted. */
function abortedResult<T>(): ContentResult<T> {
  return {
    ok: false,
    reason: "aborted",
    problem: { code: "content-unreachable", detail: "aborted" },
  };
}

function bytesOf(text: string): FileContent {
  return {
    bytes: new TextEncoder().encode(text),
    etag: undefined,
    contentType: undefined,
  };
}

describe("SAS Content upload and download (13a)", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pyviya-transfer-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe("upload", () => {
    it("creates each picked file with its bytes, refreshes the folder, and says how many", async () => {
      fs.writeFileSync(path.join(dir, "a.py"), "print('a')\n");
      fs.writeFileSync(path.join(dir, "b.csv"), Buffer.from([0, 255, 10]));
      const created: { name: string; bytes: number[] }[] = [];
      const holder = harness({
        createFile: (_parent, name, _signal, content) => {
          created.push({ name, bytes: [...(content ?? [])] });
          return Promise.resolve(ok({ ...file, name }));
        },
      });
      holder.pick = [
        vscode.Uri.file(path.join(dir, "a.py")),
        vscode.Uri.file(path.join(dir, "b.csv")),
      ];

      await withStubs(holder, () => upload(holder.deps, folder));

      assert.deepEqual(created, [
        { name: "a.py", bytes: [...new TextEncoder().encode("print('a')\n")] },
        { name: "b.csv", bytes: [0, 255, 10] },
      ]);
      assert.deepEqual(holder.refreshed, [folder]);
      assert.deepEqual(holder.info, ['Uploaded 2 files to "Destination".']);
      assert.deepEqual(holder.errorToasts, []);
    });

    it("names an uploaded file as it is spelled on disk, not percent-encoded", async () => {
      // `Uri.path` is the decoded path; only `toString()` percent-encodes.
      const name = "My résumé 100%.py";
      fs.writeFileSync(path.join(dir, name), "x");
      const created: string[] = [];
      const holder = harness({
        createFile: (_parent, newName) => {
          created.push(newName);
          return Promise.resolve(ok({ ...file, name: newName }));
        },
      });
      holder.pick = [vscode.Uri.file(path.join(dir, name))];

      await withStubs(holder, () => upload(holder.deps, folder));

      assert.deepEqual(created, [name]);
    });

    it("keeps going after one file fails, then reports the count and logs the failure", async () => {
      fs.writeFileSync(path.join(dir, "taken.py"), "x");
      fs.writeFileSync(path.join(dir, "free.py"), "y");
      const attempted: string[] = [];
      const holder = harness({
        createFile: (_parent, name) => {
          attempted.push(name);
          return Promise.resolve(
            name === "taken.py"
              ? {
                  ok: false,
                  reason: "taken",
                  problem: {
                    code: "content-name-rejected",
                    message: 'An item named "taken.py" already exists.',
                  },
                }
              : ok({ ...file, name }),
          );
        },
      });
      holder.pick = [
        vscode.Uri.file(path.join(dir, "taken.py")),
        vscode.Uri.file(path.join(dir, "free.py")),
      ];

      await withStubs(holder, () => upload(holder.deps, folder));

      assert.deepEqual(attempted, ["taken.py", "free.py"]);
      assert.equal(holder.errorToasts.length, 1);
      assert.match(
        holder.errorToasts[0] ?? "",
        /Uploaded 1 of 2 files to "Destination"\. Could not upload "taken\.py"\. That name can't be used\./,
      );
      assert.equal(holder.errors.length, 1);
      assert.match(holder.errors[0] ?? "", /taken\.py/);
    });

    it("quotes the service's own sentence when a single file is refused as a blocked type", async () => {
      fs.writeFileSync(path.join(dir, "tool.exe"), "MZ");
      const holder = harness({
        createFile: () =>
          Promise.resolve({
            ok: false,
            reason: "blocked",
            problem: {
              code: "content-rejected",
              error: {
                status: 400,
                message:
                  'The file "tool.exe" has a file type of "application/x-msdownload", which is blocked.',
              },
            },
          }),
      });
      holder.pick = [vscode.Uri.file(path.join(dir, "tool.exe"))];

      await withStubs(holder, () => upload(holder.deps, folder));

      assert.equal(holder.errorToasts.length, 1);
      assert.match(holder.errorToasts[0] ?? "", /Could not upload "tool\.exe"/);
      assert.match(holder.errorToasts[0] ?? "", /which is blocked/);
    });

    it("reports a file that cannot be read from disk without calling the adapter", async () => {
      const holder = harness({
        createFile: () => {
          throw new Error("createFile should not be called");
        },
      });
      holder.pick = [vscode.Uri.file(path.join(dir, "missing.py"))];

      await withStubs(holder, () => upload(holder.deps, folder));

      assert.match(holder.errorToasts[0] ?? "", /could not be read/);
    });

    it("refuses a file over the limit from its size alone, without reading or sending it", async () => {
      // Sparse: the size is set without writing the bytes.
      const big = path.join(dir, "big.bin");
      fs.closeSync(fs.openSync(big, "w"));
      fs.truncateSync(big, MAX_TRANSFER_BYTES + 1);
      const holder = harness({
        createFile: () => {
          throw new Error("createFile should not be called");
        },
      });
      holder.pick = [vscode.Uri.file(big)];

      await withStubs(holder, () => upload(holder.deps, folder));

      assert.deepEqual(holder.errorToasts, [
        'Could not upload "big.bin". It is larger than the 100 MB SAS Viya accepts for one file.',
      ]);
      assert.equal(holder.errors.length, 1);
      assert.match(holder.errors[0] ?? "", /104857601 bytes/);
    });

    it("sends the rest to the log when more than one file fails", async () => {
      for (const name of ["a.py", "b.py", "c.py"]) {
        fs.writeFileSync(path.join(dir, name), name);
      }
      const holder = harness({
        createFile: (_parent, name) =>
          Promise.resolve(
            name === "b.py"
              ? ok({ ...file, name })
              : {
                  ok: false,
                  reason: "taken",
                  problem: {
                    code: "content-name-rejected",
                    message: `An item named "${name}" already exists.`,
                  },
                },
          ),
      });
      holder.pick = ["a.py", "b.py", "c.py"].map((name) =>
        vscode.Uri.file(path.join(dir, name)),
      );

      await withStubs(holder, () => upload(holder.deps, folder));

      assert.deepEqual(holder.errorToasts, [
        'Uploaded 1 of 3 files to "Destination". The rest could not be uploaded. See the Python on Viya log for details.',
      ]);
      assert.equal(holder.errors.length, 2);
    });

    it("stops at a cancel, starts nothing after it, and says it was cancelled", async () => {
      for (const name of ["a.py", "b.py", "c.py"]) {
        fs.writeFileSync(path.join(dir, name), name);
      }
      const attempted: string[] = [];
      const holder = harness({
        createFile: (_parent, name, signal) => {
          attempted.push(name);
          if (name === "b.py") {
            holder.cancel();
            assert.equal(signal?.aborted, true);
            return Promise.resolve(abortedResult<ContentItem>());
          }
          return Promise.resolve(ok({ ...file, name }));
        },
      });
      holder.fakeProgress = true;
      holder.pick = ["a.py", "b.py", "c.py"].map((name) =>
        vscode.Uri.file(path.join(dir, name)),
      );

      await withStubs(holder, () => upload(holder.deps, folder));

      assert.deepEqual(attempted, ["a.py", "b.py"]);
      assert.deepEqual(holder.errorToasts, []);
      assert.deepEqual(holder.errors, []);
      assert.deepEqual(holder.info, [
        'Upload to "Destination" cancelled. 1 of 3 files were uploaded.',
      ]);
      assert.deepEqual(holder.refreshed, [folder]);
    });

    it("does nothing when the dialog is dismissed", async () => {
      const holder = harness({
        createFile: () => {
          throw new Error("createFile should not be called");
        },
      });
      holder.pick = undefined;

      await withStubs(holder, () => upload(holder.deps, folder));

      assert.equal(holder.dialogs, 1);
      assert.deepEqual(holder.refreshed, []);
      assert.deepEqual(holder.info, []);
      assert.deepEqual(holder.errorToasts, []);
    });

    it("asks the user to sign in, without a dialog, when there is no session", async () => {
      const holder = harness(undefined);

      await withStubs(holder, () => upload(holder.deps, folder));

      assert.equal(holder.dialogs, 0);
      assert.match(holder.errorToasts[0] ?? "", /Sign in to SAS Viya/);
    });
  });

  describe("download", () => {
    it("writes a file into the chosen folder under its own name", async () => {
      const holder = harness({
        downloadFileContent: (href) => {
          assert.equal(href, "/files/files/f1");
          return Promise.resolve(ok(bytesOf("print('hi')\n")));
        },
      });
      holder.pick = [vscode.Uri.file(dir)];

      await withStubs(holder, () => download(holder.deps, file));

      assert.equal(
        fs.readFileSync(path.join(dir, "model.py"), "utf8"),
        "print('hi')\n",
      );
      assert.deepEqual(holder.info, ['Downloaded 1 file from "model.py".']);
      assert.deepEqual(holder.warnings, []);
      assert.deepEqual(holder.commands, []);
    });

    it("reveals the downloaded item when the user chooses Show in Folder", async () => {
      const holder = harness({
        downloadFileContent: () => Promise.resolve(ok(bytesOf("x"))),
      });
      holder.pick = [vscode.Uri.file(dir)];
      holder.infoAnswer = "Show in Folder";

      await withStubs(holder, () => download(holder.deps, file));

      assert.equal(holder.commands.length, 1);
      const [revealed] = holder.commands;
      assert.equal(revealed?.command, "revealFileInOS");
      assert.ok(revealed.arg instanceof vscode.Uri);
      assert.equal(
        revealed.arg.fsPath.toLowerCase(),
        path.join(dir, "model.py").toLowerCase(),
      );
    });

    it("writes a folder tree, leaves out what is not a file, and says so", async () => {
      const sub: ContentItem = {
        id: "m-sub",
        name: "data",
        type: "child",
        contentType: "folder",
        uri: "/folders/folders/sub",
        links: [],
      };
      const flow: ContentItem = {
        id: "m-flow",
        name: "etl.flw",
        type: "child",
        contentType: "dataFlow",
        uri: "/dataFlows/dataFlows/x",
        links: [],
      };
      const holder = harness({
        getChildItems: (parent) =>
          Promise.resolve(
            ok(
              parent.id === "dest"
                ? [sub, flow, { ...file, name: "main.py" }]
                : [{ ...file, name: "in.csv", uri: "/files/files/f2" }],
            ),
          ),
        downloadFileContent: (href) =>
          Promise.resolve(ok(bytesOf(href.endsWith("f2") ? "a,b\n" : "x"))),
      });
      holder.pick = [vscode.Uri.file(dir)];

      await withStubs(holder, () => download(holder.deps, folder));

      assert.equal(
        fs.readFileSync(
          path.join(dir, "Destination", "data", "in.csv"),
          "utf8",
        ),
        "a,b\n",
      );
      assert.equal(
        fs.readFileSync(path.join(dir, "Destination", "main.py"), "utf8"),
        "x",
      );
      assert.equal(
        fs.existsSync(path.join(dir, "Destination", "etl.flw")),
        false,
      );
      assert.equal(holder.info.length, 1);
      assert.match(holder.info[0] ?? "", /Downloaded 2 files/);
      assert.match(holder.info[0] ?? "", /1 item was left out\./);
      assert.equal(holder.warns.length, 1);
      assert.match(holder.warns[0] ?? "", /etl\.flw/);
    });

    it("counts more than one left-out item in the plural", async () => {
      const flow = (name: string): ContentItem => ({
        id: `m-${name}`,
        name,
        type: "child",
        contentType: "dataFlow",
        uri: `/dataFlows/dataFlows/${name}`,
        links: [],
      });
      const holder = harness({
        getChildItems: () =>
          Promise.resolve(
            ok([flow("a.flw"), flow("b.flw"), { ...file, name: "main.py" }]),
          ),
        downloadFileContent: () => Promise.resolve(ok(bytesOf("x"))),
      });
      holder.pick = [vscode.Uri.file(dir)];

      await withStubs(holder, () => download(holder.deps, folder));

      assert.equal(holder.info.length, 1);
      assert.match(holder.info[0] ?? "", /2 items were left out\./);
    });

    it("leaves an existing local file alone when the user does not confirm", async () => {
      fs.writeFileSync(path.join(dir, "model.py"), "mine");
      const holder = harness({
        downloadFileContent: () => {
          throw new Error("downloadFileContent should not be called");
        },
      });
      holder.pick = [vscode.Uri.file(dir)];
      holder.confirm = undefined;

      await withStubs(holder, () => download(holder.deps, file));

      assert.equal(holder.warnings.length, 1);
      assert.match(holder.warnings[0] ?? "", /already exists/);
      assert.equal(fs.readFileSync(path.join(dir, "model.py"), "utf8"), "mine");
    });

    it("overwrites an existing local file when the user chooses Replace", async () => {
      fs.writeFileSync(path.join(dir, "model.py"), "mine");
      const holder = harness({
        downloadFileContent: () => Promise.resolve(ok(bytesOf("theirs"))),
      });
      holder.pick = [vscode.Uri.file(dir)];
      holder.confirm = "Replace";

      await withStubs(holder, () => download(holder.deps, file));

      assert.equal(
        fs.readFileSync(path.join(dir, "model.py"), "utf8"),
        "theirs",
      );
    });

    it("refuses an item whose name cannot be a local file name, before any dialog", async () => {
      const holder = harness({});

      await withStubs(holder, () =>
        download(holder.deps, { ...file, name: "a\\b.py" }),
      );

      assert.equal(holder.dialogs, 0);
      assert.match(
        holder.errorToasts[0] ?? "",
        /can't be saved under that name/,
      );
    });

    it("words a too-large file as a download limit, not an editor one", async () => {
      const holder = harness({
        downloadFileContent: () =>
          Promise.resolve({
            ok: false,
            reason: "too large",
            problem: {
              code: "content-too-large",
              limitBytes: 100 * 1024 * 1024,
            },
          }),
      });
      holder.pick = [vscode.Uri.file(dir)];

      await withStubs(holder, () => download(holder.deps, file));

      assert.equal(holder.errorToasts.length, 1);
      assert.match(
        holder.errorToasts[0] ?? "",
        /Could not download "model\.py"\. It is larger than the 100 MB this extension downloads\./,
      );
      assert.equal(fs.existsSync(path.join(dir, "model.py")), false);
    });

    it("keeps going past a failed file in a folder, then gives the count and the reason", async () => {
      const holder = harness({
        getChildItems: () =>
          Promise.resolve(
            ok([
              { ...file, name: "a.py", uri: "/files/files/fa" },
              { ...file, name: "b.py", uri: "/files/files/fb" },
            ]),
          ),
        downloadFileContent: (href) =>
          Promise.resolve(
            href.endsWith("fa")
              ? {
                  ok: false,
                  reason: "gone",
                  problem: {
                    code: "content-rejected",
                    error: { status: 404 },
                  },
                }
              : ok(bytesOf("b")),
          ),
      });
      holder.pick = [vscode.Uri.file(dir)];

      await withStubs(holder, () => download(holder.deps, folder));

      assert.equal(
        fs.readFileSync(path.join(dir, "Destination", "b.py"), "utf8"),
        "b",
      );
      assert.equal(holder.errorToasts.length, 1);
      assert.match(
        holder.errorToasts[0] ?? "",
        /Downloaded 1 of 2 files from "Destination"\. Could not download "Destination\/a\.py"\./,
      );
    });

    it("sends the rest to the log when more than one file in a folder fails", async () => {
      const holder = harness({
        getChildItems: () =>
          Promise.resolve(
            ok(
              ["a", "b", "c"].map((name) => ({
                ...file,
                name: `${name}.py`,
                uri: `/files/files/f${name}`,
              })),
            ),
          ),
        downloadFileContent: (href) =>
          Promise.resolve(
            href.endsWith("fb")
              ? ok(bytesOf("b"))
              : {
                  ok: false,
                  reason: "gone",
                  problem: {
                    code: "content-rejected",
                    error: { status: 404 },
                  },
                },
          ),
      });
      holder.pick = [vscode.Uri.file(dir)];

      await withStubs(holder, () => download(holder.deps, folder));

      assert.deepEqual(holder.errorToasts, [
        'Downloaded 1 of 3 files from "Destination". The rest could not be downloaded. See the Python on Viya log for details.',
      ]);
      assert.equal(holder.errors.length, 2);
    });

    it("reports a local folder that cannot be created, before fetching anything", async () => {
      // A file where the folder has to go: Replace is confirmed, and creating
      // the folder then fails.
      fs.writeFileSync(path.join(dir, "Destination"), "in the way");
      const holder = harness({
        getChildItems: () => Promise.resolve(ok([file])),
        downloadFileContent: () => {
          throw new Error("downloadFileContent should not be called");
        },
      });
      holder.pick = [vscode.Uri.file(dir)];
      holder.confirm = "Replace";

      await withStubs(holder, () => download(holder.deps, folder));

      assert.deepEqual(holder.errorToasts, [
        'Could not download "Destination". A folder could not be created on this computer.',
      ]);
      assert.equal(holder.errors.length, 1);
    });

    it("reports a file that cannot be written to local disk", async () => {
      // A folder where the file has to go.
      fs.mkdirSync(path.join(dir, "model.py"));
      const holder = harness({
        downloadFileContent: () => Promise.resolve(ok(bytesOf("x"))),
      });
      holder.pick = [vscode.Uri.file(dir)];
      holder.confirm = "Replace";

      await withStubs(holder, () => download(holder.deps, file));

      assert.deepEqual(holder.errorToasts, [
        'Could not download "model.py". It could not be written to this computer.',
      ]);
      assert.deepEqual(holder.info, []);
    });

    it("stops at a cancel, fetches nothing after it, and says it was cancelled", async () => {
      const fetched: string[] = [];
      const holder = harness({
        getChildItems: () =>
          Promise.resolve(
            ok(
              ["a", "b", "c"].map((name) => ({
                ...file,
                name: `${name}.py`,
                uri: `/files/files/f${name}`,
              })),
            ),
          ),
        downloadFileContent: (href, signal) => {
          fetched.push(href);
          if (href.endsWith("fb")) {
            holder.cancel();
            assert.equal(signal?.aborted, true);
            return Promise.resolve(abortedResult<FileContent>());
          }
          return Promise.resolve(ok(bytesOf("a")));
        },
      });
      holder.fakeProgress = true;
      holder.pick = [vscode.Uri.file(dir)];

      await withStubs(holder, () => download(holder.deps, folder));

      assert.deepEqual(fetched, ["/files/files/fa", "/files/files/fb"]);
      assert.equal(
        fs.readFileSync(path.join(dir, "Destination", "a.py"), "utf8"),
        "a",
      );
      assert.equal(fs.existsSync(path.join(dir, "Destination", "c.py")), false);
      assert.deepEqual(holder.errorToasts, []);
      assert.deepEqual(holder.errors, []);
      assert.deepEqual(holder.info, [
        'Download of "Destination" cancelled. 1 of 3 files were downloaded.',
      ]);
    });

    it("says a download cancelled while listing its folder was cancelled", async () => {
      const holder = harness({
        getChildItems: () => {
          holder.cancel();
          return Promise.resolve(abortedResult<readonly ContentItem[]>());
        },
        downloadFileContent: () => {
          throw new Error("downloadFileContent should not be called");
        },
      });
      holder.fakeProgress = true;
      holder.pick = [vscode.Uri.file(dir)];

      await withStubs(holder, () => download(holder.deps, folder));

      assert.deepEqual(holder.errorToasts, []);
      assert.deepEqual(holder.info, ['Download of "Destination" cancelled.']);
    });

    it("reports a folder listing failure as one failed download", async () => {
      const holder = harness({
        getChildItems: () =>
          Promise.resolve({
            ok: false,
            reason: "forbidden",
            problem: { code: "forbidden", error: { status: 403 } },
          }),
      });
      holder.pick = [vscode.Uri.file(dir)];

      await withStubs(holder, () => download(holder.deps, folder));

      assert.equal(holder.errorToasts.length, 1);
      assert.match(
        holder.errorToasts[0] ?? "",
        /Could not download "Destination"/,
      );
      assert.equal(holder.errors.length, 1);
    });
  });
});

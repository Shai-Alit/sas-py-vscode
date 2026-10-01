// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import * as vscode from "vscode";

import type { ContentAdapter } from "../../../src/content/adapter";
import type { ContentResult } from "../../../src/content/client";
import {
  clearContentClipboard,
  copy,
  cut,
  paste,
  type ContentCommandDeps,
} from "../../../src/content/contentCommands";
import { CONTENT_VIEW_ID } from "../../../src/content/contentExplorer";
import { resourceHrefOf, type ContentItem } from "../../../src/content/types";

/**
 * Copy/Paste (13b) — `copy` and the copy arm of `paste` in
 * `contentCommands.ts`, and the reporting in `contentCopy.ts`, driven with a
 * stub adapter, the same direct-construction pattern `cutPaste.test.ts` and
 * `transfer.test.ts` use. What is copied, in what order and under what name
 * is `copy.ts`'s, unit-tested in `content-copy.test.ts`; this file checks
 * the clipboard and what the user is told.
 *
 * The stub keeps a listing per folder and adds every folder it makes and
 * every file it copies to its parent's listing, so the reveal after a paste
 * finds the copy the way it would in the tree.
 */

const ENDPOINT_A = "https://a.example.com";
const ENDPOINT_B = "https://b.example.com";
const DEST = "/folders/folders/dest";
const TOP = "/folders/folders/top";
const LIB = "/folders/folders/lib";

function folderMember(name: string, uri: string): ContentItem {
  return {
    id: `m-${name}`,
    name,
    type: "child",
    contentType: "folder",
    uri,
    links: [],
  };
}

function fileMember(name: string, id = name): ContentItem {
  return {
    id: `m-${name}`,
    name,
    type: "child",
    contentType: "file",
    uri: `/files/files/${id}`,
    links: [],
  };
}

const destination = folderMember("Destination", DEST);
const model = fileMember("model.py");
const project = folderMember("Project", TOP);
const flow: ContentItem = {
  id: "m-flow",
  name: "flow",
  type: "child",
  contentType: "dataFlow",
  uri: "/dataFlows/dataFlows/flow",
  links: [],
};

function ok<T>(value: T): ContentResult<T> {
  return { ok: true, value };
}

function refused<T>(): ContentResult<T> {
  return {
    ok: false,
    reason: "refused",
    problem: {
      code: "content-rejected",
      error: { status: 409, message: "already exists" },
    },
  };
}

/** What the adapter returns for a request its signal aborted. */
function abortedResult<T>(): ContentResult<T> {
  return {
    ok: false,
    reason: "aborted",
    problem: { code: "content-unreachable", detail: "aborted" },
  };
}

interface StoreOptions {
  /** A folder href whose listing fails; `"reveal"` fails only the listing
   * after the copy. */
  failListing?: string;
  failCreate?: string;
  failCopy?: readonly string[];
  /** Called as each file's copy starts. */
  onCopy?: (item: ContentItem) => void;
}

interface Store {
  adapter: Partial<ContentAdapter>;
  copied: { name: string; into: string }[];
  moved: string[];
}

function store(
  listings: Record<string, ContentItem[]>,
  opts: StoreOptions = {},
): Store {
  const copied: { name: string; into: string }[] = [];
  const moved: string[] = [];
  let next = 0;
  let copiesDone = false;
  const add = (parent: ContentItem, member: ContentItem): void => {
    const href = resourceHrefOf(parent) ?? "";
    (listings[href] ??= []).push(member);
  };
  const adapter: Partial<ContentAdapter> = {
    getChildItems: (parent, signal) => {
      const href = resourceHrefOf(parent) ?? "";
      if (signal?.aborted === true) return Promise.resolve(abortedResult());
      if (
        href === opts.failListing ||
        (opts.failListing === "reveal" && copiesDone)
      ) {
        return Promise.resolve(refused());
      }
      return Promise.resolve(ok([...(listings[href] ?? [])]));
    },
    createFolder: (parent, name, signal) => {
      if (signal?.aborted === true) return Promise.resolve(abortedResult());
      if (name === opts.failCreate) return Promise.resolve(refused());
      next += 1;
      const href = `/folders/folders/new-${String(next)}`;
      add(parent, folderMember(name, href));
      listings[href] = [];
      return Promise.resolve(
        ok({
          id: `new-${String(next)}`,
          name,
          type: "folder",
          links: [{ rel: "self", href, method: "GET" }],
        }),
      );
    },
    copyFile: (item, parent, name, signal) => {
      opts.onCopy?.(item);
      if (signal?.aborted === true) return Promise.resolve(abortedResult());
      if (opts.failCopy?.includes(item.name) === true) {
        return Promise.resolve(refused());
      }
      next += 1;
      const id = `c-${String(next)}`;
      add(parent, fileMember(name, id));
      copied.push({ name, into: resourceHrefOf(parent) ?? "" });
      copiesDone = true;
      return Promise.resolve(ok(`/files/files/${id}`));
    },
    moveItem: (item) => {
      moved.push(item.name);
      return Promise.resolve(ok(item));
    },
  };
  return { adapter, copied, moved };
}

interface Harness {
  deps: ContentCommandDeps;
  refreshed: (ContentItem | undefined)[];
  revealed: ContentItem[];
  errors: string[];
  warns: string[];
  info: string[];
  warnings: string[];
  errorToasts: string[];
  /** Press Cancel on the faked progress notification. */
  cancel: () => void;
}

function harness(
  adapter: Partial<ContentAdapter> | undefined,
  endpoint = ENDPOINT_A,
): Harness {
  const holder: Harness = {
    refreshed: [],
    revealed: [],
    errors: [],
    warns: [],
    info: [],
    warnings: [],
    errorToasts: [],
    cancel: () => undefined,
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
    activeEndpoint: () => endpoint,
    refresh: (item) => {
      holder.refreshed.push(item);
    },
    reveal: (item) => {
      holder.revealed.push(item);
      return Promise.resolve();
    },
    log,
    viewId: CONTENT_VIEW_ID,
  };
  return holder;
}

/** Stubs the notifications, and the progress notification with one whose
 * Cancel `holder.cancel` presses, for the life of `body`. */
async function withStubs(
  holder: Harness,
  body: () => Promise<void> | void,
): Promise<void> {
  const win = vscode.window as unknown as Record<string, unknown>;
  const names = [
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
  win.showInformationMessage = (message: string) => {
    holder.info.push(message);
    return Promise.resolve(undefined);
  };
  win.showWarningMessage = (message: string) => {
    holder.warnings.push(message);
    return Promise.resolve(undefined);
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

/** The Project tree: two files and a data flow, and a sub-folder with one
 * more file. */
function projectListings(): Record<string, ContentItem[]> {
  return {
    [DEST]: [],
    [TOP]: [
      fileMember("a.py"),
      fileMember("b.py"),
      flow,
      folderMember("lib", LIB),
    ],
    [LIB]: [fileMember("c.py")],
  };
}

describe("SAS Content Copy/Paste (13b)", () => {
  afterEach(() => {
    clearContentClipboard();
  });

  describe("copy", () => {
    it("arms Paste, and a copied file can be pasted more than once", async () => {
      const s = store({ [DEST]: [] });
      const holder = harness(s.adapter);
      await withStubs(holder, async () => {
        copy(holder.deps, model);
        assert.deepEqual(holder.info, [
          'Copied "model.py". Right-click a folder and choose Paste.',
        ]);

        await paste(holder.deps, destination);
        assert.deepEqual(s.copied, [{ name: "model.py", into: DEST }]);
        assert.deepEqual(holder.refreshed, [destination]);
        assert.deepEqual(
          holder.revealed.map((item) => item.uri),
          ["/files/files/c-1"],
        );
        // Pasted under its own name: no message beyond Copy's own.
        assert.equal(holder.info.length, 1);

        await paste(holder.deps, destination);
        assert.deepEqual(
          s.copied.map((c) => c.name),
          ["model.py", "model_Copy1.py"],
        );
        assert.equal(
          holder.info[1],
          'Pasted as "model_Copy1.py", because "Destination" already has an item named "model.py".',
        );
      });
    });

    it("refuses a Recycle Bin item, a non-member and a data flow, arming nothing", async () => {
      const holder = harness(store({}).adapter);
      await withStubs(holder, async () => {
        copy(holder.deps, { ...model, inRecycleBin: true });
        copy(holder.deps, { ...project, type: "folder" });
        copy(holder.deps, flow);
        assert.deepEqual(holder.errorToasts, [
          "Restore this item from the Recycle Bin before copying it.",
          '"Project" cannot be copied from here.',
          '"flow" can\'t be copied. Only files and folders can be.',
        ]);

        await paste(holder.deps, destination);
        assert.match(
          holder.errorToasts[3] ?? "",
          /Nothing has been cut or copied yet\. Cut or copy an item first\./,
        );
      });
    });

    it("asks to sign in when there is no adapter", async () => {
      const holder = harness(undefined);
      await withStubs(holder, () => {
        copy(holder.deps, model);
        assert.deepEqual(holder.errorToasts, [
          "Sign in to SAS Viya to change SAS Content.",
        ]);
      });
    });
  });

  describe("paste of a copied item", () => {
    it("refuses a target in the Recycle Bin, or one that is not a folder", async () => {
      const s = store({ [DEST]: [] });
      const holder = harness(s.adapter);
      await withStubs(holder, async () => {
        copy(holder.deps, model);
        await paste(holder.deps, { ...destination, inRecycleBin: true });
        await paste(holder.deps, fileMember("other.py"));
        assert.deepEqual(holder.warnings, [
          "You can't copy an item into or out of the Recycle Bin.",
          '"other.py" is not a folder you can copy items into.',
        ]);
        assert.equal(s.copied.length, 0);
      });
    });

    it("refuses a copy from another connection", async () => {
      const s = store({ [DEST]: [] });
      const holder = harness(s.adapter);
      await withStubs(holder, async () => {
        copy(holder.deps, model);
        await paste(
          { ...holder.deps, activeEndpoint: () => ENDPOINT_B },
          destination,
        );
        assert.match(
          holder.errorToasts[0] ?? "",
          /"model\.py" was copied from a different connection\. Copy it again to paste it here\./,
        );
        assert.equal(s.copied.length, 0);
      });
    });

    it("a copy replaces a cut, and a cut replaces a copy", async () => {
      const s = store({ [DEST]: [] });
      const holder = harness(s.adapter);
      await withStubs(holder, async () => {
        cut(holder.deps, fileMember("cut.py"));
        copy(holder.deps, model);
        await paste(holder.deps, destination);
        assert.deepEqual(s.moved, []);
        assert.deepEqual(
          s.copied.map((c) => c.name),
          ["model.py"],
        );

        cut(holder.deps, fileMember("cut.py"));
        await paste(holder.deps, destination);
        assert.deepEqual(s.moved, ["cut.py"]);
        // The cut was consumed, and the copy it replaced is gone too.
        await paste(holder.deps, destination);
        assert.match(
          holder.errorToasts.at(-1) ?? "",
          /Nothing has been cut or copied yet/,
        );
      });
    });

    it("copies a folder and says how many files, and what was left out", async () => {
      const s = store(projectListings());
      const holder = harness(s.adapter);
      await withStubs(holder, async () => {
        copy(holder.deps, project);
        await paste(holder.deps, destination);
        assert.deepEqual(
          s.copied.map((c) => c.name),
          ["a.py", "b.py", "c.py"],
        );
        assert.equal(
          holder.info.at(-1),
          'Copied 3 files into "Project". 1 item was left out. See the Python on Viya log for which, and why.',
        );
        assert.deepEqual(holder.warns, [
          'SAS Content: "Project/flow" was not copied: it is not a file',
        ]);
        assert.deepEqual(
          holder.revealed.map((item) => item.name),
          ["Project"],
        );
      });
    });

    it("says 1 file for a folder holding one", async () => {
      const s = store({ [DEST]: [], [TOP]: [fileMember("a.py")] });
      const holder = harness(s.adapter);
      await withStubs(holder, async () => {
        copy(holder.deps, project);
        await paste(holder.deps, destination);
        assert.equal(holder.info.at(-1), 'Copied 1 file into "Project".');
      });
    });

    it("says only folders were made for a folder with no files, under either name", async () => {
      const s = store({ [DEST]: [], [TOP]: [] });
      const holder = harness(s.adapter);
      await withStubs(holder, async () => {
        copy(holder.deps, project);
        await paste(holder.deps, destination);
        await paste(holder.deps, destination);
        assert.deepEqual(holder.info.slice(1), [
          'Copied "Project" to "Destination". It has no files, so only its folders were created.',
          'Copied "Project" to "Destination" as "Project_Copy1". It has no files, so only its folders were created.',
        ]);
      });
    });

    it("does not reveal when the listing after the copy fails", async () => {
      const s = store({ [DEST]: [] }, { failListing: "reveal" });
      const holder = harness(s.adapter);
      await withStubs(holder, async () => {
        copy(holder.deps, model);
        await paste(holder.deps, destination);
        assert.equal(s.copied.length, 1);
        assert.deepEqual(holder.revealed, []);
        assert.deepEqual(holder.errorToasts, []);
      });
    });
  });

  describe("failures", () => {
    it("reports a file that could not be copied, and logs why", async () => {
      const s = store({ [DEST]: [] }, { failCopy: ["model.py"] });
      const holder = harness(s.adapter);
      await withStubs(holder, async () => {
        copy(holder.deps, model);
        await paste(holder.deps, destination);
        assert.match(
          holder.errorToasts[0] ?? "",
          /^Could not copy "model\.py"\. /,
        );
        assert.equal(holder.errors.length, 1);
        assert.match(holder.errors[0] ?? "", /copy of "model\.py" failed/);
        assert.deepEqual(holder.revealed, []);
      });
    });

    it("names the one file of a folder that failed", async () => {
      const s = store(projectListings(), { failCopy: ["b.py"] });
      const holder = harness(s.adapter);
      await withStubs(holder, async () => {
        copy(holder.deps, project);
        await paste(holder.deps, destination);
        assert.match(
          holder.errorToasts[0] ?? "",
          /^Copied 2 of 3 files into "Project"\. Could not copy "Project\/b\.py"\. .* 1 item was left out\./,
        );
      });
    });

    it("sends the rest to the log when several files failed", async () => {
      const s = store(projectListings(), { failCopy: ["a.py", "c.py"] });
      const holder = harness(s.adapter);
      await withStubs(holder, async () => {
        copy(holder.deps, project);
        await paste(holder.deps, destination);
        assert.match(
          holder.errorToasts[0] ?? "",
          /^Copied 1 of 3 files into "Project"\. The rest could not be copied\. See the Python on Viya log for details\./,
        );
        assert.equal(holder.errors.length, 2);
      });
    });

    it("says nothing was copied when the target could not be listed", async () => {
      const s = store(projectListings(), { failListing: DEST });
      const holder = harness(s.adapter);
      await withStubs(holder, async () => {
        copy(holder.deps, project);
        await paste(holder.deps, destination);
        assert.match(
          holder.errorToasts[0] ?? "",
          /^Could not copy "Project"\. /,
        );
        assert.equal(s.copied.length, 0);
      });
    });

    it("says where the partial copy is when a folder could not be created", async () => {
      const s = store(projectListings(), { failCreate: "lib" });
      const holder = harness(s.adapter);
      await withStubs(holder, async () => {
        copy(holder.deps, project);
        await paste(holder.deps, destination);
        assert.match(
          holder.errorToasts[0] ?? "",
          /^Could not finish copying "Project", because "Project\/lib" could not be created\. .* What was copied before it is in "Project"\./,
        );
        assert.deepEqual(
          holder.revealed.map((item) => item.name),
          ["Project"],
        );
      });
    });
  });

  describe("cancel", () => {
    it("says a single file's copy was cancelled, and reveals nothing", async () => {
      const holder = harness(undefined);
      const s = store(
        { [DEST]: [] },
        {
          onCopy: () => {
            holder.cancel();
          },
        },
      );
      holder.deps = {
        ...holder.deps,
        adapter: () => s.adapter as ContentAdapter,
      };
      await withStubs(holder, async () => {
        copy(holder.deps, model);
        await paste(holder.deps, destination);
        assert.equal(holder.info.at(-1), 'Copy of "model.py" cancelled.');
        assert.deepEqual(holder.errorToasts, []);
        assert.deepEqual(holder.revealed, []);
      });
    });

    it("says how far a folder's copy got, and where", async () => {
      const holder = harness(undefined);
      const s = store(projectListings(), {
        onCopy: (item) => {
          if (item.name === "b.py") holder.cancel();
        },
      });
      holder.deps = {
        ...holder.deps,
        adapter: () => s.adapter as ContentAdapter,
      };
      await withStubs(holder, async () => {
        copy(holder.deps, project);
        await paste(holder.deps, destination);
        assert.equal(
          holder.info.at(-1),
          'Copy of "Project" cancelled. 1 of 3 files were copied into "Project". 1 item was left out. See the Python on Viya log for which, and why.',
        );
        assert.deepEqual(holder.revealed, []);
      });
    });

    it("counts a failure before the cancel", async () => {
      const holder = harness(undefined);
      const s = store(projectListings(), {
        failCopy: ["a.py"],
        onCopy: (item) => {
          if (item.name === "b.py") holder.cancel();
        },
      });
      holder.deps = {
        ...holder.deps,
        adapter: () => s.adapter as ContentAdapter,
      };
      await withStubs(holder, async () => {
        copy(holder.deps, project);
        await paste(holder.deps, destination);
        assert.match(
          holder.info.at(-1) ?? "",
          /^Copy of "Project" cancelled\. 0 of 3 files were copied into "Project", and 1 could not be\. See the Python on Viya log for details\./,
        );
      });
    });
  });
});

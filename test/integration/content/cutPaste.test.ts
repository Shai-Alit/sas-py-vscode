// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import * as vscode from "vscode";

import type { ContentAdapter } from "../../../src/content/adapter";
import type { ContentResult } from "../../../src/content/client";
import {
  clearCutContentItem,
  cut,
  paste,
  type ContentCommandDeps,
} from "../../../src/content/contentCommands";
import { CONTENT_VIEW_ID } from "../../../src/content/contentExplorer";
import type { ContentItem } from "../../../src/content/types";

/**
 * Cut/Paste (6e) — the behavioural coverage the diagnostic version shipped
 * without. Constructed directly with stub deps, the same pattern
 * `dragAndDrop.test.ts` / `fileSystem.test.ts` / `tree.test.ts` use for the
 * other `vscode` shells this coverage gate does not see. `cut`/`paste` are
 * exported from `contentCommands.ts` for exactly this.
 *
 * `cutState` is process-lifetime module state, shared with every other test
 * in this file (and, in principle, every other test file the integration
 * run loads) — `afterEach` below calls `clearCutContentItem()` so no test
 * leaks a pending cut into the next.
 */

const ENDPOINT_A = "https://a.example.com";
const ENDPOINT_B = "https://b.example.com";

function fakeLog(): { channel: vscode.LogOutputChannel; errors: string[] } {
  const errors: string[] = [];
  const channel = {
    error: (message: string) => errors.push(message),
    info: () => undefined,
    warn: () => undefined,
    debug: () => undefined,
    trace: () => undefined,
    append: () => undefined,
    appendLine: () => undefined,
  } as unknown as vscode.LogOutputChannel;
  return { channel, errors };
}

const fileMember: ContentItem = {
  id: "m1",
  name: "model.py",
  type: "child",
  contentType: "file",
  uri: "/files/files/m1",
  parentFolderUri: "/folders/folders/src",
  links: [
    { rel: "self", href: "/folders/folders/src/members/m1", method: "GET" },
  ],
};

const targetFolder: ContentItem = {
  id: "dest",
  name: "Destination",
  type: "child",
  contentType: "folder",
  uri: "/folders/folders/dest",
  links: [
    { rel: "self", href: "/folders/folders/dest/members/dest", method: "GET" },
  ],
};

/** A root-listing folder — `type !== "child"`, so `moveObjection` reports
 * "not-a-member" for it as a *source*, and it fails `cut()`'s own guard
 * before `moveObjection` is even consulted. */
const rootListingFolder: ContentItem = {
  id: "top",
  name: "Top",
  type: "folder",
  links: [],
};

type MoveItem = ContentAdapter["moveItem"];

interface Harness {
  deps: ContentCommandDeps;
  state: { refreshed: number; revealed: ContentItem[] };
  errors: string[];
  info: string[];
  warnings: string[];
  errorToasts: string[];
}

function depsWith(moveItem: MoveItem, endpoint = ENDPOINT_A): Harness {
  const { channel, errors } = fakeLog();
  const state = { refreshed: 0, revealed: [] as ContentItem[] };
  const info: string[] = [];
  const warnings: string[] = [];
  const errorToasts: string[] = [];
  const deps: ContentCommandDeps = {
    adapter: () => ({ moveItem }) as unknown as ContentAdapter,
    activeEndpoint: () => endpoint,
    refresh: () => {
      state.refreshed += 1;
    },
    reveal: (item) => {
      state.revealed.push(item);
      return Promise.resolve();
    },
    log: channel,
    viewId: CONTENT_VIEW_ID,
  };
  return { deps, state, errors, info, warnings, errorToasts };
}

const notCalled: MoveItem = () => {
  throw new Error("moveItem should not be called");
};

/** Stubs the three message-showing functions `cut`/`paste` use, recording
 * every call, restoring the originals afterwards — regardless of the
 * harness the calls were made through, since these are process-global. */
async function withMessageStubs(
  holder: Harness,
  body: () => Promise<void> | void,
): Promise<void> {
  const originals = {
    info: vscode.window.showInformationMessage,
    warn: vscode.window.showWarningMessage,
    error: vscode.window.showErrorMessage,
  };
  (
    vscode.window as { showInformationMessage: unknown }
  ).showInformationMessage = (message: string) => {
    holder.info.push(message);
    return Promise.resolve(undefined);
  };
  (vscode.window as { showWarningMessage: unknown }).showWarningMessage = (
    message: string,
  ) => {
    holder.warnings.push(message);
    return Promise.resolve(undefined);
  };
  (vscode.window as { showErrorMessage: unknown }).showErrorMessage = (
    message: string,
  ) => {
    holder.errorToasts.push(message);
    return Promise.resolve(undefined);
  };
  try {
    await body();
  } finally {
    (
      vscode.window as { showInformationMessage: unknown }
    ).showInformationMessage = originals.info;
    (vscode.window as { showWarningMessage: unknown }).showWarningMessage =
      originals.warn;
    (vscode.window as { showErrorMessage: unknown }).showErrorMessage =
      originals.error;
  }
}

describe("SAS Content Cut/Paste (6e)", () => {
  afterEach(() => {
    clearCutContentItem();
  });

  it("cuts, then pastes into a valid folder: moves, refreshes, reveals, and clears the cut", async () => {
    const moves: { id: string; dest: string }[] = [];
    const holder = depsWith((item, dest) => {
      moves.push({ id: item.id, dest });
      return Promise.resolve({
        ok: true,
        value: { ...item, parentFolderUri: dest },
      } as ContentResult<ContentItem>);
    });

    await withMessageStubs(holder, async () => {
      cut(holder.deps, fileMember);
      assert.equal(holder.info.length, 1);
      assert.match(holder.info[0] ?? "", /Cut "model\.py"/);

      await paste(holder.deps, targetFolder);
      // resourceHrefOf prefers the member's own `uri` over its `self` link.
      assert.deepEqual(moves, [{ id: "m1", dest: "/folders/folders/dest" }]);
      assert.equal(holder.state.refreshed, 1);
      assert.deepEqual(
        holder.state.revealed.map((i) => i.id),
        ["m1"],
      );

      // The cut is consumed — a second Paste with nothing re-cut refuses.
      holder.warnings.length = 0;
      holder.errorToasts.length = 0;
      await paste(holder.deps, targetFolder);
      assert.equal(moves.length, 1, "moveItem should not run a second time");
      assert.match(holder.errorToasts[0] ?? "", /Nothing has been cut yet/);
    });
  });

  it("paste with nothing cut shows a named reason and never calls the adapter", async () => {
    const holder = depsWith(notCalled);
    await withMessageStubs(holder, async () => {
      await paste(holder.deps, targetFolder);
      assert.equal(holder.state.refreshed, 0);
      assert.match(
        holder.errorToasts[0] ?? "",
        /Nothing has been cut yet\. Cut an item first\./,
      );
    });
  });

  it("cut refuses a non-member item (not-a-member) without ever arming a paste", async () => {
    const holder = depsWith(notCalled);
    await withMessageStubs(holder, async () => {
      cut(holder.deps, rootListingFolder);
      assert.match(
        holder.errorToasts[0] ?? "",
        /"Top" cannot be moved from here\./,
      );

      await paste(holder.deps, targetFolder);
      assert.equal(holder.state.refreshed, 0);
      assert.match(holder.errorToasts[1] ?? "", /Nothing has been cut yet/);
    });
  });

  it("cut refuses a Recycle Bin item", async () => {
    const holder = depsWith(notCalled);
    await withMessageStubs(holder, () => {
      cut(holder.deps, { ...fileMember, inRecycleBin: true });
      assert.match(
        holder.errorToasts[0] ?? "",
        /Restore this item from the Recycle Bin/,
      );
    });
  });

  it("paste onto a Recycle Bin item (target-side in-recycle-bin) is rejected and the cut survives for a later valid paste", async () => {
    const moves: string[] = [];
    const holder = depsWith((item, dest) => {
      moves.push(item.id);
      return Promise.resolve({
        ok: true,
        value: { ...item, parentFolderUri: dest },
      } as ContentResult<ContentItem>);
    });
    await withMessageStubs(holder, async () => {
      cut(holder.deps, fileMember);

      await paste(holder.deps, { ...targetFolder, inRecycleBin: true });
      assert.equal(moves.length, 0);
      assert.match(
        holder.warnings[0] ?? "",
        /Recycle Bin can only be restored, not moved/,
      );

      // The rejected paste did not consume the cut — retrying onto a real
      // folder still works.
      await paste(holder.deps, targetFolder);
      assert.deepEqual(moves, ["m1"]);
    });
  });

  it("paste onto a file (target-not-a-folder) is rejected", async () => {
    const holder = depsWith(notCalled);
    await withMessageStubs(holder, async () => {
      cut(holder.deps, fileMember);
      await paste(holder.deps, { ...fileMember, id: "other-file" });
      assert.match(
        holder.warnings[0] ?? "",
        /is not a folder you can move items into\./,
      );
    });
  });

  it("paste onto the item's own current folder (already-there) is rejected by name", async () => {
    const holder = depsWith(notCalled);
    const currentParent: ContentItem = {
      ...targetFolder,
      id: "src",
      name: "Src",
      uri: "/folders/folders/src",
      links: [{ rel: "self", href: "/folders/folders/src", method: "GET" }],
    };
    await withMessageStubs(holder, async () => {
      cut(holder.deps, fileMember); // fileMember.parentFolderUri === "/folders/folders/src"
      await paste(holder.deps, currentParent);
      assert.match(
        holder.warnings[0] ?? "",
        /"model\.py" is already in "Src"\./,
      );
    });
  });

  it("paste onto itself (into-itself) is rejected", async () => {
    const holder = depsWith(notCalled);
    const selfTarget: ContentItem = {
      ...fileMember,
      contentType: "folder",
    };
    await withMessageStubs(holder, async () => {
      cut(holder.deps, fileMember);
      await paste(holder.deps, selfTarget);
      assert.match(
        holder.warnings[0] ?? "",
        /can't move a folder into itself\./,
      );
    });
  });

  it("a target with no resolvable resource href is refused before any move is attempted", async () => {
    const holder = depsWith(notCalled);
    const noHrefTarget: ContentItem = {
      id: "dest2",
      name: "NoHref",
      type: "child",
      contentType: "folder",
      links: [],
    };
    await withMessageStubs(holder, async () => {
      cut(holder.deps, fileMember);
      await paste(holder.deps, noHrefTarget);
      assert.match(
        holder.errorToasts[0] ?? "",
        /"NoHref" has no address to move into\./,
      );
    });
  });

  it("refuses a paste after switching to a different deployment, and clearCutContentItem resets it cleanly", async () => {
    const holder = depsWith(notCalled, ENDPOINT_A);
    await withMessageStubs(holder, async () => {
      cut(holder.deps, fileMember);

      // Same object, but a later call to activeEndpoint() answers with a
      // different deployment — exactly what a profile switch looks like
      // from contentCommands.ts's point of view.
      const switched: ContentCommandDeps = {
        ...holder.deps,
        activeEndpoint: () => ENDPOINT_B,
      };
      await paste(switched, targetFolder);
      assert.match(
        holder.errorToasts[0] ?? "",
        /"model\.py" was cut from a different connection\. Cut it again/,
      );
      assert.equal(holder.state.refreshed, 0);
    });

    // clearCutContentItem (what contentExplorer.ts calls on a real profile
    // change / sign-out) leaves no cut behind for the next paste either.
    holder.errorToasts.length = 0;
    clearCutContentItem();
    await withMessageStubs(holder, async () => {
      await paste(holder.deps, targetFolder);
      assert.match(holder.errorToasts[0] ?? "", /Nothing has been cut yet/);
    });
  });

  it("a failed move restores the cut so a retry needs no re-cut", async () => {
    let attempts = 0;
    const failing = depsWith(() => {
      attempts += 1;
      return Promise.resolve({
        ok: false,
        reason: "rejected",
        problem: {
          code: "content-rejected",
          error: { status: 409, detail: "name clash" },
        },
      } as ContentResult<ContentItem>);
    });

    await withMessageStubs(failing, async () => {
      cut(failing.deps, fileMember);
      await paste(failing.deps, targetFolder);
      assert.equal(attempts, 1);
      assert.equal(failing.errors.length, 1);
    });

    // The cut slot is module state, not carried on `deps` — a second
    // attempt through different deps (this one succeeding) confirms the
    // failed move above left the cut armed rather than consuming it.
    const succeeding = depsWith((item, dest) =>
      Promise.resolve({
        ok: true,
        value: { ...item, parentFolderUri: dest },
      } as ContentResult<ContentItem>),
    );
    await withMessageStubs(succeeding, async () => {
      await paste(succeeding.deps, targetFolder);
      assert.doesNotMatch(
        succeeding.errorToasts[0] ?? "",
        /Nothing has been cut yet/,
      );
      assert.equal(succeeding.state.refreshed, 1);
      assert.deepEqual(
        succeeding.state.revealed.map((i) => i.id),
        ["m1"],
      );
    });
  });
});

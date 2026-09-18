// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import * as vscode from "vscode";

import {
  type DataResult,
  type LibraryAdapter,
} from "../../../src/data/adapter";
import { SasLibraryTreeProvider } from "../../../src/data/dataTree";
import { type DataItem, type LibraryItem } from "../../../src/data/types";

/**
 * `SasLibraryTreeProvider`'s mapping onto a real `vscode.TreeItem`, and the
 * 11c fixes: a failed listing renders a `ConnectionProblemNode` instead of a
 * silent empty list (B1), and a `session-gone` reading calls `forgetProfile`
 * so `pythonOnViya.connected` re-syncs rather than leaving **Connect**
 * hidden behind **Disconnect** (B2). Runs in the extension host because it
 * constructs `vscode.TreeItem`/`vscode.ThemeIcon`, mirroring
 * `test/integration/cas/tree.test.ts` and `test/integration/content/tree.test.ts`'s
 * own harness shape — the one gap the Phase 7→8 housekeeping checkpoint left
 * for `dataTree.ts` (no test file existed at all before this).
 */

const PROFILE_ID = "p1";

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

function library(over: Partial<LibraryItem> = {}): LibraryItem {
  return {
    kind: "library",
    name: "SASHELP",
    readOnly: true,
    links: [],
    ...over,
  };
}

function adapterReturning(
  libraries: DataResult<readonly DataItem[]>,
): LibraryAdapter {
  return {
    profileId: PROFILE_ID,
    getLibraries: () => Promise.resolve(libraries),
    getTables: () => Promise.resolve(libraries),
  } as unknown as LibraryAdapter;
}

function makeProvider(adapter: LibraryAdapter | undefined): {
  provider: SasLibraryTreeProvider;
  errors: string[];
  forgotten: string[];
} {
  const { channel, errors } = fakeLog();
  const forgotten: string[] = [];
  const provider = new SasLibraryTreeProvider(
    () => adapter,
    channel,
    (profileId) => forgotten.push(profileId),
  );
  return { provider, errors, forgotten };
}

describe("SasLibraryTreeProvider", () => {
  it("never throws when there is no active profile", async () => {
    const { provider } = makeProvider(undefined);
    assert.deepEqual(await provider.getChildren(), []);
  });

  it("returns the adapter's libraries on the happy path", async () => {
    const libraries = [library({ name: "WORK" }), library({ name: "SASHELP" })];
    const { provider } = makeProvider(
      adapterReturning({ ok: true, value: libraries }),
    );

    const children = await provider.getChildren();

    assert.deepEqual(children, libraries);
  });

  it("renders a connection-problem node instead of a silent empty list when not-connected (B1), without forgetting the profile", async () => {
    const { provider, errors, forgotten } = makeProvider(
      adapterReturning({
        ok: false,
        reason: "no active SAS Viya session for browsing libraries",
        problem: { code: "not-connected" },
      }),
    );

    const children = await provider.getChildren();

    assert.equal(children.length, 1);
    assert.equal(errors.length, 1);
    assert.match(errors[0] ?? "", /SAS Libraries:/);
    // Genuinely never had a session — nothing for `forgetProfile` to correct.
    assert.deepEqual(forgotten, []);

    const [node] = children;
    assert.ok(node !== undefined);
    const treeItem = provider.getTreeItem(node);
    assert.ok(treeItem.iconPath instanceof vscode.ThemeIcon);
    assert.equal(treeItem.iconPath.id, "warning");
    assert.equal(treeItem.command?.command, "pythonOnViya.refreshDataExplorer");
  });

  it("renders a connection-problem node and forgets the profile when the session is actually gone (B2)", async () => {
    const { provider, errors, forgotten } = makeProvider(
      adapterReturning({
        ok: false,
        reason: "the compute session is no longer available",
        problem: {
          code: "compute",
          problem: {
            code: "session-gone",
            error: { status: 404, message: "" },
          },
        },
      }),
    );

    const children = await provider.getChildren();

    assert.equal(children.length, 1);
    assert.equal(errors.length, 1);
    // The window's own cached belief that this profile still holds a
    // session was wrong — `pythonOnViya.connected` must re-sync so
    // **Connect** reappears in the palette instead of staying hidden
    // behind **Disconnect**.
    assert.deepEqual(forgotten, [PROFILE_ID]);
  });

  it("does not forget the profile for a failure unrelated to the session being gone", async () => {
    const { forgotten, provider } = makeProvider(
      adapterReturning({
        ok: false,
        reason: "the compute service refused the request",
        problem: {
          code: "compute",
          problem: { code: "forbidden", error: { status: 403, message: "" } },
        },
      }),
    );

    await provider.getChildren();

    assert.deepEqual(forgotten, []);
  });
});

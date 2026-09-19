// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { ThemeIcon } from "vscode";
import type * as vscode from "vscode";

import { type CasAdapter } from "../../../src/cas/adapter";
import { type CasResult } from "../../../src/cas/client";
import { SasCasTreeProvider, type CasTreeNode } from "../../../src/cas/casTree";
import { type CasItem, type CasTableItem } from "../../../src/cas/types";

/**
 * `SasCasTreeProvider`'s mapping onto a real `vscode.TreeItem`, and the
 * icon-refresh fix for an unloaded table (manual test finding, 2026-09-14):
 * expanding an unloaded table triggers `CasAdapter.getColumns`'s own JIT-load
 * `PUT`, but the tree's own `table` reference is stale, so nothing told VS
 * Code to redraw the node — the icon stayed "unloaded" (cloud) until the
 * user ran **Refresh CAS** by hand. Mirrors
 * `test/integration/content/tree.test.ts`'s own harness shape.
 *
 * **These tests were rewritten after PR #173's fix was found not to work
 * live.** The originals asserted the fired element was a state-updated
 * *copy* (`{ ...table, state: "loaded" }`) — which is exactly the defect:
 * `onDidChangeTreeData` resolves an element through an identity-keyed map,
 * so a copy the extension never handed out is dropped silently. Asserting
 * the copy's *shape* could never catch that. The assertions below are on the
 * two things that actually govern whether the icon flips in a real window:
 * the fired element is the **identical object** VS Code passed in, and a
 * subsequent `getTreeItem` for it yields the loaded icon.
 */

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

function table(over: Partial<CasTableItem> = {}): CasTableItem {
  return {
    kind: "table",
    serverName: "cas-shared-default",
    caslibName: "Public",
    name: "CARS",
    state: "unloaded",
    links: [],
    ...over,
  };
}

function adapterReturning(
  columns: CasResult<readonly CasItem[]> = { ok: true, value: [] },
): CasAdapter & { getColumnsCalls: number } {
  // The provider calls only `getColumns` for a table node.
  const adapter = {
    getColumnsCalls: 0,
    getColumns() {
      adapter.getColumnsCalls += 1;
      return Promise.resolve(columns);
    },
  };
  return adapter as unknown as CasAdapter & { getColumnsCalls: number };
}

function makeProvider(adapter: CasAdapter | undefined): {
  provider: SasCasTreeProvider;
  errors: string[];
  fired: (CasTreeNode | undefined)[];
} {
  const { channel, errors } = fakeLog();
  const provider = new SasCasTreeProvider(() => adapter, channel);
  const fired: (CasTreeNode | undefined)[] = [];
  provider.onDidChangeTreeData((item) => fired.push(item));
  return { provider, errors, fired };
}

/** The `ThemeIcon` id `getTreeItem` chose for an item — `"cloud"` for an
 * unloaded table, `"table"` for a loaded one (`src/cas/presentation.ts`). */
function iconOf(provider: SasCasTreeProvider, item: CasItem): string {
  const { iconPath } = provider.getTreeItem(item);
  assert.ok(iconPath instanceof ThemeIcon, "expected a ThemeIcon");
  return iconPath.id;
}

describe("SasCasTreeProvider", () => {
  it("fires a refresh with the identical element after an unloaded table's columns load", async () => {
    // The regression guard for the defect PR #173 shipped: VS Code resolves a
    // fired element through `_nodes: Map<T, TreeNode>`, keyed by the object
    // the extension itself handed out. A `{ ...table, state: "loaded" }` copy
    // is absent from that map, so `_getHandlesToRefresh` yields no handle and
    // the event is dropped with no error — the icon never flips, and no test
    // that checks only the fired element's *shape* can tell.
    const adapter = adapterReturning({ ok: true, value: [] });
    const { provider, fired } = makeProvider(adapter);
    const node = table({ state: "unloaded" });

    const children = await provider.getChildren(node);

    assert.deepEqual(children, []);
    assert.equal(fired.length, 1);
    assert.strictEqual(
      fired[0],
      node,
      "must fire the very object VS Code handed in — a copy is silently dropped",
    );
  });

  it("draws the loaded icon for a table it watched load, without a refresh", async () => {
    // The user-visible half: `state` on the item VS Code holds is still the
    // caslib listing's stale "unloaded", so the flip has to come from the
    // provider's own record of what it watched load.
    const adapter = adapterReturning({ ok: true, value: [] });
    const { provider } = makeProvider(adapter);
    const node = table({ state: "unloaded" });

    assert.equal(iconOf(provider, node), "cloud");
    await provider.getChildren(node);

    assert.equal(iconOf(provider, node), "table");
    assert.equal(
      node.state,
      "unloaded",
      "the element itself must not be mutated — VS Code's cache holds this object",
    );
  });

  it("drops the loaded-icon override on refresh, deferring to the server's own state", async () => {
    const adapter = adapterReturning({ ok: true, value: [] });
    const { provider } = makeProvider(adapter);
    const node = table({ state: "unloaded" });

    await provider.getChildren(node);
    assert.equal(iconOf(provider, node), "table");

    provider.refresh();

    assert.equal(
      iconOf(provider, node),
      "cloud",
      "after a re-listing the server's own state is authoritative again",
    );
  });

  it("keeps the unloaded icon when getColumns fails", async () => {
    const adapter = adapterReturning({
      ok: false,
      reason: "the CAS management service refused the request",
      problem: { code: "cas-rejected", error: { status: 404 } },
    });
    const { provider } = makeProvider(adapter);
    const node = table({ state: "unloaded" });

    await provider.getChildren(node);

    assert.equal(iconOf(provider, node), "cloud");
  });

  it("PR #173 review: serves VS Code's own re-entrant getChildren call from cache rather than fetching columns twice", async () => {
    // Firing onDidChangeTreeData for a table while it is mid-expansion is
    // expected to make VS Code re-invoke getChildren for that same node
    // immediately (the API's own "and its children recursively, if shown"
    // contract) — this simulates exactly that re-entrant call, passing back
    // the fired element the way VS Code would.
    const columns: CasResult<readonly CasItem[]> = {
      ok: true,
      value: [{ kind: "column", name: "x" } as unknown as CasItem],
    };
    const adapter = adapterReturning(columns);
    const { provider, fired } = makeProvider(adapter);

    const first = await provider.getChildren(table({ state: "unloaded" }));
    assert.equal(adapter.getColumnsCalls, 1);
    assert.equal(fired.length, 1);

    const second = await provider.getChildren(fired[0]);

    assert.equal(
      adapter.getColumnsCalls,
      1,
      "a re-entrant getChildren for the just-refreshed node must not re-fetch",
    );
    assert.deepEqual(second, first);
  });

  it("PR #173 review: a genuine later re-expand of the same table still fetches for real", async () => {
    const adapter = adapterReturning({ ok: true, value: [] });
    const { provider, fired } = makeProvider(adapter);

    await provider.getChildren(table({ state: "unloaded" }));
    await provider.getChildren(fired[0]); // the re-entrant call
    await provider.getChildren(table({ state: "unloaded" })); // a later, real re-expand

    assert.equal(adapter.getColumnsCalls, 2);
  });

  it("PR #173 review (second pass): refresh() clears a justLoaded entry whose re-entrant call never arrived", async () => {
    // Simulates the bot's own scenario: the node was collapsed (or the view
    // was hidden) before VS Code's expected re-entrant getChildren call ever
    // reached this provider, so the cached columns are never consumed by it.
    // An explicit refresh (Refresh CAS, a profile switch, sign-in/out) must
    // still discard that stale entry rather than let a later, unrelated
    // re-expand of the same table be served it.
    const adapter = adapterReturning({ ok: true, value: [] });
    const { provider } = makeProvider(adapter);

    await provider.getChildren(table({ state: "unloaded" }));
    assert.equal(adapter.getColumnsCalls, 1);
    // No re-entrant call here — the entry sits unconsumed.

    provider.refresh();
    await provider.getChildren(table({ state: "unloaded" }));

    assert.equal(
      adapter.getColumnsCalls,
      2,
      "refresh() must drop the stale entry rather than let it be served later",
    );
  });

  it("does not fire a refresh for a table that was already loaded", async () => {
    const adapter = adapterReturning({ ok: true, value: [] });
    const { provider, fired } = makeProvider(adapter);

    await provider.getChildren(table({ state: "loaded" }));

    assert.equal(fired.length, 0);
  });

  it("does not fire a refresh when getColumns fails, and renders a connection-problem node instead of a silent empty list (11c, B1)", async () => {
    const adapter = adapterReturning({
      ok: false,
      reason: "the CAS management service refused the request",
      problem: { code: "cas-rejected", error: { status: 404 } },
    });
    const { provider, fired, errors } = makeProvider(adapter);

    const children = await provider.getChildren(table({ state: "unloaded" }));

    assert.equal(children.length, 1);
    assert.equal(fired.length, 0);
    assert.equal(errors.length, 1);

    const [node] = children;
    assert.ok(node !== undefined);
    const treeItem = provider.getTreeItem(node);
    assert.ok(treeItem.iconPath instanceof ThemeIcon);
    assert.equal(treeItem.iconPath.id, "warning");
    assert.equal(treeItem.command?.command, "pythonOnViya.refreshCasExplorer");
  });

  it("never throws when there is no active deployment", async () => {
    const { provider } = makeProvider(undefined);
    const children = await provider.getChildren(table());
    assert.deepEqual(children, []);
  });
});

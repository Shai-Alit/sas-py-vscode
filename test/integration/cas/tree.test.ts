// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import type * as vscode from "vscode";

import { type CasAdapter } from "../../../src/cas/adapter";
import { type CasResult } from "../../../src/cas/client";
import { SasCasTreeProvider } from "../../../src/cas/casTree";
import { type CasItem, type CasTableItem } from "../../../src/cas/types";

/**
 * `SasCasTreeProvider`'s mapping onto a real `vscode.TreeItem`, and the
 * icon-refresh fix for an unloaded table (manual test finding, 2026-09-14):
 * expanding an unloaded table triggers `CasAdapter.getColumns`'s own JIT-load
 * `PUT`, but the tree's own `table` reference is stale, so nothing told VS
 * Code to redraw the node — the icon stayed "unloaded" (cloud) until the
 * user ran **Refresh CAS** by hand. Mirrors
 * `test/integration/content/tree.test.ts`'s own harness shape.
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
  fired: (CasItem | undefined)[];
} {
  const { channel, errors } = fakeLog();
  const provider = new SasCasTreeProvider(() => adapter, channel);
  const fired: (CasItem | undefined)[] = [];
  provider.onDidChangeTreeData((item) => fired.push(item));
  return { provider, errors, fired };
}

describe("SasCasTreeProvider", () => {
  it("fires a refresh with a loaded copy after an unloaded table's columns load", async () => {
    const adapter = adapterReturning({ ok: true, value: [] });
    const { provider, fired } = makeProvider(adapter);

    const children = await provider.getChildren(table({ state: "unloaded" }));

    assert.deepEqual(children, []);
    assert.equal(fired.length, 1);
    const [refreshed] = fired;
    assert.ok(refreshed !== undefined);
    assert.equal((refreshed as CasTableItem).state, "loaded");
    assert.equal((refreshed as CasTableItem).name, "CARS");
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

    const second = await provider.getChildren(fired[0] as CasTableItem);

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
    await provider.getChildren(fired[0] as CasTableItem); // the re-entrant call
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

  it("does not fire a refresh when getColumns fails", async () => {
    const adapter = adapterReturning({
      ok: false,
      reason: "the CAS management service refused the request",
      problem: { code: "cas-rejected", error: { status: 404 } },
    });
    const { provider, fired, errors } = makeProvider(adapter);

    const children = await provider.getChildren(table({ state: "unloaded" }));

    assert.deepEqual(children, []);
    assert.equal(fired.length, 0);
    assert.equal(errors.length, 1);
  });

  it("never throws when there is no active deployment", async () => {
    const { provider } = makeProvider(undefined);
    const children = await provider.getChildren(table());
    assert.deepEqual(children, []);
  });
});

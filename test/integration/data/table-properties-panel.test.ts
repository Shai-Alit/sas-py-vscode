// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * `TablePropertiesPanelManager`/`TablePropertiesPanel` (7c-ii) against a fake
 * `TablePropertiesWebviewPanel` and a **real** `LibraryAdapter` wired to
 * recorded `DataAccessApi` fixtures — the same shape
 * `data-viewer-panel.test.ts` already uses for `DataViewerPanelManager`, and
 * the same fixtures (`table-detail-class.json`, now carrying 7c-ii's fuller
 * `TableInfo` field set; `columns-class.json`).
 *
 * This is an integration test, not a unit one, because `tablePropertiesPanel.ts`
 * imports `vscode` (`.c8rc.json` excludes it from unit coverage for exactly
 * that reason) — the pure formatting helpers it calls
 * (`tablePropertiesModel.ts`) are unit-tested directly in
 * `test/unit/data-table-properties-model.test.ts`, and `LibraryAdapter`
 * itself in `test/unit/data-adapter.test.ts`.
 *
 * Unlike the data viewer panel, there is no `"ready"` handshake to drive —
 * this panel has no message loop at all, so every case that exercises a
 * render simply `await`s `manager.open(...)` and reads `fake.panel.webview.html`
 * straight afterward.
 */

import assert from "node:assert/strict";

import * as vscode from "vscode";

import {
  LibraryAdapter,
  type ConnectedSession,
  type LibrarySessionSource,
} from "../../../src/data/adapter";
import {
  TablePropertiesPanelManager,
  type TablePropertiesWebviewPanel,
} from "../../../src/data/tablePropertiesPanel";
import { type TableItem } from "../../../src/data/types";
import {
  dataFail,
  dataFixture,
  recordedDataClient,
  type RecordedDataRoute,
} from "../../helpers/recorded-data";
import type {
  ComputeClient,
  ComputeResponse,
  ComputeResult,
} from "../../../src/compute/client";
import type { ComputeSession } from "../../../src/compute/session";

const SESSION_ID = "aaaaaaaa-0000-4000-8000-000000000001-ses0000";
const LIBREFS_HREF = `/compute/sessions/${SESSION_ID}/data`;
const CLASS_HREF = `${LIBREFS_HREF}/SASHELP/CLASS`;
const PROFILE_ID = "profile-1";

/** Same shape `data-viewer-panel.test.ts`'s own `tableItem()` builds,
 * duplicated rather than imported for the same reason that file's own
 * comment gives. */
function tableItem(overrides: Partial<TableItem> = {}): TableItem {
  return {
    kind: "table",
    libref: "SASHELP",
    name: "CLASS",
    readOnly: true,
    links: overrides.links ?? [
      {
        rel: "self",
        href: CLASS_HREF,
        method: "GET",
        type: "application/vnd.sas.compute.data.table",
      },
    ],
    ...overrides,
  };
}

function libraryAdapter(routes: readonly RecordedDataRoute[]): LibraryAdapter {
  const { client } = recordedDataClient(routes);
  const session: ComputeSession = { id: SESSION_ID, state: "idle", links: [] };
  const sessions: LibrarySessionSource = {
    isBusy: () => false,
    current: (): ConnectedSession | undefined => ({ client, session }),
  };
  return new LibraryAdapter(sessions, PROFILE_ID);
}

const OPEN_ROUTES: readonly RecordedDataRoute[] = [
  { when: CLASS_HREF, reply: dataFixture("table-detail-class.json") },
  {
    when: `${CLASS_HREF}/columns`,
    reply: dataFixture("columns-class.json"),
  },
];

/** A `TablePropertiesWebviewPanel` double — narrower than `data-viewer-panel
 * .test.ts`'s own `fakePanel()`, since this panel never receives or posts a
 * message. */
function fakePanel(): {
  readonly panel: TablePropertiesWebviewPanel;
  readonly revealed: { column: vscode.ViewColumn; preserveFocus: boolean }[];
  readonly disposed: boolean[];
} {
  const revealed: { column: vscode.ViewColumn; preserveFocus: boolean }[] = [];
  const disposed: boolean[] = [];
  const disposeListeners: (() => void)[] = [];

  const panel: TablePropertiesWebviewPanel = {
    webview: {
      html: "",
    },
    reveal: (column, preserveFocus) => {
      revealed.push({
        column: column ?? vscode.ViewColumn.Active,
        preserveFocus: preserveFocus ?? false,
      });
    },
    onDidDispose: (listener) => {
      disposeListeners.push(listener);
      return { dispose: () => undefined };
    },
    dispose: () => {
      disposed.push(true);
      for (const listener of disposeListeners) listener();
    },
  };

  return { panel, revealed, disposed };
}

describe("TablePropertiesPanelManager", () => {
  it("renders the table's properties once openTable/getColumns resolve", async () => {
    const fake = fakePanel();
    const manager = new TablePropertiesPanelManager({
      createPanel: () => fake.panel,
    });

    await manager.open(tableItem(), libraryAdapter(OPEN_ROUTES));

    const html = fake.panel.webview.html;
    // General/Size/Technical fields — Finding 7.19's own real values.
    assert.match(html, /Student Data/);
    assert.match(html, /V9/);
    assert.match(html, />DATA</);
    assert.match(html, /NO/);
    assert.match(html, /us-ascii/);
    // Columns tab.
    assert.match(html, />Name</);
    assert.match(html, />Sex</);
    assert.match(html, />FLOAT</);
    // No script anywhere in this panel.
    assert.doesNotMatch(html, /<script/);
    assert.match(html, /default-src 'none'/);
  });

  it("keeps both radio inputs as direct siblings of the panes they reveal, not nested in a wrapper div", async () => {
    // Manual test pass §13, 2026-09-10 (Sean, live): both tabs rendered but
    // the pane content was always blank. Root cause: an earlier version
    // wrapped the two radio inputs (and their labels) in their own
    // `<div class="...tabs">`, but `panelHead()`'s tab-switch CSS relies on
    // the general sibling combinator (`#tab-properties:checked ~
    // #pane-properties`), which only matches elements sharing the *same
    // parent* as the checked input — nesting the input one level deeper than
    // the panes meant that selector could never match, so `display: none`
    // never lifted for either pane. This asserts the exact flat sibling
    // order the fix depends on: nothing opens a wrapping element between the
    // "Properties" input and the "Properties" pane, or between the "Columns"
    // input and the "Columns" pane.
    const fake = fakePanel();
    const manager = new TablePropertiesPanelManager({
      createPanel: () => fake.panel,
    });

    await manager.open(tableItem(), libraryAdapter(OPEN_ROUTES));

    const html = fake.panel.webview.html;
    assert.match(
      html,
      /<input[^>]*id="python-on-viya-tab-properties"[^>]*>\s*<label[^>]*for="python-on-viya-tab-properties"[^>]*>[^<]*<\/label>\s*<input[^>]*id="python-on-viya-tab-columns"[^>]*>\s*<label[^>]*for="python-on-viya-tab-columns"[^>]*>[^<]*<\/label>\s*<div[^>]*class="python-on-viya-table-properties-tabs-underline"[^>]*><\/div>\s*<div[^>]*id="python-on-viya-pane-properties"/,
    );
  });

  it("locks style-src to the <style> tag's own nonce, with no 'unsafe-inline' anywhere", async () => {
    // PR review, 2026-09-11 (blocking): an earlier version of this panel
    // used `style-src {cspSource} 'unsafe-inline'`, reasoning that every
    // dynamic value is already `escapeHtml`-escaped so nothing could exploit
    // it — true, but weaker than not needing the exception at all. Unlike
    // `dataViewerPanel.ts` (which genuinely needs `'unsafe-inline'` for
    // ag-grid's own runtime-set `style="…"` *attributes*, which a nonce
    // cannot cover), this panel has exactly one `<style>` *element* and no
    // inline `style="…"` attributes anywhere, so a nonce removes the
    // exception entirely.
    const fake = fakePanel();
    const manager = new TablePropertiesPanelManager({
      createPanel: () => fake.panel,
    });
    await manager.open(tableItem(), libraryAdapter(OPEN_ROUTES));

    const html = fake.panel.webview.html;
    assert.doesNotMatch(html, /unsafe-inline/);
    const cspNonce = /style-src 'nonce-([^']+)'/.exec(html)?.[1];
    const styleNonce = /<style nonce="([^"]+)"/.exec(html)?.[1];
    assert.ok(cspNonce !== undefined && cspNonce.length > 0);
    assert.equal(styleNonce, cspNonce);
  });

  it("shows a loading placeholder synchronously, before the fetch resolves", () => {
    const fake = fakePanel();
    const manager = new TablePropertiesPanelManager({
      createPanel: () => fake.panel,
    });

    // Deliberately not awaited — the assertion below reads the panel's html
    // right after `open()`'s synchronous prefix has run (setting the
    // placeholder) but before its first `await` has had a chance to settle.
    void manager.open(tableItem(), libraryAdapter(OPEN_ROUTES));

    assert.match(fake.panel.webview.html, /Loading/);
  });

  it("renders a failure message when openTable finds no self link", async () => {
    const fake = fakePanel();
    const manager = new TablePropertiesPanelManager({
      createPanel: () => fake.panel,
    });

    await manager.open(tableItem({ links: [] }), libraryAdapter([]));

    assert.match(fake.panel.webview.html, /did not offer that operation/);
  });

  it("renders a failure message when the columns fetch fails, after openTable already succeeded", async () => {
    const fake = fakePanel();
    const manager = new TablePropertiesPanelManager({
      createPanel: () => fake.panel,
    });

    await manager.open(
      tableItem(),
      libraryAdapter([
        { when: CLASS_HREF, reply: dataFixture("table-detail-class.json") },
        {
          when: `${CLASS_HREF}/columns`,
          reply: dataFail({ code: "compute-rejected", error: { status: 500 } }),
        },
      ]),
    );

    // Not the properties render — no "Student Data" label leaks through from
    // a half-finished load.
    assert.doesNotMatch(fake.panel.webview.html, /Student Data/);
  });

  it("renders a failure message, then rethrows, when the adapter call rejects rather than answering { ok: false }", async () => {
    // PR review, 2026-09-11 (Codex, Major): `openTable`/`getColumns` are
    // total for every failure `LibraryAdapter` itself anticipates, but the
    // one narrow path `dataExplorer.ts`'s own command handler already
    // documents (`ComputeClient.send` rethrowing whatever `resolveHref`
    // throws that is not a `ForeignLinkError`) used to leave the panel stuck
    // on "Loading…" forever. A raw `ComputeClient` whose `send` rejects
    // reproduces that exact shape without needing a real `resolveHref`
    // failure.
    const fake = fakePanel();
    const manager = new TablePropertiesPanelManager({
      createPanel: () => fake.panel,
    });
    const client: ComputeClient = {
      send: () => Promise.reject(new Error("boom")),
    };
    const sessions: LibrarySessionSource = {
      isBusy: () => false,
      current: (): ConnectedSession => ({
        client,
        session: { id: SESSION_ID, state: "idle", links: [] },
      }),
    };

    await assert.rejects(
      manager.open(tableItem(), new LibraryAdapter(sessions, PROFILE_ID)),
      /boom/,
    );

    assert.match(fake.panel.webview.html, /boom/);
    assert.doesNotMatch(fake.panel.webview.html, /Loading/);
  });

  it("reveals the existing panel and issues no new request for a table already open", async () => {
    const fake = fakePanel();
    const manager = new TablePropertiesPanelManager({
      createPanel: () => fake.panel,
    });
    const { client, calls } = recordedDataClient(OPEN_ROUTES);
    const session: ComputeSession = {
      id: SESSION_ID,
      state: "idle",
      links: [],
    };
    const sessions: LibrarySessionSource = {
      isBusy: () => false,
      current: (): ConnectedSession => ({ client, session }),
    };
    const adapter = new LibraryAdapter(sessions, PROFILE_ID);

    await manager.open(tableItem(), adapter);
    assert.equal(calls.length, 2, "openTable, then getColumns");

    await manager.open(tableItem(), adapter);
    assert.equal(calls.length, 2, "no new request for the same table");
    assert.equal(fake.revealed.length, 1);
  });

  it("opens a fresh panel, not the other profile's, for the same table under a different profile", async () => {
    const firstPanel = fakePanel();
    const secondPanel = fakePanel();
    let call = 0;
    const manager = new TablePropertiesPanelManager({
      createPanel: () => (call++ === 0 ? firstPanel.panel : secondPanel.panel),
    });

    await manager.open(tableItem(), libraryAdapter(OPEN_ROUTES));

    const { client, calls } = recordedDataClient(OPEN_ROUTES);
    const session: ComputeSession = {
      id: SESSION_ID,
      state: "idle",
      links: [],
    };
    const secondProfile = new LibraryAdapter(
      {
        isBusy: () => false,
        current: (): ConnectedSession => ({ client, session }),
      },
      "profile-2",
    );
    await manager.open(tableItem(), secondProfile);

    assert.equal(
      calls.length,
      2,
      "second profile issues its own openTable/getColumns, not a reveal",
    );
    assert.equal(firstPanel.revealed.length, 0);
    assert.equal(secondPanel.revealed.length, 0);
  });

  it("aborts its own AbortController when the panel is disposed mid-load", async () => {
    let capturedSignal: AbortSignal | undefined;
    const routes: readonly RecordedDataRoute[] = [
      { when: CLASS_HREF, reply: dataFixture("table-detail-class.json") },
      {
        when: `${CLASS_HREF}/columns`,
        reply: (request) => {
          capturedSignal = request.signal;
          return dataFixture("columns-class.json");
        },
      },
    ];
    const fake = fakePanel();
    const manager = new TablePropertiesPanelManager({
      createPanel: () => fake.panel,
    });

    await manager.open(tableItem(), libraryAdapter(routes));

    assert.ok(capturedSignal !== undefined, "getColumns should carry a signal");
    assert.equal(capturedSignal.aborted, false, "not aborted before dispose");

    fake.panel.dispose();

    assert.equal(
      capturedSignal.aborted,
      true,
      "disposing the panel should abort the same controller its adapter calls used",
    );
  });

  it("does not render into a panel disposed while its own fetch was still in flight", async () => {
    let resolveColumns:
      ((result: ComputeResult<ComputeResponse>) => void) | undefined;
    const { client: baseClient } = recordedDataClient(OPEN_ROUTES);
    const client: ComputeClient = {
      send: (request) => {
        if (request.link.href === `${CLASS_HREF}/columns`) {
          return new Promise((resolve) => {
            resolveColumns = resolve;
          });
        }
        return baseClient.send(request);
      },
    };
    const sessions: LibrarySessionSource = {
      isBusy: () => false,
      current: (): ConnectedSession => ({
        client,
        session: { id: SESSION_ID, state: "idle", links: [] },
      }),
    };
    const fake = fakePanel();
    const manager = new TablePropertiesPanelManager({
      createPanel: () => fake.panel,
    });

    const opened = manager.open(
      tableItem(),
      new LibraryAdapter(sessions, PROFILE_ID),
    );
    // Let openTable resolve and getColumns start (and stall).
    await new Promise((resolve) => setImmediate(resolve));

    fake.panel.dispose();
    const htmlAtDispose = fake.panel.webview.html;

    assert.ok(resolveColumns, "the stalled getColumns call should exist");
    resolveColumns(dataFixture("columns-class.json"));
    await opened;

    assert.equal(
      fake.panel.webview.html,
      htmlAtDispose,
      "a panel disposed mid-load is never written to again once its fetch resolves",
    );
  });

  it("disposes every open panel", async () => {
    const first = fakePanel();
    const second = fakePanel();
    let call = 0;
    const manager = new TablePropertiesPanelManager({
      createPanel: () => (call++ === 0 ? first.panel : second.panel),
    });
    await manager.open(tableItem(), libraryAdapter(OPEN_ROUTES));
    await manager.open(
      tableItem({ name: "SHOES" }),
      libraryAdapter(OPEN_ROUTES),
    );

    manager.dispose();
    assert.deepEqual(first.disposed, [true]);
    assert.deepEqual(second.disposed, [true]);
  });
});

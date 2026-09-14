// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * `DataViewerPanelManager`/`OpenTablePanel` (`src/data/dataViewerPanel.ts`,
 * 7b/ADR-0028) opening a **CAS** table (8c) — a real `CasAdapter` wrapped in
 * `CasTableSource` (`src/cas/casTableSource.ts`), wired to recorded
 * `casManagement`/Data Tables/`rowSets` fixtures
 * (`test/helpers/recorded-cas.ts`, `test/fixtures/cas/`), against a fake
 * `DataWebviewPanel` — the same double shape
 * `test/integration/data/data-viewer-panel.test.ts` uses for a Library table.
 *
 * This file's own job is narrower than that one's: `CasTableSource` has no
 * view-creation machinery to exercise (Findings 8.11/8.12 — sort and filter
 * are plain query parameters on every `getRows` call), so this covers what is
 * actually different about the CAS path — the JIT-load-before-open gate, the
 * combined sort+filter request, and the panel manager's own generic wiring
 * reached through a second `TableSource` implementation — rather than
 * re-asserting the CSP/HTML-shell/dispose behaviour the Library-backed file
 * already covers, since none of that varies by backend.
 */

import assert from "node:assert/strict";

import * as vscode from "vscode";

import { CasAdapter } from "../../../src/cas/adapter";
import { CasTableSource } from "../../../src/cas/casTableSource";
import { readCasTableItem, type CasTableItem } from "../../../src/cas/types";
import {
  DataViewerPanelManager,
  type DataWebviewPanel,
} from "../../../src/data/dataViewerPanel";
import {
  isRequestRowsMessage,
  type DataViewerHostMessage,
} from "../../../src/data/dataViewerModel";
import {
  casFail,
  casFixture,
  casText,
  recordedCasClient,
  type RecordedCasCall,
  type RecordedCasRoute,
} from "../../helpers/recorded-cas";

const CASLIBS_HREF = "/casManagement/servers/cas-shared-default/caslibs";
const TABLES_HREF = `${CASLIBS_HREF}/Public/tables`;
const LOAD_HREF = `${TABLES_HREF}/LOOKUP_TABLE/state`;
const DATA_TABLE_HREF =
  "/dataTables/dataSources/cas~fs~cas-shared-default~fs~Public/tables/LOOKUP_TABLE";
const ROWS_HREF =
  "/rowSets/tables/cas~fs~cas-shared-default~fs~Public~fs~LOOKUP_TABLE/rows";

/** Mirrors `cas-adapter.test.ts`'s own `loadedTable`/`unloadedTable` — every
 * table this file opens carries the same four relations (`self`,
 * `updateState`, `columns`, `dataTable`) a real casManagement listing entry
 * does. */
function table(state: "loaded" | "unloaded"): CasTableItem {
  const item = readCasTableItem(
    {
      name: "LOOKUP_TABLE",
      state,
      rowCount: state === "loaded" ? 12 : 0,
      columnCount: state === "loaded" ? 2 : 0,
      links: [
        {
          rel: "self",
          href: `${TABLES_HREF}/LOOKUP_TABLE`,
          method: "GET",
          type: "application/vnd.sas.cas.table",
        },
        {
          rel: "updateState",
          href: LOAD_HREF,
          method: "PUT",
          responseType: "application/json,text/plain",
        },
        {
          rel: "columns",
          href: `${TABLES_HREF}/LOOKUP_TABLE/columns`,
          method: "GET",
          type: "application/vnd.sas.collection",
        },
        {
          rel: "dataTable",
          href: DATA_TABLE_HREF,
          method: "GET",
          type: "application/vnd.sas.data.table",
        },
      ],
    },
    {
      kind: "caslib",
      serverName: "cas-shared-default",
      name: "Public",
      links: [],
    },
  );
  assert.ok(item);
  return item;
}

/** `casManagement`'s own `columns` collection — a different, narrower
 * endpoint than the Data Tables API's own `columns` (`COLUMNS_HREF` above,
 * unused here: 8c reuses `CasAdapter.getColumns`, per that method's own doc
 * comment, rather than re-fetching a second column listing). */
const CASMANAGEMENT_COLUMNS_HREF = `${TABLES_HREF}/LOOKUP_TABLE/columns`;

function casTableSource(
  routes: readonly RecordedCasRoute[],
  state: "loaded" | "unloaded" = "loaded",
  endpoint = "https://cas.example.com",
): { source: CasTableSource; calls: RecordedCasCall[] } {
  const { client, calls } = recordedCasClient(routes);
  const adapter = new CasAdapter(client, endpoint);
  return { source: new CasTableSource(adapter, table(state)), calls };
}

/** The routes a loaded table's happy-path open needs: the Data Tables
 * representation (for the `rows` link), then its columns. */
const OPEN_ROUTES_LOADED: readonly RecordedCasRoute[] = [
  { when: DATA_TABLE_HREF, reply: casFixture("data-table.json") },
  {
    when: CASMANAGEMENT_COLUMNS_HREF,
    reply: casFixture("columns.json"),
  },
];

/** A `DataWebviewPanel` double — the same shape
 * `data-viewer-panel.test.ts`'s own `fakePanel()` builds, duplicated rather
 * than imported (that file's own `tableItem()` doc comment gives the
 * reasoning: a small fake costs less to duplicate than to share across
 * directories). */
function fakePanel(): {
  readonly panel: DataWebviewPanel;
  readonly posted: DataViewerHostMessage[];
  sendReady(): void;
  sendRequestRows(
    requestId: string,
    start: number,
    limit: number,
    sort?: readonly { key: string; direction: "ascending" | "descending" }[],
    filter?: string,
  ): void;
} {
  const posted: DataViewerHostMessage[] = [];
  let messageListener: ((message: unknown) => void) | undefined;
  const disposeListeners: (() => void)[] = [];

  const panel: DataWebviewPanel = {
    webview: {
      html: "",
      cspSource: "vscode-webview://fake",
      asWebviewUri: (uri) => uri,
      postMessage: (message) => {
        posted.push(message as DataViewerHostMessage);
        return Promise.resolve(true);
      },
      onDidReceiveMessage: (listener) => {
        messageListener = listener;
        return { dispose: () => undefined };
      },
    },
    reveal: () => undefined,
    onDidDispose: (listener) => {
      disposeListeners.push(listener);
      return { dispose: () => undefined };
    },
    dispose: () => {
      for (const listener of disposeListeners) listener();
    },
  };

  return {
    panel,
    posted,
    sendReady: () => messageListener?.({ type: "ready" }),
    sendRequestRows: (requestId, start, limit, sort = [], filter = "") => {
      const message = {
        type: "requestRows",
        requestId,
        start,
        limit,
        sort,
        filter,
      };
      assert.ok(isRequestRowsMessage(message), "malformed test message");
      messageListener?.(message);
    },
  };
}

const extensionUri = vscode.Uri.file("/fake-extension");

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

describe("DataViewerPanelManager opening a CAS table (8c)", () => {
  it("loads columns via casManagement's own getColumns, with an unknown row count up front", async () => {
    const fake = fakePanel();
    const manager = new DataViewerPanelManager(extensionUri, {
      createPanel: () => fake.panel,
    });
    const { source } = casTableSource(OPEN_ROUTES_LOADED);

    await manager.open(source);
    fake.sendReady();

    assert.equal(fake.posted.length, 1);
    const [init] = fake.posted;
    assert.ok(init?.type === "init");
    // Not a stale `0` carried over from a listing taken before the table was
    // necessarily loaded — see `CasTableSource.open`'s own doc comment.
    assert.equal(init.rowCount, undefined);
    assert.deepEqual(
      init.columns.map((c) => [c.field, c.type]),
      [
        ["CODE", "varchar"],
        ["VALUE", "double"],
      ],
    );
  });

  it("Finding 8.11: loads an unloaded table (JIT-load) before reading its Data Tables representation", async () => {
    const fake = fakePanel();
    const manager = new DataViewerPanelManager(extensionUri, {
      createPanel: () => fake.panel,
    });
    const { source, calls } = casTableSource(
      [
        {
          when: (href, method) =>
            href.startsWith(LOAD_HREF) && method === "PUT",
          reply: casText("loaded"),
        },
        ...OPEN_ROUTES_LOADED,
      ],
      "unloaded",
    );

    await manager.open(source);
    fake.sendReady();

    assert.equal(fake.posted[0]?.type, "init");
    assert.deepEqual(
      calls.map((c) => c.href),
      [
        `${LOAD_HREF}?value=loaded`,
        DATA_TABLE_HREF,
        `${CASMANAGEMENT_COLUMNS_HREF}?sortBy=name`,
      ],
    );
  });

  it("answers a requestRows message with one window of rows and the collection's count", async () => {
    const fake = fakePanel();
    const manager = new DataViewerPanelManager(extensionUri, {
      createPanel: () => fake.panel,
    });
    const { source } = casTableSource([
      ...OPEN_ROUTES_LOADED,
      { when: ROWS_HREF, reply: casFixture("rows.json") },
    ]);

    await manager.open(source);
    fake.sendReady();
    fake.posted.length = 0;

    fake.sendRequestRows("r1", 0, 2);
    await flush();

    assert.equal(fake.posted.length, 1);
    const [reply] = fake.posted;
    assert.ok(reply?.type === "rows");
    assert.equal(reply.count, 12);
    assert.deepEqual(reply.rows, [
      ["ABC", 1.5],
      ["DEF", 2.5],
    ]);
  });

  it("sends sort and filter together on the same request — no view of any kind", async () => {
    const fake = fakePanel();
    const manager = new DataViewerPanelManager(extensionUri, {
      createPanel: () => fake.panel,
    });
    const { source, calls } = casTableSource([
      ...OPEN_ROUTES_LOADED,
      { when: ROWS_HREF, reply: casFixture("rows.json") },
    ]);

    await manager.open(source);
    fake.sendReady();
    fake.posted.length = 0;

    fake.sendRequestRows(
      "r1",
      0,
      2,
      [{ key: "Value", direction: "descending" }],
      "Code='ABC'",
    );
    await flush();

    assert.equal(fake.posted[0]?.type, "rows");
    const rowsCall = calls.find((c) => c.href.startsWith(ROWS_HREF));
    assert.equal(
      rowsCall?.href,
      `${ROWS_HREF}?start=0&limit=2&sortBy=${encodeURIComponent("Value:descending")}&where=${encodeURIComponent("Code='ABC'")}`,
    );
  });

  it("answers rowsError, scoped to the request's id, when the row fetch fails", async () => {
    const fake = fakePanel();
    const manager = new DataViewerPanelManager(extensionUri, {
      createPanel: () => fake.panel,
    });
    const { source } = casTableSource([
      ...OPEN_ROUTES_LOADED,
      {
        when: ROWS_HREF,
        reply: casFail({ code: "cas-rejected", error: { status: 500 } }),
      },
    ]);

    await manager.open(source);
    fake.sendReady();
    fake.posted.length = 0;

    fake.sendRequestRows("r7", 0, 2);
    await flush();

    assert.equal(fake.posted.length, 1);
    const [reply] = fake.posted;
    assert.ok(reply?.type === "rowsError");
    assert.equal(reply.requestId, "r7");
  });

  it("posts failure, not init, when the load fails on an unloaded table", async () => {
    const fake = fakePanel();
    const manager = new DataViewerPanelManager(extensionUri, {
      createPanel: () => fake.panel,
    });
    const { source } = casTableSource(
      [
        {
          when: (href, method) =>
            href.startsWith(LOAD_HREF) && method === "PUT",
          reply: casFail({
            code: "cas-rejected",
            error: { status: 409, message: "table is busy" },
          }),
        },
      ],
      "unloaded",
    );

    const opened = manager.open(source);
    fake.sendReady();
    await opened;

    assert.equal(fake.posted.length, 1);
    assert.equal(fake.posted[0]?.type, "failure");
  });

  it("reveals the existing panel and issues no new request for the same table", async () => {
    const fake = fakePanel();
    const manager = new DataViewerPanelManager(extensionUri, {
      createPanel: () => fake.panel,
    });
    const { client, calls } = recordedCasClient(OPEN_ROUTES_LOADED);
    const adapter = new CasAdapter(client, "https://cas.example.com");

    await manager.open(new CasTableSource(adapter, table("loaded")));
    assert.equal(calls.length, 2, "openTable's dataTable fetch, then columns");

    await manager.open(new CasTableSource(adapter, table("loaded")));
    assert.equal(calls.length, 2, "no new request for the same table");
  });

  it("does not reveal a panel opened against a different endpoint for the same server/caslib/table names", async () => {
    // Regression test for the finding on PR #171: the dedup `key` must be
    // scoped by deployment, not just by server/caslib/table name, or
    // switching profiles/endpoints would reveal a panel still bound to the
    // previous deployment's `CasAdapter` — a cross-deployment data leak.
    const fake = fakePanel();
    const manager = new DataViewerPanelManager(extensionUri, {
      createPanel: () => fake.panel,
    });
    const first = recordedCasClient(OPEN_ROUTES_LOADED);
    const firstAdapter = new CasAdapter(first.client, "https://a.example.com");
    const second = recordedCasClient(OPEN_ROUTES_LOADED);
    const secondAdapter = new CasAdapter(
      second.client,
      "https://b.example.com",
    );

    await manager.open(new CasTableSource(firstAdapter, table("loaded")));
    assert.equal(first.calls.length, 2);

    await manager.open(new CasTableSource(secondAdapter, table("loaded")));
    assert.equal(
      second.calls.length,
      2,
      "a different endpoint's own panel must issue its own requests, not reveal the first endpoint's panel",
    );
  });

  it("closes without a server-side view to discard, unlike a Library table", async () => {
    // `CasTableSource.close` is a no-op — see its own doc comment. This just
    // confirms disposing a CAS panel does not throw or hang waiting on
    // anything, the way a Library panel's `discardView` would if its own
    // `close` never resolved.
    const fake = fakePanel();
    const manager = new DataViewerPanelManager(extensionUri, {
      createPanel: () => fake.panel,
    });
    const { source } = casTableSource(OPEN_ROUTES_LOADED);

    await manager.open(source);
    fake.sendReady();

    assert.doesNotThrow(() => fake.panel.dispose());
    await flush();
  });
});

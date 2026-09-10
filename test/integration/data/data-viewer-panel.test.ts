// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * `DataViewerPanelManager`/`OpenTablePanel` (7b, ADR-0028) against a fake
 * `DataWebviewPanel` (the same double shape `result-panel.test.ts` uses for
 * `ResultWebviewPanel`) and a **real** `LibraryAdapter` wired to recorded
 * `DataAccessApi` fixtures (`test/helpers/recorded-data.ts`,
 * `test/fixtures/data/`) — the same fixtures `data-adapter.test.ts` already
 * exercises the adapter itself against, reused here rather than re-recorded,
 * since this file's job is the panel's own wiring (the message protocol, the
 * ready handshake, the HTML shell), not the adapter's parsing, which is
 * already covered there.
 *
 * This is an integration test, not a unit one, because `dataViewerPanel.ts`
 * imports `vscode` (`.c8rc.json` excludes it from unit coverage for exactly
 * that reason) — `LibraryAdapter` itself stays `vscode`-free and is unit
 * tested directly in `test/unit/data-adapter.test.ts`.
 *
 * **Every case that exercises the panel's initial load `await`s
 * `manager.open(...)` directly** — `open()` returns a promise that resolves
 * once `openTable`/`getColumns` have settled (successfully or not), added to
 * `DataViewerPanelManager` for exactly this reason (see its own doc comment).
 * A `requestRows` reply is different: it arrives on `fake.sendRequestRows(...)`,
 * a void call into the webview message listener, so those cases `flush()` a
 * pending microtask queue afterward instead.
 */

import assert from "node:assert/strict";

import * as vscode from "vscode";

import {
  LibraryAdapter,
  type ConnectedSession,
  type LibrarySessionSource,
} from "../../../src/data/adapter";
import {
  DataViewerPanelManager,
  type DataWebviewPanel,
} from "../../../src/data/dataViewerPanel";
import {
  isRequestRowsMessage,
  type DataViewerHostMessage,
} from "../../../src/data/dataViewerModel";
import { type TableItem } from "../../../src/data/types";
import {
  dataFail,
  dataFixture,
  recordedDataClient,
  type RecordedDataRoute,
} from "../../helpers/recorded-data";
import type { ComputeSession } from "../../../src/compute/session";

const SESSION_ID = "aaaaaaaa-0000-4000-8000-000000000001-ses0000";
const LIBREFS_HREF = `/compute/sessions/${SESSION_ID}/data`;
const CLASS_HREF = `${LIBREFS_HREF}/SASHELP/CLASS`;
const PROFILE_ID = "profile-1";

/** A `TableItem` whose own `self` link `openTable` follows — the same shape
 * `data-adapter.test.ts`'s own `tableItem()` builds, duplicated here rather
 * than imported: it is four fields and a link, and importing a test-only
 * helper across files buys less than it costs (ADR-0009's own reasoning for
 * why `test/helpers/` holds shared fakes, not shared fixtures-of-fixtures). */
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

/** The routes a table's happy-path open needs: its own rich detail, then its
 * columns. Row requests are routed separately per test, since not every case
 * gets that far. */
const OPEN_ROUTES: readonly RecordedDataRoute[] = [
  { when: CLASS_HREF, reply: dataFixture("table-detail-class.json") },
  {
    when: `${CLASS_HREF}/columns`,
    reply: dataFixture("columns-class.json"),
  },
];

/** A `DataWebviewPanel` double that records everything asked of it and lets a
 * test drive the `"ready"` handshake, a `requestRows` message, and disposal
 * by hand — the same shape `result-panel.test.ts`'s own `fakePanel()` takes
 * for `ResultWebviewPanel`. */
function fakePanel(): {
  readonly panel: DataWebviewPanel;
  readonly posted: DataViewerHostMessage[];
  readonly revealed: { column: vscode.ViewColumn; preserveFocus: boolean }[];
  readonly disposed: boolean[];
  sendReady(): void;
  sendRequestRows(requestId: string, start: number, limit: number): void;
} {
  const posted: DataViewerHostMessage[] = [];
  const revealed: { column: vscode.ViewColumn; preserveFocus: boolean }[] = [];
  const disposed: boolean[] = [];
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

  return {
    panel,
    posted,
    revealed,
    disposed,
    sendReady: () => messageListener?.({ type: "ready" }),
    sendRequestRows: (requestId, start, limit) => {
      const message = { type: "requestRows", requestId, start, limit };
      assert.ok(isRequestRowsMessage(message), "malformed test message");
      messageListener?.(message);
    },
  };
}

const extensionUri = vscode.Uri.file("/fake-extension");

/** Lets a pending `handleRequestRows`/`loadTable` microtask chain settle
 * before a test inspects `fake.posted` — needed only after a *void* call into
 * the webview's message listener (`sendRequestRows`); every case that awaits
 * `manager.open(...)` directly needs no flush of its own, since that promise
 * already resolves after the same chain. */
function flush(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

describe("DataViewerPanelManager", () => {
  it("loads the table and buffers init until the ready handshake, then replays it", async () => {
    const fake = fakePanel();
    const manager = new DataViewerPanelManager(extensionUri, {
      createPanel: () => fake.panel,
    });

    await manager.open(tableItem(), libraryAdapter(OPEN_ROUTES));
    // Not `assert.deepEqual(fake.posted, [], ...)` — @types/node's `deepEqual`
    // carries an `asserts` signature that narrows `fake.posted` itself to the
    // type of the literal `[]` for the rest of this scope, so a later
    // `fake.posted[0]` types as `never` (the same trap `compute-client.test.ts`
    // notes for `assert.equal` narrowing a boolean to one literal).
    assert.equal(fake.posted.length, 0, "nothing posted before ready");

    fake.sendReady();
    assert.equal(fake.posted.length, 1);
    const [init] = fake.posted;
    assert.ok(init?.type === "init");
    assert.equal(init.rowCount, 19);
    assert.deepEqual(
      init.columns.map((c) => [c.field, c.headerName, c.type]),
      [
        ["Name", "Name", "CHAR"],
        ["Sex", "Sex", "CHAR"],
        ["Age", "Age", "FLOAT"],
        ["Height", "Height", "FLOAT"],
        ["Weight", "Weight", "FLOAT"],
      ],
    );
  });

  it("posts immediately, without buffering, once the panel is already ready", async () => {
    // Caught running against real VS Code (Sean, 2026-09-10): `sendReady()`
    // cannot be called before `manager.open(...)` even starts — the fake's
    // `messageListener` is only set inside `webview.onDidReceiveMessage`,
    // which `OpenTablePanel.start()` calls, which only runs once `open()` is
    // invoked. Calling it any earlier is a no-op against `undefined`, so
    // `ready` stays `false` for the whole load and nothing is ever posted —
    // exactly the "0 !== 1" failure this integration run surfaced. The fix is
    // to invoke `open()` without awaiting it yet, call `sendReady()`
    // synchronously right after (by which point `start()`'s own synchronous
    // prefix — html, then both `onDidReceiveMessage`/`onDidDispose` — has
    // already run, since an `async` function's body runs synchronously up to
    // its first `await`), and only then await the same promise.
    const fake = fakePanel();
    const manager = new DataViewerPanelManager(extensionUri, {
      createPanel: () => fake.panel,
    });

    const opened = manager.open(tableItem(), libraryAdapter(OPEN_ROUTES));
    fake.sendReady();
    await opened;

    assert.equal(fake.posted.length, 1);
    assert.equal(fake.posted[0]?.type, "init");
  });

  it("answers a requestRows message with one window of rows and the collection's count", async () => {
    const fake = fakePanel();
    const manager = new DataViewerPanelManager(extensionUri, {
      createPanel: () => fake.panel,
    });
    await manager.open(
      tableItem(),
      libraryAdapter([
        ...OPEN_ROUTES,
        {
          when: `${CLASS_HREF}/rows?start=0&limit=2`,
          reply: dataFixture("rows-class-page1.json"),
        },
      ]),
    );
    fake.sendReady();
    fake.posted.length = 0;

    fake.sendRequestRows("r1", 0, 2);
    await flush();

    assert.equal(fake.posted.length, 1);
    const [reply] = fake.posted;
    assert.ok(reply?.type === "rows");
    assert.equal(reply.requestId, "r1");
    assert.equal(reply.start, 0);
    assert.equal(reply.count, 19);
    assert.deepEqual(reply.rows, [
      ["Alfred", "M", 14, 69, 112.5],
      ["Alice", "F", 13, 56.5, 84],
    ]);
  });

  it("answers rowsError, scoped to that request's id, when the row fetch fails", async () => {
    const fake = fakePanel();
    const manager = new DataViewerPanelManager(extensionUri, {
      createPanel: () => fake.panel,
    });
    await manager.open(
      tableItem(),
      libraryAdapter([
        ...OPEN_ROUTES,
        {
          when: `${CLASS_HREF}/rows?start=0&limit=2`,
          reply: dataFail({ code: "compute-rejected", error: { status: 500 } }),
        },
      ]),
    );
    fake.sendReady();
    fake.posted.length = 0;

    fake.sendRequestRows("r7", 0, 2);
    await flush();

    assert.equal(fake.posted.length, 1);
    const [reply] = fake.posted;
    assert.ok(reply?.type === "rowsError");
    assert.equal(reply.requestId, "r7");
  });

  it("posts failure, not init, when openTable finds no self link", async () => {
    // Same ordering fix as "posts immediately" above — see that test's own
    // comment.
    const fake = fakePanel();
    const manager = new DataViewerPanelManager(extensionUri, {
      createPanel: () => fake.panel,
    });

    const opened = manager.open(tableItem({ links: [] }), libraryAdapter([]));
    fake.sendReady();
    await opened;

    assert.equal(fake.posted.length, 1);
    const [message] = fake.posted;
    assert.ok(message?.type === "failure");
    assert.match(message.message, /link/i);
  });

  it("posts failure when the columns fetch fails, after openTable already succeeded", async () => {
    // Same ordering fix as "posts immediately" above — see that test's own
    // comment.
    const fake = fakePanel();
    const manager = new DataViewerPanelManager(extensionUri, {
      createPanel: () => fake.panel,
    });

    const opened = manager.open(
      tableItem(),
      libraryAdapter([
        { when: CLASS_HREF, reply: dataFixture("table-detail-class.json") },
        {
          when: `${CLASS_HREF}/columns`,
          reply: dataFail({ code: "compute-rejected", error: { status: 500 } }),
        },
      ]),
    );
    fake.sendReady();
    await opened;

    assert.equal(fake.posted.length, 1);
    assert.equal(fake.posted[0]?.type, "failure");
  });

  it("reveals the existing panel and issues no new request for a table already open", async () => {
    const fake = fakePanel();
    const manager = new DataViewerPanelManager(extensionUri, {
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

  it("builds an HTML shell whose CSP nonce matches the script tag's own nonce, and links the panel's stylesheet", async () => {
    const fake = fakePanel();
    const manager = new DataViewerPanelManager(extensionUri, {
      createPanel: () => fake.panel,
    });
    await manager.open(tableItem(), libraryAdapter(OPEN_ROUTES));

    const html = fake.panel.webview.html;
    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /script-src 'nonce-[^']+'/);
    const cspNonce = /nonce-([^']+)'/.exec(html)?.[1];
    const scriptNonce = /<script nonce="([^"]+)"/.exec(html)?.[1];
    assert.ok(cspNonce !== undefined && cspNonce.length > 0);
    assert.equal(scriptNonce, cspNonce);

    // No inline script allowance — the one script this panel loads carries
    // the nonce, and nothing else should be able to run.
    const scriptSrcDirective = /script-src[^;]*/.exec(html)?.[0] ?? "";
    assert.doesNotMatch(scriptSrcDirective, /unsafe-inline/);

    // style-src's 'unsafe-inline' is deliberate here too, for ag-grid's own
    // row-positioning styles — see this panel's own doc comment on buildHtml.
    const styleSrcDirective = /style-src[^;]*/.exec(html)?.[0] ?? "";
    assert.match(styleSrcDirective, /unsafe-inline/);
    assert.match(html, /default-src 'none'/);

    // The companion CSS esbuild emits alongside dataViewer.js (ag-grid's own
    // stylesheets, bundled by dataViewerEntry.tsx) needs its own <link>, not
    // just the inline <style> block every panel already carries.
    assert.match(html, /<link rel="stylesheet" href="[^"]*dataViewer\.css"/);
    assert.match(html, /<script nonce="[^"]+" src="[^"]*dataViewer\.js"/);
  });

  it("disposes every open panel", async () => {
    const first = fakePanel();
    const second = fakePanel();
    let call = 0;
    const manager = new DataViewerPanelManager(extensionUri, {
      createPanel: () => (call++ === 0 ? first.panel : second.panel),
    });
    await manager.open(tableItem(), libraryAdapter(OPEN_ROUTES));
    // A different key (`SASHELP.SHOES`) than the first table, so the manager
    // opens a second panel rather than revealing the first — reusing
    // `tableItem()`'s own default `self` link (still `CLASS_HREF`) is fine
    // here, since this test asserts on disposal, never on which href either
    // panel's own adapter was asked for.
    await manager.open(
      tableItem({ name: "SHOES" }),
      libraryAdapter(OPEN_ROUTES),
    );

    manager.dispose();
    assert.deepEqual(first.disposed, [true]);
    assert.deepEqual(second.disposed, [true]);
  });

  it("aborts the panel's own AbortController when the panel is disposed", async () => {
    // Caught in the 7b adversarial review's second pass (2026-09-10): every
    // adapter call was already threading a `signal` (`hadSignal` in
    // `RecordedDataCall`), and `OpenTablePanel`'s own `onDidDispose` handler
    // already called `this.controller.abort()` — but nothing asserted the
    // two were actually the same controller. Capturing the signal a real
    // adapter call carried, then disposing the panel and checking that exact
    // signal flips to aborted, is what closes that gap.
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
    const manager = new DataViewerPanelManager(extensionUri, {
      createPanel: () => fake.panel,
    });

    await manager.open(tableItem(), libraryAdapter(routes));

    assert.ok(
      capturedSignal !== undefined,
      "getColumns should have carried a signal",
    );
    assert.equal(capturedSignal.aborted, false, "not aborted before dispose");

    fake.panel.dispose();

    assert.equal(
      capturedSignal.aborted,
      true,
      "disposing the panel should abort the same controller its adapter calls used",
    );
  });
});

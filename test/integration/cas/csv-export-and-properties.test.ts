// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * 11d — a **CAS** table's CSV export and properties panel (F3/F2):
 * `runSourceCsvExport` (`src/data/csvExportCommand.ts`) driving a real
 * `CasCsvSource`, and `TablePropertiesPanelManager.openSource`
 * (`src/data/tablePropertiesPanel.ts`) driving a real `CasPropertiesSource`,
 * both over a real `CasAdapter` wired to recorded fixtures
 * (`test/helpers/recorded-cas.ts`, `test/fixtures/cas/`).
 *
 * The SAS-library halves of both features are covered by
 * `test/integration/data/csv-export-command.test.ts` and
 * `table-properties-panel.test.ts`, which run through the same generalised
 * code paths; this file covers what is new — the CAS sources, and the
 * large-export confirmation (driven through a fake source, since it is the
 * command's own behaviour, independent of any backend).
 */

import assert from "node:assert/strict";

import * as vscode from "vscode";

import { CasAdapter } from "../../../src/cas/adapter";
import { CasCsvSource } from "../../../src/cas/casCsvSource";
import { CasPropertiesSource } from "../../../src/cas/casPropertiesSource";
import { readCasTableItem, type CasTableItem } from "../../../src/cas/types";
import {
  runSourceCsvExport,
  type CsvOutputStream,
} from "../../../src/data/csvExportCommand";
import { type CsvExportSource } from "../../../src/data/csvExportModel";
import {
  TablePropertiesPanelManager,
  type TablePropertiesWebviewPanel,
} from "../../../src/data/tablePropertiesPanel";
import {
  casFail,
  casFixture,
  casOk,
  casText,
  recordedCasClient,
  type RecordedCasCall,
  type RecordedCasRoute,
} from "../../helpers/recorded-cas";

const TABLES_HREF =
  "/casManagement/servers/cas-shared-default/caslibs/Public/tables";
const SELF_HREF = `${TABLES_HREF}/LOOKUP_TABLE`;
const LOAD_HREF = `${SELF_HREF}/state`;
const COLUMNS_HREF = `${SELF_HREF}/columns`;
const DATA_TABLE_HREF =
  "/dataTables/dataSources/cas~fs~cas-shared-default~fs~Public/tables/LOOKUP_TABLE";
const ROWS_HREF =
  "/rowSets/tables/cas~fs~cas-shared-default~fs~Public~fs~LOOKUP_TABLE/rows";
const SAVE_URI = vscode.Uri.file("C:/exports/public.lookup_table.csv");

function table(state: "loaded" | "unloaded" = "loaded"): CasTableItem {
  const item = readCasTableItem(
    {
      name: "LOOKUP_TABLE",
      state,
      rowCount: state === "loaded" ? 12 : 0,
      columnCount: state === "loaded" ? 2 : 0,
      links: [
        {
          rel: "self",
          href: SELF_HREF,
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
          href: COLUMNS_HREF,
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

function adapterWith(
  routes: readonly RecordedCasRoute[],
  endpoint = "https://cas.example.com",
): { adapter: CasAdapter; calls: RecordedCasCall[] } {
  const { client, calls } = recordedCasClient(routes);
  return { adapter: new CasAdapter(client, endpoint), calls };
}

/** Finding 11.5's shape for a loaded table's own representation (scrubbed). */
const SELF_BODY = {
  name: "LOOKUP_TABLE",
  caslibName: "Public",
  serverName: "cas-shared-default",
  state: "loaded",
  scope: "global",
  rowCount: 12,
  columnCount: 2,
  created: "2026-01-02T03:04:05.678Z",
  createdBy: "someone",
  lastModified: "2026-01-02T03:04:06.000Z",
  lastAccessed: "2026-01-03T03:04:06.000Z",
  encoding: "utf-8",
  characterSet: "UTF8",
  repeated: false,
};

/** The rows fixture's own two rows for the first page, an empty page for any
 * later one — what a real `rows` request past the end answers (Finding
 * 8.12's empty-`items` reading), keyed off the request's own `start`. */
const ROWS_ROUTE: RecordedCasRoute = {
  when: ROWS_HREF,
  reply: (request) => {
    const start = /[?&]start=(\d+)/.exec(request.link.href)?.[1];
    return start === "0"
      ? casFixture("rows.json")
      : casOk({ count: 12, items: [], links: [] });
  },
};

const EXPORT_ROUTES: readonly RecordedCasRoute[] = [
  { when: DATA_TABLE_HREF, reply: casFixture("data-table.json") },
  { when: COLUMNS_HREF, reply: casFixture("columns.json") },
  ROWS_ROUTE,
];

function fakeStream(): { stream: CsvOutputStream; chunks: string[] } {
  const chunks: string[] = [];
  const stream: CsvOutputStream = {
    write: (chunk, callback) => {
      chunks.push(chunk);
      callback(undefined);
    },
    end: (callback) => {
      callback();
    },
    once: () => undefined,
  };
  return { stream, chunks };
}

function fakeLog(): { log: vscode.LogOutputChannel; errors: string[] } {
  const errors: string[] = [];
  const log = {
    error: (message: string) => errors.push(message),
    debug: () => undefined,
  } as unknown as vscode.LogOutputChannel;
  return { log, errors };
}

const AMPLE_DISK = () => Promise.resolve({ bavail: 1e12, bsize: 1 });

describe("CAS table CSV export (11d)", () => {
  it("writes a formatted CSV — header first, one page per request — and renames it onto the destination", async () => {
    const { adapter, calls } = adapterWith(EXPORT_ROUTES);
    const { stream, chunks } = fakeStream();
    const { log, errors } = fakeLog();
    const renamed: { from: string; to: string }[] = [];

    await runSourceCsvExport(new CasCsvSource(adapter, table()), {
      log,
      showSaveDialog: () => Promise.resolve(SAVE_URI),
      withProgress: (_title, run) =>
        run(new vscode.CancellationTokenSource().token),
      createWriteStream: () => stream,
      rename: (from, to) => {
        renamed.push({ from, to });
        return Promise.resolve();
      },
      unlink: () => Promise.resolve(),
      statfs: AMPLE_DISK,
    });

    assert.deepEqual(chunks, ["CODE,VALUE\nABC,1.5\nDEF,2.5\n"]);
    assert.equal(renamed.length, 1);
    assert.equal(renamed[0]?.to, SAVE_URI.fsPath);
    assert.deepEqual(errors, []);
    // The table was already loaded, so no load request was made.
    assert.ok(!calls.some((call) => call.method === "PUT"));
    // Every page asks for its own window of the same table.
    const rowCalls = calls.filter((call) => call.href.startsWith(ROWS_HREF));
    assert.ok(rowCalls.some((call) => call.href.includes("start=0&limit=500")));
    assert.ok(
      rowCalls.some((call) => call.href.includes("start=500&limit=500")),
    );
  });

  it("loads an unloaded table once, before reading any row", async () => {
    const { adapter, calls } = adapterWith([
      {
        when: (href, method) => href.startsWith(LOAD_HREF) && method === "PUT",
        reply: casText("loaded"),
      },
      ...EXPORT_ROUTES,
    ]);
    const { stream } = fakeStream();
    const { log } = fakeLog();

    await runSourceCsvExport(new CasCsvSource(adapter, table("unloaded")), {
      log,
      showSaveDialog: () => Promise.resolve(SAVE_URI),
      withProgress: (_title, run) =>
        run(new vscode.CancellationTokenSource().token),
      createWriteStream: () => stream,
      rename: () => Promise.resolve(),
      unlink: () => Promise.resolve(),
      statfs: AMPLE_DISK,
    });

    const puts = calls.filter((call) => call.method === "PUT");
    assert.equal(puts.length, 1, "openTable loads; getColumns must not repeat");
    assert.equal(calls[0]?.method, "PUT", "the load comes first");
  });

  it("reports a failed row read before any temporary file exists, and leaves the destination alone", async () => {
    const { adapter } = adapterWith([
      { when: DATA_TABLE_HREF, reply: casFixture("data-table.json") },
      { when: COLUMNS_HREF, reply: casFixture("columns.json") },
      {
        when: ROWS_HREF,
        reply: (request) =>
          /[?&]limit=1(&|$)/.test(request.link.href)
            ? casFixture("rows.json")
            : casFail({ code: "cas-rejected", error: { status: 500 } }),
      },
    ]);
    const { stream } = fakeStream();
    const { log, errors } = fakeLog();
    const renamed: string[] = [];
    const unlinked: string[] = [];
    const shown: string[] = [];
    const original = vscode.window.showErrorMessage;
    (vscode.window as { showErrorMessage: unknown }).showErrorMessage = (
      message: string,
    ) => {
      shown.push(message);
      return Promise.resolve(undefined);
    };

    try {
      await runSourceCsvExport(new CasCsvSource(adapter, table()), {
        log,
        showSaveDialog: () => Promise.resolve(SAVE_URI),
        withProgress: (_title, run) =>
          run(new vscode.CancellationTokenSource().token),
        createWriteStream: () => stream,
        rename: (_from, to) => {
          renamed.push(to);
          return Promise.resolve();
        },
        unlink: (path) => {
          unlinked.push(path);
          return Promise.resolve();
        },
        statfs: AMPLE_DISK,
      });
    } finally {
      (vscode.window as { showErrorMessage: unknown }).showErrorMessage =
        original;
    }

    assert.deepEqual(renamed, []);
    assert.equal(shown.length, 1);
    assert.match(shown[0] ?? "", /HTTP 500/);
    assert.equal(errors.length, 1);
    assert.match(
      errors[0] ?? "",
      /^CAS: could not export "Public\.LOOKUP_TABLE"/,
    );
    // The size-estimate read failed, so nothing had been created to remove.
    assert.deepEqual(unlinked, []);
  });

  it("names a 100 MB large-export threshold", () => {
    const { adapter } = adapterWith([]);
    assert.equal(
      new CasCsvSource(adapter, table()).confirmAboveBytes,
      100 * 1024 * 1024,
    );
  });

  describe("12e formula-injection guard", () => {
    /** `columns.json`: `CODE` is `varchar` (text), `VALUE` is `double`
     * (numeric) — a formula-shaped `CODE` and a negative `VALUE` exercise
     * both halves of the guard's text/numeric partition in one page. */
    const GUARD_ROWS_ROUTE: RecordedCasRoute = {
      when: ROWS_HREF,
      reply: (request) =>
        /[?&]start=0(&|$)/.test(request.link.href)
          ? casOk({
              count: 1,
              items: [{ version: 1, cells: ["=SUM(A1:A9)", -1.5] }],
              links: [],
            })
          : casOk({ count: 1, items: [], links: [] }),
    };

    it("is off by default — the formula-shaped cell reaches the file untouched", async () => {
      const { adapter } = adapterWith([
        { when: DATA_TABLE_HREF, reply: casFixture("data-table.json") },
        { when: COLUMNS_HREF, reply: casFixture("columns.json") },
        GUARD_ROWS_ROUTE,
      ]);
      const { stream, chunks } = fakeStream();
      const { log } = fakeLog();

      await runSourceCsvExport(new CasCsvSource(adapter, table()), {
        log,
        showSaveDialog: () => Promise.resolve(SAVE_URI),
        withProgress: (_title, run) =>
          run(new vscode.CancellationTokenSource().token),
        createWriteStream: () => stream,
        rename: () => Promise.resolve(),
        unlink: () => Promise.resolve(),
        statfs: AMPLE_DISK,
      });

      assert.deepEqual(chunks, ["CODE,VALUE\n=SUM(A1:A9),-1.5\n"]);
    });

    it("once turned on, guards the character column only — the numeric column's own '-' is untouched", async () => {
      const { adapter } = adapterWith([
        { when: DATA_TABLE_HREF, reply: casFixture("data-table.json") },
        { when: COLUMNS_HREF, reply: casFixture("columns.json") },
        GUARD_ROWS_ROUTE,
      ]);
      const { stream, chunks } = fakeStream();
      const { log } = fakeLog();

      await runSourceCsvExport(new CasCsvSource(adapter, table(), true), {
        log,
        showSaveDialog: () => Promise.resolve(SAVE_URI),
        withProgress: (_title, run) =>
          run(new vscode.CancellationTokenSource().token),
        createWriteStream: () => stream,
        rename: () => Promise.resolve(),
        unlink: () => Promise.resolve(),
        statfs: AMPLE_DISK,
      });

      assert.deepEqual(chunks, ["CODE,VALUE\n'=SUM(A1:A9),-1.5\n"]);
    });
  });
});

describe("large-export confirmation (11d)", () => {
  /** A source that reports a fixed size and records whether it was streamed. */
  function fakeSource(options: {
    confirmAboveBytes: number | undefined;
    sample: string;
    rowCount: number;
  }): { source: CsvExportSource; streamed: boolean[] } {
    const streamed: boolean[] = [];
    const source: CsvExportSource = {
      name: "BIG.TABLE",
      logPrefix: "Test",
      confirmAboveBytes: options.confirmAboveBytes,
      open: () =>
        Promise.resolve({ ok: true, value: { rowCount: options.rowCount } }),
      sample: () => Promise.resolve({ ok: true, value: options.sample }),
      stream: async (sink) => {
        streamed.push(true);
        await sink("x\n");
        return { ok: true, value: undefined };
      },
    };
    return { source, streamed };
  }

  async function run(
    source: CsvExportSource,
    confirm:
      | ((bytes: number, rows: number | undefined) => Thenable<boolean>)
      | undefined,
  ): Promise<{ created: number }> {
    const { log } = fakeLog();
    let created = 0;
    await runSourceCsvExport(source, {
      log,
      showSaveDialog: () => Promise.resolve(SAVE_URI),
      withProgress: (_title, work) =>
        work(new vscode.CancellationTokenSource().token),
      createWriteStream: () => {
        created += 1;
        return fakeStream().stream;
      },
      rename: () => Promise.resolve(),
      unlink: () => Promise.resolve(),
      statfs: AMPLE_DISK,
      confirmLargeExport: confirm,
    });
    return { created };
  }

  // 10 rows, a 10-character sample of 10 rows -> an estimate of 10 bytes.
  it("does not ask, and exports, when the estimate is at or below the threshold", async () => {
    const { source, streamed } = fakeSource({
      confirmAboveBytes: 10,
      sample: "0123456789",
      rowCount: 10,
    });
    let asked = 0;
    await run(source, () => {
      asked += 1;
      return Promise.resolve(true);
    });
    assert.equal(asked, 0);
    assert.deepEqual(streamed, [true]);
  });

  it("asks with the estimate and the row count when it is above the threshold, and exports on yes", async () => {
    const { source, streamed } = fakeSource({
      confirmAboveBytes: 5,
      sample: "0123456789",
      rowCount: 10,
    });
    const asked: { bytes: number; rows: number | undefined }[] = [];
    await run(source, (bytes, rows) => {
      asked.push({ bytes, rows });
      return Promise.resolve(true);
    });
    assert.deepEqual(asked, [{ bytes: 10, rows: 10 }]);
    assert.deepEqual(streamed, [true]);
  });

  it("writes nothing, creates no file, and reports no error when the user declines", async () => {
    const { source, streamed } = fakeSource({
      confirmAboveBytes: 5,
      sample: "0123456789",
      rowCount: 10,
    });
    const { created } = await run(source, () => Promise.resolve(false));
    assert.deepEqual(streamed, []);
    assert.equal(created, 0);
  });

  it("never asks for a source that names no threshold, however large the estimate", async () => {
    const { source, streamed } = fakeSource({
      confirmAboveBytes: undefined,
      sample: "x".repeat(1000),
      rowCount: 1_000_000,
    });
    let asked = 0;
    await run(source, () => {
      asked += 1;
      return Promise.resolve(true);
    });
    assert.equal(asked, 0);
    assert.deepEqual(streamed, [true]);
  });
});

function fakePanel(): {
  readonly panel: TablePropertiesWebviewPanel;
  readonly revealed: number[];
} {
  const revealed: number[] = [];
  const panel: TablePropertiesWebviewPanel = {
    webview: { html: "" },
    reveal: () => {
      revealed.push(1);
    },
    onDidDispose: () => ({ dispose: () => undefined }),
    dispose: () => undefined,
  };
  return { panel, revealed };
}

describe("CAS table properties panel (11d)", () => {
  const routes: readonly RecordedCasRoute[] = [
    { when: SELF_HREF, reply: casOk(SELF_BODY) },
    { when: COLUMNS_HREF, reply: casFixture("columns.json") },
  ];

  it("renders the table's properties and columns, with no script and a nonce-locked style", async () => {
    const fake = fakePanel();
    const manager = new TablePropertiesPanelManager({
      createPanel: () => fake.panel,
    });
    const { adapter } = adapterWith(routes);

    await manager.openSource(new CasPropertiesSource(adapter, table()));

    const html = fake.panel.webview.html;
    assert.match(html, /<h1>Public\.LOOKUP_TABLE<\/h1>/);
    assert.match(html, />cas-shared-default</);
    assert.match(html, />someone</);
    assert.match(html, />UTF8</);
    // Columns tab: CODE (varchar, no rawLength) and VALUE (double, 8).
    assert.match(html, />CODE</);
    assert.match(html, />VALUE</);
    assert.match(html, />double</);
    assert.match(html, />8</);
    assert.doesNotMatch(html, /<script/);
    assert.doesNotMatch(html, /unsafe-inline/);
  });

  it("loads an unloaded table exactly once for the whole panel", async () => {
    const fake = fakePanel();
    const manager = new TablePropertiesPanelManager({
      createPanel: () => fake.panel,
    });
    const { adapter, calls } = adapterWith([
      {
        when: (href, method) => href.startsWith(LOAD_HREF) && method === "PUT",
        reply: casText("loaded"),
      },
      ...routes,
    ]);

    await manager.openSource(
      new CasPropertiesSource(adapter, table("unloaded")),
    );

    assert.equal(calls.filter((call) => call.method === "PUT").length, 1);
    assert.match(fake.panel.webview.html, />12</);
  });

  it("escapes a column label rather than injecting it as markup", async () => {
    const fake = fakePanel();
    const manager = new TablePropertiesPanelManager({
      createPanel: () => fake.panel,
    });
    const { adapter } = adapterWith([
      { when: SELF_HREF, reply: casOk(SELF_BODY) },
      {
        when: COLUMNS_HREF,
        reply: casOk({
          items: [
            { name: "X", type: "double", label: "<img src=x onerror=1>" },
          ],
          links: [],
        }),
      },
    ]);

    await manager.openSource(new CasPropertiesSource(adapter, table()));

    assert.doesNotMatch(fake.panel.webview.html, /<img/);
    assert.match(fake.panel.webview.html, /&lt;img/);
  });

  it("renders the failure message, not a half-finished properties view, when self cannot be read", async () => {
    const fake = fakePanel();
    const manager = new TablePropertiesPanelManager({
      createPanel: () => fake.panel,
    });
    const { adapter } = adapterWith([
      {
        when: SELF_HREF,
        reply: casFail({ code: "cas-rejected", error: { status: 500 } }),
      },
    ]);

    await manager.openSource(new CasPropertiesSource(adapter, table()));

    assert.match(fake.panel.webview.html, /HTTP 500/);
    assert.doesNotMatch(fake.panel.webview.html, /cas-shared-default</);
  });

  it("reveals the existing panel with no new request for a table already open, but opens a fresh one for another deployment", async () => {
    const first = fakePanel();
    const second = fakePanel();
    let created = 0;
    const manager = new TablePropertiesPanelManager({
      createPanel: () => (created++ === 0 ? first.panel : second.panel),
    });
    const one = adapterWith(routes);

    await manager.openSource(new CasPropertiesSource(one.adapter, table()));
    const callsAfterFirst = one.calls.length;
    await manager.openSource(new CasPropertiesSource(one.adapter, table()));
    assert.equal(one.calls.length, callsAfterFirst, "no new request");
    assert.equal(first.revealed.length, 1);

    const other = adapterWith(routes, "https://other.example.com");
    await manager.openSource(new CasPropertiesSource(other.adapter, table()));
    assert.equal(created, 2, "a second deployment gets its own panel");
    assert.ok(other.calls.length > 0);
  });
});

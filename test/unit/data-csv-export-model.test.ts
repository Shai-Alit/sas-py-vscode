// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * `exportTableToCsv` (`src/data/csvExportModel.ts`, 7c-iii) against a real
 * `LibraryAdapter` wired to a recorded `ComputeClient`
 * (`test/helpers/recorded-data.ts`) — the same shape `data-adapter.test.ts`
 * already uses for `getRowsAsCsv` itself; this file's job is the pagination
 * loop this module adds on top, not the adapter's own request-building,
 * which is already covered there.
 */

import assert from "node:assert/strict";

import {
  LibraryAdapter,
  type ConnectedSession,
  type LibrarySessionSource,
} from "../../src/data/adapter";
import {
  CSV_EXPORT_PAGE_SIZE,
  exportTableToCsv,
  streamCsvPages,
} from "../../src/data/csvExportModel";
import { readTableDetail, type TableItem } from "../../src/data/types";
import {
  dataCsv,
  dataFail,
  recordedDataClient,
  type RecordedDataRoute,
} from "../helpers/recorded-data";
import type { ComputeSession } from "../../src/compute/session";

const SESSION_ID = "aaaaaaaa-0000-4000-8000-000000000001-ses0000";
const LIBREFS_HREF = `/compute/sessions/${SESSION_ID}/data`;
const CLASS_HREF = `${LIBREFS_HREF}/SASHELP/CLASS`;
const PROFILE_ID = "profile-1";

function tableItem(): TableItem {
  return {
    kind: "table",
    libref: "SASHELP",
    name: "CLASS",
    readOnly: true,
    links: [
      {
        rel: "self",
        href: CLASS_HREF,
        method: "GET",
        type: "application/vnd.sas.compute.data.table",
      },
    ],
  };
}

/** The rich `TableDetail` a real `openTable` would have returned, carrying
 * the `rowsAsCSV` link (Findings 7.15/7.20) `exportTableToCsv` follows. */
function tableDetail() {
  const detail = readTableDetail(
    {
      name: "CLASS",
      rowCount: 19,
      links: [
        {
          rel: "rowsAsCSV",
          href: `${CLASS_HREF}/rows`,
          method: "GET",
          type: "text/csv",
        },
      ],
    },
    tableItem(),
  );
  assert.ok(detail);
  return detail;
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

/** {@link CSV_EXPORT_PAGE_SIZE} as a string, for building an expected href —
 * `String(...)` rather than a raw template-literal interpolation, matching
 * `adapter.ts`'s own `getRows`/`getRowsAsCsv` convention. */
const PAGE_SIZE = String(CSV_EXPORT_PAGE_SIZE);

describe("exportTableToCsv", () => {
  it("writes a single page, header included, and stops after the first empty response", async () => {
    const adapter = libraryAdapter([
      {
        when: `${CLASS_HREF}/rows?start=0&limit=${PAGE_SIZE}&includeColumnNames=true`,
        reply: dataCsv("Name,Sex\nAlfred,M\nAlice,F\n"),
      },
      {
        when: `${CLASS_HREF}/rows?start=${PAGE_SIZE}&limit=${PAGE_SIZE}`,
        reply: dataCsv(""),
      },
    ]);
    const chunks: string[] = [];
    const result = await exportTableToCsv(adapter, tableDetail(), (chunk) => {
      chunks.push(chunk);
      return Promise.resolve();
    });
    assert.ok(result.ok);
    assert.deepEqual(chunks, ["Name,Sex\nAlfred,M\nAlice,F\n"]);
  });

  it("requests includeColumnNames only on the first page across a multi-page export", async () => {
    const adapter = libraryAdapter([
      {
        when: `${CLASS_HREF}/rows?start=0&limit=${PAGE_SIZE}&includeColumnNames=true`,
        reply: dataCsv("Name,Sex\nAlfred,M\n"),
      },
      {
        when: `${CLASS_HREF}/rows?start=${PAGE_SIZE}&limit=${PAGE_SIZE}`,
        reply: dataCsv("Alice,F\n"),
      },
      {
        when: `${CLASS_HREF}/rows?start=${String(2 * CSV_EXPORT_PAGE_SIZE)}&limit=${PAGE_SIZE}`,
        reply: dataCsv(""),
      },
    ]);
    const chunks: string[] = [];
    const result = await exportTableToCsv(adapter, tableDetail(), (chunk) => {
      chunks.push(chunk);
      return Promise.resolve();
    });
    assert.ok(result.ok);
    assert.deepEqual(chunks, ["Name,Sex\nAlfred,M\n", "Alice,F\n"]);
  });

  it("returns the adapter's own failure and writes nothing further once a page request fails", async () => {
    const adapter = libraryAdapter([
      {
        when: `${CLASS_HREF}/rows?start=0&limit=${PAGE_SIZE}&includeColumnNames=true`,
        reply: dataCsv("Name,Sex\nAlfred,M\n"),
      },
      {
        when: `${CLASS_HREF}/rows?start=${PAGE_SIZE}&limit=${PAGE_SIZE}`,
        reply: dataFail({ code: "compute-rejected", error: { status: 500 } }),
      },
    ]);
    const chunks: string[] = [];
    const result = await exportTableToCsv(adapter, tableDetail(), (chunk) => {
      chunks.push(chunk);
      return Promise.resolve();
    });
    assert.ok(!result.ok);
    assert.deepEqual(result.problem, {
      code: "compute",
      problem: { code: "compute-rejected", error: { status: 500 } },
    });
    assert.deepEqual(chunks, ["Name,Sex\nAlfred,M\n"]);
  });

  it("reports link-missing immediately when the table detail carries no rowsAsCSV relation", async () => {
    const adapter = libraryAdapter([]);
    const chunks: string[] = [];
    const result = await exportTableToCsv(
      adapter,
      { ...tableDetail(), links: [] },
      (chunk) => {
        chunks.push(chunk);
        return Promise.resolve();
      },
    );
    assert.ok(!result.ok);
    assert.deepEqual(result.problem, {
      code: "compute",
      problem: {
        code: "link-missing",
        rel: "rowsAsCSV",
        resource: 'table "SASHELP.CLASS"',
      },
    });
    assert.deepEqual(chunks, []);
  });

  it("threads a caller's AbortSignal through to every page request", async () => {
    const adapter = libraryAdapter([
      {
        when: `${CLASS_HREF}/rows?start=0&limit=${PAGE_SIZE}&includeColumnNames=true`,
        reply: (request) => {
          assert.ok(request.signal !== undefined);
          return dataCsv("");
        },
      },
    ]);
    const controller = new AbortController();
    const result = await exportTableToCsv(
      adapter,
      tableDetail(),
      () => Promise.resolve(),
      controller.signal,
    );
    assert.ok(result.ok);
  });
});

describe("streamCsvPages", () => {
  const failure = { ok: false, message: "boom", logDetail: "boom" } as const;

  it("asks for the header on the first page only and advances by pageSize", async () => {
    const asked: { start: number; limit: number; header: boolean }[] = [];
    const pages = ["h\n1\n2\n", "3\n", ""];
    const chunks: string[] = [];
    const result = await streamCsvPages(
      (window, header) => {
        asked.push({ ...window, header });
        return Promise.resolve({
          ok: true,
          value: pages[asked.length - 1] ?? "",
        } as const);
      },
      2,
      (chunk) => {
        chunks.push(chunk);
        return Promise.resolve();
      },
    );
    assert.ok(result.ok);
    assert.deepEqual(asked, [
      { start: 0, limit: 2, header: true },
      { start: 2, limit: 2, header: false },
      { start: 4, limit: 2, header: false },
    ]);
    assert.deepEqual(chunks, ["h\n1\n2\n", "3\n"]);
  });

  it("returns a reader's own failure and stops writing", async () => {
    let call = 0;
    const chunks: string[] = [];
    const result = await streamCsvPages(
      () => {
        call += 1;
        return Promise.resolve(
          call === 1 ? ({ ok: true, value: "h\n" } as const) : failure,
        );
      },
      1,
      (chunk) => {
        chunks.push(chunk);
        return Promise.resolve();
      },
    );
    assert.equal(result, failure);
    assert.deepEqual(chunks, ["h\n"]);
  });

  it("stops at a rejected sink rather than fetching further pages", async () => {
    let reads = 0;
    await assert.rejects(
      streamCsvPages(
        () => {
          reads += 1;
          return Promise.resolve({ ok: true, value: "x\n" } as const);
        },
        1,
        () => Promise.reject(new Error("disk full")),
      ),
      /disk full/,
    );
    assert.equal(reads, 1);
  });
});

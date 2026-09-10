// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  LibraryAdapter,
  MAX_DATA_PAGES,
  type ConnectedSession,
  type LibrarySessionSource,
} from "../../src/data/adapter";
import {
  readLibraryItem,
  readTableDetail,
  type LibraryItem,
  type TableDetail,
  type TableItem,
} from "../../src/data/types";
import {
  dataFail,
  dataFixture,
  dataOk,
  recordedDataClient,
  type RecordedDataCall,
  type RecordedDataRoute,
} from "../helpers/recorded-data";
import type { ComputeSession } from "../../src/compute/session";

/**
 * The real `LibraryAdapter` against recorded `DataAccessApi` wire shapes
 * (Findings 7.1–7.9, `docs/phases/phase-7.md`, `verde`). The adapter is
 * `vscode`-free, so this is a plain unit test; the HTTP boundary is the fake
 * `ComputeClient` `recorded-data.ts` builds, and the session lookup is a fake
 * `LibrarySessionSource` — `LibraryAdapter` never constructs either itself
 * (ADR-0027).
 */

const SESSION_ID = "aaaaaaaa-0000-4000-8000-000000000001-ses0000";
const LIBREFS_HREF = `/compute/sessions/${SESSION_ID}/data`;
const PROFILE_ID = "profile-1";

function session(overrides: Partial<ComputeSession> = {}): ComputeSession {
  return {
    id: SESSION_ID,
    state: "idle",
    links: [
      {
        rel: "librefs",
        href: LIBREFS_HREF,
        method: "GET",
        type: "application/vnd.sas.collection",
      },
    ],
    ...overrides,
  };
}

interface AdapterFixture {
  readonly adapter: LibraryAdapter;
  readonly calls: RecordedDataCall[];
}

function adapterWith(
  routes: readonly RecordedDataRoute[],
  options?: {
    readonly isBusy?: boolean;
    readonly connected?: boolean;
    readonly session?: ComputeSession;
  },
): AdapterFixture {
  const { client, calls } = recordedDataClient(routes);
  const sessions: LibrarySessionSource = {
    isBusy: () => options?.isBusy ?? false,
    current: (): ConnectedSession | undefined => {
      if (options?.connected === false) return undefined;
      return { client, session: options?.session ?? session() };
    },
  };
  return { adapter: new LibraryAdapter(sessions, PROFILE_ID), calls };
}

function libraryItem(name: string, readOnly: boolean): LibraryItem {
  const rich = readLibraryItem({ name, readOnly, links: [] });
  assert.ok(rich);
  return rich;
}

const CLASS_HREF = `${LIBREFS_HREF}/SASHELP/CLASS`;

/** A `TableItem` whose own `self` link `openTable` follows — the sparse
 * shape Finding 7.8 established a tables-collection entry actually carries. */
function tableItem(overrides: Partial<TableItem> = {}): TableItem {
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
    ...overrides,
  };
}

/** The rich `TableDetail` `openTable` would have returned, for tests of
 * `getColumns`/`getRows` that do not themselves need to exercise the `self`
 * follow-up. */
function tableDetail(): TableDetail {
  const detail = readTableDetail(
    {
      name: "CLASS",
      rowCount: 19,
      columnCount: 5,
      links: [
        {
          rel: "columns",
          href: `${CLASS_HREF}/columns`,
          method: "GET",
          type: "application/vnd.sas.collection",
          itemType: "application/vnd.sas.compute.data.table.column",
        },
        {
          rel: "rows",
          href: `${CLASS_HREF}/rows`,
          method: "GET",
          type: "application/vnd.sas.collection",
          itemType: "application/vnd.sas.compute.data.table.row",
        },
      ],
    },
    tableItem(),
  );
  assert.ok(detail);
  return detail;
}

describe("data/adapter LibraryAdapter", () => {
  describe("getLibraries", () => {
    it("paginates the librefs collection and resolves each item's rich detail", async () => {
      const { adapter, calls } = adapterWith([
        { when: LIBREFS_HREF, reply: dataFixture("librefs-page1.json") },
        {
          when: (href) => href.includes("start=10"),
          reply: dataFixture("librefs-page2.json"),
        },
        {
          when: `${LIBREFS_HREF}/SASHELP`,
          reply: dataFixture("library-sashelp.json"),
        },
        {
          when: `${LIBREFS_HREF}/WORK`,
          reply: dataFixture("library-work.json"),
        },
      ]);

      const result = await adapter.getLibraries();
      assert.ok(result.ok);
      assert.deepEqual(
        result.value.map((l) => [l.name, l.readOnly, l.concatenationCount]),
        [
          ["SASHELP", true, 4],
          ["WORK", false, 0],
        ],
      );

      // Both pages of the librefs collection are read fully before any
      // per-item follow-up — `collectPages` resolves the whole listing first,
      // then `getLibraries` walks it in order.
      assert.deepEqual(
        calls.map((c) => c.href),
        [
          LIBREFS_HREF,
          `${LIBREFS_HREF}?limit=10&start=10`,
          `${LIBREFS_HREF}/SASHELP`,
          `${LIBREFS_HREF}/WORK`,
        ],
      );
    });

    it("Finding 7.9: reuses page 1's link type on every later page, not the untyped next link's", async () => {
      // The tables collection's own `next` link carries no `type` at all
      // (verde, 2026-09-09) — following it literally would send no `Accept`
      // and this URI answers that with the *library's* rich detail instead of
      // continuing the listing. `collectPages` must keep the `librefs`
      // link's own type fixed across every page.
      const { adapter, calls } = adapterWith([
        { when: LIBREFS_HREF, reply: dataFixture("librefs-page1.json") },
        {
          when: (href) => href.includes("start=10"),
          reply: dataFixture("librefs-page2.json"),
        },
        {
          when: `${LIBREFS_HREF}/SASHELP`,
          reply: dataFixture("library-sashelp.json"),
        },
        {
          when: `${LIBREFS_HREF}/WORK`,
          reply: dataFixture("library-work.json"),
        },
      ]);

      const result = await adapter.getLibraries();
      assert.ok(result.ok);

      const page1 = calls.find((c) => c.href === LIBREFS_HREF);
      const page2 = calls.find((c) => c.href.includes("start=10"));
      assert.ok(page1);
      assert.ok(page2);
      assert.equal(page1.linkType, "application/vnd.sas.collection");
      // The critical assertion: page 2 carries the *same* type page 1 did,
      // even though the fixture's own `next` link had none.
      assert.equal(page2.linkType, page1.linkType);
    });

    it("skips a list entry with no self link rather than failing the whole listing", async () => {
      const { adapter } = adapterWith([
        {
          when: LIBREFS_HREF,
          reply: dataOk({
            items: [{ id: "ORFMTS", name: "ORFMTS", links: [] }],
            links: [],
          }),
        },
      ]);
      const result = await adapter.getLibraries();
      assert.ok(result.ok);
      assert.deepEqual(result.value, []);
    });

    it("reports link-missing when the session carries no librefs relation", async () => {
      const { adapter } = adapterWith([], { session: session({ links: [] }) });
      const result = await adapter.getLibraries();
      assert.ok(!result.ok);
      assert.deepEqual(result.problem, {
        code: "compute",
        problem: {
          code: "link-missing",
          rel: "librefs",
          resource: `compute session "${SESSION_ID}"`,
        },
      });
    });

    it("reports response-malformed when a page carries no items array", async () => {
      const { adapter } = adapterWith([
        { when: LIBREFS_HREF, reply: dataOk({ version: 2, count: 0 }) },
      ]);
      const result = await adapter.getLibraries();
      assert.ok(!result.ok);
      const { problem } = result;
      assert.ok(problem.code === "compute");
      assert.equal(problem.problem.code, "response-malformed");
    });

    it("rewrites a session-gone 404 through the compute vocabulary, unchanged", async () => {
      const { adapter } = adapterWith([
        {
          when: LIBREFS_HREF,
          reply: dataFail({ code: "compute-rejected", error: { status: 404 } }),
        },
      ]);
      const result = await adapter.getLibraries();
      assert.ok(!result.ok);
      assert.deepEqual(result.problem, {
        code: "compute",
        problem: { code: "session-gone", error: { status: 404 } },
      });
    });

    it("refuses with session-busy without sending any request", async () => {
      const { adapter, calls } = adapterWith([], { isBusy: true });
      const result = await adapter.getLibraries();
      assert.ok(!result.ok);
      assert.deepEqual(result.problem, { code: "session-busy" });
      assert.deepEqual(calls, []);
    });

    it("reports not-connected when the active profile has no session", async () => {
      const { adapter, calls } = adapterWith([], { connected: false });
      const result = await adapter.getLibraries();
      assert.ok(!result.ok);
      assert.deepEqual(result.problem, { code: "not-connected" });
      assert.deepEqual(calls, []);
    });

    it("stops at the page guard rather than paging forever", async () => {
      // A collection that never stops offering `next` — the exact shape that
      // crashed a real `npm run coverage` run with a V8 out-of-memory error
      // before `recorded-data.ts`'s own routing bug was fixed (2026-09-09;
      // see that file's doc comment). The guard is what makes this safe even
      // against a well-formed but pathological server response, not just
      // against a test double: it returns what it has rather than erroring,
      // the same choice `listFilerefNames`'s `MAX_FILEREF_PAGES` makes.
      let page = 0;
      const { adapter, calls } = adapterWith([
        {
          when: (href) => href.startsWith(LIBREFS_HREF),
          reply: () => {
            page += 1;
            return dataOk({
              items: [
                {
                  id: `LIB${String(page)}`,
                  name: `LIB${String(page)}`,
                  links: [],
                },
              ],
              links: [
                {
                  rel: "next",
                  href: `${LIBREFS_HREF}?start=${String(page)}`,
                  method: "GET",
                },
              ],
            });
          },
        },
      ]);

      const result = await adapter.getLibraries();

      assert.ok(result.ok);
      // Every item is dropped (no self link), so this pins the page count,
      // not the item count — `getLibraries`'s per-item follow-up is separate
      // from `collectPages`'s own guard.
      assert.equal(calls.length, MAX_DATA_PAGES);
    });

    it("skips a list entry with no usable name, not just one with no self link", async () => {
      const { adapter } = adapterWith([
        {
          when: LIBREFS_HREF,
          reply: dataOk({ items: [{ id: "x" }], links: [] }), // no "name"
        },
      ]);
      const result = await adapter.getLibraries();
      assert.ok(result.ok);
      assert.deepEqual(result.value, []);
    });

    it("propagates a failure from the per-item self-detail follow-up", async () => {
      const { adapter } = adapterWith([
        { when: LIBREFS_HREF, reply: dataFixture("librefs-page1.json") },
        {
          when: (href) => href.includes("start=10"),
          reply: dataFixture("librefs-page2.json"),
        },
        {
          when: `${LIBREFS_HREF}/SASHELP`,
          reply: dataFail({ code: "compute-rejected", error: { status: 500 } }),
        },
        {
          when: `${LIBREFS_HREF}/WORK`,
          reply: dataFixture("library-work.json"),
        },
      ]);
      const result = await adapter.getLibraries();
      assert.ok(!result.ok);
      assert.deepEqual(result.problem, {
        code: "compute",
        problem: { code: "compute-rejected", error: { status: 500 } },
      });
    });

    it("skips a library whose self-detail follow-up did not answer with a library representation", async () => {
      const { adapter } = adapterWith([
        { when: LIBREFS_HREF, reply: dataFixture("librefs-page1.json") },
        {
          when: (href) => href.includes("start=10"),
          reply: dataFixture("librefs-page2.json"),
        },
        {
          when: `${LIBREFS_HREF}/SASHELP`,
          reply: dataOk({ not: "a library" }),
        },
        {
          when: `${LIBREFS_HREF}/WORK`,
          reply: dataFixture("library-work.json"),
        },
      ]);
      const result = await adapter.getLibraries();
      assert.ok(result.ok);
      assert.deepEqual(
        result.value.map((l) => l.name),
        ["WORK"],
      );
    });

    it("reports response-malformed when a page's body is not an object at all", async () => {
      const { adapter } = adapterWith([
        { when: LIBREFS_HREF, reply: dataOk("not an object") },
      ]);
      const result = await adapter.getLibraries();
      assert.ok(!result.ok);
      const { problem } = result;
      assert.ok(problem.code === "compute");
      assert.equal(problem.problem.code, "response-malformed");
    });

    it("falls back to 'an unknown type' when a malformed response carries no contentType", async () => {
      const { adapter } = adapterWith([
        {
          when: LIBREFS_HREF,
          reply: {
            ok: true,
            value: {
              status: 200,
              notModified: false,
              text: "{}",
              body: { version: 2 },
            },
          },
        },
      ]);
      const result = await adapter.getLibraries();
      assert.ok(!result.ok);
      const { problem } = result;
      assert.ok(problem.code === "compute");
      assert.ok(problem.problem.code === "response-malformed");
      assert.match(problem.problem.detail, /as an unknown type/);
    });

    it("threads a caller's AbortSignal through to every request", async () => {
      const { adapter, calls } = adapterWith([
        { when: LIBREFS_HREF, reply: dataOk({ items: [], links: [] }) },
      ]);
      const controller = new AbortController();
      const result = await adapter.getLibraries(controller.signal);
      assert.ok(result.ok);
      assert.ok(calls.length > 0);
      assert.ok(calls.every((c) => c.hadSignal));
    });
  });

  describe("getTables", () => {
    it("paginates a library's tables collection, inheriting readOnly", async () => {
      const sashelp = libraryItem("SASHELP", true);
      const withTablesLink: LibraryItem = {
        ...sashelp,
        links: [
          {
            rel: "tables",
            href: `${LIBREFS_HREF}/SASHELP`,
            method: "GET",
            type: "application/vnd.sas.collection",
          },
        ],
      };
      const { adapter, calls } = adapterWith([
        {
          when: `${LIBREFS_HREF}/SASHELP`,
          reply: dataFixture("tables-sashelp-page1.json"),
        },
        {
          when: (href) => href.includes("start=2"),
          reply: dataFixture("tables-sashelp-page2.json"),
        },
      ]);

      const result = await adapter.getTables(withTablesLink);
      assert.ok(result.ok);
      assert.deepEqual(
        result.value.map((t) => [t.name, t.libref, t.readOnly]),
        [
          ["AACOMP", "SASHELP", true],
          ["ADSMSG", "SASHELP", true],
          ["CLASS", "SASHELP", true],
        ],
      );
      assert.equal(calls.length, 2);
    });

    it("returns an empty list for a library with no tables, no pagination needed", async () => {
      const work = libraryItem("WORK", false);
      const withTablesLink: LibraryItem = {
        ...work,
        links: [
          {
            rel: "tables",
            href: `${LIBREFS_HREF}/WORK`,
            method: "GET",
            type: "application/vnd.sas.collection",
          },
        ],
      };
      const { adapter } = adapterWith([
        {
          when: `${LIBREFS_HREF}/WORK`,
          reply: dataFixture("tables-work-empty.json"),
        },
      ]);
      const result = await adapter.getTables(withTablesLink);
      assert.ok(result.ok);
      assert.deepEqual(result.value, []);
    });

    it("propagates a failure from the tables collection fetch itself", async () => {
      const withTablesLink: LibraryItem = {
        ...libraryItem("SASHELP", true),
        links: [
          {
            rel: "tables",
            href: `${LIBREFS_HREF}/SASHELP`,
            method: "GET",
            type: "application/vnd.sas.collection",
          },
        ],
      };
      const { adapter } = adapterWith([
        {
          when: `${LIBREFS_HREF}/SASHELP`,
          reply: dataFail({ code: "compute-rejected", error: { status: 500 } }),
        },
      ]);
      const result = await adapter.getTables(withTablesLink);
      assert.ok(!result.ok);
      assert.deepEqual(result.problem, {
        code: "compute",
        problem: { code: "compute-rejected", error: { status: 500 } },
      });
    });

    it("reports link-missing when the library carries no tables relation", async () => {
      const orphan = libraryItem("ORPHAN", false);
      const { adapter } = adapterWith([]);
      const result = await adapter.getTables(orphan);
      assert.ok(!result.ok);
      assert.deepEqual(result.problem, {
        code: "compute",
        problem: {
          code: "link-missing",
          rel: "tables",
          resource: 'library "ORPHAN"',
        },
      });
    });

    it("refuses with session-busy before consulting the library's own link", async () => {
      const withTablesLink: LibraryItem = {
        ...libraryItem("SASHELP", true),
        links: [
          { rel: "tables", href: `${LIBREFS_HREF}/SASHELP`, method: "GET" },
        ],
      };
      const { adapter, calls } = adapterWith([], { isBusy: true });
      const result = await adapter.getTables(withTablesLink);
      assert.ok(!result.ok);
      assert.deepEqual(result.problem, { code: "session-busy" });
      assert.deepEqual(calls, []);
    });
  });

  describe("openTable", () => {
    it("follows the table's own self link to its rich detail, carrying rows/columns links", async () => {
      const { adapter, calls } = adapterWith([
        { when: CLASS_HREF, reply: dataFixture("table-detail-class.json") },
      ]);
      const result = await adapter.openTable(tableItem());
      assert.ok(result.ok);
      assert.equal(result.value.rowCount, 19);
      assert.equal(result.value.columnCount, 5);
      assert.equal(result.value.libref, "SASHELP");
      assert.ok(
        result.value.links.some(
          (l) => l.rel === "rows" && l.href === `${CLASS_HREF}/rows`,
        ),
      );
      assert.ok(
        result.value.links.some(
          (l) => l.rel === "columns" && l.href === `${CLASS_HREF}/columns`,
        ),
      );
      assert.deepEqual(
        calls.map((c) => c.href),
        [CLASS_HREF],
      );
    });

    it("reports link-missing when the table carries no self relation", async () => {
      const { adapter } = adapterWith([]);
      const result = await adapter.openTable(tableItem({ links: [] }));
      assert.ok(!result.ok);
      assert.deepEqual(result.problem, {
        code: "compute",
        problem: {
          code: "link-missing",
          rel: "self",
          resource: 'table "SASHELP.CLASS"',
        },
      });
    });

    it("reports response-malformed when the self follow-up does not answer with a table representation", async () => {
      const { adapter } = adapterWith([
        { when: CLASS_HREF, reply: dataOk({ not: "a table" }) },
      ]);
      const result = await adapter.openTable(tableItem());
      assert.ok(!result.ok);
      const { problem } = result;
      assert.ok(problem.code === "compute");
      assert.equal(problem.problem.code, "response-malformed");
    });

    it("rewrites a session-gone 404 through the compute vocabulary", async () => {
      const { adapter } = adapterWith([
        {
          when: CLASS_HREF,
          reply: dataFail({ code: "compute-rejected", error: { status: 404 } }),
        },
      ]);
      const result = await adapter.openTable(tableItem());
      assert.ok(!result.ok);
      assert.deepEqual(result.problem, {
        code: "compute",
        problem: { code: "session-gone", error: { status: 404 } },
      });
    });

    it("refuses with session-busy without sending any request", async () => {
      const { adapter, calls } = adapterWith([], { isBusy: true });
      const result = await adapter.openTable(tableItem());
      assert.ok(!result.ok);
      assert.deepEqual(result.problem, { code: "session-busy" });
      assert.deepEqual(calls, []);
    });

    it("reports not-connected when the active profile has no session", async () => {
      const { adapter } = adapterWith([], { connected: false });
      const result = await adapter.openTable(tableItem());
      assert.ok(!result.ok);
      assert.deepEqual(result.problem, { code: "not-connected" });
    });
  });

  describe("getColumns", () => {
    it("reads a table's column metadata, dropping the empty-string label", async () => {
      const { adapter, calls } = adapterWith([
        {
          when: `${CLASS_HREF}/columns`,
          reply: dataFixture("columns-class.json"),
        },
      ]);
      const result = await adapter.getColumns(tableDetail());
      assert.ok(result.ok);
      assert.deepEqual(
        result.value.map((c) => [c.name, c.type, c.length, c.label]),
        [
          ["Name", "CHAR", 8, undefined],
          ["Sex", "CHAR", 1, undefined],
          ["Age", "FLOAT", 8, undefined],
          ["Height", "FLOAT", 8, undefined],
          ["Weight", "FLOAT", 8, undefined],
        ],
      );
      assert.deepEqual(
        calls.map((c) => c.href),
        [`${CLASS_HREF}/columns`],
      );
    });

    it("reports link-missing when the table detail carries no columns relation", async () => {
      const { adapter } = adapterWith([]);
      const bare = tableDetail();
      const result = await adapter.getColumns({ ...bare, links: [] });
      assert.ok(!result.ok);
      assert.deepEqual(result.problem, {
        code: "compute",
        problem: {
          code: "link-missing",
          rel: "columns",
          resource: 'table "SASHELP.CLASS"',
        },
      });
    });

    it("drops a column entry with no usable name", async () => {
      const { adapter } = adapterWith([
        {
          when: `${CLASS_HREF}/columns`,
          reply: dataOk({ items: [{ id: "x" }], links: [] }),
        },
      ]);
      const result = await adapter.getColumns(tableDetail());
      assert.ok(result.ok);
      assert.deepEqual(result.value, []);
    });

    it("propagates a failure from the columns collection fetch itself", async () => {
      const { adapter } = adapterWith([
        {
          when: `${CLASS_HREF}/columns`,
          reply: dataFail({ code: "compute-rejected", error: { status: 500 } }),
        },
      ]);
      const result = await adapter.getColumns(tableDetail());
      assert.ok(!result.ok);
      assert.deepEqual(result.problem, {
        code: "compute",
        problem: { code: "compute-rejected", error: { status: 500 } },
      });
    });

    it("refuses with session-busy before consulting the table's own link", async () => {
      const { adapter, calls } = adapterWith([], { isBusy: true });
      const result = await adapter.getColumns(tableDetail());
      assert.ok(!result.ok);
      assert.deepEqual(result.problem, { code: "session-busy" });
      assert.deepEqual(calls, []);
    });
  });

  describe("getRows", () => {
    it("requests one window, appending start/limit to the table's own rows link", async () => {
      const { adapter, calls } = adapterWith([
        {
          when: `${CLASS_HREF}/rows?start=0&limit=2`,
          reply: dataFixture("rows-class-page1.json"),
        },
      ]);
      const result = await adapter.getRows(tableDetail(), {
        start: 0,
        limit: 2,
      });
      assert.ok(result.ok);
      assert.equal(result.value.count, 19);
      assert.deepEqual(
        result.value.rows.map((r) => r.cells),
        [
          ["Alfred", "M", 14, 69, 112.5],
          ["Alice", "F", 13, 56.5, 84],
        ],
      );
      assert.deepEqual(
        calls.map((c) => c.href),
        [`${CLASS_HREF}/rows?start=0&limit=2`],
      );
    });

    it("never follows a returned next link — a fresh window is a fresh request from the table's own rows link", async () => {
      const { adapter, calls } = adapterWith([
        {
          when: `${CLASS_HREF}/rows?start=0&limit=2`,
          reply: dataFixture("rows-class-page1.json"),
        },
        {
          when: `${CLASS_HREF}/rows?start=2&limit=2`,
          reply: dataOk({ count: 19, items: [], links: [] }),
        },
      ]);
      await adapter.getRows(tableDetail(), { start: 0, limit: 2 });
      const second = await adapter.getRows(tableDetail(), {
        start: 2,
        limit: 2,
      });
      assert.ok(second.ok);
      assert.deepEqual(
        calls.map((c) => c.href),
        [
          `${CLASS_HREF}/rows?start=0&limit=2`,
          `${CLASS_HREF}/rows?start=2&limit=2`,
        ],
      );
    });

    it("appends start/limit with & when the table's own rows link already carries a query string", async () => {
      // `withQuery`'s two-separator branches — caught in review's coverage
      // follow-up: every other case in this file uses `tableDetail()`'s own
      // bare `${CLASS_HREF}/rows` link, so the `?`-already-present path was
      // never exercised.
      const detail = tableDetail();
      const rowsLink = detail.links.find((l) => l.rel === "rows");
      assert.ok(rowsLink);
      const withQueryAlready = {
        ...detail,
        links: [
          ...detail.links.filter((l) => l.rel !== "rows"),
          { ...rowsLink, href: `${rowsLink.href}?foo=bar` },
        ],
      };
      const { adapter, calls } = adapterWith([
        {
          when: `${CLASS_HREF}/rows?foo=bar&start=0&limit=2`,
          reply: dataFixture("rows-class-page1.json"),
        },
      ]);
      const result = await adapter.getRows(withQueryAlready, {
        start: 0,
        limit: 2,
      });
      assert.ok(result.ok);
      assert.deepEqual(
        calls.map((c) => c.href),
        [`${CLASS_HREF}/rows?foo=bar&start=0&limit=2`],
      );
    });

    it("returns count undefined when the collection body carries none", async () => {
      const { adapter } = adapterWith([
        {
          when: `${CLASS_HREF}/rows?start=0&limit=2`,
          reply: dataOk({ items: [], links: [] }),
        },
      ]);
      const result = await adapter.getRows(tableDetail(), {
        start: 0,
        limit: 2,
      });
      assert.ok(result.ok);
      assert.equal(result.value.count, undefined);
    });

    it("drops a row entry with no cells array", async () => {
      const { adapter } = adapterWith([
        {
          when: `${CLASS_HREF}/rows?start=0&limit=2`,
          reply: dataOk({ items: [{ version: 1 }], links: [] }),
        },
      ]);
      const result = await adapter.getRows(tableDetail(), {
        start: 0,
        limit: 2,
      });
      assert.ok(result.ok);
      assert.deepEqual(result.value.rows, []);
    });

    it("reports link-missing when the table detail carries no rows relation", async () => {
      const { adapter } = adapterWith([]);
      const bare = tableDetail();
      const result = await adapter.getRows(
        { ...bare, links: [] },
        { start: 0, limit: 2 },
      );
      assert.ok(!result.ok);
      assert.deepEqual(result.problem, {
        code: "compute",
        problem: {
          code: "link-missing",
          rel: "rows",
          resource: 'table "SASHELP.CLASS"',
        },
      });
    });

    it("reports response-malformed when the page carries no items array", async () => {
      const { adapter } = adapterWith([
        {
          when: `${CLASS_HREF}/rows?start=0&limit=2`,
          reply: dataOk({ count: 19 }),
        },
      ]);
      const result = await adapter.getRows(tableDetail(), {
        start: 0,
        limit: 2,
      });
      assert.ok(!result.ok);
      const { problem } = result;
      assert.ok(problem.code === "compute");
      assert.equal(problem.problem.code, "response-malformed");
    });

    it("rewrites a session-gone 404 through the compute vocabulary", async () => {
      const { adapter } = adapterWith([
        {
          when: `${CLASS_HREF}/rows?start=0&limit=2`,
          reply: dataFail({ code: "compute-rejected", error: { status: 404 } }),
        },
      ]);
      const result = await adapter.getRows(tableDetail(), {
        start: 0,
        limit: 2,
      });
      assert.ok(!result.ok);
      assert.deepEqual(result.problem, {
        code: "compute",
        problem: { code: "session-gone", error: { status: 404 } },
      });
    });

    it("refuses with session-busy without sending any request", async () => {
      const { adapter, calls } = adapterWith([], { isBusy: true });
      const result = await adapter.getRows(tableDetail(), {
        start: 0,
        limit: 2,
      });
      assert.ok(!result.ok);
      assert.deepEqual(result.problem, { code: "session-busy" });
      assert.deepEqual(calls, []);
    });

    it("threads a caller's AbortSignal through to the request", async () => {
      const { adapter, calls } = adapterWith([
        {
          when: `${CLASS_HREF}/rows?start=0&limit=2`,
          reply: dataOk({ items: [], links: [] }),
        },
      ]);
      const controller = new AbortController();
      const result = await adapter.getRows(
        tableDetail(),
        { start: 0, limit: 2 },
        undefined,
        controller.signal,
      );
      assert.ok(result.ok);
      assert.ok(calls.every((c) => c.hadSignal));
    });

    it("appends a where= parameter, percent-encoded, when a filter is given", async () => {
      const { adapter, calls } = adapterWith([
        {
          when: `${CLASS_HREF}/rows?start=0&limit=2&where=Sex%3D'F'`,
          reply: dataFixture("rows-class-page1.json"),
        },
      ]);
      const result = await adapter.getRows(
        tableDetail(),
        { start: 0, limit: 2 },
        "Sex='F'",
      );
      assert.ok(result.ok);
      assert.deepEqual(
        calls.map((c) => c.href),
        [`${CLASS_HREF}/rows?start=0&limit=2&where=Sex%3D'F'`],
      );
    });

    it("omits where= entirely when the filter is an empty string", async () => {
      const { adapter, calls } = adapterWith([
        {
          when: `${CLASS_HREF}/rows?start=0&limit=2`,
          reply: dataFixture("rows-class-page1.json"),
        },
      ]);
      const result = await adapter.getRows(
        tableDetail(),
        { start: 0, limit: 2 },
        "",
      );
      assert.ok(result.ok);
      assert.deepEqual(
        calls.map((c) => c.href),
        [`${CLASS_HREF}/rows?start=0&limit=2`],
      );
    });
  });

  describe("applySort", () => {
    const VIEW_HREF = `${LIBREFS_HREF}/%24VIEWS/T0D749FF8_VIEW`;

    function tableWithCreateView(): TableDetail {
      const detail = tableDetail();
      return {
        ...detail,
        links: [
          ...detail.links,
          {
            rel: "createView",
            href: `${CLASS_HREF}/views`,
            method: "POST",
            type: "application/vnd.sas.compute.data.table.view.request",
          },
        ],
      };
    }

    it("posts sortBy to the createView link and returns a view carrying the original table's identity", async () => {
      const { adapter, calls } = adapterWith([
        {
          when: `${CLASS_HREF}/views`,
          reply: dataOk(
            {
              name: "T0D749FF8_VIEW",
              libref: "WORK",
              type: "VIEW",
              rowCount: -1,
              links: [
                { rel: "rows", href: `${VIEW_HREF}/rows`, method: "GET" },
                { rel: "delete", href: VIEW_HREF, method: "DELETE" },
              ],
            },
            { status: 201 },
          ),
        },
      ]);

      const result = await adapter.applySort(
        tableWithCreateView(),
        [{ key: "Age", direction: "descending" }],
        undefined,
      );

      assert.ok(result.ok);
      // The view's own libref/name are misleading (Finding 7.15) — carrying
      // the source table's identity is what an error message should show.
      assert.equal(result.value.libref, "SASHELP");
      assert.equal(result.value.name, "CLASS");
      // rowCount/columnCount are never carried over from the view's own
      // response — its -1 is "not yet known", not a real count.
      assert.equal(result.value.rowCount, undefined);
      assert.ok(result.value.links.some((l) => l.rel === "rows"));
      assert.ok(result.value.links.some((l) => l.rel === "delete"));

      assert.equal(calls.length, 1);
      const [call] = calls;
      assert.ok(call);
      assert.equal(call.method, "POST");
      assert.equal(call.href, `${CLASS_HREF}/views`);
    });

    it("bakes a filter into the same createView body rather than a separate call", async () => {
      let sentBody: unknown;
      const { adapter } = adapterWith([
        {
          when: `${CLASS_HREF}/views`,
          reply: (request) => {
            sentBody = request.body;
            return dataOk(
              {
                name: "V",
                libref: "WORK",
                links: [
                  { rel: "rows", href: `${VIEW_HREF}/rows`, method: "GET" },
                  { rel: "delete", href: VIEW_HREF, method: "DELETE" },
                ],
              },
              { status: 201 },
            );
          },
        },
      ]);

      const result = await adapter.applySort(
        tableWithCreateView(),
        [{ key: "Age", direction: "descending" }],
        "Sex='F'",
      );

      assert.ok(result.ok);
      assert.deepEqual(sentBody, {
        sortBy: [{ key: "Age", direction: "descending" }],
        where: "Sex='F'",
      });
    });

    it("omits where from the body when there is no filter", async () => {
      let sentBody: unknown;
      const { adapter } = adapterWith([
        {
          when: `${CLASS_HREF}/views`,
          reply: (request) => {
            sentBody = request.body;
            return dataOk(
              {
                name: "V",
                libref: "WORK",
                links: [
                  { rel: "rows", href: `${VIEW_HREF}/rows`, method: "GET" },
                  { rel: "delete", href: VIEW_HREF, method: "DELETE" },
                ],
              },
              { status: 201 },
            );
          },
        },
      ]);
      await adapter.applySort(
        tableWithCreateView(),
        [{ key: "Age", direction: "descending" }],
        undefined,
      );
      assert.deepEqual(sentBody, {
        sortBy: [{ key: "Age", direction: "descending" }],
      });
    });

    it("reports link-missing when the table carries no createView relation", async () => {
      const { adapter } = adapterWith([]);
      const result = await adapter.applySort(tableDetail(), [], undefined);
      assert.ok(!result.ok);
      assert.deepEqual(result.problem, {
        code: "compute",
        problem: {
          code: "link-missing",
          rel: "createView",
          resource: 'table "SASHELP.CLASS"',
        },
      });
    });

    it("reports response-malformed when the created view carries no rows or delete link", async () => {
      const { adapter } = adapterWith([
        {
          when: `${CLASS_HREF}/views`,
          reply: dataOk(
            { name: "V", libref: "WORK", links: [] },
            { status: 201 },
          ),
        },
      ]);
      const result = await adapter.applySort(
        tableWithCreateView(),
        [],
        undefined,
      );
      assert.ok(!result.ok);
      const { problem } = result;
      assert.ok(problem.code === "compute");
      assert.equal(problem.problem.code, "response-malformed");
    });

    it("refuses with session-busy without sending any request", async () => {
      const { adapter, calls } = adapterWith([], { isBusy: true });
      const result = await adapter.applySort(
        tableWithCreateView(),
        [],
        undefined,
      );
      assert.ok(!result.ok);
      assert.deepEqual(result.problem, { code: "session-busy" });
      assert.deepEqual(calls, []);
    });

    it("rewrites a session-gone 404 through the compute vocabulary", async () => {
      const { adapter } = adapterWith([
        {
          when: `${CLASS_HREF}/views`,
          reply: dataFail({ code: "compute-rejected", error: { status: 404 } }),
        },
      ]);
      const result = await adapter.applySort(
        tableWithCreateView(),
        [],
        undefined,
      );
      assert.ok(!result.ok);
      assert.deepEqual(result.problem, {
        code: "compute",
        problem: { code: "session-gone", error: { status: 404 } },
      });
    });
  });

  describe("deleteView", () => {
    const VIEW_HREF = `${LIBREFS_HREF}/%24VIEWS/T0D749FF8_VIEW`;

    function view(): TableDetail {
      return {
        kind: "tableDetail",
        libref: "SASHELP",
        name: "CLASS",
        links: [{ rel: "delete", href: VIEW_HREF, method: "DELETE" }],
      };
    }

    it("follows the view's own delete link", async () => {
      const { adapter, calls } = adapterWith([
        { when: VIEW_HREF, reply: dataOk({}, { status: 204 }) },
      ]);
      const result = await adapter.deleteView(view());
      assert.ok(result.ok);
      assert.equal(calls.length, 1);
      const [call] = calls;
      assert.ok(call);
      assert.equal(call.method, "DELETE");
      assert.equal(call.href, VIEW_HREF);
    });

    it("reports link-missing when the view carries no delete relation", async () => {
      const { adapter } = adapterWith([]);
      const result = await adapter.deleteView({ ...view(), links: [] });
      assert.ok(!result.ok);
      assert.deepEqual(result.problem, {
        code: "compute",
        problem: {
          code: "link-missing",
          rel: "delete",
          resource: 'view over table "SASHELP.CLASS"',
        },
      });
    });

    it("rewrites a session-gone 404 through the compute vocabulary", async () => {
      const { adapter } = adapterWith([
        {
          when: VIEW_HREF,
          reply: dataFail({ code: "compute-rejected", error: { status: 404 } }),
        },
      ]);
      const result = await adapter.deleteView(view());
      assert.ok(!result.ok);
      assert.deepEqual(result.problem, {
        code: "compute",
        problem: { code: "session-gone", error: { status: 404 } },
      });
    });

    it("refuses with session-busy without sending any request", async () => {
      const { adapter, calls } = adapterWith([], { isBusy: true });
      const result = await adapter.deleteView(view());
      assert.ok(!result.ok);
      assert.deepEqual(result.problem, { code: "session-busy" });
      assert.deepEqual(calls, []);
    });
  });
});

// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { CasAdapter, MAX_CAS_PAGES } from "../../src/cas/adapter";
import {
  readCaslibItem,
  readCasServerItem,
  readCasTableItem,
  type CaslibItem,
  type CasServerItem,
  type CasTableItem,
} from "../../src/cas/types";
import {
  casFail,
  casFixture,
  casOk,
  casText,
  recordedCasClient,
  type RecordedCasCall,
  type RecordedCasRoute,
} from "../helpers/recorded-cas";

/**
 * The real `CasAdapter` against recorded `casManagement` wire shapes
 * (Findings 8.1–8.3/8.7/8.8, `docs/phases/phase-8.md`, `verde`). The adapter
 * is `vscode`-free, so this is a plain unit test; the HTTP boundary is the
 * fake `CasClient` `recorded-cas.ts` builds — `CasAdapter` never constructs
 * one itself (ADR-0033).
 */

const SERVERS_HREF = "/casManagement/servers";
const CASLIBS_HREF = "/casManagement/servers/cas-shared-default/caslibs";
const TABLES_HREF = `${CASLIBS_HREF}/Public/tables`;
const COLUMNS_HREF = `${TABLES_HREF}/LOOKUP_TABLE/columns`;
const LOAD_HREF = `${TABLES_HREF}/LOOKUP_TABLE/state`;

function adapterWith(routes: readonly RecordedCasRoute[]): {
  adapter: CasAdapter;
  calls: RecordedCasCall[];
} {
  const { client, calls } = recordedCasClient(routes);
  return { adapter: new CasAdapter(client), calls };
}

function server(overrides: Partial<CasServerItem> = {}): CasServerItem {
  const item = readCasServerItem({
    name: "cas-shared-default",
    restPort: 8777,
    restProtocol: "https",
    links: [
      {
        rel: "caslibs",
        href: CASLIBS_HREF,
        method: "GET",
        type: "application/vnd.sas.collection",
      },
    ],
    ...overrides,
  });
  assert.ok(item);
  return item;
}

function caslib(overrides: Partial<CaslibItem> = {}): CaslibItem {
  const item = readCaslibItem(
    {
      name: "Public",
      links: [
        {
          rel: "tables",
          href: TABLES_HREF,
          method: "GET",
          type: "application/vnd.sas.collection",
        },
      ],
      ...overrides,
    },
    server(),
  );
  assert.ok(item);
  return item;
}

function unloadedTable(): CasTableItem {
  const item = readCasTableItem(
    {
      name: "LOOKUP_TABLE",
      state: "unloaded",
      rowCount: 0,
      columnCount: 0,
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
          href: COLUMNS_HREF,
          method: "GET",
          type: "application/vnd.sas.collection",
        },
      ],
    },
    caslib(),
  );
  assert.ok(item);
  return item;
}

function loadedTable(): CasTableItem {
  const item = readCasTableItem(
    {
      name: "LOOKUP_TABLE",
      state: "loaded",
      rowCount: 12,
      columnCount: 2,
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
          href: COLUMNS_HREF,
          method: "GET",
          type: "application/vnd.sas.collection",
        },
      ],
    },
    caslib(),
  );
  assert.ok(item);
  return item;
}

describe("cas/adapter CasAdapter", () => {
  describe("getServers", () => {
    it("reads the composed servers collection with no per-item follow-up", async () => {
      const { adapter, calls } = adapterWith([
        { when: SERVERS_HREF, reply: casFixture("servers.json") },
      ]);
      const result = await adapter.getServers();
      assert.ok(result.ok);
      assert.equal(result.value.length, 1);
      assert.equal(result.value[0]?.name, "cas-shared-default");
      assert.deepEqual(calls, [
        { href: `${SERVERS_HREF}?sortBy=name`, method: "GET" },
      ]);
    });

    it("drops a server entry with no usable name", async () => {
      const { adapter } = adapterWith([
        {
          when: SERVERS_HREF,
          reply: casOk({ count: 1, items: [{ restPort: 8777 }], links: [] }),
        },
      ]);
      const result = await adapter.getServers();
      assert.ok(result.ok);
      assert.deepEqual(result.value, []);
    });

    it("propagates a transport failure", async () => {
      const { adapter } = adapterWith([
        {
          when: SERVERS_HREF,
          reply: casFail({ code: "cas-unreachable", detail: "ECONNRESET" }),
        },
      ]);
      const result = await adapter.getServers();
      assert.ok(!result.ok);
      assert.equal(result.problem.code, "cas-unreachable");
    });
  });

  describe("getCaslibs", () => {
    it("paginates the caslibs collection, following next", async () => {
      // Function matchers, not bare strings: a bare string ignores the query
      // string entirely (`recorded-cas.ts`'s own doc comment), which would
      // make page 1's route also match page 2's request. Page 1's own href
      // carries collectPages' own seed `sortBy=name` (Finding 8.9); page 2's
      // does not, because it comes verbatim from the fixture's own `next`
      // link, which never had one added to it.
      const { adapter, calls } = adapterWith([
        {
          when: (href) => href === `${CASLIBS_HREF}?sortBy=name`,
          reply: casFixture("caslibs-page1.json"),
        },
        {
          when: (href) => href.includes("start=2"),
          reply: casFixture("caslibs-page2.json"),
        },
      ]);
      const result = await adapter.getCaslibs(server());
      assert.ok(result.ok);
      assert.deepEqual(
        result.value.map((c) => c.name),
        ["Public", "Formats", "Samples", "SystemData"],
      );
      assert.equal(calls.length, 2);
      // Every caslib carries the owning server's name, not read off the wire.
      assert.ok(
        result.value.every((c) => c.serverName === "cas-shared-default"),
      );
    });

    it("reports response-malformed when a collection carries no items array", async () => {
      const { adapter } = adapterWith([
        { when: CASLIBS_HREF, reply: casOk({ count: 0, links: [] }) },
      ]);
      const result = await adapter.getCaslibs(server());
      assert.ok(!result.ok);
      assert.equal(result.problem.code, "response-malformed");
    });

    it("fails link-missing when the server carries no caslibs link", async () => {
      const { adapter } = adapterWith([]);
      const result = await adapter.getCaslibs(server({ links: [] }));
      assert.ok(!result.ok);
      assert.equal(result.problem.code, "link-missing");
    });

    it("stops at the page guard rather than paging forever", async () => {
      // A collection that never stops offering `next` — the same runaway
      // shape `data-adapter.test.ts` guards `collectPages` against, one
      // service over. A bare-string route matches every page's request
      // regardless of its `?start=` query (`recorded-cas.ts`'s own
      // doc comment), so one route suffices.
      const { adapter, calls } = adapterWith([
        {
          when: CASLIBS_HREF,
          reply: (request) => {
            const page = Number(
              new URL(`https://x${request.link.href}`).searchParams.get(
                "start",
              ) ?? "0",
            );
            return casOk({
              count: 999,
              items: [{ name: `Lib${String(page)}` }],
              links: [
                {
                  rel: "next",
                  href: `${CASLIBS_HREF}?start=${String(page + 1)}`,
                  method: "GET",
                },
              ],
            });
          },
        },
      ]);
      const result = await adapter.getCaslibs(server());
      assert.ok(result.ok);
      assert.equal(calls.length, MAX_CAS_PAGES);
    });
  });

  describe("getTables", () => {
    it("reads a caslib's tables, sparse, with no per-item follow-up", async () => {
      const { adapter, calls } = adapterWith([
        { when: TABLES_HREF, reply: casFixture("tables.json") },
      ]);
      const result = await adapter.getTables(caslib());
      assert.ok(result.ok);
      assert.deepEqual(
        result.value.map((t) => [t.name, t.state, t.rowCount, t.columnCount]),
        [
          ["REFERENCE_DATA", "unloaded", 0, 0],
          ["LOOKUP_TABLE", "loaded", 12, 2],
        ],
      );
      assert.ok(result.value.every((t) => t.caslibName === "Public"));
      assert.equal(calls.length, 1);
    });

    it("Finding 8.9: requests sortBy=name, since casManagement's own listings are not stably ordered across identical requests without it", async () => {
      const { adapter, calls } = adapterWith([
        { when: TABLES_HREF, reply: casFixture("tables.json") },
      ]);
      const result = await adapter.getTables(caslib());
      assert.ok(result.ok);
      assert.equal(calls[0]?.href, `${TABLES_HREF}?sortBy=name`);
    });

    it("fails link-missing when the caslib carries no tables link", async () => {
      const { adapter } = adapterWith([]);
      const result = await adapter.getTables(caslib({ links: [] }));
      assert.ok(!result.ok);
      assert.equal(result.problem.code, "link-missing");
    });

    it("propagates a transport failure", async () => {
      const { adapter } = adapterWith([
        {
          when: TABLES_HREF,
          reply: casFail({ code: "cas-unreachable", detail: "ECONNRESET" }),
        },
      ]);
      const result = await adapter.getTables(caslib());
      assert.ok(!result.ok);
      assert.equal(result.problem.code, "cas-unreachable");
    });
  });

  describe("getColumns", () => {
    it("reads columns directly when the table is already loaded — no load PUT", async () => {
      const { adapter, calls } = adapterWith([
        { when: COLUMNS_HREF, reply: casFixture("columns.json") },
      ]);
      const result = await adapter.getColumns(loadedTable());
      assert.ok(result.ok);
      assert.deepEqual(
        result.value.map((c) => [c.name, c.type, c.formattedLength]),
        [
          ["CODE", "varchar", 8],
          ["VALUE", "double", 12],
        ],
      );
      assert.deepEqual(calls, [
        { href: `${COLUMNS_HREF}?sortBy=name`, method: "GET" },
      ]);
    });

    it("Finding 8.8: loads an unloaded table first, then reads the same columns link", async () => {
      const { adapter, calls } = adapterWith([
        {
          // A function matcher, not a bare string: `withQuery` appends
          // `?value=loaded` to the link's own href before sending it.
          when: (href, method) =>
            href.startsWith(LOAD_HREF) && method === "PUT",
          reply: casText("loaded"),
        },
        { when: COLUMNS_HREF, reply: casFixture("columns.json") },
      ]);
      const result = await adapter.getColumns(unloadedTable());
      assert.ok(result.ok);
      assert.equal(result.value.length, 2);
      assert.deepEqual(calls, [
        { href: `${LOAD_HREF}?value=loaded`, method: "PUT" },
        { href: `${COLUMNS_HREF}?sortBy=name`, method: "GET" },
      ]);
    });

    it("carries the table's own identity onto each column", async () => {
      const { adapter } = adapterWith([
        { when: COLUMNS_HREF, reply: casFixture("columns.json") },
      ]);
      const result = await adapter.getColumns(loadedTable());
      assert.ok(result.ok);
      for (const column of result.value) {
        assert.equal(column.serverName, "cas-shared-default");
        assert.equal(column.caslibName, "Public");
        assert.equal(column.tableName, "LOOKUP_TABLE");
      }
    });

    it("returns the load failure as-is, without attempting columns", async () => {
      const { adapter, calls } = adapterWith([
        {
          when: (href, method) =>
            href.startsWith(LOAD_HREF) && method === "PUT",
          reply: casFail({
            code: "cas-rejected",
            error: { status: 409, message: "table is busy" },
          }),
        },
      ]);
      const result = await adapter.getColumns(unloadedTable());
      assert.ok(!result.ok);
      assert.equal(result.problem.code, "cas-rejected");
      assert.equal(calls.length, 1);
    });

    it("appends value=loaded with & when the updateState link already carries a query", async () => {
      const table = unloadedTable();
      const withQuery = {
        ...table,
        links: table.links.map((l) =>
          l.rel === "updateState" ? { ...l, href: `${l.href}?debug=1` } : l,
        ),
      };
      const { adapter, calls } = adapterWith([
        {
          when: (href, method) =>
            href.startsWith(LOAD_HREF) && method === "PUT",
          reply: casText("loaded"),
        },
        { when: COLUMNS_HREF, reply: casFixture("columns.json") },
      ]);
      const result = await adapter.getColumns(withQuery);
      assert.ok(result.ok);
      assert.deepEqual(calls[0], {
        href: `${LOAD_HREF}?debug=1&value=loaded`,
        method: "PUT",
      });
    });

    it("fails link-missing when an unloaded table carries no updateState link", async () => {
      const { adapter } = adapterWith([]);
      const table = unloadedTable();
      const result = await adapter.getColumns({
        ...table,
        links: table.links.filter((l) => l.rel !== "updateState"),
      });
      assert.ok(!result.ok);
      assert.equal(result.problem.code, "link-missing");
      assert.equal(result.problem.rel, "updateState");
    });

    it("fails link-missing when the table carries no columns link", async () => {
      const { adapter } = adapterWith([]);
      const table = loadedTable();
      const result = await adapter.getColumns({
        ...table,
        links: table.links.filter((l) => l.rel !== "columns"),
      });
      assert.ok(!result.ok);
      assert.equal(result.problem.code, "link-missing");
      assert.equal(result.problem.rel, "columns");
    });

    it("propagates a transport failure reading columns, after a successful load", async () => {
      const { adapter } = adapterWith([
        {
          when: (href, method) =>
            href.startsWith(LOAD_HREF) && method === "PUT",
          reply: casText("loaded"),
        },
        {
          when: COLUMNS_HREF,
          reply: casFail({ code: "cas-unreachable", detail: "ECONNRESET" }),
        },
      ]);
      const result = await adapter.getColumns(unloadedTable());
      assert.ok(!result.ok);
      assert.equal(result.problem.code, "cas-unreachable");
    });

    it("drops a column entry with no usable name", async () => {
      const { adapter } = adapterWith([
        {
          when: COLUMNS_HREF,
          reply: casOk({ count: 1, items: [{ type: "varchar" }], links: [] }),
        },
      ]);
      const result = await adapter.getColumns(loadedTable());
      assert.ok(result.ok);
      assert.deepEqual(result.value, []);
    });
  });
});

// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  LibraryAdapter,
  MAX_DATA_PAGES,
  type ConnectedSession,
  type LibrarySessionSource,
} from "../../src/data/adapter";
import { readLibraryItem, type LibraryItem } from "../../src/data/types";
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
});

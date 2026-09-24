// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The read model behind the CAS browsing tree: a deployment's CAS servers,
 * their global-scope caslibs, each caslib's tables, and a table's columns
 * once it is loaded.
 *
 * **This module must never import `vscode`.**
 *
 * No upstream file to follow or audit — the SAS VS Code extension calls no
 * CAS APIs at all (`docs/phases/phase-8.md`'s Plan section). Built
 * from the `casManagement` REST API's documented shape and the live probes
 * recorded there (Findings 8.1–8.8), the same "endpoint plus a token, no
 * session" shape `src/content/adapter.ts` uses rather than
 * `src/data/adapter.ts`'s session-borrowing one —
 * [ADR-0033](../../docs/adr/0033-cas-adapter-shape.md).
 *
 * ## The one composed URL, and why it is not a link-following violation
 *
 * ADR-0010's rule is "navigate by link, never compose a URL" — but a first
 * hop has to start somewhere, and `src/content/adapter.ts` already composes
 * `/folders/folders` directly for exactly this reason (there is no link to
 * it from nowhere). {@link CasAdapter.getServers} does the same for
 * `/casManagement/servers`: Finding 8.1/8.7 confirm the deployment root's own
 * `getServers` link resolves to precisely this path, so composing it is not
 * a guess about an unlinked shape, it is skipping a round trip to a link
 * this project has already confirmed is stable — the same reasoning, applied
 * once, one service over.
 *
 * ## Why a table's columns can need a load first
 *
 * Finding 8.3: an unloaded table's `columns` collection is a `404`. Finding
 * 8.8 (this slice's own probe) confirmed the fix is a bodyless
 * `PUT .../tables/{name}/state?value=loaded`, answered with a **plain-text**
 * `"loaded"`, and that the *same* `columns` link the unloaded listing entry
 * already carried then succeeds — no re-fetch of the table's own
 * representation is needed after loading, because the link itself does not
 * change. {@link CasAdapter.getColumns} therefore checks `table.state`
 * before deciding whether to load, rather than reacting to a `columns` `404`
 * — see `src/cas/types.ts`'s own doc comment for why this avoids branching
 * on an `errorCode`.
 */

import { findLink, readLinks, type Link } from "../wire/links";
import {
  type CasClient,
  type CasFailure,
  type CasResponse,
  type CasResult,
} from "./client";
import {
  CASLIBS_REL,
  COLUMNS_REL,
  CONNECTION_REL,
  DATA_TABLE_REL,
  LOAD_REL,
  readCaslibItem,
  readCasColumnItem,
  readCasConnectionInfo,
  readCasRowItem,
  readCasServerItem,
  readCasTableItem,
  readCasTableProperties,
  ROWS_REL,
  SERVERS_REL,
  TABLES_REL,
  type CaslibItem,
  type CasColumnItem,
  type CasConnectionInfo,
  type CasRowItem,
  type CasServerItem,
  type CasSortSpec,
  type CasTableDetail,
  type CasTableItem,
  type CasTableProperties,
} from "./types";

/** The window of rows {@link CasAdapter.getRows} requests — `start`/`limit`
 * map onto the `rows` collection's own query parameters (Finding 8.12),
 * zero-based, the same shape `src/data/adapter.ts`'s `RowWindow` gives a
 * Compute session table. */
export interface CasRowWindow {
  readonly start: number;
  readonly limit: number;
}

/** One window of a CAS table's row data, as {@link CasAdapter.getRows}
 * returns it. Unlike `src/data/adapter.ts`'s `RowsPage`, `count` has no
 * documented case where it disappears (Finding 8.12 found it populated even
 * under a combined sort+filter) — still optional at the type level since
 * nothing here has probed every possible deployment. */
export interface CasRowsPage {
  readonly rows: readonly CasRowItem[];
  readonly count: number | undefined;
}

/** The composed bootstrap link for the CAS servers collection — see this
 * module's own doc comment for why this one URL is written down rather than
 * followed. */
const SERVERS_LINK: Link = {
  rel: SERVERS_REL,
  href: "/casManagement/servers",
  method: "GET",
  type: "application/vnd.sas.collection",
};

export class CasAdapter {
  constructor(
    private readonly client: CasClient,
    /** The deployment this adapter's `client` was built against —
     * `CasSession.adapterFor`'s own cache key. `CasTableSource` folds this
     * into its panel-dedup `key` (mirroring `LibraryAdapter.profileId`) so
     * switching to a different profile/endpoint never reveals a panel still
     * bound to a previous deployment's adapter. */
    readonly endpoint: string,
  ) {}

  /** Every CAS server on this deployment — one request, no per-item
   * follow-up: unlike Phase 7's sparse `librefs` listing, the servers
   * collection's own entry already carries every relation a caller needs
   * (`caslibs`, `sessions`, `createSession`, … — Finding 8.1/8.7). */
  async getServers(
    signal?: AbortSignal,
  ): Promise<CasResult<readonly CasServerItem[]>> {
    const items = await this.collectPages(SERVERS_LINK, signal);
    if (!items.ok) return items;

    const servers: CasServerItem[] = [];
    for (const raw of items.value) {
      const server = readCasServerItem(raw);
      if (server !== undefined) servers.push(server);
    }
    return { ok: true, value: servers };
  }

  /** `server`'s own global-scope caslibs (Finding 8.2/8.7 — no `sessionId`
   * needed). 8a's own scope stops here: a session-scoped personal caslib is
   * a later slice's problem, per `docs/phases/phase-8.md`'s Plan section. */
  async getCaslibs(
    server: CasServerItem,
    signal?: AbortSignal,
  ): Promise<CasResult<readonly CaslibItem[]>> {
    const link = findLink(server.links, CASLIBS_REL);
    if (link === undefined) {
      return linkMissing(`CAS server "${server.name}"`, CASLIBS_REL);
    }

    const items = await this.collectPages(link, signal);
    if (!items.ok) return items;

    const caslibs: CaslibItem[] = [];
    for (const raw of items.value) {
      const caslib = readCaslibItem(raw, server);
      if (caslib !== undefined) caslibs.push(caslib);
    }
    return { ok: true, value: caslibs };
  }

  /** `caslib`'s own tables, sparse — the listing entry already carries
   * everything `CasTableItem` needs (`state`/`rowCount`/`columnCount`,
   * Finding 8.2/8.3), no per-item follow-up. */
  async getTables(
    caslib: CaslibItem,
    signal?: AbortSignal,
  ): Promise<CasResult<readonly CasTableItem[]>> {
    const link = findLink(caslib.links, TABLES_REL);
    if (link === undefined) {
      return linkMissing(`caslib "${caslib.name}"`, TABLES_REL);
    }

    const items = await this.collectPages(link, signal);
    if (!items.ok) return items;

    const tables: CasTableItem[] = [];
    for (const raw of items.value) {
      const table = readCasTableItem(raw, caslib);
      if (table !== undefined) tables.push(table);
    }
    return { ok: true, value: tables };
  }

  /**
   * `table`'s columns, loading the table first when it is not already
   * `"loaded"` (Finding 8.3/8.8) — see this module's own doc comment. A load
   * failure is returned as-is rather than a columns-specific one: whatever
   * went wrong loading is what the user needs to see, not a downstream
   * symptom of it.
   *
   * **Returned in the table's own column order, not the listing's.**
   * Finding 12.6: {@link collectPages}' `sortBy=name` reorders this
   * collection alphabetically, while every `rows` reply's positional
   * `cells` stay in the table's own order — so the list is re-sorted here
   * by each item's 1-based `index` field before anyone pairs a column with
   * a cell by position (the data viewer's grid, the CSV export). An item
   * with no numeric `index` sorts after every item that has one, keeping
   * the listing's relative order among themselves.
   */
  async getColumns(
    table: CasTableItem,
    signal?: AbortSignal,
  ): Promise<CasResult<readonly CasColumnItem[]>> {
    if (table.state !== "loaded") {
      const loaded = await this.load(table, signal);
      if (!loaded.ok) return loaded;
    }

    const link = findLink(table.links, COLUMNS_REL);
    if (link === undefined) {
      return linkMissing(
        `table "${table.caslibName}.${table.name}"`,
        COLUMNS_REL,
      );
    }

    const items = await this.collectPages(link, signal);
    if (!items.ok) return items;

    const columns: CasColumnItem[] = [];
    for (const raw of [...items.value].sort(byColumnIndex)) {
      const column = readCasColumnItem(raw, table);
      if (column !== undefined) columns.push(column);
    }
    return { ok: true, value: columns };
  }

  /**
   * Opens `table` for viewing (8c) — loads it first when necessary (the same
   * gate {@link getColumns} already has), then follows {@link DATA_TABLE_REL}
   * to the Data Tables API and reads its own {@link ROWS_REL} (Findings
   * 8.11/8.12), since `casManagement` itself has no row-data relation at all.
   *
   * The returned {@link CasTableDetail} always reports `state: "loaded"` —
   * see that interface's own doc comment for why this is correct even when
   * `table.state` said otherwise a moment ago.
   */
  async openTable(
    table: CasTableItem,
    signal?: AbortSignal,
  ): Promise<CasResult<CasTableDetail>> {
    if (table.state !== "loaded") {
      const loaded = await this.load(table, signal);
      if (!loaded.ok) return loaded;
    }

    const dataTableLink = findLink(table.links, DATA_TABLE_REL);
    if (dataTableLink === undefined) {
      return linkMissing(
        `table "${table.caslibName}.${table.name}"`,
        DATA_TABLE_REL,
      );
    }

    const result = await this.client.send({
      link: dataTableLink,
      ...withSignal(signal),
    });
    if (!result.ok) return result;

    const rowsLink = findLink(readLinks(result.value.body), ROWS_REL);
    if (rowsLink === undefined) {
      return malformed(
        result.value,
        `table "${table.caslibName}.${table.name}"'s Data Tables representation`,
        'and it carried no "rows" link',
      );
    }

    return { ok: true, value: { ...table, state: "loaded", rowsLink } };
  }

  /**
   * `table`'s own full representation for 11d's properties panel — loads the
   * table first when it is not already `"loaded"` (the same gate
   * {@link getColumns} has), then re-reads `self`: Finding 11.5, an unloaded
   * table's representation carries no timestamps, encoding, or real
   * row/column counts at all, so the listing entry the caller already holds
   * is not enough.
   */
  async getTableProperties(
    table: CasTableItem,
    signal?: AbortSignal,
  ): Promise<CasResult<CasTableProperties>> {
    if (table.state !== "loaded") {
      const loaded = await this.load(table, signal);
      if (!loaded.ok) return loaded;
    }

    const link = findLink(table.links, "self");
    if (link === undefined) {
      return linkMissing(`table "${table.caslibName}.${table.name}"`, "self");
    }

    const result = await this.client.send({ link, ...withSignal(signal) });
    if (!result.ok) return result;
    return {
      ok: true,
      value: readCasTableProperties(result.value.body, table),
    };
  }

  /**
   * One window of a table's row data — a single request, never a walk to
   * completion, the same "windowed, not collected" shape
   * `src/data/adapter.ts`'s own `getRows` gives a Compute session table.
   *
   * **Sort and filter are both plain query parameters on every request, sent
   * together — there is no `createView`/`deleteView` step of any kind.**
   * Finding 8.12: `sortBy=key:direction` (comma-joined for more than one
   * column) and `where=<clause>` both work directly on the `rows` link,
   * together, in a single request, with `count` staying populated regardless
   * — materially simpler than `LibraryAdapter.getRows`'s own view-creation
   * dance, which exists only because a Compute session table's `where=` is
   * silently ignored once a sort is active (Finding 7.16). Nothing here needs
   * that workaround.
   */
  async getRows(
    table: CasTableDetail,
    window: CasRowWindow,
    sort: readonly CasSortSpec[],
    filter: string,
    signal?: AbortSignal,
  ): Promise<CasResult<CasRowsPage>> {
    const parameters = [
      `start=${String(window.start)}`,
      `limit=${String(window.limit)}`,
    ];
    if (sort.length > 0) {
      const clause = sort
        .map((spec) => `${spec.key}:${spec.direction}`)
        .join(",");
      parameters.push(`sortBy=${encodeURIComponent(clause)}`);
    }
    if (filter !== "") parameters.push(`where=${encodeURIComponent(filter)}`);

    const link: Link = {
      ...table.rowsLink,
      href: withQuery(table.rowsLink.href, parameters),
    };
    const result = await this.client.send({ link, ...withSignal(signal) });
    if (!result.ok) return result;

    const items = readItems(result.value);
    if (items === undefined) {
      return malformed(
        result.value,
        `table "${table.caslibName}.${table.name}"'s rows`,
        'and it carried no "items" array',
      );
    }

    const rows: CasRowItem[] = [];
    for (const raw of items) {
      const row = readCasRowItem(raw);
      if (row !== undefined) rows.push(row);
    }
    return { ok: true, value: { rows, count: readCount(result.value.body) } };
  }

  /** `server`'s internal connection info (Finding 8.10) — 8b's own caller:
   * the CAS-connect snippet command needs the internal host/port to build a
   * `swat.CAS(host, port, password=<token>)` call. A single resource, not a
   * collection — no `collectPages` involved. */
  async getConnection(
    server: CasServerItem,
    signal?: AbortSignal,
  ): Promise<CasResult<CasConnectionInfo>> {
    const link = findLink(server.links, CONNECTION_REL);
    if (link === undefined) {
      return linkMissing(`CAS server "${server.name}"`, CONNECTION_REL);
    }

    const result = await this.client.send({ link, ...withSignal(signal) });
    if (!result.ok) return result;

    const info = readCasConnectionInfo(result.value.body);
    if (info === undefined) {
      return malformed(
        result.value,
        `CAS server "${server.name}"'s connection info`,
        'and it carried no usable "host"/"port" fields',
      );
    }
    return { ok: true, value: info };
  }

  /** The JIT-load toggle (Finding 8.8): `PUT` `table`'s own `updateState`
   * link with `value=loaded` appended, no request body. The response is
   * plain text and carries nothing this method needs to read — success is
   * the `200` itself, and `getColumns` re-uses the *same* `columns` link the
   * unloaded listing entry already carried rather than re-fetching `table`'s
   * own representation, since Finding 8.8 found that link unchanged by
   * loading. */
  private async load(
    table: CasTableItem,
    signal: AbortSignal | undefined,
  ): Promise<CasResult<void>> {
    const link = findLink(table.links, LOAD_REL);
    if (link === undefined) {
      return linkMissing(`table "${table.caslibName}.${table.name}"`, LOAD_REL);
    }

    const loadLink: Link = {
      ...link,
      href: withQuery(link.href, ["value=loaded"]),
    };
    const result = await this.client.send({
      link: loadLink,
      ...withSignal(signal),
    });
    if (!result.ok) return result;
    return { ok: true, value: undefined };
  }

  /**
   * Reads every page of a collection, following `next` to the end — the same
   * shape `src/data/adapter.ts`'s own `collectPages` uses, with the same
   * bound against a runaway or cyclical `next` link this project has not
   * constructed itself.
   *
   * **The seed request adds `sortBy=name`; every later page reuses whatever
   * the server's own `next` link already carries.** Finding 8.9: without it,
   * `casManagement`'s collections are not stably ordered across requests at
   * all — two identical `GET`s of the same `start`/`limit` window, seconds
   * apart with no state change in between, returned two different sets of
   * tables. Fed into offset pagination that reshuffles items between pages,
   * which is the live bug this fixes: the same table lands on more than one
   * page, and `casTree.ts`'s per-item node id collides on it, throwing VS
   * Code's own "Element with id … is already registered" — while other
   * tables are skipped by the same reshuffle and never appear at all.
   * `sortBy=name` made three repeated identical requests come back
   * byte-for-byte the same, and every collection this method reads (servers,
   * caslibs, tables, columns) accepted it without complaint, so it is added
   * once, here, rather than once per caller. For `columns`, alphabetical is
   * the wrong final order — {@link getColumns} re-sorts by each item's own
   * `index` (Finding 12.6); paging still uses `sortBy=name` for stability. Only the seed `href` needs it —
   * the server's own `next` link already carries `sortBy=name` forward to
   * every later page, confirmed live.
   */
  private async collectPages(
    link: Link,
    signal: AbortSignal | undefined,
  ): Promise<CasResult<readonly unknown[]>> {
    const items: unknown[] = [];
    let href: string | undefined = withQuery(link.href, ["sortBy=name"]);

    for (let page = 0; href !== undefined && page < MAX_CAS_PAGES; page += 1) {
      const pageLink: Link = { ...link, href };
      const result = await this.client.send({
        link: pageLink,
        ...withSignal(signal),
      });
      if (!result.ok) return result;

      const pageItems = readItems(result.value);
      if (pageItems === undefined) {
        return malformed(
          result.value,
          `a "${link.rel}" collection`,
          'and it carried no "items" array',
        );
      }
      items.push(...pageItems);

      const next = findLink(readLinks(result.value.body), "next");
      href = next?.href;
    }
    return { ok: true, value: items };
  }
}

/** Enough pages of a `casManagement` collection to hold everything this
 * project has observed (68 caslibs, 56 tables in one caslib — Finding 8.2/8.7)
 * with headroom to spare — the same runaway-guard reasoning
 * `src/data/adapter.ts`'s `MAX_DATA_PAGES` documents, not a real ceiling
 * anyone browsing CAS is expected to reach. */
export const MAX_CAS_PAGES = 500;

/** A `columns` collection item's 1-based position in its table (Finding
 * 12.6), or `Infinity` when it carries no numeric `index`. */
function columnIndex(raw: unknown): number {
  if (typeof raw !== "object" || raw === null) return Infinity;
  const index = (raw as Record<string, unknown>).index;
  return typeof index === "number" ? index : Infinity;
}

/** Orders raw `columns` items by {@link columnIndex}. `Array.prototype.sort`
 * is stable, so items that tie — including every item without an `index` —
 * keep the listing's own relative order. */
function byColumnIndex(a: unknown, b: unknown): number {
  const left = columnIndex(a);
  const right = columnIndex(b);
  return left === right ? 0 : left < right ? -1 : 1;
}

/** The `items` of a collection body, or `undefined` if there is no array
 * there. */
function readItems(response: CasResponse): readonly unknown[] | undefined {
  const body: unknown = response.body;
  if (typeof body !== "object" || body === null) return undefined;
  const items: unknown = (body as { items?: unknown }).items;
  return Array.isArray(items) ? (items as readonly unknown[]) : undefined;
}

/** A collection body's own `count`, or `undefined` if absent or not a
 * number — the same defensive read `src/data/adapter.ts`'s own `readCount`
 * gives `items`. */
function readCount(body: unknown): number | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const count = (body as { count?: unknown }).count;
  return typeof count === "number" ? count : undefined;
}

/** Passes a signal through only when there is one, so the request object
 * never carries an explicit `signal: undefined`. */
function withSignal(signal: AbortSignal | undefined): { signal?: AbortSignal } {
  return signal === undefined ? {} : { signal };
}

/** Adds query parameters to an href, keeping any query already there — the
 * same small helper `src/data/adapter.ts` and `compute/job.ts` each carry
 * their own copy of. */
function withQuery(href: string, parameters: readonly string[]): string {
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}${parameters.join("&")}`;
}

/** The failure for a representation that carried no such relation. */
function linkMissing(resource: string, rel: string): CasFailure {
  return {
    ok: false,
    reason: `the ${resource} carried no "${rel}" link in the response this account read`,
    problem: { code: "link-missing", rel, resource },
  };
}

/** The failure for a 2xx that was not the representation expected. */
function malformed(
  response: CasResponse,
  subject: string,
  defect: string,
): CasFailure {
  return {
    ok: false,
    reason:
      "the CAS management service did not answer with what this request expected",
    problem: {
      code: "response-malformed",
      detail: `a request for ${subject} answered HTTP ${String(response.status)} as ${response.contentType ?? "an unknown type"}, ${defect}`,
    },
  };
}

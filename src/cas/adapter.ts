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
  LOAD_REL,
  readCaslibItem,
  readCasColumnItem,
  readCasServerItem,
  readCasTableItem,
  SERVERS_REL,
  TABLES_REL,
  type CaslibItem,
  type CasColumnItem,
  type CasServerItem,
  type CasTableItem,
} from "./types";

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
  constructor(private readonly client: CasClient) {}

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
    for (const raw of items.value) {
      const column = readCasColumnItem(raw, table);
      if (column !== undefined) columns.push(column);
    }
    return { ok: true, value: columns };
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
   */
  private async collectPages(
    link: Link,
    signal: AbortSignal | undefined,
  ): Promise<CasResult<readonly unknown[]>> {
    const items: unknown[] = [];
    let href: string | undefined = link.href;

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

/** The `items` of a collection body, or `undefined` if there is no array
 * there. */
function readItems(response: CasResponse): readonly unknown[] | undefined {
  const body: unknown = response.body;
  if (typeof body !== "object" || body === null) return undefined;
  const items: unknown = (body as { items?: unknown }).items;
  return Array.isArray(items) ? (items as readonly unknown[]) : undefined;
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

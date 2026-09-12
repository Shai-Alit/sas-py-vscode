// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The CAS browsing tree's own vocabulary: a server, a caslib, a table, and a
 * column, reduced to what a read-only browse needs.
 *
 * **This module must never import `vscode`.**
 *
 * No upstream file to follow — the SAS VS Code extension calls no CAS APIs
 * at all (`docs/phases/phase-8.md`'s Plan section). This is built
 * from the `casManagement` REST API's own documented shape and the live
 * probes in that phase file (Findings 8.1–8.8), the same way `src/content/`
 * and `src/data/` were each built from a documented shape plus probes, per
 * [ADR-0033](../../docs/adr/0033-cas-adapter-shape.md).
 *
 * ## Every level's own listing entry already carries what this tree needs
 *
 * Unlike Phase 7's sparse `librefs`/`tables` collections (Finding 7.8), which
 * needed a per-item follow-up on `self` to get a library's rich detail,
 * `casManagement`'s own collections do not: the servers collection's own item
 * already carries every relation `getCaslibs` needs (Finding 8.1, and
 * reconfirmed live at 8a's own start, Finding 8.7 — `caslibs`, `sessions`,
 * `createSession`, `nodes`, `metrics`, `connection`, `stopLists`, `casProxy`,
 * `dataSource`), and a caslib's own tables/table's own columns collections
 * carry everything `CaslibItem`/`CasTableItem` read straight off the listing
 * entry (Findings 8.2/8.3). So `src/cas/adapter.ts` never performs the
 * two-tier fetch `src/data/adapter.ts`'s `getLibraries` does.
 *
 * ## Why a table's `columns` need a load first, and why that isn't read here
 *
 * Finding 8.3: an unloaded table's `columns` collection is a `404`, not an
 * empty list, until `PUT .../tables/{name}/state?value=loaded` is called.
 * `CasTableItem.state` carries the listing's own `state` field so
 * `CasAdapter.getColumns` (`adapter.ts`) can check it before deciding whether
 * to load first — this module only reads the field, it does not act on it.
 */

import { readLinks, type Link } from "../wire/links";

/** The relation on the deployment root (`casManagement`'s own `apiMeta`
 * document) that reaches the CAS servers collection. Confirmed live (Finding
 * 8.7) to carry a real, root-relative `href` — `/casManagement/servers` — not
 * merely a documentation-only operation-catalog entry, so it is followed the
 * same way any other relation in this project is. */
export const SERVERS_REL = "getServers";

/** The relation on a CAS server's own representation that reaches its
 * (global-scope) caslibs — no `sessionId` needed for this deployment's
 * global caslibs (Finding 8.2, reconfirmed Finding 8.7). */
export const CASLIBS_REL = "caslibs";

/** The relation on a caslib's own representation that reaches its tables —
 * likewise no `sessionId` needed (Finding 8.2/8.7). */
export const TABLES_REL = "tables";

/** The relation on a table's own representation that reaches its columns.
 * `404` until the table is loaded (Finding 8.3) — see `adapter.ts`'s
 * `getColumns`. */
export const COLUMNS_REL = "columns";

/** The relation on a table's own representation that loads or unloads it —
 * `PUT` with a `value=loaded`/`value=unloaded` query parameter and no request
 * body (Finding 8.8: the documented shape, confirmed live). The response is
 * plain text (`"loaded"`/`"unloaded"`) even though the link's own
 * `responseType` advertises `application/json,text/plain` — Finding 8.8. */
export const LOAD_REL = "updateState";

/** A CAS server — `cas-shared-default` on every deployment probed so far
 * (Finding 8.1), but this project has never assumed there is exactly one. */
export interface CasServerItem {
  readonly kind: "server";
  readonly name: string;
  readonly restPort?: number | undefined;
  readonly restProtocol?: string | undefined;
  readonly links: readonly Link[];
}

/** A caslib on a CAS server. 8a's own scope stops at global-scope caslibs
 * (`docs/phases/phase-8.md`'s Plan section) — every caslib Finding 8.7
 * observed on this deployment reported `scope: "global"`, so there is no
 * session-scoped case to distinguish yet; that is a later slice's problem if
 * one is ever seen. */
export interface CaslibItem {
  readonly kind: "caslib";
  /** The owning server's name, so a caller need not carry the parent
   * `CasServerItem` alongside every `CaslibItem` it holds. */
  readonly serverName: string;
  readonly name: string;
  readonly links: readonly Link[];
}

/** A table within a caslib. */
export interface CasTableItem {
  readonly kind: "table";
  readonly serverName: string;
  readonly caslibName: string;
  readonly name: string;
  /** `"loaded"` or `"unloaded"` on every table probed (Finding 8.2/8.3/8.7) —
   * kept as a plain string rather than a union, since nothing here has
   * observed the full set of values this field can take. */
  readonly state?: string | undefined;
  /** `0` on an unloaded table (Finding 8.3) — a real count only once the
   * table is loaded. */
  readonly rowCount?: number | undefined;
  readonly columnCount?: number | undefined;
  readonly links: readonly Link[];
}

/** One column of a loaded CAS table (Finding 8.8). A narrower shape than
 * `src/data/types.ts`'s `Column` — this vocabulary carries no `label`,
 * `format`, or `informat`; `formattedLength` is the closest analogue to
 * `Column.length`, and is the only extra field this slice's presentation
 * layer reads. Carries its own parent identity (`serverName`/`caslibName`/
 * `tableName`) the same reason `CasTableItem` carries its caslib's — a tree
 * node's stable id (`casTree.ts`) is built from it without needing the
 * ancestor chain threaded alongside. */
export interface CasColumnItem {
  readonly kind: "column";
  readonly serverName: string;
  readonly caslibName: string;
  readonly tableName: string;
  readonly name: string;
  readonly type: string;
  readonly formattedLength?: number | undefined;
}

export type CasItem = CasServerItem | CaslibItem | CasTableItem | CasColumnItem;

export function isCasServer(item: CasItem): item is CasServerItem {
  return item.kind === "server";
}

export function isCaslib(item: CasItem): item is CaslibItem {
  return item.kind === "caslib";
}

export function isCasTable(item: CasItem): item is CasTableItem {
  return item.kind === "table";
}

export function isCasColumn(item: CasItem): item is CasColumnItem {
  return item.kind === "column";
}

/**
 * Reads a CAS server out of one entry of the servers collection.
 *
 * Takes `unknown` because it is handed the output of `JSON.parse`. An entry
 * with no string `name` cannot be shown or expanded, so it is dropped rather
 * than carried as a half-item that fails later with less context — the same
 * tolerance `src/data/types.ts`'s `readLibraryItem` gives a nameless entry.
 */
export function readCasServerItem(value: unknown): CasServerItem | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const name = raw.name;
  if (typeof name !== "string" || name === "") return undefined;

  return {
    kind: "server",
    name,
    ...(typeof raw.restPort === "number" ? { restPort: raw.restPort } : {}),
    ...(typeof raw.restProtocol === "string" && raw.restProtocol !== ""
      ? { restProtocol: raw.restProtocol }
      : {}),
    links: readLinks(value),
  };
}

/** Reads a caslib out of one entry of a server's `caslibs` collection. */
export function readCaslibItem(
  value: unknown,
  server: CasServerItem,
): CaslibItem | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const name = raw.name;
  if (typeof name !== "string" || name === "") return undefined;

  return {
    kind: "caslib",
    serverName: server.name,
    name,
    links: readLinks(value),
  };
}

/** Reads a table out of one entry of a caslib's `tables` collection. */
export function readCasTableItem(
  value: unknown,
  caslib: CaslibItem,
): CasTableItem | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const name = raw.name;
  if (typeof name !== "string" || name === "") return undefined;

  return {
    kind: "table",
    serverName: caslib.serverName,
    caslibName: caslib.name,
    name,
    ...(typeof raw.state === "string" && raw.state !== ""
      ? { state: raw.state }
      : {}),
    ...(typeof raw.rowCount === "number" ? { rowCount: raw.rowCount } : {}),
    ...(typeof raw.columnCount === "number"
      ? { columnCount: raw.columnCount }
      : {}),
    links: readLinks(value),
  };
}

/** Reads one entry of a table's `columns` collection. An entry with no
 * usable `name` is dropped by the caller (`CasAdapter.getColumns`), the same
 * tolerance every other collection reader in this project gives a malformed
 * member. */
export function readCasColumnItem(
  value: unknown,
  table: CasTableItem,
): CasColumnItem | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const name = raw.name;
  if (typeof name !== "string" || name === "") return undefined;
  const type = raw.type;

  return {
    kind: "column",
    serverName: table.serverName,
    caslibName: table.caslibName,
    tableName: table.name,
    name,
    type: typeof type === "string" ? type : "",
    ...(typeof raw.formattedLength === "number"
      ? { formattedLength: raw.formattedLength }
      : {}),
  };
}

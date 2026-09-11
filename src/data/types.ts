// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The SAS Libraries tree's own vocabulary: a library and a table, reduced to
 * what a read-only browse needs.
 *
 * **This module must never import `vscode`.**
 *
 * Structure follows: `client/src/components/LibraryNavigator/types.ts` in
 * sassoftware/vscode-sas-extension (Apache-2.0). No code was copied — read
 * for what it does, per [ADR-0027](../../docs/adr/0027-library-adapter-shape.md),
 * which also settles why there is one concrete shape here rather than
 * upstream's `LibraryItem`/`LibraryAdapterFactory` layering.
 *
 * ## Two shapes, and the two-tier fetch that produces them
 *
 * Findings 7.1/7.2/7.5 (`docs/phases/phase-7.md`) established that the
 * session's `librefs` collection and a library's own `tables` collection
 * both answer **sparse**: `{ id, name, version, links }`, with the fields a
 * tree actually renders (`readOnly` on a library) absent. `readLibraryItem`
 * below is deliberately used for *both* the sparse list entry and the rich
 * per-item follow-up — the shapes agree on every field this module reads,
 * they differ only in which of the optional ones are present, and
 * `src/data/adapter.ts` is what performs the follow-up
 * (`client.send({ link: self })`) that turns one into the other.
 *
 * ## Why `readOnly` is inherited, not fetched, for a table
 *
 * A verde probe of `SASHELP`'s (394-table) `tables` collection (2026-09-09,
 * recorded in Finding 7.8 alongside this slice's other findings) found each
 * table entry carries only `{ id, name, version, links }` — no `readOnly` of
 * its own. Upstream's own `LibraryItem.readOnly` is documented as "inherited
 * from the owning library unless a table overrides it"; since no override has
 * ever been observed on this deployment, {@link readTableItem} inherits the
 * library's `readOnly` unconditionally rather than adding a per-table `GET`
 * this slice's read-only tree does not otherwise need — a per-table detail
 * read is 7b/7c's problem, when opening a table or showing its properties
 * needs one anyway.
 */

import { readLinks, type Link } from "../wire/links";

/** The relation on a compute session that lists its libraries (the session's
 * `DataAccessApi` entry point). `GET`, a collection. Verified against the
 * session's own `links[]` (Finding 21, `phase-2a.md`; re-confirmed for this
 * phase in Finding 7.1). */
export const LIBREFS_REL = "librefs";

/** The relation on a library's own representation that reaches its tables,
 * on the **same href** as the library itself — content-negotiated, not a
 * different URL (Finding 7.5). */
export const TABLES_REL = "tables";

/** `GET` a library's own rich representation, or a table's. */
export const SELF_REL = "self";

/** The relation on a table's own rich detail that reaches its row data —
 * a collection, paged with `start`/`limit` (Finding 7.1; confirmed again at
 * implementation time, `docs/phases/phase-7.md`'s Finding 7.10/7.13). */
export const ROWS_REL = "rows";

/** The relation on a table's own rich detail that reaches its column
 * metadata — a collection, paged (Finding 7.1). */
export const COLUMNS_REL = "columns";

/** The relation on a table's (or a view's — Finding 7.15) own rich detail
 * that creates a server-side sorted/filtered view of it. `POST`, body media
 * type `application/vnd.sas.compute.data.table.view.request`. */
export const CREATE_VIEW_REL = "createView";

/** The relation that removes a table or a view. `DELETE`, no request body,
 * no response media type (Finding 7.15 — the link carries no `type` at all,
 * the same "absent means no media type" shape Finding 14 already
 * established for a link with nothing to negotiate). */
export const DELETE_REL = "delete";

/** A SAS library (a libref) — `WORK`, `SASHELP`, and any site-registered
 * library the active session's compute context can see. */
export interface LibraryItem {
  readonly kind: "library";
  /** The libref itself — this is the "name" a session's `librefs` collection
   * and a library's own representation both carry; there is no separate
   * display name. */
  readonly name: string;
  /**
   * Whether this library refuses writes. Optional at the type level on
   * purpose: genuinely absent on the sparse list entry (Finding 7.2), always
   * present once `src/data/adapter.ts` has performed its per-item follow-up —
   * callers that only ever see a `LibraryItem` returned from
   * `LibraryAdapter.getLibraries` can treat it as present in practice, but
   * nothing in this module manufactures a `false` default for an entry that
   * never said so.
   */
  readonly readOnly?: boolean | undefined;
  /** How many physical libraries are concatenated into this libref — `4` for
   * `SASHELP` on every deployment probed (Findings 7.2/7.6). Not read for any
   * UI decision in this slice; carried so a later one (a tooltip) need not
   * re-add it. */
  readonly concatenationCount?: number | undefined;
  /** The hypermedia links, already narrowed by {@link readLinks} — this is
   * what lets the adapter follow `self` (rich detail) and `tables` (the
   * table listing) by relation rather than composing a URL (ADR-0010,
   * ADR-0027). */
  readonly links: readonly Link[];
}

/** A table within a library. Read-only browsing only in this slice — no
 * column or row detail, which is 7b/7c's problem. */
export interface TableItem {
  readonly kind: "table";
  /** The owning library's libref, so a caller need not carry the parent
   * `LibraryItem` alongside every `TableItem` it holds. */
  readonly libref: string;
  readonly name: string;
  /** Inherited from the owning library — see this module's own doc comment
   * for why a per-table fetch is not performed to obtain one. */
  readonly readOnly?: boolean | undefined;
  readonly links: readonly Link[];
}

export type DataItem = LibraryItem | TableItem;

export function isLibrary(item: DataItem): item is LibraryItem {
  return item.kind === "library";
}

export function isTable(item: DataItem): item is TableItem {
  return item.kind === "table";
}

/**
 * Reads a library out of a parsed `DataAccessApi` response — either the
 * sparse list entry or the rich per-item detail; see this module's own doc
 * comment for why one function reads both.
 *
 * Takes `unknown` because it is handed the output of `JSON.parse`. An entry
 * with no string `name` cannot be shown or expanded, so it is dropped rather
 * than carried as a half-item that fails later with less context — the same
 * shape `src/content/types.ts`'s `readContentItem` takes.
 */
export function readLibraryItem(value: unknown): LibraryItem | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const name = raw.name;
  if (typeof name !== "string" || name === "") return undefined;

  return {
    kind: "library",
    name,
    ...(typeof raw.readOnly === "boolean" ? { readOnly: raw.readOnly } : {}),
    ...(typeof raw.concatenationCount === "number"
      ? { concatenationCount: raw.concatenationCount }
      : {}),
    links: readLinks(value),
  };
}

/**
 * Reads a table out of one entry of a library's `tables` collection,
 * inheriting `readOnly` from `library` — see this module's own doc comment.
 */
export function readTableItem(
  value: unknown,
  library: LibraryItem,
): TableItem | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const name = raw.name;
  if (typeof name !== "string" || name === "") return undefined;

  return {
    kind: "table",
    libref: library.name,
    name,
    ...(library.readOnly === undefined ? {} : { readOnly: library.readOnly }),
    links: readLinks(value),
  };
}

/**
 * A table's rich per-item detail — reached by following a {@link TableItem}'s
 * own `self` link (`src/data/adapter.ts`'s `openTable`), distinct from
 * `TableItem` itself, which is what the read-only tree holds (sparse, or with
 * an inherited `readOnly`). 7a never needed this; opening a table for
 * viewing (7b) is the first caller, since that is the first time this
 * project needs the `rows`/`columns` links only the rich detail carries
 * (Finding 7.1).
 *
 * **7c-ii extends this with the rest of `TableInfo`'s own field set** —
 * `type`/`label`/`engine`/`extendedType`/`logicalRecordCount`/
 * `physicalRecordCount`/`recordLength`/`creationTimeStamp`/
 * `modifiedTimeStamp`/`compressionRoutine`/`encoding`/`bookmarkLength` — read
 * from the same `openTable` response 7b already fetches, needed only once a
 * caller wants to show them (`src/data/tablePropertiesPanel.ts`); nothing
 * before 7c-ii read past `rowCount`/`columnCount`. Finding 7.19
 * (`docs/phases/phase-7.md`, `verde`, 2026-09-10) confirms the full shape
 * against `SASHELP.CLASS`, including that `creationTimeStamp`/
 * `modifiedTimeStamp` are ISO-8601 strings (`"2026-03-04T20:36:21.880Z"`), not
 * a raw SAS epoch-seconds number — see `tablePropertiesModel.ts`'s
 * `formatTimestamp` for what that means for the epoch fallback it still
 * carries.
 */
export interface TableDetail {
  readonly kind: "tableDetail";
  readonly libref: string;
  readonly name: string;
  readonly rowCount?: number | undefined;
  readonly columnCount?: number | undefined;
  /** The SAS table type — `"DATA"` on every table Finding 7.19 observed;
   * `applySort`'s own created view has never been probed for what it reports
   * here, and nothing reads this field for that case. */
  readonly type?: string | undefined;
  readonly label?: string | undefined;
  readonly engine?: string | undefined;
  readonly extendedType?: string | undefined;
  readonly logicalRecordCount?: number | undefined;
  readonly physicalRecordCount?: number | undefined;
  readonly recordLength?: number | undefined;
  /** ISO-8601 — see this interface's own doc comment (Finding 7.19). */
  readonly creationTimeStamp?: string | undefined;
  readonly modifiedTimeStamp?: string | undefined;
  readonly compressionRoutine?: string | undefined;
  readonly encoding?: string | undefined;
  readonly bookmarkLength?: number | undefined;
  readonly links: readonly Link[];
}

/** Reads a table's rich detail response. `table` supplies the libref, since
 * the response body itself never repeats it.
 *
 * Every 7c-ii field is optional at the type level and read the same
 * defensive way `readColumnItem` already reads `Column`'s own optional
 * fields: a string is kept only when non-empty (Finding 7.19 observed
 * `extendedType: ""` on a real table — empty, not absent, and treated
 * identically to absent by every caller), a number only when it actually is
 * one. */
export function readTableDetail(
  value: unknown,
  table: TableItem,
): TableDetail | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const name = raw.name;
  if (typeof name !== "string" || name === "") return undefined;

  return {
    kind: "tableDetail",
    libref: table.libref,
    name,
    ...(typeof raw.rowCount === "number" ? { rowCount: raw.rowCount } : {}),
    ...(typeof raw.columnCount === "number"
      ? { columnCount: raw.columnCount }
      : {}),
    ...(typeof raw.type === "string" && raw.type !== ""
      ? { type: raw.type }
      : {}),
    ...(typeof raw.label === "string" && raw.label !== ""
      ? { label: raw.label }
      : {}),
    ...(typeof raw.engine === "string" && raw.engine !== ""
      ? { engine: raw.engine }
      : {}),
    ...(typeof raw.extendedType === "string" && raw.extendedType !== ""
      ? { extendedType: raw.extendedType }
      : {}),
    ...(typeof raw.logicalRecordCount === "number"
      ? { logicalRecordCount: raw.logicalRecordCount }
      : {}),
    ...(typeof raw.physicalRecordCount === "number"
      ? { physicalRecordCount: raw.physicalRecordCount }
      : {}),
    ...(typeof raw.recordLength === "number"
      ? { recordLength: raw.recordLength }
      : {}),
    ...(typeof raw.creationTimeStamp === "string" &&
    raw.creationTimeStamp !== ""
      ? { creationTimeStamp: raw.creationTimeStamp }
      : {}),
    ...(typeof raw.modifiedTimeStamp === "string" &&
    raw.modifiedTimeStamp !== ""
      ? { modifiedTimeStamp: raw.modifiedTimeStamp }
      : {}),
    ...(typeof raw.compressionRoutine === "string" &&
    raw.compressionRoutine !== ""
      ? { compressionRoutine: raw.compressionRoutine }
      : {}),
    ...(typeof raw.encoding === "string" && raw.encoding !== ""
      ? { encoding: raw.encoding }
      : {}),
    ...(typeof raw.bookmarkLength === "number"
      ? { bookmarkLength: raw.bookmarkLength }
      : {}),
    links: readLinks(value),
  };
}

/**
 * One column's metadata — `name`/`type` always read from a real deployment
 * (Finding 7.1); `length`/`label`/`format`/`informat` are each read only when
 * present, since a probed column (`SASHELP.CLASS`) carried an empty-string
 * `label` and no `format`/`informat` at all, and an empty string is treated
 * the same as absent — a grid column header falls back to `name` either way,
 * and a blank label carries no information a caller should have to check for
 * itself.
 */
export interface Column {
  readonly name: string;
  readonly type: string;
  readonly length?: number | undefined;
  readonly label?: string | undefined;
  readonly format?: string | undefined;
  readonly informat?: string | undefined;
}

/** Reads one entry of a table's `columns` collection. An entry with no
 * usable `name` is dropped by the caller ({@link
 * import("./adapter").LibraryAdapter.getColumns}), the same tolerance
 * `readTableItem` gives a nameless table entry. */
export function readColumnItem(value: unknown): Column | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const name = raw.name;
  if (typeof name !== "string" || name === "") return undefined;
  const type = raw.type;

  return {
    name,
    type: typeof type === "string" ? type : "",
    ...(typeof raw.length === "number" ? { length: raw.length } : {}),
    ...(typeof raw.label === "string" && raw.label !== ""
      ? { label: raw.label }
      : {}),
    ...(typeof raw.format === "string" && raw.format !== ""
      ? { format: raw.format }
      : {}),
    ...(typeof raw.informat === "string" && raw.informat !== ""
      ? { informat: raw.informat }
      : {}),
  };
}

/**
 * One column to sort a table's rows by, and the direction — mirrors the
 * `createView` request body's own `sortBy` entry shape exactly (Finding 7.15:
 * `{"sortBy":[{"key":"Age","direction":"descending"}]}`), so `LibraryAdapter.
 * applySort` sends it unmodified rather than translating a second time.
 */
export interface SortSpec {
  readonly key: string;
  readonly direction: "ascending" | "descending";
}

/** One row of table data — an ordered array of cell values, positionally
 * matching the table's own column order (Finding 7.1: `{ cells: [...],
 * version }`), not a name-keyed record. The grid maps `cells[index]` onto
 * `getColumns`'s own ordering, the same positional contract upstream's
 * `useDataViewer.ts` assumes of `TableData.rows[].cells`. */
export interface RowItem {
  readonly cells: readonly unknown[];
}

/** Reads one entry of a table's `rows` collection. An entry with no `cells`
 * array is dropped by the caller, the same per-item tolerance every other
 * collection reader in this module gives a malformed member. */
export function readRowItem(value: unknown): RowItem | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const cells = raw.cells;
  if (!Array.isArray(cells)) return undefined;
  return { cells: cells as readonly unknown[] };
}

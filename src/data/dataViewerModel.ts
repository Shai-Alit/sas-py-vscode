// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The host↔webview message protocol for 7b's data viewer panel, and the pure
 * mapping from this project's own {@link Column}/row vocabulary to what the
 * ag-grid datasource on the other side of the boundary actually needs.
 *
 * **This module must never import `vscode`.** Same split
 * `src/run/resultPanelModel.ts` draws (ADR-0021), extended here for a second
 * webview (ADR-0028): both the host (`src/data/dataViewerPanel.ts`) and the
 * webview bootstrap (`src/webview/dataViewerEntry.tsx`) import only from
 * here for the shapes that cross the boundary, so the message shape is
 * declared once rather than twice and cannot drift between the two sides.
 * `src/webview/dataViewerEntry.tsx` imports only types from this module,
 * never a runtime value — the same discipline `src/webview/entry.ts` already
 * follows for `resultPanelModel.ts`.
 *
 * Every string a webview would otherwise have to translate itself is decided
 * host-side and sent across already-finished, matching this project's
 * standing localisation-boundary rule (ADR-0021's own section on it) — this
 * module's own English strings (`headerName` falling back to a column's raw
 * `name`) are data, not UI chrome, so nothing here calls `vscode.l10n.t()`
 * because nothing here needs to.
 */

import type { Column, RowItem } from "./types";

/** One column, reduced to what the grid's column definitions need. `field` is
 * the key a row's positional `cells` array is mapped onto by index — see
 * {@link toWireRows} — not a lookup key into a per-row record; the row shape
 * itself stays positional all the way from the wire (Finding 7.1) through to
 * the grid, and only gets turned into a `field`-keyed object at the point
 * ag-grid's `IGetRowsParams.successCallback` actually needs one. */
export interface WireColumn {
  readonly field: string;
  /** `label` when the deployment supplied a non-empty one, else `name` —
   * decided once here rather than by every renderer independently. */
  readonly headerName: string;
  /** The SAS column type (`CHAR`, `NUM`, …), carried through unmodified so
   * the grid can right-align a numeric column — a detail 7b's own datasource
   * setup, not this module, decides what to do with. */
  readonly type: string;
}

/** Reduces this project's own {@link Column} shape to what the grid's column
 * definitions need. Pure, and the only place `label`-vs-`name` fallback logic
 * lives — `src/data/adapter.ts`'s `readColumnItem` already drops an
 * empty-string `label` to `undefined`, so this is a plain `??`. */
export function toWireColumns(
  columns: readonly Column[],
): readonly WireColumn[] {
  return columns.map((column) => ({
    field: column.name,
    headerName: column.label ?? column.name,
    type: column.type,
  }));
}

/** Reduces a page of {@link RowItem}s to the plain `cells` arrays the wire
 * protocol actually sends — `RowItem` is already exactly this shape today,
 * but going through this function rather than sending `RowItem[]` directly
 * keeps the wire message's own shape independent of `src/data/types.ts`'s,
 * so the two can diverge later without a cross-cutting rename. */
export function toWireRows(rows: readonly RowItem[]): readonly unknown[][] {
  return rows.map((row) => [...row.cells]);
}

/** Host → webview: the column definitions and the table's own known row
 * count (or `undefined`, if this deployment did not supply one), sent once
 * after `openTable`/`getColumns` resolve. */
export interface InitMessage {
  readonly type: "init";
  readonly columns: readonly WireColumn[];
  readonly rowCount: number | undefined;
}

/** Host → webview: one requested row window, answered. */
export interface RowsMessage {
  readonly type: "rows";
  readonly requestId: string;
  readonly start: number;
  readonly rows: readonly unknown[][];
  readonly count: number | undefined;
}

/** Host → webview: a single row-window request failed. Scoped to the request
 * that failed (`requestId`), not the whole panel — a transient failure on one
 * scroll-triggered fetch should not blank a grid that was working a moment
 * ago. */
export interface RowsErrorMessage {
  readonly type: "rowsError";
  readonly requestId: string;
  readonly message: string;
}

/** Host → webview: opening the table itself failed (no session, session
 * busy, a missing link, a transport failure) — nothing to page through, so
 * this is the whole panel's state, not one window's. */
export interface FailureMessage {
  readonly type: "failure";
  readonly message: string;
}

export type DataViewerHostMessage =
  InitMessage | RowsMessage | RowsErrorMessage | FailureMessage;

/** Webview → host, sent once from the bootstrap script the instant its
 * message listener is attached — the same handshake ADR-0021 describes for
 * the result panel, and for the same reason: a message posted before the
 * webview's own script has loaded would otherwise be lost silently. */
export interface ReadyMessage {
  readonly type: "ready";
}

/** Webview → host: the grid's own infinite-row-model datasource asking for
 * one window of rows. `requestId` lets the host's reply be matched back to
 * the specific `getRows` call ag-grid made, since more than one can be in
 * flight at once (a fast scroll can trigger several before the first
 * answers). */
export interface RequestRowsMessage {
  readonly type: "requestRows";
  readonly requestId: string;
  readonly start: number;
  readonly limit: number;
}

export function isReadyMessage(message: unknown): message is ReadyMessage {
  return isRecordWithType(message, "ready");
}

export function isRequestRowsMessage(
  message: unknown,
): message is RequestRowsMessage {
  if (!isRecordWithType(message, "requestRows")) return false;
  const { requestId, start, limit } = message as Record<string, unknown>;
  return (
    typeof requestId === "string" &&
    typeof start === "number" &&
    typeof limit === "number"
  );
}

function isRecordWithType(value: unknown, type: string): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === type
  );
}

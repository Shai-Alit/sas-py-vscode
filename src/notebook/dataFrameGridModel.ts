// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The DataFrame grid's own logic (ADR-0048, 13g): column and row shapes, how
 * a cell reads, and how two cells sort.
 *
 * **This module must never import `vscode`, and imports only types.** The
 * notebook renderer (`src/webview/dataFrameGridRenderer.ts`) runs in the
 * notebook's browser frame and is bundled with this module; the unit tier
 * tests it here, since the renderer itself cannot load under Node (ADR-0009's
 * `isBrowserOnly`). The same split `resultPanelModel.ts` draws for the result
 * panel.
 */

import type {
  DataFrameCell,
  DataFrameField,
  DataFrameFieldKind,
  DataFrameGrid,
} from "../backend/dataFrameGrid";

/** One grid column. `key` names the cell in each {@link GridRow}. */
export interface GridColumn {
  readonly key: string;
  readonly header: string;
  readonly kind: DataFrameFieldKind;
  /** An index level, pinned to the left as pandas shows it. */
  readonly index: boolean;
}

/** One grid row, keyed by {@link GridColumn.key}. */
export type GridRow = Readonly<Record<string, DataFrameCell>>;

/** The columns, one per field. Keys are positional, since DataFrame labels
 * can repeat. */
export function gridColumns(fields: readonly DataFrameField[]): GridColumn[] {
  return fields.map((field, position) => ({
    key: columnKey(position),
    header: field.name,
    kind: field.kind,
    index: field.index,
  }));
}

/** The rows, keyed as {@link gridColumns} keys them. */
export function gridRows(grid: DataFrameGrid): GridRow[] {
  return grid.data.map((cells) => {
    const row: Record<string, DataFrameCell> = {};
    cells.forEach((cell, position) => {
      row[columnKey(position)] = cell;
    });
    return row;
  });
}

function columnKey(position: number): string {
  return `c${String(position)}`;
}

/**
 * How a cell reads. A missing value reads as pandas prints it for that kind
 * of column: `NaN` for a number, `NaT` for a date and time, `None`
 * otherwise. The runner writes every missing value as `null`, so a `NaN` in
 * a text column also reads `None`.
 */
export function formatCell(
  cell: DataFrameCell | undefined,
  kind: DataFrameFieldKind,
): string {
  if (cell === null || cell === undefined) return MISSING[kind];
  return typeof cell === "number" ? String(cell) : cell;
}

const MISSING: Readonly<Record<DataFrameFieldKind, string>> = {
  number: "NaN",
  datetime: "NaT",
  text: "None",
};

/**
 * Orders two cells of one column. A missing value sorts first, as `null`
 * does in ag-grid's own comparator. In a `number` column, `"inf"` and
 * `"-inf"` sort as the infinities and a string of digits as the exact
 * integer it is, so a value beyond 2^53 keeps its place. Any other string
 * there, which only a hand-edited notebook can hold, sorts after every
 * number, so the order stays consistent. Anything else compares as text, by
 * UTF-16 code unit, as Python compares `str`.
 */
export function compareCells(
  a: DataFrameCell | undefined,
  b: DataFrameCell | undefined,
  kind: DataFrameFieldKind,
): number {
  const aMissing = a === null || a === undefined;
  const bMissing = b === null || b === undefined;
  if (aMissing || bMissing) return Number(bMissing) - Number(aMissing);
  if (kind === "number") {
    const x = numeric(a);
    const y = numeric(b);
    if (x !== undefined && y !== undefined) {
      if (x < y) return -1;
      if (x > y) return 1;
      return 0;
    }
    if (x !== undefined) return -1;
    if (y !== undefined) return 1;
  }
  return ordinal(String(a), String(b));
}

/** A `number` column's cell as a number or an exact integer, or `undefined`
 * for anything else. Number and `bigint` compare exactly with `<`. */
function numeric(cell: string | number): number | bigint | undefined {
  if (typeof cell === "number") return cell;
  if (cell === "inf") return Infinity;
  if (cell === "-inf") return -Infinity;
  return INTEGER.test(cell) ? BigInt(cell) : undefined;
}

const INTEGER = /^-?\d+$/;

function ordinal(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Rows shown before the grid scrolls instead of growing. */
export const GRID_VISIBLE_ROWS = 15;

/** Whether the grid sizes itself to its rows, or is a fixed height and
 * scrolls. */
export function fitsWithoutScrolling(rowCount: number): boolean {
  return rowCount <= GRID_VISIBLE_ROWS;
}

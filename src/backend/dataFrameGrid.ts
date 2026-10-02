// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * A notebook cell shows a trailing pandas DataFrame as a sortable grid
 * (ADR-0048, 13g).
 *
 * **This module must never import `vscode`, and imports nothing at run
 * time.** The host reads a grid file with it (`richOutput.ts`), and the
 * notebook renderer, which runs in the notebook's browser frame
 * (`src/webview/dataFrameGridRenderer.ts`), reads the cell output with it.
 * One parser on both sides means a payload the host accepted is one the
 * renderer accepts, and a notebook file opened from disk with a hand-edited
 * output is held to the same shape.
 *
 * The cell runner (`cellRunner.ts`) writes the payload. pandas' own
 * `to_json` is not used: on the probed deployment it rounded integers past
 * 2^53, wrote `NaN` and both infinities as one `null`, cut nanoseconds and
 * raised on a column of `bytes` (Finding 13.35). The runner's own encoding:
 *
 * - a missing value (`NaN`, `None`, `NaT`, `pd.NA`) is `null`;
 * - a `number` column's integer beyond ±2^53, and an infinity, is a string
 *   (`"inf"`, `"-inf"` or the digits), so nothing is rounded;
 * - every other value is `str()` of it, cut at 1,000 characters.
 */

/** The cell output's mime type. The renderer contributed in `package.json`
 * claims it. */
export const DATAFRAME_GRID_MIME =
  "application/vnd.python-on-viya.dataframe+json";

/** The payload format this extension writes and reads. */
export const DATAFRAME_GRID_FORMAT = 1;

/** How a column's values are compared and aligned. */
export type DataFrameFieldKind = "number" | "datetime" | "text";

/** One column of the grid. Index levels come first, as pandas shows them. */
export interface DataFrameField {
  /** The label, or `""` for an unnamed index. A tuple label is joined with
   * `", "`. */
  readonly name: string;
  readonly kind: DataFrameFieldKind;
  /** Whether this is an index level rather than a column. */
  readonly index: boolean;
}

/** One cell. See this module's own doc comment for the encoding. */
export type DataFrameCell = string | number | null;

/** The shown part of a DataFrame. */
export interface DataFrameGrid {
  /** The DataFrame's own row count, before the cap. */
  readonly rows: number;
  /** The DataFrame's own column count, before the cap. Index levels are not
   * counted. */
  readonly columns: number;
  readonly fields: readonly DataFrameField[];
  /** Row-major, one cell per field. */
  readonly data: readonly (readonly DataFrameCell[])[];
}

/** What the cell runner writes: the grid, and the DataFrame's own
 * `_repr_html_()`, which the cell also carries as its `text/html`
 * alternative. */
export interface DataFrameGridFile extends DataFrameGrid {
  readonly html: string;
}

/** What the notebook cell output carries for the renderer: the grid, and its
 * one localised summary line, written by the host. */
export interface DataFrameGridOutput extends DataFrameGrid {
  readonly summary: string;
}

/** {@link DataFrameGridOutput} as the cell output's JSON, which names its format like the
 * grid file, since a saved notebook keeps it. */
export interface DataFrameGridOutputJson extends DataFrameGridOutput {
  readonly format: typeof DATAFRAME_GRID_FORMAT;
}

/** The grid size limits, from the two settings. */
export interface DataFrameGridLimits {
  readonly maxRows: number;
  readonly maxColumns: number;
}

/** The settings' defaults: 100 rows by 20 columns (13g's plan text). */
export const DEFAULT_DATAFRAME_GRID_LIMITS: DataFrameGridLimits = {
  maxRows: 100,
  maxColumns: 20,
};

/** The settings' maximums, as `package.json` declares them. */
export const MAX_DATAFRAME_GRID_ROWS = 5000;
export const MAX_DATAFRAME_GRID_COLUMNS = 200;

/**
 * The limits from the two settings' raw values. A value that is not a whole
 * number from 0 to its maximum falls back to the default: `package.json`'s
 * schema only warns in the settings editor, and a hand-edited
 * `settings.json` can hold anything. 0 turns the grid off.
 */
export function dataFrameGridLimits(
  maxRows: unknown,
  maxColumns: unknown,
): DataFrameGridLimits {
  return {
    maxRows: limit(
      maxRows,
      MAX_DATAFRAME_GRID_ROWS,
      DEFAULT_DATAFRAME_GRID_LIMITS.maxRows,
    ),
    maxColumns: limit(
      maxColumns,
      MAX_DATAFRAME_GRID_COLUMNS,
      DEFAULT_DATAFRAME_GRID_LIMITS.maxColumns,
    ),
  };
}

function limit(value: unknown, max: number, fallback: number): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= max
    ? value
    : fallback;
}

/** The parse result: the value, or why it was refused. */
export type ParsedGrid<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

/** The grid file the cell runner wrote, or why it is not one. */
export function parseDataFrameGridFile(
  value: unknown,
): ParsedGrid<DataFrameGridFile> {
  const grid = parseDataFrameGrid(value);
  if (!grid.ok) return grid;
  const html = (value as { html?: unknown }).html;
  if (typeof html !== "string") {
    return { ok: false, reason: "its html is not a string" };
  }
  return { ok: true, value: { ...grid.value, html } };
}

/** The cell output the renderer was given, or why it is not one. */
export function parseDataFrameGridOutput(
  value: unknown,
): ParsedGrid<DataFrameGridOutput> {
  const grid = parseDataFrameGrid(value);
  if (!grid.ok) return grid;
  const summary = (value as { summary?: unknown }).summary;
  if (typeof summary !== "string") {
    return { ok: false, reason: "its summary is not a string" };
  }
  return { ok: true, value: { ...grid.value, summary } };
}

/**
 * The grid part of either payload. Every field is checked, and the result is
 * a fresh object holding only the known fields, so nothing unchecked rides
 * along. The shown rows and columns cannot exceed the settings' maximums or
 * the counts the payload states.
 */
export function parseDataFrameGrid(value: unknown): ParsedGrid<DataFrameGrid> {
  if (!isRecord(value)) return refuse("it is not an object");
  if (value.format !== DATAFRAME_GRID_FORMAT) {
    return refuse("its format is not 1");
  }
  const { rows, columns } = value;
  if (!isCount(rows)) return refuse("its row count is not a whole number");
  if (!isCount(columns)) {
    return refuse("its column count is not a whole number");
  }

  if (!Array.isArray(value.fields)) return refuse("its fields are not a list");
  const fields: DataFrameField[] = [];
  for (const field of value.fields as unknown[]) {
    const parsed = parseField(field);
    if (parsed === undefined) return refuse("a field is not valid");
    fields.push(parsed);
  }
  const shownColumns = fields.filter((field) => !field.index).length;
  if (
    shownColumns > Math.min(columns, MAX_DATAFRAME_GRID_COLUMNS) ||
    fields.length - shownColumns > MAX_DATAFRAME_INDEX_LEVELS
  ) {
    return refuse("it has more fields than it says");
  }

  if (!Array.isArray(value.data)) return refuse("its data is not a list");
  const rowsIn = value.data as unknown[];
  if (rowsIn.length > Math.min(rows, MAX_DATAFRAME_GRID_ROWS)) {
    return refuse("it has more rows than it says");
  }
  const data: DataFrameCell[][] = [];
  for (const row of rowsIn) {
    if (!Array.isArray(row) || row.length !== fields.length) {
      return refuse("a row does not have one cell per field");
    }
    const cells: DataFrameCell[] = [];
    for (const cell of row as unknown[]) {
      if (!isCell(cell)) return refuse("a cell is not valid");
      cells.push(cell);
    }
    data.push(cells);
  }

  return { ok: true, value: { rows, columns, fields, data } };
}

/** More index levels than any real DataFrame has, so a payload cannot carry
 * an unbounded number of fields as index levels. The cell runner refuses a
 * DataFrame with more, so it never writes a grid this parser rejects. */
export const MAX_DATAFRAME_INDEX_LEVELS = 32;

/** The longest text cell or label the runner writes: 1,000 characters and an
 * ellipsis. Measured in UTF-16 units here, which a Python character outside
 * the BMP counts as two, so the bound allows twice that. */
const MAX_TEXT_LENGTH = 2002;

function refuse(reason: string): ParsedGrid<never> {
  return { ok: false, reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseField(value: unknown): DataFrameField | undefined {
  if (!isRecord(value)) return undefined;
  const { name, kind, index } = value;
  if (typeof name !== "string" || name.length > MAX_TEXT_LENGTH) {
    return undefined;
  }
  if (kind !== "number" && kind !== "datetime" && kind !== "text") {
    return undefined;
  }
  if (typeof index !== "boolean") return undefined;
  return { name, kind, index };
}

function isCell(value: unknown): value is DataFrameCell {
  if (value === null) return true;
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "string" && value.length <= MAX_TEXT_LENGTH;
}

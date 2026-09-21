// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Turns pages of a CAS table's JSON row data into CSV text — 11d's export.
 *
 * **This module must never import `vscode`.**
 *
 * **Why this is built client-side, unlike a SAS library table's export**
 * (`src/data/csvExportModel.ts`, which relays the server's own `text/csv`
 * response untouched): Finding 11.5. The CAS `rows` collection *does*
 * honour `Accept: text/csv` — but a numeric column arrives as its
 * **formatted, space-padded** display string (`"          29"`), and a missing
 * numeric arrives as a bare `"."`, in the CSV exactly as in the JSON. Written
 * straight to a file that is a CSV a spreadsheet or `pandas.read_csv` reads
 * as text, not numbers. So this module fixes both, using the JSON pages
 * `CasAdapter.getRows` already reads: a non-character column's cells are
 * trimmed, and a trimmed `"."` becomes an empty field.
 *
 * A character column's cells are never trimmed — leading/trailing spaces in a
 * `char`/`varchar` are data, not padding.
 */

/** A column reduced to what formatting needs. `CasColumnItem` satisfies it
 * structurally. */
export interface CsvColumn {
  readonly name: string;
  readonly type: string;
}

/** One row, positionally matching the column order. `CasRowItem` satisfies it
 * structurally. */
export interface CsvRow {
  readonly cells: readonly unknown[];
}

/** The column types whose cells are text rather than numbers. Every other
 * type observed or documented for CAS (`double`, `int32`, `int64`, `decimal`,
 * `date`, `time`, `datetime`, …) is displayed as a padded number/formatted
 * value. `binary`/`varbinary` are treated as non-text too — they are not
 * expected in a browsed table and their exact display form is unprobed. */
const TEXT_TYPES: ReadonlySet<string> = new Set(["char", "varchar"]);

/** RFC-4180 quoting: a field is wrapped in double quotes, with embedded
 * quotes doubled, only when it contains a comma, a quote, or a line break. */
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** One cell's CSV field text. `null`/`undefined` are empty. */
function cellText(cell: unknown, isText: boolean): string {
  if (cell === null || cell === undefined) return "";
  const text =
    typeof cell === "string"
      ? cell
      : typeof cell === "number" || typeof cell === "boolean"
        ? String(cell)
        : JSON.stringify(cell);
  if (isText) return text;
  const trimmed = text.trim();
  return trimmed === "." ? "" : trimmed;
}

/**
 * One page of CSV text — every line, including the last, ends in `\n` (the
 * same page-boundary contract `src/data/csvExportModel.ts` documents for the
 * server's own CSV: pages concatenate with no separator). `includeHeader`
 * prepends the column-name row; a page with no rows and no header is the
 * empty string, which is what tells the export loop it has reached the end.
 */
export function formatCsvPage(
  columns: readonly CsvColumn[],
  rows: readonly CsvRow[],
  includeHeader: boolean,
): string {
  const isText = columns.map((column) =>
    TEXT_TYPES.has(column.type.toLowerCase()),
  );

  const lines: string[] = [];
  if (includeHeader) {
    lines.push(columns.map((column) => csvField(column.name)).join(","));
  }
  for (const row of rows) {
    lines.push(
      row.cells
        .map((cell, index) => csvField(cellText(cell, isText[index] ?? true)))
        .join(","),
    );
  }
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

/** The most rows one page ever asks for. */
const MAX_PAGE_ROWS = 500;

/** How many cells one page aims to hold. Finding 11.6: a 76-column table
 * returned 500 rows in ~458 KB — about 12 bytes a cell — so 500 rows of a
 * wide table can pass the transport's 1 MiB body cap
 * (`src/auth/transport.ts`'s `MAX_BODY_BYTES`). Capping cells per page keeps
 * an ordinary wide table comfortably under it; a table whose individual
 * values are far wider than average can still exceed it. That fails the read —
 * never a silent truncation — but `src/cas/client.ts` has no oversized-response
 * case, so it surfaces as `cas-unreachable` with the cap named only in its
 * detail. */
const TARGET_CELLS_PER_PAGE = 30_000;

/** Rows per page for a table with `columnCount` columns. */
export function pageRowsFor(columnCount: number): number {
  return Math.max(
    1,
    Math.min(
      MAX_PAGE_ROWS,
      Math.floor(TARGET_CELLS_PER_PAGE / Math.max(1, columnCount)),
    ),
  );
}

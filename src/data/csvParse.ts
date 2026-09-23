// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Splits one page of already-RFC-4180-encoded CSV text — the shape a SAS
 * library table's `rowsAsCSV` response delivers (Finding 7.20,
 * `docs/phases/phase-7.md`) — back into rows of decoded field values, so a
 * value can be inspected and transformed (the CSV formula-injection guard,
 * `./csvFormulaGuard.ts`, 12e) before being re-encoded.
 *
 * **This module must never import `vscode`.**
 *
 * **Only used when the guard is turned on.** The default, untouched relay
 * path (`./csvExportModel.ts`'s own `exportTableToCsv`) never parses
 * anything — a page reaches the file exactly as the server sent it unless a
 * user opts into the guard, which is the only caller of this module.
 *
 * **A full RFC 4180 §2 field grammar, not a naive split on `,`/`\n`.** A
 * quoted field can itself contain a comma, a literal newline, or a doubled
 * `""` standing for one literal `"` — a plain `split` would misplace every
 * column after the first such field. The server's CSV is already correctly
 * quoted (Finding 7.20), so this parser only has to *read* that grammar
 * back, not guess at malformed input.
 *
 * **A page always ends on a whole row, never mid-field.** Finding 7.20
 * confirms the server's own pagination never splits a row across two pages,
 * so each call here is self-contained — no state carries between pages, and
 * a caller never needs to stitch a trailing partial row from one page onto
 * the next page's start.
 *
 * **`csvField` also lives here** — the one RFC-4180 field-quoting function
 * both CSV export surfaces need (a parsed-and-guarded library field going
 * back out, and every CAS field `../cas/csvFormat.ts` builds from scratch).
 * `src/cas` already depends on `src/data` elsewhere (`casCsvSource.ts`
 * imports `./csvExportModel`); keeping the one canonical definition here,
 * re-exported from `../cas/csvFormat.ts` for its own existing callers/tests,
 * avoids the reverse dependency a second copy in `cas/` would otherwise
 * force.
 */

/** RFC-4180 quoting: a field is wrapped in double quotes, with embedded
 * quotes doubled, only when it contains a comma, a quote, or a line break. */
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * One page's rows, each a positional array of decoded field values (quotes
 * and doubled-quote escaping already resolved — a field's raw text, not its
 * CSV-encoded form). `""` (the empty-page sentinel {@link
 * import("./csvExportModel").streamCsvPages} checks for) parses to no rows
 * at all.
 */
export function parseCsvPage(text: string): readonly (readonly string[])[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldStarted = false;

  const endField = (): void => {
    row.push(field);
    field = "";
    fieldStarted = false;
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === undefined) continue; // unreachable given the loop bound above

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
      continue;
    }
    if (ch === ",") {
      endField();
      continue;
    }
    if (ch === "\n") {
      endRow();
      continue;
    }
    if (ch === "\r") {
      // The server's own CSV uses a bare `\n` (Finding 7.20) — a stray `\r`
      // is not expected, but dropping it rather than folding it into the
      // field is the safer read if one ever appears.
      continue;
    }
    field += ch;
    fieldStarted = true;
  }

  // A well-formed page (Finding 7.20: every page ends in `\n`) leaves
  // nothing pending here — this only fires for a malformed or partial
  // trailing row, and keeps that row rather than silently dropping it.
  if (fieldStarted || field !== "" || row.length > 0) {
    endRow();
  }

  return rows;
}

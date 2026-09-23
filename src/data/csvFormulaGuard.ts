// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The opt-in CSV formula-injection guard — 12e
 * (`docs/phases/phase-12.md`), shared by both CSV export surfaces
 * (`src/cas/csvFormat.ts`, `src/data/libraryCsvSource.ts`). Neither surface
 * guards anything unless `pythonOnViya.csvExport.guardFormulaInjection` is
 * turned on — every cell reaches the file exactly as it does today by
 * default.
 *
 * **This module must never import `vscode`.**
 *
 * **What this guards against.** A spreadsheet program (Excel, Google
 * Sheets, LibreOffice Calc) that opens a CSV treats a cell beginning with
 * `=`, `+`, `-`, or `@` as a formula, not literal text — OWASP's own
 * "CSV Injection" writeup (https://owasp.org/www-community/attacks/CSV_Injection).
 * A SAS character column holding attacker- or user-entered text (a name
 * field, a free-text comment column) can carry exactly such a value, and an
 * export that relays it unmodified hands a formula to whoever opens the
 * file next — the classic CSV/formula-injection class (CWE-1236). The fix
 * OWASP recommends, and this module applies, is a leading apostrophe: every
 * mainstream spreadsheet program already treats a `'`-prefixed cell as "the
 * rest of this is literal text," so the visible value is unchanged once
 * opened, only its interpretation is pinned down. Deleting or stripping the
 * leading character instead (an alternative some guards use) was
 * deliberately not chosen: `-5` losing its sign or `@handle` losing its `@`
 * silently changes what the exported value actually says.
 *
 * **Applied to character columns only, never numeric ones.** A SAS variable
 * is one of exactly two base types — character or numeric — so this is a
 * complete partition, not a heuristic that leaves some third case
 * unaccounted for. A numeric column's own leading `-` (a negative value) is
 * not a formula-injection risk at all: every mainstream spreadsheet parses
 * a cell that reads as a plain number as a number first, never as a
 * formula, regardless of a leading `-`/`+`. Guarding it anyway would still
 * "fix" nothing real while corrupting the column from numeric to text on
 * open — sorting and arithmetic on that column would silently stop working
 * the moment the guard is turned on. {@link isTextColumnType} is what
 * callers use to draw that line; each surface already knows, per cell,
 * which column a value came from.
 */

/** The two character-column type names this project has observed or
 * documented across both CSV export surfaces — `CHAR`/`VARCHAR` for a SAS
 * library table (Finding 7.14, `phase-7.md`: `GET …/columns` returns
 * `type: "CHAR"` for a character column and `type: "FLOAT"` for a numeric
 * one, never `"NUM"`) and `char`/`varchar` for CAS (`src/cas/csvFormat.ts`'s
 * own `TEXT_TYPES`). Compared case-insensitively since the two APIs report
 * the type string in different cases. Every other type string either API
 * reports (`FLOAT`, `double`, `int32`, `date`, …) is a numeric or
 * numeric-like display value, never free text. */
const TEXT_COLUMN_TYPES: ReadonlySet<string> = new Set(["char", "varchar"]);

/** True for a SAS character column — the only kind of column {@link
 * escapeCsvFormula} is ever applied to. */
export function isTextColumnType(type: string): boolean {
  return TEXT_COLUMN_TYPES.has(type.toLowerCase());
}

/** OWASP's own formula-triggering character set for CSV injection: a cell
 * beginning with one of these four is what a spreadsheet program treats as
 * the start of a formula rather than literal text. */
const FORMULA_TRIGGER = /^[=+@-]/;

/**
 * `value` unchanged, unless it begins with a formula-triggering character —
 * in which case a leading `'` is prepended. Only ever call this for a value
 * already known to come from a character column ({@link isTextColumnType});
 * calling it on a numeric column's formatted value is exactly the mistake
 * this module's own doc comment warns against.
 */
export function escapeCsvFormula(value: string): string {
  return FORMULA_TRIGGER.test(value) ? `'${value}` : value;
}

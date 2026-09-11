// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The text of a 7d drag-and-drop snippet — deriving a Python variable name
 * from a table, and building the two snippet bodies `src/data/dataDragAndDrop.ts`
 * hands to VS Code.
 *
 * **This module must never import `vscode`.** The two snippet builders return
 * plain strings; `dataDragAndDrop.ts` is what turns the SQL-passthrough one
 * into a `vscode.SnippetString` (its `${1:...}`/`$1`/`${2:...}` tabstop
 * syntax is plain VS Code snippet grammar, not a `vscode` type).
 *
 * ## Two escaping layers, not one
 *
 * `libref`/`table` come from the wire (a session's own libref and table
 * names) — unlike `variableName`/`viewName` below, which this module derives
 * itself and constrains to `[a-z0-9_]+`, nothing here bounds what characters
 * a real deployment's table name can contain. Both builders therefore escape
 * `libref`/`table` for the *Python* string-literal context they land in
 * (backslash, double quote, a stray newline) before use, the same
 * injection-safety concern `CLAUDE.md` asks for around submitted Python
 * generally. `buildSqlPassthroughSnippet` escapes a second time, for the
 * *snippet* syntax the whole result is embedded in (`$`, `}`, backslash) —
 * skipped by `buildSd2dfSnippet`, which returns a plain string never parsed
 * as a snippet at all.
 *
 * ## A third layer, `buildSqlPassthroughSnippet` only: SAS name literals
 *
 * The two layers above protect the *Python* and *snippet* boundaries the
 * text passes through, but `buildSqlPassthroughSnippet`'s own `select * from
 * libref.table` line is raw SAS/SQL source the user's own submitted Python
 * hands to `SAS.submit()` verbatim once the snippet is run. Neither prior
 * layer stops a `;` in a table name (plausible for exactly the SAS/ACCESS
 * external-table case this snippet is written for) from closing the
 * generated `create view` statement early and letting the rest run as
 * independent SAS statements. `sasNameRef` wraps a name outside the ordinary
 * bare-identifier shape in a SAS name literal (`'...'n`) before either
 * escaping layer runs — everything between the quotes is one atomic name
 * token to the SAS tokenizer, embedded `;`/whitespace/`&`/`%` included — so
 * an ordinary name (`SASHELP.CLASS`) still reads exactly as before, and only
 * an unusual one pays for the wrapping. `buildSd2dfSnippet` does not need
 * this: its `libref.table` is a runtime string argument to `SAS.sd2df`, not
 * SAS source this project generates and hands to the interpreter itself.
 */

const INVALID_IDENTIFIER_CHARS = /[^a-z0-9_]+/g;
const LEADING_OR_TRAILING_UNDERSCORES = /^_+|_+$/g;
const REPEATED_UNDERSCORES = /_{2,}/g;
const STARTS_WITH_DIGIT = /^[0-9]/;

/** Lowercases, replaces every run of non-`[a-z0-9_]` characters with a single
 * `_`, and trims leading/trailing underscores. May return `""`. */
function sanitizeIdentifierFragment(raw: string): string {
  return raw
    .toLowerCase()
    .replace(INVALID_IDENTIFIER_CHARS, "_")
    .replace(REPEATED_UNDERSCORES, "_")
    .replace(LEADING_OR_TRAILING_UNDERSCORES, "");
}

/** A Python identifier cannot start with a digit; `sanitizeIdentifierFragment`
 * can produce one from a table name that starts with a digit (`"2024data"`).
 * An empty fragment (a table name with no `[a-z0-9]` character at all, e.g.
 * one written entirely in another script) falls back to `fallback` instead. */
function asIdentifierFragment(fragment: string, fallback: string): string {
  if (fragment === "") return fallback;
  return STARTS_WITH_DIGIT.test(fragment) ? `t_${fragment}` : fragment;
}

/** The variable name a dropped table's `sd2df`/SQL-passthrough snippet
 * assigns into — the table's own name, sanitized to a Python identifier and
 * suffixed `_df`. Never deduplicated against the document itself; call
 * {@link dedupeIdentifier} with the result for that. */
export function deriveVariableName(tableName: string): string {
  return `${asIdentifierFragment(sanitizeIdentifierFragment(tableName), "sas")}_df`;
}

/** The `work.<name>` view the SQL-passthrough snippet's `create view` step
 * uses — the same sanitizing as {@link deriveVariableName}, suffixed
 * `_view` instead. This is the tabstop's *default* text, not a final value —
 * the user can retype it before running the snippet — so it is not
 * deduplicated against the document the way the assigned variable is. */
export function deriveViewName(tableName: string): string {
  return `${asIdentifierFragment(sanitizeIdentifierFragment(tableName), "sas")}_view`;
}

/** Returns `base` if `isTaken(base)` is `false`, otherwise the first of
 * `base2`, `base3`, … that `isTaken` reports as free. `isTaken` is supplied
 * by the caller (`dataDragAndDrop.ts` scans the drop target document's own
 * text) so this function stays free of any editor dependency. */
export function dedupeIdentifier(
  base: string,
  isTaken: (candidate: string) => boolean,
): string {
  if (!isTaken(base)) return base;
  for (let suffix = 2; ; suffix++) {
    const candidate = `${base}${String(suffix)}`;
    if (!isTaken(candidate)) return candidate;
  }
}

/** Escapes a value for the inside of a Python double-quoted string literal:
 * backslash, double quote, and a literal newline (which would otherwise
 * terminate the single-line snippet these builders produce). */
function escapeForPythonString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Escapes an already Python-escaped value for the *outer* VS Code snippet
 * grammar it will be embedded in — `$`, `}`, and backslash are all
 * snippet-syntax metacharacters (`${1:...}` etc.). Applied after
 * {@link escapeForPythonString}, never before: escaping snippet syntax first
 * would let the Python-escaping pass reinterpret the backslashes it adds. */
function escapeForSnippetSyntax(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\$/g, "\\$")
    .replace(/}/g, "\\}");
}

const BARE_SAS_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A safe SAS name reference for `buildSqlPassthroughSnippet`'s own
 * `select * from` line — see this module's own doc comment ("A third
 * layer") for why this is needed there and nowhere else. An ordinary name is
 * returned bare; anything else is wrapped in a SAS name literal, with an
 * embedded `'` doubled the same way any SAS string literal escapes one. */
function sasNameRef(name: string): string {
  if (BARE_SAS_NAME.test(name)) return name;
  return `'${name.replace(/'/g, "''")}'n`;
}

/** A single-line `variableName = SAS.sd2df("libref.table")` assignment — a
 * plain string, never parsed as a snippet (no tabstops to mirror), so
 * `libref`/`table` need only the Python-string escaping layer. */
export function buildSd2dfSnippet(
  libref: string,
  table: string,
  variableName: string,
): string {
  const ref = `${escapeForPythonString(libref)}.${escapeForPythonString(table)}`;
  return `${variableName} = SAS.sd2df("${ref}")`;
}

/** A multi-line snippet pushing a filter down to the engine first via
 * `SAS.submit`'s own `PROC SQL` pass-through, then reading the resulting
 * view back with `SAS.sd2df` — the pattern `phase-7.md`'s Plan section
 * documents for a SAS/ACCESS-connected external table. The view name is a
 * single mirrored tabstop (`${1:<viewName>}` / `$1`), so retyping it once
 * updates both the `create view` step and the `sd2df` read; the `where`
 * clause is a second tabstop defaulted to `1=1` (an intentionally-inert
 * placeholder condition, not a real filter) so `Tab` lands the cursor
 * exactly where a real condition belongs. Returns raw VS Code snippet
 * syntax — the caller wraps it in `new vscode.SnippetString(...)`, not a
 * plain string. */
export function buildSqlPassthroughSnippet(
  libref: string,
  table: string,
  variableName: string,
  viewName: string,
): string {
  const libSnippet = escapeForSnippetSyntax(
    escapeForPythonString(sasNameRef(libref)),
  );
  const tableSnippet = escapeForSnippetSyntax(
    escapeForPythonString(sasNameRef(table)),
  );
  return [
    `SAS.submit("""`,
    `proc sql;`,
    `  create view work.\${1:${viewName}} as`,
    `    select * from ${libSnippet}.${tableSnippet}`,
    `    where \${2:1=1};`,
    `quit;`,
    `""")`,
    `${variableName} = SAS.sd2df("work.$1")`,
  ].join("\n");
}

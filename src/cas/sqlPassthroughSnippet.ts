// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The text of 11b's CAS FedSQL explicit pass-through snippet — a companion
 * to `connectSnippet.ts`'s `buildCasConnectSnippet` (8b), assuming that
 * snippet's own `conn` is already bound in the same file. Probed and
 * confirmed working against `verde` (Finding 11.2, `phase-11.md`): loading
 * the `fedsql` action set and calling `execDirect` with a
 * `connection to <caslib> (<native SQL>)` query runs the parenthesized SQL
 * natively in the caslib's own external database, with no CAS-side
 * transformation.
 *
 * Unlike `connectSnippet.ts` and `src/data/dragSnippet.ts`'s
 * `buildSqlPassthroughSnippet`, this builder takes no input at all — the
 * caslib name and the native query are both things only the user can supply,
 * so they are VS Code snippet tabstops with placeholder default text
 * (`${1:CASLIB}` / `${2:select * from native_table}`), not values this
 * project interpolates from wire data. That means neither of
 * `dragSnippet.ts`'s two escaping layers applies here: there is no untrusted
 * string landing inside a Python literal, and every `$`/`}` in the template
 * below is this module's own deliberately-written snippet syntax, not
 * something that needs escaping to survive as one.
 *
 * **This module must never import `vscode`.** `casSqlPassthroughCommand.ts`
 * is what wraps the result in `new vscode.SnippetString(...)`.
 *
 * The `query=` value is wrapped in Python triple quotes (`'''...'''`), not a
 * single pair of double quotes, so the native query tabstop can freely
 * contain the target database's own quoting — Snowflake identifiers
 * double-quoted, string literals single-quoted — without the user having to
 * escape anything to keep it inside this snippet's own string literal.
 */
export function buildCasSqlPassthroughSnippet(): string {
  return [
    'conn.loadactionset("fedsql")',
    "result = conn.fedsql.execDirect(",
    "    query='''select * from connection to ${1:CASLIB} (${2:select * from native_table})'''",
    ")",
    'df = result["Result Set"]',
  ].join("\n");
}

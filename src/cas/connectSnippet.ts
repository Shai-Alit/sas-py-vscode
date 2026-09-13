// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The text of 8b's CAS-connect snippet — a plain string, not a VS Code
 * snippet: there is nothing here for a user to retype (unlike 7d's
 * `src/data/dragSnippet.ts`, which mirrors a tabstop across two lines), so
 * it carries no `${1:...}`/`$1` syntax and needs no second escaping layer
 * for it.
 *
 * **This module must never import `vscode`.**
 *
 * `host` and `filerefName` both land inside a Python double-quoted string
 * literal in the generated text, so both get the same
 * `escapeForPythonString` treatment `dragSnippet.ts` gives `libref`/`table` —
 * `host` comes off the wire (Finding 8.10) and this project has never
 * assumed a wire string is free of characters that would break out of a
 * literal; `filerefName` is this project's own fixed `CTnnnnnn` shape
 * (`src/compute/casToken.ts`) and never needs it in practice, but escaping
 * it anyway costs nothing and keeps this module honest about what it
 * assumes. `port` is a plain number this project itself constrains to a
 * `number` (`CasConnectionInfo.port` — `readCasConnectionInfo` in
 * `src/cas/types.ts` rejects anything else), so it is interpolated bare,
 * never through the string-escaping path.
 */

/** Escapes a value for the inside of a Python double-quoted string literal —
 * the same three characters `src/data/dragSnippet.ts`'s function of the same
 * name escapes, and for the same reason (backslash, double quote, a literal
 * newline that would otherwise terminate the line early). Kept as this
 * module's own copy rather than imported from `dragSnippet.ts`: that module
 * lives under `src/data/`, a different feature area, and the two have no
 * shared caller that would make a re-export worth the coupling. */
function escapeForPythonString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r\n|\r|\n/g, "\\n");
}

export interface CasConnectSnippetInput {
  readonly host: string;
  readonly port: number;
  readonly filerefName: string;
}

/**
 * A plain multi-line Python snippet: read the token `writeCasToken` already
 * delivered into the session's run directory, then open a binary
 * `swat.CAS()` connection with it — Finding 8.5's confirmed shape, no
 * username. The REST/HTTP alternative Finding 8.5 also confirmed is
 * deliberately not generated here (Decision 2, `phase-8.md`'s 8b Runbook
 * entry) — `docs/cas-python-connection.md` points at `swat`'s own "Binary
 * vs REST" documentation instead of this module re-deriving it.
 */
export function buildCasConnectSnippet(input: CasConnectSnippetInput): string {
  const host = escapeForPythonString(input.host);
  const filerefName = escapeForPythonString(input.filerefName);
  return [
    `with open("${filerefName}") as _cas_token_file:`,
    `    _cas_token = _cas_token_file.read().strip()`,
    `import swat`,
    `conn = swat.CAS("${host}", ${String(input.port)}, password=_cas_token)`,
  ].join("\n");
}

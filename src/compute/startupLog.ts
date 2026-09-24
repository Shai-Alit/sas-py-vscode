// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Picks what to show from a session's own log when its startup reported a
 * nonzero condition code (Finding 11.7/11.8) — the text of the error, which
 * 11e's own warning only said had happened.
 *
 * **This module must never import `vscode`.**
 *
 * ## What Finding 12.11 measured
 *
 * One bad `autoExecLines` statement on `verde` left a 172-line session log.
 * About 160 of those lines were the deployment's own preamble and site
 * autoexec, not the user's, and a clean session with no autoExec at all had
 * **no** `error` or `warning` lines. The bad statement wrote three `type:
 * "error"` lines:
 *
 * ```text
 *      ----
 *      180
 * ERROR 180-322: Statement is not valid or it is used out of proper order.
 * ```
 *
 * The first two are SAS's underline markers pointing into the echoed source
 * line above them. Shown without that line they are noise, and the source
 * line is not shown: it is a profile's `autoExec` text echoed back, and
 * Finding 12.1 saw a `LIBNAME` statement that failed to parse echoed
 * unmasked (there through `SAS.submit()`; the autoexec echo was not tested),
 * so it could carry a password into a log a user later pastes into a bug
 * report. So this keeps the `error`/`warning` lines and drops the ones that
 * are only markers.
 *
 * An `ERROR` line itself can also quote user-supplied text: some `LIBNAME`
 * engines' connection errors repeat the connection string (ODBC/OLEDB's
 * `PWD=` is the usual case). None was observed here; Finding 12.11's only
 * error line quotes nothing. So every kept line also has the value of any
 * credential-shaped `key=value` option replaced ({@link redactCredentials}).
 * That is a pattern, not a proof: a value SAS wraps onto a continuation line
 * away from its key, or a secret under a key not in the list, gets through.
 */

import { type LogLine } from "./job";

/** At most this many lines are returned — enough for several distinct
 * errors, few enough that a session log full of warnings does not flood the
 * output channel. The caller says how many more there were. */
export const MAX_STARTUP_DIAGNOSTIC_LINES = 20;

export interface StartupDiagnostics {
  /** The lines to show, in log order, text only. */
  readonly lines: readonly string[];
  /** How many more matching lines there were past
   * {@link MAX_STARTUP_DIAGNOSTIC_LINES}. */
  readonly omitted: number;
}

/**
 * The `error` and `warning` lines of a session log, minus SAS's underline
 * markers.
 *
 * Keyed on the line `type` the deployment sends rather than a `^ERROR`
 * prefix test: a long SAS error wraps onto continuation lines that carry the
 * same `type` but no prefix. The `type` vocabulary is a floor, not a closed
 * set (`LogLine.type`), so anything else is ignored rather than guessed at.
 */
export function selectStartupDiagnostics(
  lines: readonly LogLine[],
): StartupDiagnostics {
  const matching = lines
    .filter((line) => line.type === "error" || line.type === "warning")
    .map((line) => line.line.trimEnd())
    .filter((text) => !isMarkerLine(text))
    .map(redactCredentials);
  return {
    lines: matching.slice(0, MAX_STARTUP_DIAGNOSTIC_LINES),
    omitted: Math.max(0, matching.length - MAX_STARTUP_DIAGNOSTIC_LINES),
  };
}

/** Whether a line is only SAS's underline marker — dashes or underscores
 * under the offending token, or the error number printed below them — or
 * blank. Such a line points into the echoed source above it, which is not
 * shown. */
function isMarkerLine(text: string): boolean {
  return /^[\s\-_\d]*$/.test(text);
}

/** What a scrubbed value is replaced with — the same text as `auth/problems.ts`
 * uses. */
const REDACTED = "[redacted]";

/**
 * A `key=value` option whose key names a credential, as a `LIBNAME` statement
 * or an ODBC/OLEDB connection string writes it. The value is a quoted string,
 * a braced prefix and what follows it (`{SAS002}…`-encoded passwords), or a
 * bare run up to whitespace, `;` or a quote — so `PWD=x;UID=y` inside a
 * quoted connection string loses only `x`.
 */
const CREDENTIAL_OPTION =
  /\b(password|passwd|pwd|pw|authpw|client_secret|secret|access_token|token|apikey|api_key)(\s*=\s*)("[^"]*"|'[^']*'|\{[^}]*\}[^\s;'"]*|[^\s;'"]+)/gi;

/** A log line with the value of every credential-shaped option replaced by
 * {@link REDACTED}; the key is kept, so the line still says what failed. */
export function redactCredentials(text: string): string {
  return text.replace(
    CREDENTIAL_OPTION,
    (_match, key: string, equals: string) => `${key}${equals}${REDACTED}`,
  );
}

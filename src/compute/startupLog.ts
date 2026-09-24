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
 * **That is a narrower guarantee than "no secret reaches the log".** It keeps
 * out the echoed statement, not whatever an `ERROR` line itself quotes. Some
 * `LIBNAME` engines' connection errors (ODBC/OLEDB connection strings are
 * the usual case) can repeat user-supplied text in the message. None was
 * observed here; Finding 12.11's only error line quotes nothing.
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
    .filter((text) => !isMarkerLine(text));
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

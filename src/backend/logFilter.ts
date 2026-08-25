// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The log filter — Phase 3b, `PRODUCTION_PLAN.md`'s "SAS log → clean Python
 * stdout."
 *
 * **This module must never import `vscode`.**
 *
 * `job.ts`'s own doc comment on {@link LogLine.type} says it plainly:
 * "interpreting a type is 3b's filter, and this module's job is to deliver it
 * intact." This is that filter, given a proper home. It shipped once already,
 * inline inside `procPython.ts`, because 3a could not produce any visible
 * output at all without deciding *something* about which log lines were noise
 * — but that module's own doc comment recorded the same tension this one
 * settles: "Turning a `LogLine` into a `RichOutput` is this slice's to do,"
 * written by 3a, about 3a. This module is 3a's shortcut given the dedicated,
 * fixture-tested treatment the plan always meant for it, and `procPython.ts`
 * now calls into it rather than carrying its own copy.
 *
 * ## Why a type switch and not a text scan
 *
 * The plan originally described this slice as stripping "page-break headers,
 * `>>>` markers, and procedure NOTEs" — the shape of the problem before 2c-pre
 * measured the log at all. Two things that probe found make that description
 * the wrong one to build against:
 *
 * 1. **The log is already a collection of typed lines**, not a blob of text
 *    a client has to parse. `job.ts`'s `LogLine` carries `{ line, type }` for
 *    every item the deployment sends — `source`, `note`, `normal`, `error`,
 *    and whatever else a future deployment adds (finding 52). A line's `type`
 *    is exactly the classification a text scan for `>>>` markers or `NOTE:`
 *    prefixes would otherwise have to reconstruct, and reconstructing it
 *    imperfectly is worse than not trying: ten of finding 52's thirteen
 *    `note` lines carry no `NOTE:` prefix at all, so a prefix test would
 *    have shown those ten as if they were user output.
 * 2. **`infile=` echoes no source.** ADR-0014 chose upload plus `infile=`
 *    (finding 35), which never echoes the submitted file into the log — so
 *    the `source` type this module still excludes is defensive rather than
 *    load-bearing, kept on the chance a deployment or a future submission
 *    path differs, not because a real 3a run is expected to produce one.
 *
 * A page-break banner is no longer hypothetical. 3c's probe (2026-08-25,
 * `docs/phases/phase-3.md`'s findings) triggered one for real: it arrives as
 * its own log item typed `title` — not `note`, the guess this comment made
 * before any deployment had actually been asked to produce one.
 * `isNoiseLine` does not exclude `title` today, so a banner currently passes
 * through as visible output rather than being silently dropped; whether it
 * should join `note` and `source` as noise is an open question for whichever
 * 3c/3d slice next touches this filter, not settled here. PAGESIZE=MAX
 * (`docs/phases/phase-3.md`'s own note under 3a) is still not sent at session
 * creation (`sessionManager.ts`'s `open()` calls `createSession` with no
 * `options`), a real, separate gap. Neither changes this filter's design in
 * the way that matters: a banner still arrives as its own atomic,
 * already-typed log item, never as text spliced into a neighbouring line, so
 * "a page break splits the stdout region mid-stream" — the awkward case the
 * original plan text named — still cannot happen to it regardless of which
 * type wins the argument above.
 *
 * ## What counts as noise, and why the vocabulary stays open
 *
 * `note` and `source` are the only two types this filter excludes.
 * Everything else — `normal`, `error`, and any type this codebase has never
 * seen — is shown. `job.ts`'s own doc is explicit that the vocabulary is
 * "a floor, not a closed set," and a filter that hid an unrecognised type by
 * default would hide real output the day the vocabulary grows, with no
 * error and no way for a user to know it happened. Showing the unknown is
 * the only choice that fails safely.
 *
 * `note` is dropped in full, blanks and continuation lines included, not
 * matched against a `NOTE:` prefix — finding 52 measured a `note` line
 * carrying nothing but the empty string, and a prefix test would have kept
 * it as if it were output. This does not touch the user's own blank
 * `print()` calls: those arrive typed `normal`, on SAS's own log-formatting
 * channel rather than `note`'s, so nothing here can mistake one for the
 * other.
 *
 * `error` is *not* excluded. Finding 39 measured a Python exception as an
 * `ERROR: Unhandled Python exception.` line of type `error`, immediately
 * followed by the raw traceback text as `normal` lines — both are shown, and
 * both are what a user watching their program run needs to see. Turning
 * that traceback into a structured `Traceback` for the result panel is
 * 3c's job (`backend.ts`'s own `RichOutput` doc), and diagnosing it further
 * — mapping frames back to editor positions — is Phase 4's; this filter's
 * only job is deciding which lines are shown at all.
 */

import { type RichOutput } from "./backend";

import { type LogLine } from "../compute/job";

/**
 * Whether a log line's `type` is noise this filter excludes.
 *
 * `source` should not occur at all with the `infile=` submission path 3a
 * uses (finding 35) and is excluded on the chance a deployment or a future
 * submission mechanism differs — never because a real run is expected to
 * produce one. Anything not named here, including a type nothing in this
 * codebase recognises, is not noise; see this module's own doc comment for
 * why an unrecognised type must never default to hidden.
 */
export function isNoiseLine(type: string | undefined): boolean {
  return type === "note" || type === "source";
}

/**
 * One forwarded log line as output, with the trailing newline a caller
 * iterating {@link LogLine}s one at a time would otherwise have to add back
 * itself — the same newline a real `print()` call's output reads back as,
 * once it has passed through the log.
 */
export function logLineOutput(line: LogLine): RichOutput {
  return { mime: "text/plain", data: `${line.line}\n` };
}

/**
 * The marker shown in place of log lines this project's own buffer caps
 * discarded — `logStream.ts`'s `EventBuffer`, guarding against a run that
 * nobody is consuming. Reports a count rather than the lines themselves,
 * because the lines are gone by the time this fires; the marker's whole job
 * is to say honestly that a hole exists, not to describe what filled it.
 */
export function droppedLinesOutput(lines: number): RichOutput {
  return {
    mime: "text/plain",
    data: `[${String(lines)} log line(s) dropped]\n`,
  };
}

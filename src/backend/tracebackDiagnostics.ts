// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Phase 4c: mapping a {@link TracebackFrame} back to an editor position, and
 * the `ModuleNotFoundError` special case `phase-3.md`'s 3e entry asked for.
 *
 * **This module must never import `vscode`.** Same discipline as
 * `procPython.ts`/`logFilter.ts` (ADR-0009's coverage-scope rule) — nothing
 * here needs the host, and `backend.ts`'s own types it imports are type-only,
 * which is erased at compile time and keeps this file inside the coverage
 * denominator. `check:coverage-scope` enforces the rule in both directions.
 *
 * ## Why a `<string>` frame's line number needs no adjustment
 *
 * ADR-0014 settled that `PROC PYTHON infile=<fileref>;` runs the uploaded
 * file byte-for-byte with no wrapper preamble and no source echo, so a
 * `<string>` frame's `line` is the *identity* mapping against the file that
 * was uploaded — there is no fixed harness-line-count to subtract, unlike a
 * harness that prepends its own boilerplate before the user's code. What
 * still has to be added is {@link ProgramOrigin.lineOffset}: zero for a whole
 * file, `selection.start.line` for Run Selection (`commands.ts`'s
 * `buildProgram`) — the editor position of whichever line the uploaded bytes
 * actually began at.
 *
 * ## What this does not attempt
 *
 * Only a `<string>` frame is mapped. `backend.ts`'s own doc on
 * {@link TracebackFrame} names the reason: a frame the runtime also labels
 * `<stdin>` can appear below a real frame when the user's own code calls
 * `compile(src, "<stdin>", "exec")` (or `eval`/`exec` against a code object
 * built that way), and this project has no offset map for text the user's
 * own program constructed at run time. Guessing a position for it would be
 * worse than leaving it unmapped — {@link mapFrameToOrigin} returns
 * `undefined` for anything that is not `<string>`, and {@link
 * primaryFrame}/{@link primaryPosition} search past an unmappable innermost
 * frame rather than reporting one.
 *
 * No column is ever reported: `PROC PYTHON`'s traceback carries only a line
 * number (`  File "<name>", line <n>, in <name>` — finding 39's one measured
 * shape), so {@link EditorPosition.character} is always `0`, the start of
 * the mapped line.
 */

import type { ProgramOrigin, Traceback, TracebackFrame } from "./backend";

/** The runtime's label for the file `PROC PYTHON infile=` ran — the only
 * frame label ADR-0014 lets this module map. See this module's own doc
 * comment for why every other label is left unmapped rather than guessed
 * at. */
export const STRING_FRAME_FILE = "<string>";

/** A plain editor position — zero-based, VS Code's own convention for both
 * fields, so a caller can hand this straight to a `vscode.Position`
 * constructor without re-deriving anything. */
export interface EditorPosition {
  readonly line: number;
  /** Always `0` — see this module's own doc comment for why. */
  readonly character: number;
}

/**
 * Maps one frame back to a position in {@link ProgramOrigin.uri}.
 *
 * `undefined` for any frame whose `file` is not {@link STRING_FRAME_FILE} —
 * this module's own doc comment explains why guessing one is wrong. `frame`
 * has already had the harness's own leading `<stdin>` run dropped by
 * `parseTraceback` (3c-ii, finding 39) before it ever reaches here; this
 * function does not need to know that happened, only that a `<string>` frame
 * it is given is genuinely the user's.
 */
export function mapFrameToOrigin(
  frame: TracebackFrame,
  origin: ProgramOrigin,
): EditorPosition | undefined {
  if (frame.file !== STRING_FRAME_FILE) return undefined;
  // `frame.line` is one-based (`TracebackFrame`'s own doc); `lineOffset` is
  // zero-based and added directly, per `ProgramOrigin.lineOffset`'s own doc:
  // "Added to a line number reported by the runtime, after any wrapper
  // frames … have been dropped."
  return { line: origin.lineOffset + frame.line - 1, character: 0 };
}

/**
 * The frame a `Diagnostic` should point at — confirmed with Sean (this
 * phase's Runbook, 4c entry): one `Diagnostic` at the innermost frame, not
 * one per frame, the idiomatic VS Code pattern and one that avoids cluttering
 * Problems with duplicate entries for a single recursive error.
 *
 * Searches from the innermost frame (the end of `traceback.frames` —
 * outermost first, per that type's own doc) backward for the first one
 * labelled {@link STRING_FRAME_FILE}, so a trailing user-generated `<stdin>`
 * frame (see this module's own doc comment) is skipped rather than reported
 * as the primary location. `undefined` when no frame in the stack is
 * mappable at all.
 */
export function primaryFrame(traceback: Traceback): TracebackFrame | undefined {
  // Innermost first. `frames` is outermost-first (that type's own doc), so a
  // reversed shallow copy lets a plain `for…of` hand back a non-optional
  // `TracebackFrame` — an index walk would force a `noUncheckedIndexedAccess`
  // guard branch that no input can ever take, and `.reverse()` on a spread
  // copy leaves `traceback.frames` itself untouched.
  for (const frame of [...traceback.frames].reverse()) {
    if (frame.file === STRING_FRAME_FILE) return frame;
  }
  return undefined;
}

/** {@link primaryFrame} mapped through {@link mapFrameToOrigin} in one call —
 * the position 4d's `Diagnostic` is placed at. */
export function primaryPosition(
  traceback: Traceback,
  origin: ProgramOrigin,
): EditorPosition | undefined {
  const frame = primaryFrame(traceback);
  if (frame === undefined) return undefined;
  return mapFrameToOrigin(frame, origin);
}

/**
 * The exception name Python raises for an unresolvable `import` —
 * `phase-3.md`'s 3e entry: "Phase 4's traceback work should special-case
 * `ModuleNotFoundError` and point at [`probeRuntime()`'s cached installed-
 * package list]."
 */
const MODULE_NOT_FOUND = "ModuleNotFoundError";

/**
 * The English fragment appended to a `ModuleNotFoundError`'s own message.
 *
 * Not localised, matching the other extension-authored English strings
 * `backend.ts`'s own doc comment on {@link RichOutput} already names as a
 * known, accepted gap: neither this module nor `procPython.ts` may import
 * `vscode` (ADR-0009), so `l10n.t()` is unavailable here. `outputChannel.ts`
 * — the first thing to render a `PythonDiagnostic.message` to a person —
 * writes this verbatim, the same as the rest. Unlike those, this one is
 * appended guidance rather than a fallback, so it is counted explicitly in
 * that comment's own list rather than folded into "fallback messages".
 *
 * Names the command by its exact Command Palette title
 * (`package.nls.json`'s `command.showEnvironment.title` under the
 * `Python on Viya` category) rather than its id, since a person reads the
 * palette, not `package.json`.
 */
const SHOW_ENVIRONMENT_GUIDANCE =
  ' Run "Python on Viya: Show Environment" to see what is installed on this connection.';

/**
 * Appends {@link SHOW_ENVIRONMENT_GUIDANCE} to a diagnostic message that is a
 * `ModuleNotFoundError`, unchanged otherwise.
 *
 * Matched on the exception name at the start of the message rather than
 * anywhere within it — `traceback.message` is `messageLines.join(" ")`
 * (`procPython.ts`'s `parseTraceback`), so a *multi-line* exception message
 * that merely mentions the words "module" or "not found" (a user's own
 * `raise ValueError("module not found in registry")`, say) must not match.
 * Python's own convention is `<ExceptionName>: <detail>` on one logical
 * line, which is exactly what this checks for.
 */
export function withModuleNotFoundGuidance(message: string): string {
  if (!message.startsWith(`${MODULE_NOT_FOUND}:`)) return message;
  return `${message}${SHOW_ENVIRONMENT_GUIDANCE}`;
}

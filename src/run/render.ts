// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Turns one streamed {@link RichOutput} into what 3d-i's output channel shows.
 *
 * **This module must never import `vscode`.** The decision of *what* a mime
 * arm becomes belongs here, fixture-tested; the decision of *how to say it in
 * the user's language* is `src/run/outputChannel.ts`'s, the same split
 * `src/profile/model.ts`'s `ValidationProblem` uses for the same reason.
 *
 * ## Why two mime arms produce nothing to append
 *
 * `application/vnd.python.traceback` is not rendered here at all, and that is
 * deliberate rather than an oversight this slice ran out of time for: the raw
 * traceback text is *already* visible by the time this run's outputs reach a
 * caller, because `logFilter.ts`'s `isNoiseLine` excludes only `note` and
 * `source` — the `error` and `normal` lines a real Python exception logs
 * (finding 39) pass straight through as `text/plain` output ahead of this one.
 * A second, structured rendering of the same failure belongs to 3d-ii's result
 * panel, which can do something a text channel cannot (map a frame, make it
 * clickable); repeating it here as more text would be the same information
 * twice with no more of it readable.
 *
 * `text/html` and `image/png` are real output the *channel* cannot show — it
 * is text-only, and matplotlib figures or a DataFrame's HTML repr have no
 * textual form worth dumping into a log (a base64 PNG blob or a wall of markup
 * is not what "text-only" is offering). Reported here as their own line rather
 * than silently dropped, so the person watching the channel knows their
 * program *did* produce something and the extension has not lost it — the
 * Result panel (3d-ii) is where it is actually shown.
 */

import type { RichOutput } from "../backend/backend";

/** One line the output channel writes, or the shape of one it defers to the panel. */
export type OutputLine =
  /** Appended exactly as given — already includes its own trailing newline,
   * per `logFilter.ts`'s `logLineOutput`/`droppedLinesOutput`. */
  | { readonly kind: "raw"; readonly text: string }
  /** A rich output the channel cannot render as text. The shell localises the
   * one line shown for it; see this module's own doc comment for why. */
  | {
      readonly kind: "deferred-rich-output";
      readonly mime: "text/html" | "image/png";
    };

/** What, if anything, one streamed {@link RichOutput} contributes to the channel. */
export function renderRichOutput(output: RichOutput): readonly OutputLine[] {
  switch (output.mime) {
    case "text/plain":
      return [{ kind: "raw", text: output.data }];
    case "text/html":
    case "image/png":
      return [{ kind: "deferred-rich-output", mime: output.mime }];
    case "application/vnd.python.traceback":
      return [];
  }
}

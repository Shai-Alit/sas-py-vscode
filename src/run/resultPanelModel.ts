// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Turns one streamed {@link RichOutput}, or a run's conclusion, into the wire
 * shape 3d-ii's result panel sends across the host↔webview boundary.
 *
 * **This module must never import `vscode`.** Same split `render.ts` already
 * draws for the output channel: the decision of *what* a `RichOutput` becomes
 * is pure and fixture-tested here; the decision of *how to say it in the
 * user's language* belongs to whichever `vscode`-importing shell calls this
 * one (`src/run/resultPanel.ts`) — see ADR-0021. Concretely, that means this
 * module never invents its own English text: every localised string a
 * {@link RenderItem} carries (an image's `alt`, a traceback's `heading`)
 * arrives as a parameter, already translated by the caller, the same way
 * `outputChannel.ts` supplies the text `render.ts`'s own deferred-output lines
 * never carry themselves.
 *
 * `ResultPanelMessage` is also declared here rather than split across the host
 * and webview sides, because both sides need to agree on exactly one shape for
 * it — a message type declared twice is a message type that can drift.
 * `src/webview/entry.ts` imports only the type from this module, never a
 * runtime value, so this stays reachable from a browser bundle that has no
 * Node module resolution for anything beyond what esbuild inlines.
 */

import type {
  ExecutionOutcome,
  RichOutput,
  TracebackFrame,
} from "../backend/backend";

/** The input shape {@link RenderItemLabels.tracebackFrame} formats into one
 * already-localised line. Mirrors {@link TracebackFrame} field for field;
 * declared separately so this module never has to import a type it would
 * otherwise re-export unchanged. Not itself a wire type — what crosses the
 * host↔webview boundary is the formatted `frameLines` string array below. */
export interface RenderTracebackFrame {
  readonly file: string;
  readonly line: number;
  readonly name: string;
}

/**
 * One piece of a run's output, reduced from {@link RichOutput} to exactly what
 * the DOM layer (`src/run/resultPanelDom.ts`) needs to build a node for it —
 * plain, serialisable data, already carrying whatever localised text it needs
 * and nothing it would have to fetch or translate itself.
 */
export type RenderItem =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "image"; readonly dataUri: string; readonly alt: string }
  /** `markup` is inserted as HTML, not text — real `<table>` semantics from a
   * pandas repr survive only if this stays markup all the way to the DOM. Safe
   * because the panel's CSP (ADR-0021) never allows a script from this source
   * to execute, whatever it contains. */
  | { readonly kind: "html"; readonly markup: string }
  | {
      readonly kind: "traceback";
      readonly heading: string;
      readonly message: string;
      /** Each frame already formatted into one localised line (e.g.
       * "app.py, line 3, in <module>") by
       * {@link RenderItemLabels.tracebackFrame}. The DOM layer renders a
       * frame as a single `<li>` of this text — and, from Phase 4d, makes
       * the `<li>` clickable when the matching {@link frames} entry is a
       * mappable `<string>` frame. Keeping the display text a pre-formatted
       * string array is still what keeps the connectives ("line", "in") on
       * the host side of the localisation boundary rather than hardcoded
       * English in `resultPanelDom.ts`. */
      readonly frameLines: readonly string[];
      /** The same frames as {@link frameLines}, in the same order, but as
       * raw `file`/`line`/`name` rather than a formatted line. Added in
       * Phase 4d: the DOM layer keys on `file === STRING_FRAME_FILE` to
       * decide which `<li>`s are clickable, and the host
       * (`src/run/resultPanel.ts`) maps the activated frame's index back
       * through 4c's `mapFrameToOrigin` to reveal it in the editor. Not
       * itself user-facing text — nothing here is localised or displayed
       * directly. */
      readonly frames: readonly RenderTracebackFrame[];
      /** The run this traceback belongs to, as `resultPanel.ts`'s
       * monotonic per-run counter. Phase 5d-iv: baked into each clickable
       * frame's activation so the {@link RevealFrameMessage} it posts back
       * carries the token, and a click from a superseded run is dropped by
       * the host rather than resolved against the current run's frames. Rides
       * on the item (not on transient webview state) so it survives the
       * panel's hide/show rebuild and backlog replay unchanged. Not
       * user-facing. */
      readonly runToken: number;
    };

/** Already-localised strings {@link toRenderItem} needs but must not invent
 * itself. Supplied by `src/run/resultPanel.ts`, the one place in this feature
 * that is allowed to call `vscode.l10n.t()`. */
export interface RenderItemLabels {
  /** `imageIndex` is 1-based and counts only image outputs within a run, so
   * "Output image 1", "Output image 2" numbers the way a person looking at
   * the panel would, not by this output's position among every output kind. */
  readonly imageAlt: (imageIndex: number) => string;
  /** A thunk, not a plain string, so the caller's `vscode.l10n.t()` call only
   * ever runs for the one output in a run that is actually a traceback,
   * rather than once per streamed output regardless of its mime type. */
  readonly tracebackHeading: () => string;
  /** Formats one traceback frame into a single already-localised line — e.g.
   * "app.py, line 3, in <module>". Called once per frame, and (like
   * {@link tracebackHeading}) only for an output that is actually a
   * traceback, so the caller's `vscode.l10n.t()` never runs for a plain or
   * image output. The connectives ("line", "in") are the caller's to
   * translate: ADR-0021 keeps every user-facing string on the host side, and
   * this is one `resultPanelDom.ts` would otherwise hardcode in English. */
  readonly tracebackFrame: (frame: RenderTracebackFrame) => string;
}

/**
 * Reduces one streamed {@link RichOutput} to a {@link RenderItem}.
 *
 * Total over `RichOutput`'s mime union — every arm has something to show,
 * unlike `render.ts`'s `renderRichOutput`, which defers two arms and drops a
 * fifth to nothing. This is the module that *is* the "later slice" those
 * deferrals and that drop pointed at.
 */
export function toRenderItem(
  output: RichOutput,
  labels: RenderItemLabels,
  imageIndex: number,
  runToken: number,
): RenderItem {
  switch (output.mime) {
    case "text/plain":
      return { kind: "text", text: output.data };
    case "text/html":
      return { kind: "html", markup: output.data };
    case "image/png":
      return {
        kind: "image",
        // No data-URI prefix on the wire (backend.ts's own RichOutput doc) —
        // added here, once, rather than by every caller that wants to display it.
        dataUri: `data:image/png;base64,${output.data}`,
        alt: labels.imageAlt(imageIndex),
      };
    case "application/vnd.python.traceback":
      return {
        kind: "traceback",
        heading: labels.tracebackHeading(),
        message: output.data.message,
        frameLines: output.data.frames.map((frame) =>
          labels.tracebackFrame(toRenderFrame(frame)),
        ),
        frames: output.data.frames.map(toRenderFrame),
        // Phase 5d-iv: only the traceback arm carries it — it is the only
        // item that produces a webview→host message worth scoping to a run.
        runToken,
      };
  }
}

function toRenderFrame(frame: TracebackFrame): RenderTracebackFrame {
  return { file: frame.file, line: frame.line, name: frame.name };
}

/** Whether a {@link RichOutput} is one the output channel already shows in
 * full as text — used to decide the panel's reveal policy (ADR-0021): a run
 * that produces only these never forces the panel into view, because it adds
 * nothing the output channel has not already shown. */
export function isAlreadyVisibleAsText(output: RichOutput): boolean {
  return output.mime === "text/plain";
}

/** The messages `src/run/resultPanel.ts` posts to the webview, and
 * `src/webview/entry.ts` (via `src/run/resultPanelDom.ts`) applies to the DOM.
 * One shared type on both sides of the boundary, per this module's own doc
 * comment. */
export type ResultPanelMessage =
  /** A new run starting — clears the panel's prior content. */
  | { readonly type: "reset" }
  | { readonly type: "output"; readonly item: RenderItem }
  | {
      readonly type: "outcome";
      /** Already localised by the caller — e.g. "Finished." or "Finished
       * with an error." `succeeded` travels alongside it only for styling
       * (which CSS class the DOM layer applies), never as something the DOM
       * layer would have to turn into English itself. */
      readonly summary: string;
      readonly succeeded: boolean;
      /** Already plain strings — `ExecutionOutcome.diagnostics[].message` is
       * not localised by this seam (backend.ts's own documented gap) and this
       * module does not change that either way. */
      readonly diagnostics: readonly string[];
    }
  /** A run, cancel or reset that never reached an outcome at all — `message`
   * is already localised, via `localiseBackendProblem` in `resultPanel.ts`. */
  | { readonly type: "failure"; readonly message: string };

/**
 * The one message that travels **webview → host** beyond ADR-0021's `"ready"`
 * handshake, added in Phase 4d: the user activated a traceback frame in the
 * result panel and wants the editor to jump to it.
 *
 * `frameIndex` indexes the activated frame's position in the traceback's own
 * `frames` array (outermost first, as Python prints) — the host
 * (`src/run/resultPanel.ts`) retains that array plus the run's
 * `ProgramOrigin` and resolves the pair through 4c's `mapFrameToOrigin`. The
 * webview only ever sends an index for a frame it rendered as clickable,
 * i.e. one whose `file` is `STRING_FRAME_FILE`; the host re-checks anyway
 * (`mapFrameToOrigin` returns `undefined` for anything else), so a
 * malformed or stale index is a no-op rather than a wrong jump.
 *
 * `runToken` (Phase 5d-iv) is the value the host stamped on the traceback
 * {@link RenderItem} this frame was rendered from — its monotonic per-run
 * counter. The host drops a message whose token is not the current run's,
 * closing the one race `frameIndex` alone left open: a `revealFrame` for a
 * previous run's frame, delayed in the host queue until the next run has both
 * reset and streamed its own traceback, would otherwise resolve against the
 * new run's origin/frames — a jump to a plausible-but-wrong line rather than
 * the no-op this message type promises.
 *
 * Kept out of {@link ResultPanelMessage} deliberately: that union is the
 * host-authored, host → webview protocol (its own doc comment says so), and
 * `resultPanel.ts` validates this direction with {@link isRevealFrameMessage}
 * the same way it validates `"ready"` with its own narrow guard.
 */
export interface RevealFrameMessage {
  readonly type: "revealFrame";
  readonly frameIndex: number;
  readonly runToken: number;
}

/** Structural validation for a value received over
 * `webview.onDidReceiveMessage` that claims to be a {@link RevealFrameMessage}.
 * `frameIndex` and `runToken` must both be non-negative integers — anything
 * else cannot be a real array index or a real run counter and is rejected
 * here rather than reaching the lookup. */
export function isRevealFrameMessage(
  value: unknown,
): value is RevealFrameMessage {
  return (
    isRecord(value) &&
    value.type === "revealFrame" &&
    typeof value.frameIndex === "number" &&
    Number.isInteger(value.frameIndex) &&
    value.frameIndex >= 0 &&
    typeof value.runToken === "number" &&
    Number.isInteger(value.runToken) &&
    value.runToken >= 0
  );
}

/** Reduces a run's conclusion to the message {@link ResultPanelMessage}'s
 * `"outcome"` arm carries. `summary` is supplied by the caller, already
 * localised — this module invents no English text, the same rule
 * {@link toRenderItem} follows for `RenderItemLabels`. */
export function outcomeMessage(
  outcome: ExecutionOutcome,
  summary: string,
): ResultPanelMessage {
  return {
    type: "outcome",
    summary,
    succeeded: outcome.succeeded,
    diagnostics: outcome.diagnostics.map((diagnostic) => diagnostic.message),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

function isRenderTracebackFrame(value: unknown): value is RenderTracebackFrame {
  return (
    isRecord(value) &&
    typeof value.file === "string" &&
    typeof value.line === "number" &&
    typeof value.name === "string"
  );
}

function isRenderTracebackFrameArray(
  value: unknown,
): value is RenderTracebackFrame[] {
  return Array.isArray(value) && value.every(isRenderTracebackFrame);
}

/** Structural validation for a value that claims to be a {@link RenderItem} —
 * used by {@link isResultPanelMessage} below, which is what
 * `src/webview/entry.ts` actually calls on every message it receives. Between
 * the two, the host-to-webview direction of `SECURITY.md`'s "unvalidated
 * messages crossing the extension/webview boundary" has a checked answer, not
 * an assumption. The other direction (webview to host) has no vocabulary
 * beyond the single `"ready"` handshake, which `resultPanel.ts` checks with
 * its own narrow, unexported guard rather than this one — there being only
 * one possible shape to check makes a second full validator here unwarranted. */
export function isRenderItem(value: unknown): value is RenderItem {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case "text":
      return typeof value.text === "string";
    case "image":
      return typeof value.dataUri === "string" && typeof value.alt === "string";
    case "html":
      return typeof value.markup === "string";
    case "traceback":
      return (
        typeof value.heading === "string" &&
        typeof value.message === "string" &&
        isStringArray(value.frameLines) &&
        isRenderTracebackFrameArray(value.frames) &&
        typeof value.runToken === "number"
      );
    default:
      return false;
  }
}

/**
 * Structural validation for a value received over `window.addEventListener("message")`.
 *
 * The only sender is this extension's own host side (`src/run/resultPanel.ts`),
 * never third-party content — a webview's message channel is not the same
 * threat model as embedding remote web content. Validating anyway is cheap,
 * gives `src/webview/entry.ts` something better than an unchecked cast to
 * dispatch on, and is exactly what closes `SECURITY.md`'s named category for
 * this feature rather than leaving it an assumption.
 */
export function isResultPanelMessage(
  value: unknown,
): value is ResultPanelMessage {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case "reset":
      return true;
    case "output":
      return isRenderItem(value.item);
    case "outcome":
      return (
        typeof value.summary === "string" &&
        typeof value.succeeded === "boolean" &&
        isStringArray(value.diagnostics)
      );
    case "failure":
      return typeof value.message === "string";
    default:
      return false;
  }
}

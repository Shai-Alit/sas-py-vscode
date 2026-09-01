// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Owns the result panel's `WebviewPanel` — 3d-ii, ADR-0021.
 *
 * One singleton, reused across runs, the same shape `RunOutputChannel`
 * already uses. Only reveals itself when a run produces something the output
 * channel cannot already show in full — `text/html`, `image/png`, or a
 * structured traceback (ADR-0021's reveal policy) — but keeps its content in
 * sync for a plain `text/plain` run too, so a panel a user already has open
 * stays consistent with what actually happened.
 *
 * This is the one module in the feature allowed to call `vscode.l10n.t()` —
 * everything it hands to `src/run/resultPanelModel.ts`'s pure functions is
 * already translated, and nothing crossing the message boundary into the
 * webview carries English text this class did not already localise. See this
 * feature's own localisation-boundary note on `backend.ts`'s `RichOutput` doc
 * comment, extended here the same way `outputChannel.ts` already extended it.
 *
 * **Phase 4d — click-to-jump.** A traceback frame the webview rendered as
 * clickable (one whose `file` is `<string>`) posts a `revealFrame` message
 * back; this class holds the current run's structured frames and its
 * {@link ProgramOrigin}, maps the activated frame through 4c's
 * `mapFrameToOrigin`, and opens the editor at that position via the
 * injectable {@link ResultPanelDeps.revealPosition}. The Problems-panel half
 * of 4d lives in `src/run/diagnostics.ts`, not here — this class only owns
 * the panel.
 */

import * as vscode from "vscode";

import type {
  ExecutionOutcome,
  ProgramOrigin,
  RichOutput,
} from "../backend/backend";
import { localiseBackendProblem } from "../backend/messages";
import type { BackendProblem } from "../backend/problems";
import { mapFrameToOrigin } from "../backend/tracebackDiagnostics";
import {
  isAlreadyVisibleAsText,
  isRevealFrameMessage,
  outcomeMessage,
  toRenderItem,
  type RenderTracebackFrame,
  type ResultPanelMessage,
} from "./resultPanelModel";

const VIEW_TYPE = "pythonOnViya.resultPanel";

/**
 * The surface of `vscode.WebviewPanel`/`vscode.Webview` this class actually
 * uses, narrowed the same way `RunCommandSessions` narrows
 * `ComputeSessionManager` — so a test double only has to implement the six
 * members this class calls, not the whole real interface. A real
 * `vscode.WebviewPanel` satisfies this structurally with no adapter needed.
 */
export interface ResultWebviewPanel extends vscode.Disposable {
  readonly webview: {
    html: string;
    readonly cspSource: string;
    asWebviewUri(localResource: vscode.Uri): vscode.Uri;
    postMessage(message: unknown): Thenable<boolean>;
    onDidReceiveMessage(
      listener: (message: unknown) => void,
    ): vscode.Disposable;
  };
  reveal(viewColumn?: vscode.ViewColumn, preserveFocus?: boolean): void;
  onDidDispose(listener: () => void): vscode.Disposable;
}

/**
 * The one port this class would otherwise reach for on the `vscode`
 * namespace directly — same reasoning as `RunOutputChannelDeps.createChannel`:
 * a test cannot drive a real webview's document through message events
 * reliably, so panel creation is injectable and defaults to the real thing.
 */
export interface ResultPanelDeps {
  createPanel?: (() => ResultWebviewPanel) | undefined;
  /** Reveals `uri` in an editor with the cursor at `position` — Phase 4d's
   * click-to-jump. Defaults to `vscode.window.showTextDocument`. Injectable
   * for the same reason `createPanel` is: an integration test cannot assert
   * on a real editor being focused, but can assert this port was asked to
   * focus the right place. */
  revealPosition?:
    | ((uri: vscode.Uri, position: { line: number; character: number }) => void)
    | undefined;
}

export class ResultPanel implements vscode.Disposable {
  private readonly extensionUri: vscode.Uri;
  private readonly createPanel: () => ResultWebviewPanel;
  private readonly revealPosition: (
    uri: vscode.Uri,
    position: { line: number; character: number },
  ) => void;

  private panel: ResultWebviewPanel | undefined;
  private panelSubscriptions: vscode.Disposable[] = [];
  private ready = false;
  /** Every message since the last `"reset"`, replayed in order into a freshly
   * created panel once its `"ready"` handshake arrives — the buffering
   * ADR-0021 describes for the one real race in this design.
   *
   * Kept for the *whole* run, not just until the first `"ready"`: a
   * `retainContextWhenHidden: false` panel is discarded and rebuilt on every
   * hide/show (see `createRealPanel`), each rebuild sends a fresh `"ready"`,
   * and the replay is what makes the panel whole again — so the entire run's
   * message stream has to still be here. This means a run that streams a lot
   * of output holds all of it in the extension host's heap until the next
   * `startRun()` clears it, even a `text/plain`-only run that never opens a
   * panel at all. Bounded by one run and released at the next, so it is a
   * retention cost, not a leak; a size-aware cap (which would trade full-run
   * fidelity on a late-opening or reloaded panel) is a deliberate non-goal
   * here and left for a measured follow-up if a pathological run ever shows
   * it matters. */
  private backlog: ResultPanelMessage[] = [];
  private imageCount = 0;
  /** Whether *this run* has already brought the panel to the front. Separate
   * from `this.panel !== undefined`: a panel can already exist, from an
   * earlier run, sitting unfocused behind other tabs — the reveal policy is
   * "once per qualifying run", not "once ever per window", so a later run's
   * first qualifying output must still call `.reveal()` even though it does
   * not need to create anything. Caught on review: the first version of this
   * class only ever revealed on the run that happened to create the panel.
   *
   * Also reset in {@link open}'s `onDidDispose` handler, not only in
   * {@link startRun} — found by `test:integration` actually exercising a
   * real `vscode.WebviewPanel` disposal for the first time (the mocked-vscode
   * unit tier never runs `test/integration/**`, per `.mocharc.json`, so this
   * had no coverage until then). Without that second reset, a user closing
   * the panel — which fires the identical `onDidDispose` event this class'
   * own `dispose()` does — permanently used up this run's one reveal, so any
   * further rich output later in the same run would never bring a panel back
   * at all. */
  private revealedThisRun = false;
  /** The origin of the program this run is executing — set by
   * {@link startRun}, consumed by {@link revealFrame} to map an activated
   * traceback frame's line back into the editor. `undefined` before the
   * first run, or when a caller (a test) drove the panel without one. */
  private currentOrigin: ProgramOrigin | undefined;
  /** This run's traceback frames, structured, in the order Python printed
   * them — retained from the streamed traceback output so
   * {@link revealFrame} can look one up by the index the webview sends
   * back. Reset at the start of every run. */
  private currentFrames: readonly RenderTracebackFrame[] = [];

  constructor(extensionUri: vscode.Uri, deps: ResultPanelDeps = {}) {
    this.extensionUri = extensionUri;
    this.createPanel = deps.createPanel ?? (() => this.createRealPanel());
    this.revealPosition =
      deps.revealPosition ??
      ((uri, position) => {
        const target = new vscode.Position(position.line, position.character);
        void vscode.window.showTextDocument(uri, {
          selection: new vscode.Range(target, target),
          preserveFocus: false,
        });
      });
  }

  /** A new run starting. Clears the panel's prior content immediately if a
   * panel already exists; creates nothing by itself — this run's own outputs
   * decide whether a panel is worth having at all.
   *
   * `origin` (Phase 4d) is this run's program origin, kept so a later
   * `revealFrame` message can be mapped back to an editor position. Optional
   * only so tests that never exercise click-to-jump can keep calling
   * `startRun()` bare; `src/run/commands.ts` always passes it. */
  startRun(origin?: ProgramOrigin): void {
    this.imageCount = 0;
    this.revealedThisRun = false;
    this.currentOrigin = origin;
    this.currentFrames = [];
    this.emit({ type: "reset" });
  }

  /** One streamed output. The first output in a run that is not already
   * fully visible as plain text creates the panel if it does not exist yet,
   * and brings it to the front either way — ADR-0021's reveal policy is
   * per-run, not "only the run that happened to create the panel": a panel
   * left open but unfocused from an earlier run must still come forward for
   * a later run's first qualifying output. */
  writeOutput(output: RichOutput): void {
    if (output.mime === "image/png") this.imageCount += 1;
    const item = toRenderItem(
      output,
      {
        imageAlt: (index) => vscode.l10n.t("Output image {0}", String(index)),
        tracebackHeading: () => vscode.l10n.t("Traceback"),
        tracebackFrame: (frame) =>
          vscode.l10n.t(
            "{0}, line {1}, in {2}",
            frame.file,
            String(frame.line),
            frame.name,
          ),
      },
      this.imageCount,
    );

    // Phase 4d: keep this run's structured frames so a `revealFrame` message
    // for one of them can be resolved. A run only ever streams one
    // traceback output (`procPython.ts`'s single trailing `RichOutput`), but
    // a last-writer-wins assignment is correct even if that ever changes.
    if (item.kind === "traceback") this.currentFrames = item.frames;

    if (!this.revealedThisRun && !isAlreadyVisibleAsText(output)) {
      this.revealedThisRun = true;
      if (this.panel === undefined) {
        this.open();
      } else {
        this.panel.reveal(vscode.ViewColumn.Beside, true);
      }
    }
    this.emit({ type: "output", item });
  }

  /** The run's own conclusion. Never opens the panel by itself — the output
   * channel already shows this in full, so an outcome-only run stays quiet,
   * per the reveal policy. */
  writeOutcome(outcome: ExecutionOutcome): void {
    const summary = outcome.succeeded
      ? vscode.l10n.t("Finished.")
      : vscode.l10n.t("Finished with an error.");
    this.emit(outcomeMessage(outcome, summary));
  }

  /** A run, cancel or reset that never reached an outcome. Same non-opening
   * rule as {@link writeOutcome}. */
  writeFailure(problem: BackendProblem): void {
    this.emit({ type: "failure", message: localiseBackendProblem(problem) });
  }

  dispose(): void {
    this.panel?.dispose();
  }

  /** Records `message` in this run's backlog and, if a ready panel already
   * exists, posts it immediately. A panel that exists but has not yet sent
   * its `"ready"` handshake gets nothing here — the handler wired in
   * {@link open} replays the whole backlog, in order, the moment `"ready"`
   * arrives, and that replay already includes whatever was just recorded. */
  private emit(message: ResultPanelMessage): void {
    if (message.type === "reset") this.backlog = [];
    this.backlog.push(message);
    if (this.panel !== undefined && this.ready) {
      void this.panel.webview.postMessage(message);
    }
  }

  /** Resolves a `revealFrame` message: look the frame up by the index the
   * webview sent, map it through 4c's `mapFrameToOrigin` against this run's
   * origin, and ask {@link ResultPanelDeps.revealPosition} to open the
   * editor there. Every step can legitimately produce nothing — no origin
   * (the panel was driven without a run), a stale or out-of-range index, or
   * a frame that is not a mappable `<string>` frame after all — and each is
   * a silent no-op rather than a wrong jump. */
  private revealFrame(frameIndex: number): void {
    const origin = this.currentOrigin;
    if (origin === undefined) return;
    const frame = this.currentFrames[frameIndex];
    if (frame === undefined) return;
    const position = mapFrameToOrigin(frame, origin);
    if (position === undefined) return;
    this.revealPosition(origin.uri, position);
  }

  /** Creates the panel (if one does not already exist) and reveals it. */
  private open(): void {
    const panel = this.createPanel();
    this.panel = panel;
    this.ready = false;

    panel.webview.html = this.buildHtml(panel.webview);

    this.panelSubscriptions.push(
      // The webview sends two message kinds, both host-validated here rather
      // than trusted: the `"ready"` handshake `src/webview/entry.ts` posts
      // once its listener is attached (ADR-0021), and — from Phase 4d — a
      // `revealFrame` for a clicked traceback frame. Neither is a
      // `ResultPanelMessage`; that union is the *other* direction (host to
      // webview). Anything that is neither is ignored.
      //
      // Replays the *whole* backlog, unconditionally, on every `"ready"` —
      // deliberately not guarded on `this.ready` already being `true`. A
      // `"ready"` can only ever be posted by `entry.ts`'s top-level script
      // running, which can only happen when the webview's document loads or
      // reloads; there is no other trigger. So every `"ready"` this handler
      // will ever see corresponds to a document that just went from
      // nonexistent to empty — including the hide/show reload
      // `retainContextWhenHidden: false` guarantees (see `createRealPanel`'s
      // own comment) — which is what makes an unconditional full replay
      // always correct rather than a source of duplicated content. Raised on
      // review: this reasoning was previously implicit rather than written
      // down anywhere a future change to `retainContextWhenHidden` would see it.
      panel.webview.onDidReceiveMessage((message) => {
        if (isRevealFrameMessage(message)) {
          this.revealFrame(message.frameIndex);
          return;
        }
        if (!isReady(message)) return;
        this.ready = true;
        for (const backlogged of this.backlog) {
          void panel.webview.postMessage(backlogged);
        }
      }),
      panel.onDidDispose(() => {
        for (const subscription of this.panelSubscriptions) {
          subscription.dispose();
        }
        this.panelSubscriptions = [];
        this.panel = undefined;
        this.ready = false;
        // The panel is gone — by this class' own `dispose()`, or by the user
        // closing the tab, indistinguishably from here. Either way this run's
        // one reveal is no longer "used up": if more rich output arrives
        // before the run ends, it should still bring a panel back rather than
        // silently going nowhere for the rest of the run. See
        // `revealedThisRun`'s own doc comment for how this was found.
        //
        // The two causes are not actually symmetric: this class' own
        // `dispose()` only ever runs from `RunCommandHandlers.dispose()`
        // (extension teardown), where `close()` on a still-busy backend is
        // deliberately fired, not awaited, so a straggling `writeOutput` can
        // still land after this handler runs and — now — resurrect a panel
        // during shutdown. That exposure already existed before this fix for
        // a run that had not revealed yet; this change only widens it to a
        // run that already had. Not worth guarding against on its own (VS
        // Code is already tearing the extension host down either way), but
        // worth naming rather than implying the two causes are equivalent.
        this.revealedThisRun = false;
      }),
    );

    panel.reveal(vscode.ViewColumn.Beside, true);
  }

  private createRealPanel(): ResultWebviewPanel {
    return vscode.window.createWebviewPanel(
      VIEW_TYPE,
      vscode.l10n.t("Result"),
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        // Explicit, not just the default, because the default is load-bearing
        // for `open()`'s "ready" handler below: `false` means VS Code discards
        // and reloads the webview's document whenever its tab is hidden and
        // shown again, which is what guarantees `src/webview/entry.ts` only
        // ever posts `"ready"` against a document that just went blank. If
        // this is ever flipped to `true` (to preserve scroll position, say),
        // the reasoning in `open()`'s comment stops holding and needs
        // revisiting alongside it — flip them together, not one at a time.
        retainContextWhenHidden: false,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, "dist", "webview"),
        ],
      },
    );
  }

  private buildHtml(webview: ResultWebviewPanel["webview"]): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.extensionUri,
        "dist",
        "webview",
        "resultPanel.js",
      ),
    );
    // The Web Crypto global, not `node:crypto`'s `randomUUID` — ADR-0003's
    // Node-builtins ban applies to this file (it is not on the three-file
    // allow-list, deliberately: this needs no widening of it). `crypto` here
    // resolves to Node's own global implementation of the same standard Web
    // Crypto API a browser exposes, so this call needs no import at all and
    // would keep working unchanged in a future web extension host.
    const nonce = crypto.randomUUID();
    const csp = [
      "default-src 'none';",
      `img-src ${webview.cspSource} data:;`,
      `style-src ${webview.cspSource} 'unsafe-inline';`,
      `script-src 'nonce-${nonce}';`,
    ].join(" ");

    // Match the document's declared language to the locale the panel's own
    // strings are rendered in (`vscode.l10n.t()` above), so a screen reader
    // announces localised content in the right voice. Filtered to the BCP-47
    // shape VS Code documents `env.language` returns ("en", "pt-br", …) with
    // an "en" fallback — this is interpolated into an HTML attribute, and a
    // VS Code-supplied value is not a reason to skip validating its shape.
    const lang = /^[a-z]{2,3}(-[a-z0-9]+)*$/i.test(vscode.env.language)
      ? vscode.env.language
      : "en";

    return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    padding: 4px 12px;
  }
  .python-on-viya-output-text {
    white-space: pre-wrap;
    font-family: var(--vscode-editor-font-family);
    margin: 4px 0;
  }
  .python-on-viya-output-image { max-width: 100%; }
  .python-on-viya-output-html table {
    border-collapse: collapse;
  }
  .python-on-viya-output-html td,
  .python-on-viya-output-html th {
    border: 1px solid var(--vscode-panel-border);
    padding: 2px 6px;
  }
  .python-on-viya-traceback-message,
  .python-on-viya-outcome-failure {
    color: var(--vscode-errorForeground);
  }
  .python-on-viya-outcome-success {
    color: var(--vscode-terminal-ansiGreen, var(--vscode-foreground));
  }
  .python-on-viya-traceback-frame-clickable {
    cursor: pointer;
    text-decoration: underline;
    color: var(--vscode-textLink-foreground);
  }
  .python-on-viya-traceback-frame-clickable:hover {
    color: var(--vscode-textLink-activeForeground, var(--vscode-textLink-foreground));
  }
  .python-on-viya-traceback-frame-clickable:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
  }
</style>
</head>
<body>
<div id="root" role="log" aria-live="polite"></div>
<script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
  }
}

function isReady(message: unknown): boolean {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: unknown }).type === "ready"
  );
}

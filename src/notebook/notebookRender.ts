// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Turns one streamed {@link RichOutput} into what phase 9c's notebook cell
 * output actually shows — the notebook-side counterpart to `../run/render.ts`
 * (the output channel) and `../run/resultPanelModel.ts` (the result panel).
 *
 * **This module must never import `vscode`.** Same split those two modules
 * already draw, and for the same reason: the decision of *what* a
 * `RichOutput` becomes is pure and fixture-tested here; turning a
 * {@link NotebookOutputPiece} into a real `vscode.NotebookCellOutputItem` is
 * `../notebookController.ts`'s own job, the one place in this seam that is
 * allowed to touch the notebook API.
 *
 * ## Why this does not reuse `render.ts`'s deferred/raw split
 *
 * `render.ts`'s `renderRichOutput` defers `text/html`/`image/png` to a
 * placeholder line, because the output channel it feeds is text-only by its
 * own plan text — it has no way to show real HTML or an image at all. A
 * notebook cell is not text-only: `docs/phases/phase-9.md`'s 9c Runbook entry
 * records the finding this module acts on — VS Code's own bundled
 * `notebook-renderers` extension (publisher `vscode`, not `ms-toolsai`,
 * confirmed live and by manifest inspection the same way 9a confirmed
 * `ipynb` needs no `ms-toolsai.jupyter`) already renders `text/html` and
 * `image/png` with `requiresMessaging: "never"` — no extension of any kind
 * has to be installed for either to show up. So there is nothing here to
 * defer: every mime arm this project's `RichOutput` union carries a real
 * rendering for becomes a real piece, the same total-over-the-union shape
 * `resultPanelModel.ts`'s `toRenderItem` already uses for the result panel.
 *
 * ## Why `application/vnd.python.traceback` still produces nothing
 *
 * Unchanged from 9b's own decision (`../notebookController.ts`'s doc
 * comment): the traceback's content already arrived as ordinary `text/plain`
 * output ahead of it (`logFilter.ts`'s `isNoiseLine` passes a real
 * exception's log lines straight through), and a raised cell already gets
 * VS Code's own red-X execution-failure indicator. Rendering it a second time
 * here would be the same information twice, not more of it readable.
 */

import type { RichOutput } from "../backend/backend";

/** One piece of cell output, reduced from {@link RichOutput} to exactly what
 * `../notebookController.ts`'s `appendRichOutput` needs to build a real
 * `vscode.NotebookCellOutputItem` — plain, serialisable data, the same
 * "reduce here, construct there" split `resultPanelModel.ts`'s `RenderItem`
 * already draws for the result panel. */
export type NotebookOutputPiece =
  | { readonly kind: "stdout"; readonly text: string }
  /** `markup` is inserted as real `text/html`, not escaped text — VS Code's
   * own built-in notebook renderer is what actually shows it; this module
   * only decides that it should. */
  | { readonly kind: "html"; readonly markup: string }
  /** `base64` is `RichOutput.data` verbatim — no data-URI prefix (that is a
   * result-panel/webview concern, `resultPanelModel.ts`'s own doc comment);
   * `appendRichOutput` decodes it straight to the `Uint8Array`
   * `NotebookCellOutputItem`'s constructor wants. */
  | { readonly kind: "image"; readonly base64: string };

/** What, if anything, one streamed {@link RichOutput} contributes to a
 * notebook cell. Total over `RichOutput`'s mime union, unlike `render.ts`'s
 * `renderRichOutput` — see this module's own doc comment for why a notebook
 * cell has nothing left to defer. */
export function toNotebookOutputPieces(
  output: RichOutput,
): readonly NotebookOutputPiece[] {
  switch (output.mime) {
    case "text/plain":
      return [{ kind: "stdout", text: output.data }];
    case "text/html":
      return [{ kind: "html", markup: output.data }];
    case "image/png":
      return [{ kind: "image", base64: output.data }];
    case "application/vnd.python.traceback":
      return [];
  }
}

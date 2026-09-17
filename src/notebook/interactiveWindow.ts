// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Phase 11a — the interactive window. `docs/phases/phase-11.md`'s own F7
 * write-up settled the shape: VS Code's real Interactive Window is reachable
 * from extension code only through the `interactiveWindow` *proposed* API,
 * which a published extension cannot use at all — so this builds a bespoke
 * surface on top of Phase 9's already-shipped {@link NOTEBOOK_TYPE}
 * (`jupyter-notebook`, ADR-0024) and its `NotebookController`
 * (`./notebookController.ts`), rather than integrating with the real thing.
 *
 * Two commands:
 *
 * - `pythonOnViya.openInteractiveWindow` creates (or reveals, if one is
 *   already open) a single, module-tracked *unsaved* notebook of
 *   {@link NOTEBOOK_TYPE} — `vscode.workspace.openNotebookDocument` with no
 *   backing file, the same mechanism behind VS Code's own "Untitled-1.ipynb".
 *   `controller.test.ts`'s own 9a regression already proves this mechanism
 *   end to end (a cell in exactly such a notebook reaches a terminal
 *   execution state via the real, activation-registered controller, with no
 *   Jupyter extension installed) — this module's own spike question was
 *   already settled before this slice started.
 * - `pythonOnViya.runSelectionInInteractiveWindow` appends the active
 *   editor's current selection as a new cell to that tracked notebook
 *   (creating one first if none is open) and runs it.
 *
 * **Deliberately mirrors `runSelection`'s own convention, not "Run
 * Selection/Line"**: `../run/commands.ts`'s `buildProgram` already decided,
 * for the existing Run Selection command, that an empty selection means
 * nothing to run (`selection.isEmpty` → `undefined`, no current-line
 * fallback) — its own editor/context menu entry is hidden via
 * `editorHasSelection` rather than falling back silently. This module makes
 * the same call for consistency: two "run selection" commands in one
 * extension that disagreed about what an empty selection means would be its
 * own, unrequested inconsistency. `phase-11.md`'s "Run Selection/Line"
 * phrasing follows VS Code's own command name for the real Interactive
 * Window; this implementation's own title says what it actually does.
 *
 * **One module-scoped tracked notebook, not a registry of many** — the same
 * "one slot is enough" reasoning `notebookController.ts`'s own doc comment
 * gives for `currentRun`, applied to a different question: VS Code's own
 * Interactive Window is conceptually "the" REPL for an interpreter, not a
 * pool the user is expected to manage, and nothing here has been asked to
 * support more than one at a time.
 *
 * **Kernel selection is asynchronous, and this module waits for it rather
 * than guessing a delay.** A freshly created notebook has no kernel selected
 * yet; `controller.test.ts`'s own 9a spike found the same thing and handled
 * it by polling `notebook.execute` in a loop until the cell settled.
 * `runSelectionInInteractiveWindow` uses the real signal instead —
 * `NotebookController.onDidChangeSelectedNotebooks` — bounded by
 * {@link CONTROLLER_SELECTION_TIMEOUT_MS} so a genuinely stuck selection
 * (for instance, another extension's own controller also registered against
 * {@link NOTEBOOK_TYPE}, forcing VS Code to show its kernel-picker UI instead
 * of auto-selecting) does not hang the command forever — the run is
 * attempted regardless once the wait ends, on the same reasoning
 * `controller.test.ts` gives for its own retries: the worst case is the same
 * one-time no-op VS Code's own kernel resolution can produce with no
 * extension of this project's own involved at all.
 */

import * as vscode from "vscode";

import { NOTEBOOK_TYPE } from "./notebookController";

/** How long `runSelectionInInteractiveWindow` waits for VS Code to finish
 * selecting the controller as a freshly created notebook's kernel before
 * asking it to run a cell anyway — see this module's own doc comment
 * ("Kernel selection is asynchronous …"). Matches `controller.test.ts`'s own
 * 9a spike's 10s budget for the same underlying asynchronous selection. */
const CONTROLLER_SELECTION_TIMEOUT_MS = 10_000;

/** Tracks the single interactive-window notebook this module manages —
 * module state, not `ExtensionContext.globalState`: an unsaved notebook has
 * no identity that survives a window reload anyway, so there is nothing
 * useful to persist. */
let tracked: vscode.NotebookDocument | undefined;

/** Returns the tracked notebook if it is still open, creating and tracking a
 * fresh one otherwise. Exported for the integration test's own direct use —
 * a real `NotebookDocument`, not a fake, is worth the ceremony here for the
 * same reason `execution.test.ts`'s own doc comment gives for keeping `cell`
 * real: faking one well enough to be trustworthy costs more than the real
 * thing does. */
export async function getOrCreateInteractiveWindow(): Promise<vscode.NotebookDocument> {
  if (tracked !== undefined && !tracked.isClosed) {
    return tracked;
  }
  const notebook = await vscode.workspace.openNotebookDocument(
    NOTEBOOK_TYPE,
    new vscode.NotebookData([]),
  );
  tracked = notebook;
  return notebook;
}

/** Waits for `controller` to become the selected kernel for `notebook` — see
 * this module's own doc comment on {@link CONTROLLER_SELECTION_TIMEOUT_MS}.
 * Resolves once either the selection event fires for this notebook or
 * `timeoutMs` elapses; the caller proceeds to ask VS Code to run the cell
 * either way. */
function waitForControllerSelection(
  controller: vscode.NotebookController,
  notebook: vscode.NotebookDocument,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    const subscription = controller.onDidChangeSelectedNotebooks((event) => {
      if (event.notebook === notebook && event.selected) {
        clearTimeout(timer);
        subscription.dispose();
        resolve();
      }
    });
    const timer = setTimeout(() => {
      subscription.dispose();
      resolve();
    }, timeoutMs);
  });
}

/** Reveals `notebook` beside the active editor without stealing its focus —
 * `preserveFocus: true` matches VS Code's own real Interactive Window, which
 * leaves the source editor focused after it opens or after a cell runs. */
async function reveal(notebook: vscode.NotebookDocument): Promise<void> {
  await vscode.window.showNotebookDocument(notebook, {
    viewColumn: vscode.ViewColumn.Beside,
    preserveFocus: true,
  });
}

/**
 * Opens (or reveals) the tracked interactive-window notebook.
 * `updateNotebookAffinity` runs on every call, not only on first creation —
 * cheap, and it re-asserts the preference if some other controller has
 * pushed itself forward in the meantime.
 */
export async function openInteractiveWindow(
  controller: vscode.NotebookController,
): Promise<void> {
  const notebook = await getOrCreateInteractiveWindow();
  controller.updateNotebookAffinity(
    notebook,
    vscode.NotebookControllerAffinity.Preferred,
  );
  await reveal(notebook);
}

/**
 * Appends the active editor's selection as a new cell on the tracked
 * interactive-window notebook (creating one if none is open) and runs it. A
 * no-op with nothing to run — no active editor, not a Python file, or an
 * empty selection — matching `runSelection`'s own convention (this module's
 * own doc comment).
 */
export async function runSelectionInInteractiveWindow(
  controller: vscode.NotebookController,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (editor?.document.languageId !== "python") return;
  if (editor.selection.isEmpty) return;
  const text = editor.document.getText(editor.selection);

  const notebook = await getOrCreateInteractiveWindow();
  controller.updateNotebookAffinity(
    notebook,
    vscode.NotebookControllerAffinity.Preferred,
  );
  await reveal(notebook);

  const index = notebook.cellCount;
  const edit = new vscode.WorkspaceEdit();
  edit.set(notebook.uri, [
    vscode.NotebookEdit.insertCells(index, [
      new vscode.NotebookCellData(vscode.NotebookCellKind.Code, text, "python"),
    ]),
  ]);
  await vscode.workspace.applyEdit(edit);

  await waitForControllerSelection(
    controller,
    notebook,
    CONTROLLER_SELECTION_TIMEOUT_MS,
  );
  await vscode.commands.executeCommand("notebook.cell.execute", {
    ranges: [{ start: index, end: index + 1 }],
    document: notebook.uri,
  });
}

/** Registers both commands and pushes their disposables onto
 * `context.subscriptions`. `controller` is the real, already-registered
 * {@link vscode.NotebookController} `registerNotebookController` built — this
 * module reuses it purely through its public surface
 * (`updateNotebookAffinity`/`onDidChangeSelectedNotebooks`), never reaching
 * into `notebookController.ts`'s own execution internals. */
export function registerInteractiveWindowCommands(
  context: vscode.ExtensionContext,
  controller: vscode.NotebookController,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("pythonOnViya.openInteractiveWindow", () =>
      openInteractiveWindow(controller),
    ),
    vscode.commands.registerCommand(
      "pythonOnViya.runSelectionInInteractiveWindow",
      () => runSelectionInInteractiveWindow(controller),
    ),
  );
}

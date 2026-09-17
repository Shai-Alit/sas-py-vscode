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
 * **Matches `runSelection`'s own convention exactly, not just in spirit**:
 * `../run/commands.ts`'s `buildProgram`/`runNow` already decided, for the
 * existing Run Selection command, that a non-Python active editor or an
 * empty (or whitespace-only) selection means nothing to run, and says so via
 * an informational message rather than silently doing nothing. This module
 * makes the identical calls — same two guard conditions, same two message
 * strings — for the same reason `buildProgram`'s own doc comment gives: two
 * "run selection" commands in one extension that disagreed about what an
 * empty selection means, or whether the user is told, would be its own,
 * unrequested inconsistency.
 *
 * **One module-scoped tracked notebook, not a registry of many** — the same
 * "one slot is enough" reasoning `notebookController.ts`'s own doc comment
 * gives for `currentRun`, applied to a different question: VS Code's own
 * Interactive Window is conceptually "the" REPL for an interpreter, not a
 * pool the user is expected to manage, and nothing here has been asked to
 * support more than one at a time.
 *
 * **Kernel selection is asynchronous, and this module tracks the real signal
 * instead of guessing a delay every time.** A freshly created notebook has no
 * kernel selected yet. Rather than the fixed-delay/poll-loop shape
 * `controller.test.ts`'s own 9a spike used, `registerInteractiveWindowCommands`
 * keeps one long-lived subscription to `NotebookController
 * .onDidChangeSelectedNotebooks` for the lifetime of the extension, recording
 * every notebook the controller has been selected for in
 * {@link selectedNotebooks}. A run against a notebook already in that set —
 * every run after the first into the same window, and even a first run if
 * VS Code's auto-selection happens to land before this function gets around
 * to checking — proceeds immediately; only a genuinely fresh selection pays
 * a bounded wait, via {@link waitForControllerSelection}, capped at
 * {@link CONTROLLER_SELECTION_TIMEOUT_MS} so a genuinely stuck selection
 * (for instance, another extension's own controller also registered against
 * {@link NOTEBOOK_TYPE}, forcing VS Code to show its kernel-picker UI instead
 * of auto-selecting) does not hang the command forever. The run is attempted
 * regardless once the wait ends; {@link executeCell} then retries the actual
 * `notebook.cell.execute` call once after a short pause and surfaces a
 * message if it still fails, rather than leaving a rejected promise to
 * VS Code's own raw command-failure notification.
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

/** The in-flight `openNotebookDocument()` call, while one is outstanding.
 * Without this, two calls to {@link getOrCreateInteractiveWindow} that both
 * land before the first `await` resolves would each see `tracked` as
 * `undefined` and each create their own notebook — the second orphaning the
 * first. Sharing the same promise means the second caller waits on the first
 * caller's own in-flight creation instead of starting a second one. Cleared
 * on both the success *and* the failure branch — a rejected
 * `openNotebookDocument()` call must not leave this permanently set, or every
 * later call would just re-await the same stale rejection until a window
 * reload. */
let creatingTracked: Promise<vscode.NotebookDocument> | undefined;

/** Serializes the read-`cellCount` → insert-cell → execute critical section
 * in {@link runSelectionInInteractiveWindow} (via {@link appendAndRunCell}).
 * Without this, two overlapping invocations — a keybinding double-fire, or
 * the command firing again before a previous call's edit/execute has settled
 * — could both read `notebook.cellCount` as the same index before either has
 * inserted, so one call's cell lands at the other's index and one of the two
 * appended cells never runs. This is the same class of race
 * {@link creatingTracked} guards against for notebook creation, applied to
 * appending and running a cell instead. Each call chains its own critical
 * section onto this promise and waits its turn; `.catch(() => undefined)`
 * keeps a prior call's own failure (already reported via its own
 * `showErrorMessage`) from wedging every later call out of its turn. */
let pendingRun: Promise<void> = Promise.resolve();

/** Notebooks `NotebookController.onDidChangeSelectedNotebooks` has reported
 * as selected — see this module's own doc comment on why a long-lived
 * subscription, rather than one created per call, is what lets a run against
 * an already-selected notebook skip the wait entirely. Cleared on
 * deselection or on the notebook closing, so this cannot grow unbounded
 * across many open/close cycles of the tracked notebook. */
const selectedNotebooks = new Set<vscode.NotebookDocument>();

/** Returns the tracked notebook if it is still open, creating and tracking a
 * fresh one otherwise. Not exported: every consumer of this module reaches
 * it only through the two registered commands below, and there is no other
 * caller — a real `NotebookDocument`, not a fake, is worth the ceremony in
 * `interactiveWindow.test.ts` for the same reason `execution.test.ts`'s own
 * doc comment gives for keeping `cell` real, but that test drives the
 * commands via `vscode.commands.executeCommand`, never this function
 * directly. */
async function getOrCreateInteractiveWindow(): Promise<vscode.NotebookDocument> {
  if (tracked !== undefined && !tracked.isClosed) {
    return tracked;
  }
  creatingTracked ??= Promise.resolve(
    vscode.workspace.openNotebookDocument(
      NOTEBOOK_TYPE,
      new vscode.NotebookData([]),
    ),
  ).then(
    (notebook) => {
      tracked = notebook;
      creatingTracked = undefined;
      return notebook;
    },
    (error: unknown) => {
      creatingTracked = undefined;
      throw error;
    },
  );
  return await creatingTracked;
}

/** Waits for `controller` to become the selected kernel for `notebook` — see
 * this module's own doc comment on {@link CONTROLLER_SELECTION_TIMEOUT_MS}
 * and {@link selectedNotebooks}. Resolves immediately if `notebook` is
 * already known-selected; otherwise resolves once the selection event fires
 * for this notebook or `timeoutMs` elapses. The caller proceeds to ask
 * VS Code to run the cell either way. */
function waitForControllerSelection(
  controller: vscode.NotebookController,
  notebook: vscode.NotebookDocument,
  timeoutMs: number,
): Promise<void> {
  if (selectedNotebooks.has(notebook)) {
    return Promise.resolve();
  }
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

/** The view column `notebook` is already visible in, if any — checked so
 * {@link reveal} can reuse it instead of always opening `ViewColumn.Beside`,
 * which would otherwise open a second editor of the same notebook whenever
 * it is invoked while some other column is active (for instance, from the
 * interactive window's own focused cell). */
function findVisibleColumn(
  notebook: vscode.NotebookDocument,
): vscode.ViewColumn | undefined {
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (
        tab.input instanceof vscode.TabInputNotebook &&
        tab.input.uri.toString() === notebook.uri.toString()
      ) {
        return group.viewColumn;
      }
    }
  }
  return undefined;
}

/** Reveals `notebook` without stealing focus from the active editor —
 * `preserveFocus: true` matches VS Code's own real Interactive Window, which
 * leaves the source editor focused after it opens or after a cell runs.
 * Opens beside the active editor only when `notebook` is not already visible
 * somewhere (see {@link findVisibleColumn}). */
async function reveal(notebook: vscode.NotebookDocument): Promise<void> {
  await vscode.window.showNotebookDocument(notebook, {
    viewColumn: findVisibleColumn(notebook) ?? vscode.ViewColumn.Beside,
    preserveFocus: true,
  });
}

/** A `WorkspaceEdit` that appends one code cell containing `text` at
 * `index`. */
function insertCellEdit(
  notebook: vscode.NotebookDocument,
  index: number,
  text: string,
): vscode.WorkspaceEdit {
  const edit = new vscode.WorkspaceEdit();
  edit.set(notebook.uri, [
    vscode.NotebookEdit.insertCells(index, [
      new vscode.NotebookCellData(vscode.NotebookCellKind.Code, text, "python"),
    ]),
  ]);
  return edit;
}

/** Runs the cell at `index`, retrying once after a short pause if
 * `notebook.cell.execute` rejects — kernel resolution can still be settling
 * even after `waitForControllerSelection`'s own bounded wait, the same race
 * `controller.test.ts`'s own 9a spike retries past. A failure that persists
 * past the retry is surfaced directly, rather than left to VS Code's own raw
 * command-failure notification. */
async function executeCell(
  notebook: vscode.NotebookDocument,
  index: number,
): Promise<void> {
  const args = {
    ranges: [{ start: index, end: index + 1 }],
    document: notebook.uri,
  };
  try {
    await vscode.commands.executeCommand("notebook.cell.execute", args);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      await vscode.commands.executeCommand("notebook.cell.execute", args);
    } catch {
      void vscode.window.showErrorMessage(
        vscode.l10n.t(
          "Could not run the new cell. Select it and run it manually.",
        ),
      );
    }
  }
}

/**
 * Opens (or reveals) the tracked interactive-window notebook.
 * `updateNotebookAffinity` runs on every call, not only on first creation —
 * cheap, and it re-asserts the preference if some other controller has
 * pushed itself forward in the meantime.
 */
async function openInteractiveWindow(
  controller: vscode.NotebookController,
): Promise<void> {
  let notebook: vscode.NotebookDocument;
  try {
    notebook = await getOrCreateInteractiveWindow();
  } catch {
    void vscode.window.showErrorMessage(
      vscode.l10n.t("Could not open the interactive window. Try again."),
    );
    return;
  }
  controller.updateNotebookAffinity(
    notebook,
    vscode.NotebookControllerAffinity.Preferred,
  );
  await reveal(notebook);
}

/** The read-`cellCount` → insert-cell → execute critical section of
 * {@link runSelectionInInteractiveWindow}, run only from inside
 * {@link pendingRun}'s queue — see that variable's own doc comment for why
 * this must never run concurrently with itself. `notebook` is the caller's
 * already-created, already-revealed tracked notebook; this only reassigns
 * its own local `target` if that notebook turns out to have closed by the
 * time this call reaches the front of the queue. */
async function appendAndRunCell(
  controller: vscode.NotebookController,
  notebook: vscode.NotebookDocument,
  text: string,
): Promise<void> {
  let target = notebook;
  let index = target.cellCount;
  if (
    !(await vscode.workspace.applyEdit(insertCellEdit(target, index, text)))
  ) {
    // The tracked notebook closed between the isClosed check inside
    // getOrCreateInteractiveWindow and this edit; retry once against a fresh
    // one rather than executing a cell range that was never inserted.
    if (tracked === target) tracked = undefined;
    try {
      target = await getOrCreateInteractiveWindow();
    } catch {
      void vscode.window.showErrorMessage(
        vscode.l10n.t("Could not open the interactive window. Try again."),
      );
      return;
    }
    controller.updateNotebookAffinity(
      target,
      vscode.NotebookControllerAffinity.Preferred,
    );
    await reveal(target);
    index = target.cellCount;
    if (
      !(await vscode.workspace.applyEdit(insertCellEdit(target, index, text)))
    ) {
      void vscode.window.showErrorMessage(
        vscode.l10n.t("Could not add the new cell. Try again."),
      );
      return;
    }
  }

  await waitForControllerSelection(
    controller,
    target,
    CONTROLLER_SELECTION_TIMEOUT_MS,
  );
  await executeCell(target, index);
}

/**
 * Appends the active editor's selection as a new cell on the tracked
 * interactive-window notebook (creating one if none is open) and runs it. A
 * no-op with an informational message — no active editor, not a Python
 * file, or an empty selection — matching `runSelection`'s own convention
 * (this module's own doc comment).
 */
async function runSelectionInInteractiveWindow(
  controller: vscode.NotebookController,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (editor?.document.languageId !== "python") {
    void vscode.window.showInformationMessage(
      vscode.l10n.t("Open a Python file to run it on SAS Viya."),
    );
    return;
  }
  const text = editor.document.getText(editor.selection);
  if (editor.selection.isEmpty || text.trim() === "") {
    void vscode.window.showInformationMessage(
      vscode.l10n.t("Select some code to run."),
    );
    return;
  }

  let notebook: vscode.NotebookDocument;
  try {
    notebook = await getOrCreateInteractiveWindow();
  } catch {
    void vscode.window.showErrorMessage(
      vscode.l10n.t("Could not open the interactive window. Try again."),
    );
    return;
  }
  controller.updateNotebookAffinity(
    notebook,
    vscode.NotebookControllerAffinity.Preferred,
  );
  await reveal(notebook);

  const run = pendingRun
    .catch(() => undefined)
    .then(() => appendAndRunCell(controller, notebook, text));
  pendingRun = run.catch(() => undefined);
  await run;
}

/** Registers both commands and pushes their disposables onto
 * `context.subscriptions`. `controller` is the real, already-registered
 * {@link vscode.NotebookController} `registerNotebookController` built — this
 * module reuses it purely through its public surface
 * (`updateNotebookAffinity`/`onDidChangeSelectedNotebooks`), never reaching
 * into `notebookController.ts`'s own execution internals.
 *
 * Also sets up the two long-lived subscriptions {@link selectedNotebooks}
 * relies on: one records every notebook `controller` is selected or
 * un-selected for, the other clears an entry when its notebook closes so the
 * set cannot grow unbounded across repeated open/close cycles of the tracked
 * notebook (see "Reopening after close" in `interactiveWindow.test.ts`). */
export function registerInteractiveWindowCommands(
  context: vscode.ExtensionContext,
  controller: vscode.NotebookController,
): void {
  context.subscriptions.push(
    controller.onDidChangeSelectedNotebooks((event) => {
      if (event.selected) {
        selectedNotebooks.add(event.notebook);
      } else {
        selectedNotebooks.delete(event.notebook);
      }
    }),
    vscode.workspace.onDidCloseNotebookDocument((notebook) => {
      selectedNotebooks.delete(notebook);
    }),
    vscode.commands.registerCommand("pythonOnViya.openInteractiveWindow", () =>
      openInteractiveWindow(controller),
    ),
    vscode.commands.registerCommand(
      "pythonOnViya.runSelectionInInteractiveWindow",
      () => runSelectionInInteractiveWindow(controller),
    ),
  );
}

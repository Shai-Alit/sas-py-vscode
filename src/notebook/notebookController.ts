// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Phase 9a: registers a {@link vscode.NotebookController} against VS Code's
 * own `jupyter-notebook` notebook type. This extension contributes no
 * {@link vscode.NotebookSerializer} of its own — per
 * [ADR-0024](../../docs/adr/0024-notebooks-are-ipynb-native.md), `.ipynb`
 * stays a real, portable Jupyter notebook, and `.ipynb` serialization is
 * already owned by VS Code's own bundled `vscode.ipynb` extension.
 *
 * ## The dependency question this file settles
 *
 * `docs/phases/phase-9.md`'s 9a spike asked whether that bundled serializer —
 * and a controller registered against it — needs `ms-toolsai.jupyter`
 * installed at all. A hands-on spike (a throwaway `NotebookController`
 * contributing no serializer, run in a clean VS Code profile with
 * `--extensions-dir` empty — no `ms-toolsai.jupyter`, nothing else) opened
 * `.ipynb`, auto-selected the controller as the notebook's only candidate
 * kernel, and executed a cell through it end to end. **`ms-toolsai.jupyter`
 * is not a dependency of this feature**, confirming ADR-0024 without an
 * amendment; see `phase-9.md`'s 9a Runbook entry for the full account.
 *
 * ## What this controller does *not* do yet
 *
 * Wiring `executeHandler` to a real {@link import("../backend/backend").ExecutionBackend}
 * — reusing the same session and namespace `pythonOnViya.runFile` already
 * holds, with `freshNamespace: false` — is 9b's own slice, gated on lifting
 * `backends`/`backendFor` out of `createRunCommandHandlers`'s private closure
 * in `src/run/commands.ts` first (`phase-9.md`'s Plan section explains why
 * that refactor has to land before the controller can share state with Run
 * File rather than duplicating it). Until then, running a cell here reports a
 * clear, deliberate "not yet" rather than a raw VS Code error — the point of
 * shipping 9a on its own is proving the controller is real, discoverable,
 * and selectable, not that it can already run Python.
 */

import * as vscode from "vscode";

/** The id VS Code's kernel picker and `NotebookController.dispose()` key on. */
export const NOTEBOOK_CONTROLLER_ID = "pythonOnViya.viyaNotebookKernel";

/** Owned by VS Code's own bundled `vscode.ipynb` extension, not this one. */
export const NOTEBOOK_TYPE = "jupyter-notebook";

/**
 * Registers the controller and pushes it on `context.subscriptions`. Returns
 * the controller so a later slice (9b) can reach it to assign the real
 * `executeHandler` without re-registering.
 */
export function registerNotebookController(
  context: vscode.ExtensionContext,
  log: vscode.LogOutputChannel,
): vscode.NotebookController {
  const controller = vscode.notebooks.createNotebookController(
    NOTEBOOK_CONTROLLER_ID,
    NOTEBOOK_TYPE,
    vscode.l10n.t("Python on Viya"),
  );
  controller.supportedLanguages = ["python"];
  controller.supportsExecutionOrder = true;
  controller.description = vscode.l10n.t(
    "Run notebook cells on SAS Viya (execution lands in a later release)",
  );
  controller.executeHandler = runCellsNotYetImplemented;
  context.subscriptions.push(controller);

  log.info(
    vscode.l10n.t(
      "Notebook kernel registered against the {0} notebook type.",
      NOTEBOOK_TYPE,
    ),
  );

  return controller;
}

/**
 * 9a's placeholder `executeHandler`: marks every requested cell as a clean,
 * explained failure rather than leaving `executeHandler` unset (which VS Code
 * would surface as its own generic "no execute handler" error) or silently
 * succeeding with no output. Replaced outright, not extended, once 9b wires
 * real execution.
 */
function runCellsNotYetImplemented(
  cells: vscode.NotebookCell[],
  _notebook: vscode.NotebookDocument,
  controller: vscode.NotebookController,
): void {
  for (const cell of cells) {
    const execution = controller.createNotebookCellExecution(cell);
    execution.start(Date.now());
    execution.replaceOutput([
      new vscode.NotebookCellOutput([
        vscode.NotebookCellOutputItem.error(
          new Error(
            vscode.l10n.t(
              "Running notebook cells on SAS Viya isn't implemented yet.",
            ),
          ),
        ),
      ]),
    ]);
    execution.end(false, Date.now());
  }
}

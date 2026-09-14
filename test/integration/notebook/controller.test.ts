// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import * as vscode from "vscode";

import { NOTEBOOK_TYPE } from "../../../src/notebook/notebookController";
import { extensionId } from "../../helpers/manifest";

/**
 * Phase 9a's own spike, kept as a permanent regression rather than a one-off
 * check: this test host launches with `--disable-extensions` (`runTest.ts`),
 * so nothing but this extension and VS Code's own built-ins is present —
 * including the `vscode.ipynb` extension that owns `jupyter-notebook`
 * serialization. No `ms-toolsai.jupyter` is installed.
 *
 * `notebookController.ts` registers only a `NotebookController` against that
 * pre-existing type — no serializer of its own. If that controller were not
 * real, or VS Code required `ms-toolsai.jupyter` to select any kernel for a
 * `jupyter-notebook`, running a cell below would either throw or leave the
 * cell execution stuck pending forever, never reaching a terminal state. See
 * `docs/phases/phase-9.md`'s 9a Runbook entry for the account of the
 * hands-on spike this test formalises.
 *
 * Phase 9b replaced the placeholder `executeHandler` this test used to pin
 * with real execution (`notebookController.ts`'s own doc comment), so this
 * test no longer asserts on a specific message — that would only be testing
 * `sessions.connect()`'s own "no active profile" wording, a detail
 * `execution.test.ts`'s own suite (against a recorded connection, not the
 * real, profile-less test host) is the right place to pin, not this one.
 * What stays worth proving here, permanently, is the 9a spike's own claim: a
 * cell run through the *real*, activation-registered controller reaches a
 * terminal state with no Jupyter extension installed at all.
 */
describe("notebook controller (9a/9b)", () => {
  it("is auto-selected and reaches a terminal execution state with no Jupyter extension installed", async () => {
    const extension = vscode.extensions.getExtension(extensionId());
    assert.ok(extension);
    await extension.activate();

    const notebook = await vscode.workspace.openNotebookDocument(
      NOTEBOOK_TYPE,
      new vscode.NotebookData([
        new vscode.NotebookCellData(
          vscode.NotebookCellKind.Code,
          "print('hello from the phase 9 integration test')",
          "python",
        ),
      ]),
    );
    await vscode.window.showNotebookDocument(notebook);

    // Kernel resolution and auto-selection happen asynchronously after the
    // editor opens; poll rather than guess a fixed delay.
    const cell = notebook.cellAt(0);
    const deadline = Date.now() + 10_000;
    let lastError: unknown;
    while (Date.now() < deadline) {
      try {
        await vscode.commands.executeCommand("notebook.execute");
      } catch (error) {
        lastError = error;
      }
      if (cell.executionSummary !== undefined) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    assert.ok(
      cell.executionSummary !== undefined,
      `The cell never reached a terminal execution state within 10s (no controller was selected as the notebook's kernel, or the run never settled). Last error: ${String(lastError)}`,
    );
  });
});

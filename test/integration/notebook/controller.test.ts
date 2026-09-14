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
 * cell with no output at all. See `docs/phases/phase-9.md`'s 9a Runbook
 * entry for the account of the hands-on spike this test formalises.
 */
describe("notebook controller (9a)", () => {
  it("is auto-selected and executes a cell with no Jupyter extension installed", async () => {
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
      if (cell.outputs.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    assert.ok(
      cell.outputs.length > 0,
      `No output appeared on the cell within 10s (no controller was selected as the notebook's kernel). Last error: ${String(lastError)}`,
    );

    const output = cell.outputs[0];
    assert.ok(output);
    const item = output.items[0];
    assert.ok(item);
    assert.equal(
      item.mime,
      "application/vnd.code.notebook.error",
      `Expected the 9a placeholder controller's error output; got mime "${item.mime}" instead — a different kernel may have been selected.`,
    );

    const decoded: unknown = JSON.parse(new TextDecoder().decode(item.data));
    assert.equal(
      (decoded as { message: string }).message,
      "Running notebook cells on SAS Viya isn't implemented yet.",
    );
  });
});

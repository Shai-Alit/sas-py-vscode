// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Phase 11a's own regression, in the same spirit as `controller.test.ts`'s
 * 9a spike: this test host launches with `--disable-extensions`
 * (`runTest.ts`), so `NOTEBOOK_TYPE` has exactly one candidate controller —
 * this extension's own — with nothing to contend kernel selection against.
 *
 * Both commands are driven through `vscode.commands.executeCommand`, the
 * same public surface a real command-palette invocation uses, rather than by
 * importing `openInteractiveWindow`/`runSelectionInInteractiveWindow`
 * directly: `registerInteractiveWindowCommands` closes over the real,
 * activation-registered `NotebookController`, and there is no exported way
 * to get at that same instance from outside `extension.ts` — nor should
 * there be, since `interactiveWindow.ts`'s own doc comment is explicit that
 * this module reaches the controller only through its public surface.
 *
 * **This suite does not assume it is the only thing that has ever opened a
 * `NOTEBOOK_TYPE` notebook in this test host.** `controller.test.ts` and
 * `execution.test.ts` (9a/9b/9c) each open several of their own and never
 * close them, so by the time this suite runs, `vscode.workspace
 * .notebookDocuments` already holds many `jupyter-notebook` documents that
 * have nothing to do with this module — a first version of this test learned
 * that the hard way (`length === 1` failed with 18). Every assertion below
 * either diffs against a snapshot taken immediately before the action under
 * test, or holds onto the specific `NotebookDocument` reference this
 * module's own commands hand back (via that diff), and never re-derives "the"
 * notebook by re-filtering the whole workspace a second time.
 *
 * The two tests below share this file's module-scoped extension-host state
 * (`interactiveWindow.ts`'s own tracked notebook) deliberately, in that
 * order: the first proves a fresh open, the second proves reuse across two
 * separate command invocations — the exact behaviour a real user gets by
 * running two selections in a row without closing the window in between.
 */

import assert from "node:assert/strict";

import * as vscode from "vscode";

import { NOTEBOOK_TYPE } from "../../../src/notebook/notebookController";
import { extensionId } from "../../helpers/manifest";

/** Every `NOTEBOOK_TYPE` notebook currently open in this test host —
 * including ones earlier suites opened and never closed. Callers diff
 * against a snapshot of this rather than trusting its length alone. */
function interactiveNotebooks(): readonly vscode.NotebookDocument[] {
  return vscode.workspace.notebookDocuments.filter(
    (notebook) => notebook.notebookType === NOTEBOOK_TYPE,
  );
}

/** The `NOTEBOOK_TYPE` notebooks present now that were not in `baseline`. */
function newInteractiveNotebooks(
  baseline: ReadonlySet<vscode.NotebookDocument>,
): vscode.NotebookDocument[] {
  return interactiveNotebooks().filter((notebook) => !baseline.has(notebook));
}

/** Polls until `predicate` holds or `deadline` passes — the same "kernel
 * selection is asynchronous" shape `controller.test.ts`'s own 9a spike
 * polls for, applied here to a cell reaching a terminal execution state. */
async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(predicate(), `condition not met within ${String(timeoutMs)}ms`);
}

describe("interactive window (11a)", () => {
  // Set by the first test, read by the second — see this file's own doc
  // comment on why the second test holds onto this reference rather than
  // re-deriving "the" notebook from `interactiveNotebooks()` a second time.
  let theNotebook: vscode.NotebookDocument | undefined;

  before(async () => {
    const extension = vscode.extensions.getExtension(extensionId());
    assert.ok(extension);
    await extension.activate();
  });

  it("openInteractiveWindow opens exactly one new, visible, unsaved notebook of NOTEBOOK_TYPE", async () => {
    const baseline = new Set(interactiveNotebooks());
    await vscode.commands.executeCommand("pythonOnViya.openInteractiveWindow");

    const created = newInteractiveNotebooks(baseline);
    assert.equal(
      created.length,
      1,
      "opening the interactive window should create exactly one new notebook",
    );
    theNotebook = created[0];
    assert.ok(theNotebook);
    assert.equal(theNotebook.isUntitled, true);
    assert.equal(theNotebook.cellCount, 0);
  });

  it("runSelectionInInteractiveWindow appends and runs the selection as a new cell on that same notebook, reusing it across calls, and no-ops with nothing selected", async function () {
    // Two full run-and-settle cycles, each with its own bounded
    // `waitUntil` (kernel selection is asynchronous — see
    // `interactiveWindow.ts`'s own doc comment), can together approach the
    // suite's default 20s budget (`test/integration/index.ts`) with no
    // margin left for the commands themselves.
    this.timeout(40_000);
    assert.ok(
      theNotebook,
      "the previous test must have created the tracked notebook",
    );
    const notebook = theNotebook;

    const document = await vscode.workspace.openTextDocument({
      language: "python",
      content: "print('cell one')\nprint('cell two')",
    });
    const editor = await vscode.window.showTextDocument(document);

    // No selection: a no-op, matching `runSelection`'s own convention
    // (`interactiveWindow.ts`'s own doc comment) — no new cell, and no new
    // notebook either.
    editor.selection = new vscode.Selection(0, 0, 0, 0);
    const baselineForNoOp = new Set(interactiveNotebooks());
    await vscode.commands.executeCommand(
      "pythonOnViya.runSelectionInInteractiveWindow",
    );
    assert.equal(notebook.cellCount, 0);
    assert.equal(newInteractiveNotebooks(baselineForNoOp).length, 0);

    // First real selection: line 1. Reuses `notebook`, not a fresh one.
    const baselineForFirstRun = new Set(interactiveNotebooks());
    editor.selection = new vscode.Selection(
      0,
      0,
      0,
      "print('cell one')".length,
    );
    await vscode.commands.executeCommand(
      "pythonOnViya.runSelectionInInteractiveWindow",
    );

    assert.equal(
      newInteractiveNotebooks(baselineForFirstRun).length,
      0,
      "running a selection should reuse the tracked notebook, not create a second one",
    );
    assert.equal(notebook.cellCount, 1);
    assert.equal(notebook.cellAt(0).document.getText(), "print('cell one')");
    await waitUntil(() => notebook.cellAt(0).executionSummary !== undefined);

    // Second selection: line 2, still the same tracked notebook.
    editor.selection = new vscode.Selection(
      1,
      0,
      1,
      "print('cell two')".length,
    );
    await vscode.commands.executeCommand(
      "pythonOnViya.runSelectionInInteractiveWindow",
    );

    assert.equal(notebook.cellCount, 2);
    assert.equal(notebook.cellAt(1).document.getText(), "print('cell two')");
    await waitUntil(() => notebook.cellAt(1).executionSummary !== undefined);
  });
});

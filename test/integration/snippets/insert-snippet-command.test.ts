// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * `createInsertViyaSnippet` (`src/snippets/insertSnippetCommand.ts`, 13d) —
 * built directly with stubbed dependencies, as
 * `test/integration/cas/sql-passthrough-command.test.ts` does for its own
 * command. The library's parser and the shipped file are
 * `test/unit/snippet-library.test.ts`'s job; this file covers the `vscode`
 * plumbing: the real file read from the extension's root, what the picker
 * is offered, a real `SnippetString` landing in the editor, and every path
 * that reports instead.
 */

import assert from "node:assert/strict";
import path from "node:path";

import * as vscode from "vscode";

import {
  createInsertViyaSnippet,
  type SnippetPickItem,
} from "../../../src/snippets/insertSnippetCommand";

/** The repository root, which holds `snippets/python.json` as the
 * installed extension's root does. Tests run from `out/test/integration`. */
const ROOT = vscode.Uri.file(path.resolve(__dirname, "../../../.."));

async function document(language: string): Promise<vscode.TextEditor> {
  const doc = await vscode.workspace.openTextDocument({
    language,
    content: "",
  });
  return await vscode.window.showTextDocument(doc);
}

describe("pythonOnViya.insertViyaSnippet (13d)", () => {
  it("offers every snippet in the library and inserts the chosen one with its placeholders", async () => {
    const editor = await document("python");
    const reports: string[] = [];
    let offered: readonly SnippetPickItem[] = [];
    let options: vscode.QuickPickOptions | undefined;
    const insert = createInsertViyaSnippet(ROOT, {
      report: (message) => reports.push(message),
      pick: (items, opts) => {
        offered = items;
        options = opts;
        return Promise.resolve(
          items.find((i) => i.label === "Write a SAS table"),
        );
      },
    });

    await insert();

    assert.deepEqual(reports, []);
    assert.equal(offered.length, 12);
    assert.deepEqual(
      offered.map((i) => i.description),
      offered.map((i) => i.entry.prefix),
    );
    assert.equal(options?.matchOnDetail, true);
    assert.equal(editor.document.getText(), 'SAS.df2sd(df, "work.results")');
  });

  it("inserts nothing when the picker is dismissed", async () => {
    const editor = await document("python");
    const reports: string[] = [];
    const insert = createInsertViyaSnippet(ROOT, {
      report: (message) => reports.push(message),
      pick: () => Promise.resolve(undefined),
    });

    await insert();

    assert.deepEqual(reports, []);
    assert.equal(editor.document.getText(), "");
  });

  it("reports and shows no picker when there is no active text editor", async () => {
    const reports: string[] = [];
    let picked = false;
    const insert = createInsertViyaSnippet(ROOT, {
      activeTextEditor: () => undefined,
      report: (message) => reports.push(message),
      pick: () => {
        picked = true;
        return Promise.resolve(undefined);
      },
    });

    await insert();

    assert.equal(reports.length, 1);
    assert.match(reports[0] ?? "", /Open a Python file/);
    assert.equal(picked, false);
  });

  it("reports and inserts nothing when the active editor is not a Python file", async () => {
    const editor = await document("markdown");
    const reports: string[] = [];
    const insert = createInsertViyaSnippet(ROOT, {
      report: (message) => reports.push(message),
    });

    await insert();

    assert.equal(reports.length, 1);
    assert.match(reports[0] ?? "", /Open a Python file/);
    assert.equal(editor.document.getText(), "");
  });

  it("reports when the library cannot be read", async () => {
    await document("python");
    const reports: string[] = [];
    const insert = createInsertViyaSnippet(ROOT, {
      report: (message) => reports.push(message),
      readLibrary: () => Promise.reject(new Error("gone")),
    });

    await insert();

    assert.equal(reports.length, 1);
    assert.match(reports[0] ?? "", /Could not read the snippet library: gone/);
  });

  it("reports when the library is malformed", async () => {
    await document("python");
    const reports: string[] = [];
    const insert = createInsertViyaSnippet(ROOT, {
      report: (message) => reports.push(message),
      readLibrary: () => Promise.resolve("[]"),
    });

    await insert();

    assert.equal(reports.length, 1);
    assert.match(
      reports[0] ?? "",
      /Could not read the snippet library: it is not a JSON object/,
    );
  });

  it("is registered as a command", async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("pythonOnViya.insertViyaSnippet"));
  });
});

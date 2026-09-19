// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * `createInsertCasSqlPassthroughSnippet` (`src/cas/casSqlPassthroughCommand.ts`,
 * 11b) — constructed directly with stubbed dependencies, the same pattern
 * `test/integration/cas/connect-command.test.ts` uses for its own command,
 * since this file imports `vscode` and the coverage gate does not see it.
 * `buildCasSqlPassthroughSnippet`'s own template is
 * `test/unit/cas-sql-passthrough-snippet.test.ts`'s job; this file's job is
 * the `vscode` plumbing around it: which editor gets the snippet, that it
 * lands as a real, tabstop-bearing `SnippetString` rather than plain text,
 * and that a non-Python/no editor state reports instead of doing nothing.
 */

import assert from "node:assert/strict";

import * as vscode from "vscode";

import {
  createInsertCasSqlPassthroughSnippet,
  type CasSqlPassthroughProfiles,
} from "../../../src/cas/casSqlPassthroughCommand";

async function pythonDocument(): Promise<vscode.TextEditor> {
  const document = await vscode.workspace.openTextDocument({
    language: "python",
    content: "",
  });
  return await vscode.window.showTextDocument(document);
}

async function markdownDocument(): Promise<vscode.TextEditor> {
  const document = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: "",
  });
  return await vscode.window.showTextDocument(document);
}

const PROFILES: CasSqlPassthroughProfiles = {
  active: () => ({
    name: "default",
    profile: { version: 1, id: "p1", endpoint: "https://viya.example.test" },
  }),
};
const CONNECTED = { current: () => ({}) };
const NOT_CONNECTED = { current: () => undefined };

describe("pythonOnViya.insertCasSqlPassthroughSnippet (11b)", () => {
  it("inserts the pass-through snippet, with its tabstop placeholders in place, at the cursor", async () => {
    const editor = await pythonDocument();
    const reports: string[] = [];
    const insertCasSqlPassthroughSnippet = createInsertCasSqlPassthroughSnippet(
      CONNECTED,
      PROFILES,
      { report: (message) => reports.push(message) },
    );

    await insertCasSqlPassthroughSnippet();

    assert.deepEqual(reports, []);
    const text = editor.document.getText();
    assert.match(text, /conn\.loadactionset\("fedsql"\)/);
    assert.match(
      text,
      /select \* from connection to CASLIB \(select \* from native_table\)/,
    );
  });

  it("reports and inserts nothing when there is no active text editor", async () => {
    const reports: string[] = [];
    const insertCasSqlPassthroughSnippet = createInsertCasSqlPassthroughSnippet(
      CONNECTED,
      PROFILES,
      {
        activeTextEditor: () => undefined,
        report: (message) => reports.push(message),
      },
    );

    await insertCasSqlPassthroughSnippet();

    assert.equal(reports.length, 1);
    assert.match(reports[0] ?? "", /Open a Python file/);
  });

  it("reports and inserts nothing when the active editor is not a Python file", async () => {
    const editor = await markdownDocument();
    const reports: string[] = [];
    const insertCasSqlPassthroughSnippet = createInsertCasSqlPassthroughSnippet(
      CONNECTED,
      PROFILES,
      { report: (message) => reports.push(message) },
    );

    await insertCasSqlPassthroughSnippet();

    assert.equal(reports.length, 1);
    assert.match(reports[0] ?? "", /Open a Python file/);
    assert.equal(editor.document.getText(), "");
  });

  it("warns to connect first, and inserts nothing, when there is no live session (11.12)", async () => {
    const editor = await pythonDocument();
    const reports: string[] = [];
    const insertCasSqlPassthroughSnippet = createInsertCasSqlPassthroughSnippet(
      NOT_CONNECTED,
      PROFILES,
      { report: (message) => reports.push(message) },
    );

    await insertCasSqlPassthroughSnippet();

    assert.equal(reports.length, 1);
    assert.match(reports[0] ?? "", /Connect to SAS Viya first/);
    assert.equal(editor.document.getText(), "");
  });
});

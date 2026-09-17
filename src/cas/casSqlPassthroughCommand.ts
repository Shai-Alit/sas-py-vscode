// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The `pythonOnViya.insertCasSqlPassthroughSnippet` command — 11b's own
 * entry point, alongside the documentation `docs/cas-python-connection.md`
 * gained for the same slice.
 *
 * Deliberately far smaller than `casConnectCommand.ts` (8b): that command
 * needs a live Compute session to write a fresh token into, so it makes up
 * to five network round trips behind a cancellable progress notification.
 * This one needs none — the snippet it inserts is a fixed template
 * (`sqlPassthroughSnippet.ts`) with two user-filled tabstops, assuming the
 * user already has a `conn` from 8b's own command in the same file. The only
 * two things worth checking before inserting are the same two
 * `casConnectCommand.ts` checks first: is there an active editor, and is it
 * a Python file. `enablement: pythonOnViya.connected` in `package.json` (not
 * checked again here) keeps the command out of the palette when there is no
 * connection for a `conn` to have come from, matching 8b's own gating,
 * even though this command's own body never touches the connection itself.
 *
 * Same "handlers factory, thin registration shell" split as
 * `casConnectCommand.ts`'s own `createInsertCasConnectionSnippet`/
 * `registerCasConnectCommand`, for the same reason: a test builds the
 * handler directly with its own fakes rather than going through
 * `vscode.commands.registerCommand`.
 */

import * as vscode from "vscode";

import { buildCasSqlPassthroughSnippet } from "./sqlPassthroughSnippet";

/**
 * The ports this module would otherwise reach for on the `vscode` namespace
 * directly — same reasoning as `CasConnectCommandDeps`.
 */
export interface CasSqlPassthroughCommandDeps {
  /** Defaults to `vscode.window.activeTextEditor`. */
  activeTextEditor?: (() => vscode.TextEditor | undefined) | undefined;
  /** Defaults to `vscode.window.showErrorMessage`. */
  report?: ((message: string) => void) | undefined;
}

/**
 * Builds the command's behaviour as a callable function — no
 * `vscode.commands.registerCommand` call inside it. See this module's own
 * doc comment for why.
 */
export function createInsertCasSqlPassthroughSnippet(
  deps: CasSqlPassthroughCommandDeps = {},
): () => Promise<void> {
  const activeTextEditor =
    deps.activeTextEditor ?? (() => vscode.window.activeTextEditor);
  const report =
    deps.report ??
    ((message: string) => void vscode.window.showErrorMessage(message));

  return async function insertCasSqlPassthroughSnippet(): Promise<void> {
    const editor = activeTextEditor();
    if (editor?.document.languageId !== "python") {
      report(
        vscode.l10n.t("Open a Python file first, then run this command again."),
      );
      return;
    }

    await editor.insertSnippet(
      new vscode.SnippetString(buildCasSqlPassthroughSnippet()),
    );
  };
}

/**
 * Registers the command against the real `vscode.commands` registry — the
 * thin shell `extension.ts` calls at activation. The disposable is pushed on
 * `context.subscriptions`.
 */
export function registerCasSqlPassthroughCommand(
  context: vscode.ExtensionContext,
  deps: CasSqlPassthroughCommandDeps = {},
): void {
  const insertCasSqlPassthroughSnippet =
    createInsertCasSqlPassthroughSnippet(deps);
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "pythonOnViya.insertCasSqlPassthroughSnippet",
      insertCasSqlPassthroughSnippet,
    ),
  );
}

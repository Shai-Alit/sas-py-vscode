// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The `pythonOnViya.insertViyaSnippet` command (13d): a picker of this
 * extension's own snippets, inserted at the cursor.
 *
 * VS Code's own **Insert Snippet** lists every Python snippet from every
 * extension; this one lists only `snippets/python.json`, which it reads at
 * each use (see `library.ts`). It needs no connection: a snippet is text,
 * and the two that use `conn` say so in their description.
 *
 * Same "handlers factory, thin registration shell" split as
 * `src/cas/casSqlPassthroughCommand.ts`, so a test builds the handler with
 * its own fakes.
 */

import * as vscode from "vscode";

import { parseSnippetLibrary, type SnippetEntry } from "./library";

/** Where the library is, under the extension's root. */
export const SNIPPET_FILE_PATH = ["snippets", "python.json"] as const;

/** The ports this command would otherwise reach for on `vscode` directly. */
export interface InsertViyaSnippetDeps {
  /** Defaults to `vscode.window.activeTextEditor`. */
  activeTextEditor?: (() => vscode.TextEditor | undefined) | undefined;
  /** Defaults to `vscode.window.showErrorMessage`. */
  report?: ((message: string) => void) | undefined;
  /** Reads the library file's text. Defaults to `vscode.workspace.fs`. */
  readLibrary?: (() => Promise<string>) | undefined;
  /** Defaults to `vscode.window.showQuickPick`. */
  pick?:
    | ((
        items: readonly SnippetPickItem[],
        options: vscode.QuickPickOptions,
      ) => Thenable<SnippetPickItem | undefined>)
    | undefined;
}

/** A picker row, carrying the entry it inserts. */
export interface SnippetPickItem extends vscode.QuickPickItem {
  readonly entry: SnippetEntry;
}

/**
 * Builds the command's behaviour as a callable function, without
 * registering it.
 */
export function createInsertViyaSnippet(
  extensionUri: vscode.Uri,
  deps: InsertViyaSnippetDeps = {},
): () => Promise<void> {
  const activeTextEditor =
    deps.activeTextEditor ?? (() => vscode.window.activeTextEditor);
  const report =
    deps.report ??
    ((message: string) => void vscode.window.showErrorMessage(message));
  const readLibrary =
    deps.readLibrary ??
    (async () =>
      new TextDecoder().decode(
        await vscode.workspace.fs.readFile(
          vscode.Uri.joinPath(extensionUri, ...SNIPPET_FILE_PATH),
        ),
      ));
  const pick =
    deps.pick ??
    ((items: readonly SnippetPickItem[], options: vscode.QuickPickOptions) =>
      vscode.window.showQuickPick(items, options));

  return async function insertViyaSnippet(): Promise<void> {
    const editor = activeTextEditor();
    if (editor?.document.languageId !== "python") {
      report(
        vscode.l10n.t("Open a Python file first, then run this command again."),
      );
      return;
    }

    let text: string;
    try {
      text = await readLibrary();
    } catch (error) {
      report(
        vscode.l10n.t(
          "Could not read the snippet library: {0}",
          error instanceof Error ? error.message : String(error),
        ),
      );
      return;
    }
    const library = parseSnippetLibrary(text);
    if (!library.ok) {
      report(
        vscode.l10n.t(
          "Could not read the snippet library: {0}",
          library.reason,
        ),
      );
      return;
    }

    const chosen = await pick(
      library.entries.map((entry) => ({
        label: entry.name,
        description: entry.prefix,
        detail: entry.description,
        entry,
      })),
      {
        placeHolder: vscode.l10n.t("Choose a snippet to insert"),
        matchOnDescription: true,
        matchOnDetail: true,
      },
    );
    if (chosen === undefined) return;

    await editor.insertSnippet(new vscode.SnippetString(chosen.entry.body));
  };
}

/**
 * Registers the command against the real `vscode.commands` registry — the
 * thin shell `extension.ts` calls at activation.
 */
export function registerInsertViyaSnippetCommand(
  context: vscode.ExtensionContext,
  deps: InsertViyaSnippetDeps = {},
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "pythonOnViya.insertViyaSnippet",
      createInsertViyaSnippet(context.extensionUri, deps),
    ),
  );
}

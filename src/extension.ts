// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";

/**
 * Activation is deliberately cheap and deliberately rare.
 *
 * `activationEvents` is empty: VS Code activates us implicitly when one of our
 * contributed commands is invoked. In particular we do NOT declare
 * `onLanguage:python`, which would activate this extension for every Python
 * user on every Python file — including the overwhelming majority who have no
 * SAS Viya deployment at all.
 */
export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Python on Viya", {
    log: true,
  });
  context.subscriptions.push(output);

  output.info(vscode.l10n.t("Python on Viya activated."));

  context.subscriptions.push(
    vscode.commands.registerCommand("pythonOnViya.showOutputChannel", () => {
      output.show(true);
    }),
  );
}

export function deactivate(): void {
  // Nothing to tear down: every disposable is registered on
  // context.subscriptions, which VS Code disposes for us.
}

// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";

import { registerProfileCommands } from "./profile/commands";
import { createProfileStatusBarItem } from "./profile/statusBar";
import { ProfileStore } from "./profile/store";

/**
 * Activation is deliberately cheap and deliberately rare.
 *
 * `activationEvents` is empty, and that is correct, not an oversight. Since
 * VS Code 1.74 a command listed in `contributes.commands` activates its
 * extension implicitly; a matching `onCommand:` entry is redundant boilerplate.
 * We require ^1.104.0, and the upstream SAS extension ships 52 commands with
 * zero `onCommand` events. See docs/dev/building.md before "fixing" this.
 *
 * We also do NOT declare `onLanguage:python`, which would activate this
 * extension for every Python user on every Python file — including the
 * overwhelming majority who have no SAS Viya deployment at all.
 */
export function activate(context: vscode.ExtensionContext): void {
  // The channel name is localised even though it is largely a product name:
  // it appears in the Output dropdown alongside every other extension's
  // channel, and upstream localises its own ("SAS Log"). Translators can leave
  // it unchanged where that reads better.
  const output = vscode.window.createOutputChannel(
    vscode.l10n.t("Python on Viya"),
    { log: true },
  );
  context.subscriptions.push(output);

  output.info(vscode.l10n.t("Python on Viya activated."));

  context.subscriptions.push(
    vscode.commands.registerCommand("pythonOnViya.showOutputChannel", () => {
      output.show(true);
    }),
  );

  // Profiles are read on demand rather than cached at activation, so nothing
  // here touches the settings file or the secret store. Constructing the store
  // only registers a configuration listener.
  const profiles = new ProfileStore(context, output);
  context.subscriptions.push(profiles, createProfileStatusBarItem(profiles));
  registerProfileCommands(context, profiles, output);
}

export function deactivate(): void {
  // Nothing to tear down: every disposable is registered on
  // context.subscriptions, which VS Code disposes for us.
}

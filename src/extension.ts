// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";

import {
  registerAuthProvider,
  ViyaAuthenticationProvider,
} from "./auth/authProvider";
import { registerAuthCommands } from "./auth/commands";
import { SessionStore } from "./auth/sessionStore";
import { registerAuthUriHandler } from "./auth/uriHandler";
import { registerProfileCommands } from "./profile/commands";
import { createProfileStatusBarItem } from "./profile/statusBar";
import { ProfileStore } from "./profile/store";

/**
 * Activation is deliberately cheap, and happens once per window.
 *
 * The only declared event is `onStartupFinished`, and it is load-bearing rather
 * than defensive. A command in `contributes.commands` activates its extension
 * implicitly — since VS Code 1.74 an `onCommand:` entry is redundant, and there
 * are none here for that reason — but a *reloaded window* runs no command, so
 * with no startup event nothing registers the authentication provider, VS Code
 * has nobody to ask for sessions, and a signed-in user comes back to an empty
 * Accounts menu. That was the observed behaviour on 2026-08-14: sign-in worked,
 * a reload lost it, and the token in the keychain was never the problem. The
 * event fires after the window is up, so it costs no startup time, and this
 * function touches neither the network nor the secret store.
 *
 * We still do NOT declare `onLanguage:python`, which would activate this
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

  // One URI handler for the whole extension, registered here rather than inside
  // the sign-in flow: VS Code allows exactly one, and an attempt-scoped handler
  // means the second sign-in of a session either fails to register or replaces
  // the first. It dispatches to whichever attempts are outstanding.
  const authCallbacks = registerAuthUriHandler(context, output);

  // The provider owns signing in and out; the commands are wrappers over it, and
  // the Accounts menu talks to it directly. Registering it does not read a
  // secret or touch the network — VS Code calls `getSessions` when something
  // asks, which on a fresh window is the first time the Accounts menu is opened.
  const auth = new ViyaAuthenticationProvider(
    context.extension.id,
    profiles,
    new SessionStore(context.secrets, output),
    authCallbacks,
    output,
  );
  registerAuthProvider(context, auth);
  registerAuthCommands(context, auth, profiles, output);
}

export function deactivate(): void {
  // Nothing to tear down: every disposable is registered on
  // context.subscriptions, which VS Code disposes for us.
}

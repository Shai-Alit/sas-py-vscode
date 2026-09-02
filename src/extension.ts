// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";

import {
  registerAuthProvider,
  ViyaAuthenticationProvider,
} from "./auth/authProvider";
import { buildCaAgent, certificatePathsFrom } from "./auth/caAgent";
import { registerAuthCommands } from "./auth/commands";
import { SessionStore } from "./auth/sessionStore";
import { createNodeHttpTransport } from "./auth/transport";
import { registerAuthUriHandler } from "./auth/uriHandler";
import { SessionBindingStore } from "./compute/bindingStore";
import { registerComputeCommands } from "./compute/commands";
import { ComputeSessionManager } from "./compute/sessionManager";
import { registerProfileCommands } from "./profile/commands";
import { ProfileStore } from "./profile/store";
import { registerRunCommands } from "./run/commands";
import { createEnvironmentStatusBarItem } from "./run/environmentStatusBar";
import { EnvironmentStore } from "./run/environmentStore";
import { createRunTargetStatusBarItem } from "./run/statusBar";
import { RunTargetStore } from "./run/targetStore";

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

  // Slice 5d-i (the deferred 1c-ii): a deployment behind a private certificate
  // authority — or one that serves an incomplete chain — is unreachable until
  // its CA is trusted. `pythonOnViya.userProvidedCertificates` names PEM files
  // to add to a dedicated HTTPS agent used only by this extension's requests,
  // never `https.globalAgent` (which upstream's CAHelper.ts mutates, changing
  // what every other extension trusts). Read once, here: a change takes effect
  // on the next window reload. An unreadable path is logged and the rest are
  // still used. Read as `unknown` and coerced in `caAgent.ts` (as
  // `connectionProfiles` is) so a mistyped machine-scoped value cannot throw
  // out of activation; `caAgent.ts` owns the `node:fs` read so this file stays
  // free of Node built-ins (ADR-0003).
  const certificatePaths = certificatePathsFrom(
    vscode.workspace
      .getConfiguration("pythonOnViya")
      .get<unknown>("userProvidedCertificates"),
  );
  const { agent: caAgent, failures: caFailures } =
    buildCaAgent(certificatePaths);
  for (const failure of caFailures) {
    output.warn(
      vscode.l10n.t(
        "Could not read the CA certificate at {0}: {1}",
        failure.path,
        failure.reason,
      ),
    );
  }
  if (caAgent !== undefined) {
    // Only reached when the setting named at least one readable cert. Closes
    // idle keep-alive sockets on window teardown; a no-op when the proxy patch
    // replaced the agent, harmless when it did not.
    context.subscriptions.push({
      dispose: () => {
        caAgent.destroy();
      },
    });
  }
  const transport = createNodeHttpTransport(
    caAgent === undefined ? {} : { agent: caAgent },
  );

  // Profiles are read on demand rather than cached at activation, so nothing
  // here touches the settings file or the secret store. Constructing the store
  // only registers a configuration listener.
  const profiles = new ProfileStore(context, output);
  context.subscriptions.push(profiles);
  registerProfileCommands(context, profiles, output);

  // The run target (ADR-0011): local vs. Viya, kept separately from — but
  // reading — the active profile. Its own workspaceState key, never a
  // setting; see `RunTargetStore`'s own doc comment.
  const runTargets = new RunTargetStore(context, profiles);
  context.subscriptions.push(
    runTargets,
    createRunTargetStatusBarItem(profiles, runTargets),
  );

  // 3e's stage-2 capability cache: per-profile, `globalState`-backed, and
  // never refreshed except when a command explicitly asks — see
  // `environmentStore.ts`'s own doc comment.
  const environment = new EnvironmentStore(context);
  context.subscriptions.push(createEnvironmentStatusBarItem(runTargets));

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
    { token: { transport }, identity: { transport } },
  );
  registerAuthProvider(context, auth);

  // The compute session, and the workspace's memory of it. Constructing either
  // reads nothing: the binding is read when a connect asks for it, and the token
  // comes from the authentication provider at request time. Nothing here starts
  // a session, and a window that never runs Python never opens one.
  const sessions = new ComputeSessionManager(
    profiles,
    new SessionBindingStore(context.workspaceState, output),
    output,
    { transport },
  );
  context.subscriptions.push(sessions);
  const { connect, disconnect, forgetProfile } = registerComputeCommands(
    context,
    sessions,
    profiles,
    output,
  );

  // Registered last, and only because signing in connects (and signing out
  // disconnects, added in Phase 3's 3f slice): the commands need a way to
  // open and end a session, and handing them one keeps the dependency
  // pointing from auth to compute in one place rather than giving the
  // provider — which VS Code's Accounts menu also calls — the ability to
  // start or stop a SAS process. The disconnect is bound to its quiet mode:
  // a user who ran Sign Out and never opened a session should get one
  // confirmation toast, not a second "nothing to disconnect" one.
  registerAuthCommands(context, auth, profiles, output, connect, () =>
    disconnect({ quiet: true }),
  );

  // The palette's Sign Out command re-syncs `pythonOnViya.connected` itself
  // (via the disconnect above). A sign-out through VS Code's Accounts menu
  // never reaches that command — it calls the provider directly — so without
  // this listener it would leave the cached connection and the context key
  // exactly as the palette bug did before 3f: Connect hidden, no way back.
  // The provider issues one session per profile and its id *is* the profile
  // id, so a removed session names the profile whose connection is now dead.
  context.subscriptions.push(
    auth.onDidChangeSessions((event) => {
      for (const removed of event.removed ?? []) {
        forgetProfile(removed.id);
      }
    }),
  );

  // Slice 3d-i: the commands that actually run Python on Viya. `connect` is
  // the same wrapper `registerAuthCommands` above was given — reusing it,
  // rather than `sessions.connect` directly, is what keeps
  // `pythonOnViya.connected` honest when a run auto-connects instead of the
  // user pressing Connect first. `forgetProfile` (3f) is the same idea for
  // the opposite direction: when a run/reset/probe discovers its own
  // connection is gone (`BackendProblem` `backend-gone`), it tells
  // `src/compute` to drop it and re-sync the context key, rather than
  // leaving Connect hidden until the user finds Disconnect on their own.
  registerRunCommands(
    context,
    {
      connect,
      isBusy: (profileId) => sessions.isBusy(profileId),
      startSubmission: (profileId) => sessions.startSubmission(profileId),
      endSubmission: (profileId) => {
        sessions.endSubmission(profileId);
      },
      forgetProfile,
    },
    profiles,
    runTargets,
    environment,
    output,
  );
}

export function deactivate(): void {
  // Nothing to tear down: every disposable is registered on
  // context.subscriptions, which VS Code disposes for us.
}

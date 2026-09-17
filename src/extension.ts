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
import { registerCasConnectCommand } from "./cas/casConnectCommand";
import { registerCasExplorer } from "./cas/casExplorer";
import { registerCasSqlPassthroughCommand } from "./cas/casSqlPassthroughCommand";
import { registerComputeCommands } from "./compute/commands";
import { ComputeSessionManager } from "./compute/sessionManager";
import { registerContentExplorer } from "./content/contentExplorer";
import { registerDataExplorer } from "./data/dataExplorer";
import { DataViewerPanelManager } from "./data/dataViewerPanel";
import { TablePropertiesPanelManager } from "./data/tablePropertiesPanel";
import { registerInteractiveWindowCommands } from "./notebook/interactiveWindow";
import { registerNotebookController } from "./notebook/notebookController";
import { registerProfileCommands } from "./profile/commands";
import { ProfileStore } from "./profile/store";
import { createBackendCache } from "./run/backendCache";
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

  // ADR-0035: the notebook controller's own compute session, entirely
  // separate from `sessions` above. `PROC PYTHON` has exactly one interpreter
  // namespace per session, so a notebook (which must persist across its own
  // cells) and Run File (which resets on every whole-file run,
  // `freshNamespace: true` since Phase 3) cannot safely share one — the
  // 2026-09-14 manual pass found that collision the hard way when 9b's first
  // cut gave them the same session. Built from the same `profiles`/`transport`
  // (it follows the same active profile Run File does — there is still no
  // per-notebook profile choice, `notebookController.ts`'s own doc comment),
  // but its own `SessionBindingStore` namespaced `"notebook"` so a reload
  // reattaches to *this* session and not Run File's (`binding.ts`'s own doc
  // comment on `sessionBindingKey`'s `purpose` parameter). See
  // `notebookController.ts`'s own doc comment for the full account.
  const notebookSessions = new ComputeSessionManager(
    profiles,
    new SessionBindingStore(context.workspaceState, output, "notebook"),
    output,
    { transport },
  );
  context.subscriptions.push(notebookSessions);

  const { connect, disconnect, forgetProfile, onDidChangeConnection } =
    registerComputeCommands(
      context,
      sessions,
      profiles,
      output,
      notebookSessions,
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
  const runSessions = {
    connect,
    isBusy: (profileId: string) => sessions.isBusy(profileId),
    startSubmission: (profileId: string) => sessions.startSubmission(profileId),
    endSubmission: (profileId: string) => {
      sessions.endSubmission(profileId);
    },
    forgetProfile,
  };

  // Phase 9b: a `BackendCache` for Run File's own `sessions` — see
  // `./run/backendCache`'s own doc comment. Disposed here, not by the
  // registrar it is handed to: `registerRunCommands` takes it via its own
  // `backendCache` dep, the same rule `RunCommandDeps`'s other injectable
  // fields already follow, which means it does not own the cache's lifecycle.
  const backendCache = createBackendCache(runSessions, output);
  context.subscriptions.push(backendCache);

  // ADR-0035: the notebook controller's own `BackendCache`, wrapping
  // `notebookSessions` above rather than `sessions` — a second, independent
  // one-backend-per-profile cache, not a second handle onto Run File's. See
  // `notebookController.ts`'s own doc comment for why they were split.
  const notebookRunSessions = {
    connect: () => notebookSessions.connect(),
    isBusy: (profileId: string) => notebookSessions.isBusy(profileId),
    startSubmission: (profileId: string) =>
      notebookSessions.startSubmission(profileId),
    endSubmission: (profileId: string) => {
      notebookSessions.endSubmission(profileId);
    },
  };
  const notebookBackendCache = createBackendCache(notebookRunSessions, output);
  context.subscriptions.push(notebookBackendCache);

  registerRunCommands(
    context,
    runSessions,
    profiles,
    runTargets,
    environment,
    output,
    // Phase 5d-iv: clear the Problems collection when a profile is signed out.
    // `onDidSignOut` fires only on the deliberate path (palette / Accounts
    // menu), not on `onDidChangeSessions`'s diff, which also drops a profile a
    // slow renewal missed for one poll.
    { onDidSignOut: auth.onDidSignOut, backendCache },
  );

  // Phase 6a-ii: the read-only SAS Content tree in its own activity-bar view.
  // Independent of the compute session — it talks to the Folders/Files
  // services with the active profile's endpoint and a silent token — so it is
  // registered from here with the same `transport` (the 5d-i CA agent) and the
  // auth events it refreshes on, not threaded through `sessions`.
  registerContentExplorer(
    context,
    profiles,
    output,
    {
      onDidChangeSessions: auth.onDidChangeSessions,
      onDidSignOut: auth.onDidSignOut,
    },
    { transport },
  );

  // Phase 7b: the data viewer's own panel manager — one `WebviewPanel` per
  // open table (`src/data/dataViewerPanel.ts`, ADR-0028), constructed here so
  // its lifetime is the extension's own and every panel it opens is disposed
  // on deactivation via `context.subscriptions` (wired inside
  // `registerDataExplorer`, which owns the command that calls `.open`).
  // Constructed before `registerCasExplorer` below (8c): both the "SAS
  // Libraries" and "CAS" trees' own `openTable`/`openCasTable` commands share
  // this one manager, each wrapping its own adapter in a `TableSource`
  // (`LibraryTableSource`/`CasTableSource`) rather than each owning a
  // separate panel manager.
  const dataViewerPanels = new DataViewerPanelManager(context.extensionUri, {
    log: output,
  });

  // Phase 8a: the read-only CAS browsing tree, a third view inside the same
  // activity-bar container. Like SAS Content and unlike SAS Libraries, this
  // needs no compute session and opens no CAS session of its own (Finding
  // 8.2, ADR-0033) — an endpoint and a silent token are enough — so it is
  // registered the same way SAS Content is, with the same `transport`.
  // Phase 8c: also takes `dataViewerPanels` — a CAS table node's own
  // `pythonOnViya.openCasTable` command opens it in the same panel manager
  // the "SAS Libraries" tree's `openTable` already shares.
  const casExplorer = registerCasExplorer(
    context,
    profiles,
    output,
    {
      onDidChangeSessions: auth.onDidChangeSessions,
      onDidSignOut: auth.onDidSignOut,
    },
    dataViewerPanels,
    { transport },
  );

  // Phase 8b: unlike 8a's browsing tree, this command needs a live Compute
  // session — the token it delivers has to land inside one
  // (`src/compute/casToken.ts`) — so it is wired against `sessions` here
  // rather than alongside 8a above. Reuses 8a's own endpoint-keyed adapter
  // cache (`casExplorer.session`) rather than building a second one.
  registerCasConnectCommand(context, sessions, casExplorer.session, profiles);

  // Phase 11b: a fixed-template companion to 8b's command above, needing no
  // session/profile/adapter of its own — see `casSqlPassthroughCommand.ts`'s
  // own doc comment for why it is this much smaller.
  registerCasSqlPassthroughCommand(context);

  // Phase 7c-ii: the table properties/columns panel manager — fully static
  // (`src/data/tablePropertiesPanel.ts`), so unlike `dataViewerPanels` above
  // it needs no `extensionUri` (no bundled script/stylesheet) and no `log`
  // (a failed fetch renders its own message directly in the panel, the same
  // choice `dataViewerPanel.ts`'s own initial-load failure path already
  // makes).
  const tablePropertiesPanels = new TablePropertiesPanelManager();

  // Phase 7a: the read-only "SAS Libraries" tree, a second view inside the
  // same activity-bar container 6a-ii created (the phase file's own
  // coordination note — 6a landed first). Unlike SAS Content, this is
  // genuinely bound to the compute session (ADR-0027), so it is handed
  // `sessions` itself — read through per call, never held — and refreshes on
  // `onDidChangeConnection`, which `registerComputeCommands` above fires
  // whenever connect, disconnect or a run's own `forgetProfile` changes what
  // the active profile's session is.
  registerDataExplorer(
    context,
    profiles,
    sessions,
    output,
    {
      onDidChangeSessions: auth.onDidChangeSessions,
      onDidSignOut: auth.onDidSignOut,
      onDidChangeConnection,
    },
    dataViewerPanels,
    tablePropertiesPanels,
  );

  // Phase 9a: a NotebookController against VS Code's own `jupyter-notebook`
  // type — no serializer of this extension's own, per ADR-0024. The 9a spike
  // (`phase-9.md`) confirmed this needs no `ms-toolsai.jupyter` dependency.
  // Phase 9b: real execution, against `notebookBackendCache` — this
  // controller's own cache, wrapping its own compute session, not Run File's
  // (ADR-0035; `notebookController.ts`'s own doc comment).
  const notebookController = registerNotebookController(
    context,
    output,
    notebookBackendCache,
  );

  // Phase 11a: the interactive window, built on 9a's own `NOTEBOOK_TYPE` and
  // this controller — see `interactiveWindow.ts`'s own doc comment for why
  // this is a bespoke surface rather than VS Code's real Interactive Window.
  registerInteractiveWindowCommands(context, notebookController);
}

export function deactivate(): void {
  // Nothing to tear down: every disposable is registered on
  // context.subscriptions, which VS Code disposes for us.
}

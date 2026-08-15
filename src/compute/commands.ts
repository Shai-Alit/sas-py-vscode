// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The connect and disconnect commands.
 *
 * Thin, on the same principle as `src/auth/commands.ts`: the manager decides
 * everything and these two say what happened. Both act on the *active* profile
 * without asking, because the active profile is already in the status bar and a
 * picker here would be a second place to change something the user has chosen
 * once already.
 *
 * ## Why there is a Connect command at all
 *
 * Nothing in the design requires the user to press it — slice 3a's run command
 * connects if it needs to, which is the path almost everyone will take. It is
 * here because connecting is the first thing that reaches a deployment with real
 * credentials, and a user who has just added a profile wants to know it works
 * before they trust it with a file. Upstream has the same command for the same
 * reason.
 *
 * ## `pythonOnViya.connected`, and what it is for
 *
 * A context key, set here rather than inside the manager, because it is a fact
 * about the *window's UI* rather than about the session: it drives command
 * enablement in `package.json` so that Disconnect is greyed out when there is
 * nothing to disconnect. It follows the active profile, so switching to a
 * profile with no session clears it while the first session stays alive.
 */

import * as vscode from "vscode";

import type { ProfileStore } from "../profile/store";
import type {
  ComputeConnection,
  ComputeSessionManager,
} from "./sessionManager";

/** Set true while the active profile holds a session in this window. */
export const CONNECTED_CONTEXT_KEY = "pythonOnViya.connected";

/** What the commands read from the profile store, and nothing else. */
export type ComputeCommandProfiles = Pick<
  ProfileStore,
  "active" | "onDidChange"
>;

/**
 * Connect the active profile, and leave the enablement key telling the truth.
 *
 * Handed to the sign-in command so that signing in reaches a session (#134)
 * without `src/auth` learning what a compute session is. It deliberately shows
 * no message: the caller has just done something of its own and gets to say how
 * the two outcomes read as one sentence.
 */
export type ConnectActiveProfile = () => Promise<ComputeConnection | undefined>;

export function registerComputeCommands(
  context: vscode.ExtensionContext,
  sessions: ComputeSessionManager,
  profiles: ComputeCommandProfiles,
  log: vscode.LogOutputChannel,
): ConnectActiveProfile {
  const sync = () => {
    void syncConnectedContext(sessions, profiles);
  };

  const connect: ConnectActiveProfile = async () => {
    const connection = await sessions.connect();
    sync();
    return connection;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("pythonOnViya.connect", async () => {
      const connection = await connect();
      if (connection === undefined) return;
      void vscode.window.showInformationMessage(
        vscode.l10n.t(
          'Connected to SAS Viya using profile "{0}".',
          connection.profileName,
        ),
      );
    }),
    vscode.commands.registerCommand("pythonOnViya.disconnect", async () => {
      await sessions.disconnect();
      sync();
    }),
    // The key follows the active profile, not just this window's own connects:
    // switching profile changes which session — if any — the commands would act
    // on, and an enablement that disagreed with that would offer Disconnect for
    // a session the command cannot see.
    profiles.onDidChange(sync),
  );

  log.debug("registered the compute session commands");
  sync();

  return connect;
}

async function syncConnectedContext(
  sessions: ComputeSessionManager,
  profiles: ComputeCommandProfiles,
): Promise<void> {
  const active = profiles.active();
  const connected =
    active !== undefined && sessions.current(active.profile.id) !== undefined;
  await vscode.commands.executeCommand(
    "setContext",
    CONNECTED_CONTEXT_KEY,
    connected,
  );
}

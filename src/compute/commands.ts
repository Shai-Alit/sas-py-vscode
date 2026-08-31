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
 * enablement in `package.json` so that Disconnect is not offered when there is
 * nothing to disconnect — VS Code answers a false `enablement` by leaving the
 * command out of the Command Palette entirely, so the entry disappears rather
 * than dimming. It follows the active profile, so switching to a profile with
 * no session clears it while the first session stays alive.
 *
 * ## Keeping it honest from outside this module
 *
 * `connect` and `disconnect` below both re-sync the key after acting, which
 * covers every path that goes through them — including `signIn`'s own
 * `connect` call in `src/auth/commands.ts`. **Fixed 2026-08-28 (Phase 3's 3f
 * slice): `signOut` did not.** It revoked the token but never told this
 * module a session might need dropping, so `pythonOnViya.connected` (and the
 * cached connection itself) stayed exactly as they were — Connect stayed
 * hidden, and the next run failed against a session whose token had just
 * been pulled out from under it, with `Disconnect` the only way back to a
 * state Connect would even appear in. `signOut` now takes this module's
 * `disconnect` the same way `signIn` already takes `connect`. Separately,
 * `forgetProfile` exists for a session that dies on its *own* terms — an
 * idle reap, mid-window — discovered independently by a run that tried to
 * use it; see `ComputeSessionManager.forget`'s own doc comment.
 *
 * `forgetProfile` is also what `extension.ts` calls from the provider's
 * `onDidChangeSessions` event, so a sign-out through VS Code's **Accounts
 * menu** — which talks to the provider directly and never reaches
 * `pythonOnViya.signOut` — drops the dead connection and re-syncs the key
 * too, rather than only the palette's own Sign Out command doing so.
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

/** What `registerComputeCommands` hands other command modules, so they can
 * keep `pythonOnViya.connected` honest for actions that live outside this
 * file — `signIn`/`signOut` in `src/auth/commands.ts`, and a run/reset/probe
 * in `src/run/commands.ts` that discovers its own connection is gone. */
export interface ComputeCommandHandles {
  readonly connect: ConnectActiveProfile;
  /** Ends the active profile's session (if any) and re-syncs the context
   * key. What `signOut` calls, mirroring `signIn`'s own `connect` — passing
   * `{ quiet: true }`, so a sign-out with no session open in this window
   * stays a single confirmation toast rather than two. */
  readonly disconnect: (options?: { quiet?: boolean }) => Promise<void>;
  /** Drops a profile's cached connection — `ComputeSessionManager.forget` —
   * and re-syncs the context key. What a run/reset/probe calls on
   * `BackendProblem` `backend-gone`, so Connect reappears immediately rather
   * than staying hidden until the user finds Disconnect first. */
  readonly forgetProfile: (profileId: string) => void;
}

export function registerComputeCommands(
  context: vscode.ExtensionContext,
  sessions: ComputeSessionManager,
  profiles: ComputeCommandProfiles,
  log: vscode.LogOutputChannel,
): ComputeCommandHandles {
  const sync = () => {
    void syncConnectedContext(sessions, profiles);
  };

  const connect: ConnectActiveProfile = async () => {
    const connection = await sessions.connect();
    sync();
    return connection;
  };

  const disconnect = async (options?: { quiet?: boolean }): Promise<void> => {
    await sessions.disconnect(options);
    sync();
  };

  const forgetProfile = (profileId: string): void => {
    sessions.forget(profileId);
    sync();
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
    vscode.commands.registerCommand("pythonOnViya.disconnect", () =>
      disconnect(),
    ),
    // The key follows the active profile, not just this window's own connects:
    // switching profile changes which session — if any — the commands would act
    // on, and an enablement that disagreed with that would offer Disconnect for
    // a session the command cannot see.
    profiles.onDidChange(sync),
  );

  log.debug("registered the compute session commands");
  sync();

  return { connect, disconnect, forgetProfile };
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

// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The sign-in and sign-out commands.
 *
 * Thinner than they used to be, and deliberately so. As of slice 1c the
 * `AuthenticationProvider` owns signing in and signing out; these two commands
 * decide *which profile* the user means and how to word the outcome, then call
 * straight through to it.
 *
 * That direction — command calls provider, never the reverse — is the point.
 * Before 1c this file had its own sign-in, and the Accounts menu was about to
 * get a second one. Two implementations of "sign in" is how the menu and the
 * command palette end up disagreeing about who is signed in, and the
 * disagreement never surfaces as itself; it surfaces as a run failing against a
 * deployment the user believes they are signed in to.
 *
 * Both commands act on the *active* profile rather than asking which one,
 * because the active profile is already visible in the status bar and a picker
 * that appears every time would be a second place to change something the user
 * has already chosen. Switching profile is its own command. The Accounts menu is
 * the way to act on a profile that is not the active one.
 */

import * as vscode from "vscode";

import { type ProfileStore } from "../profile/store";
import { type ViyaAuthenticationProvider } from "./authProvider";

export function registerAuthCommands(
  context: vscode.ExtensionContext,
  provider: ViyaAuthenticationProvider,
  profiles: ProfileStore,
  log: vscode.LogOutputChannel,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("pythonOnViya.signIn", () =>
      signIn(provider, profiles, log),
    ),
    vscode.commands.registerCommand("pythonOnViya.signOut", () =>
      signOut(provider, profiles, log),
    ),
  );
}

async function signIn(
  provider: ViyaAuthenticationProvider,
  profiles: ProfileStore,
  log: vscode.LogOutputChannel,
): Promise<void> {
  if (profiles.active() === undefined) {
    void vscode.window.showInformationMessage(
      vscode.l10n.t("Select a SAS Viya connection profile before signing in."),
    );
    return;
  }

  try {
    const session = await provider.createSession();
    void vscode.window.showInformationMessage(
      vscode.l10n.t("Signed in to SAS Viya as {0}.", session.account.label),
    );
  } catch (error) {
    // The provider rejects to satisfy its contract with VS Code, which shows the
    // rejection to whoever asked for a session. Invoked from the palette there
    // is no such caller, so the command shows it — but only as a message, never
    // as an unhandled rejection in the log the user cannot read.
    reportFailure(log, error);
  }
}

async function signOut(
  provider: ViyaAuthenticationProvider,
  profiles: ProfileStore,
  log: vscode.LogOutputChannel,
): Promise<void> {
  const active = profiles.active();
  if (active === undefined) {
    void vscode.window.showInformationMessage(
      vscode.l10n.t("There is no connection profile to sign out of."),
    );
    return;
  }

  try {
    // Only the session. The client secret is configuration the user entered, not
    // something signing out should destroy — deleting a profile does that.
    await provider.removeSession(active.profile.id);
    void vscode.window.showInformationMessage(
      vscode.l10n.t('Signed out of "{0}".', active.name),
    );
  } catch (error) {
    // Reached when the active profile has no session, which is not a failure
    // worth an error dialog: the user asked to be signed out and they are.
    log.info(
      vscode.l10n.t(
        'Nothing to sign out of for "{0}": {1}',
        active.name,
        describe(error),
      ),
    );
    void vscode.window.showInformationMessage(
      vscode.l10n.t('You are not signed in to "{0}".', active.name),
    );
  }
}

function reportFailure(log: vscode.LogOutputChannel, error: unknown): void {
  const detail = describe(error);
  log.error(vscode.l10n.t("Signing in to SAS Viya failed: {0}", detail));
  void vscode.window.showErrorMessage(detail);
}

/**
 * The message from a thrown value, and nothing else.
 *
 * Never the value itself. A rejected token exchange can carry a request object,
 * and a request object carries the `Authorization` header — so an error handler
 * that logs what it caught is a credential leak that looks like diligence.
 */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

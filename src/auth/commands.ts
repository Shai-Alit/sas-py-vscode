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
 *
 * ## Signing in connects
 *
 * ADR-0013, which carries the reasoning and the rejected alternatives; the short
 * version is Sean's design call, 2026-08-15: "what other point is there of signing in if
 * not to connect to a session?" So the sign-in command opens one, and Connect
 * becomes the command you run to reconnect rather than the second half of
 * getting started.
 *
 * It lives *here*, in the command, and not in the provider — which is the whole
 * design, not an implementation detail. `createSession` is also what VS Code's
 * own Accounts menu calls, and that menu is polled, has no profile in hand, and
 * is opened to read rather than to start anything. Starting a SAS process from
 * it would be the opposite of the ADR-0002 posture. Putting the connect in the
 * command means only the deliberate, palette-invoked sign-in reaches a
 * deployment, and no code has to distinguish the two callers after the fact.
 *
 * ## Signing out disconnects — added 2026-08-28 (Phase 3's 3f slice)
 *
 * The mirror image of "signing in connects," and for a while this command was
 * the one place that symmetry was missing: `signOut` revoked the token but
 * never told `src/compute` a session might need dropping, so
 * `pythonOnViya.connected` and the session this window held both survived a
 * sign-out untouched. The 2026-08-27 manual test pass hit the two visible
 * consequences directly — the *Connect* command stayed hidden (the context
 * key still said "connected"), and the next run failed against a session
 * whose token had just been pulled out from under it, reported as a generic
 * transfer failure with nothing in the log. `signOut` now takes
 * `src/compute/commands.ts`'s `disconnect` the same way `signIn` already
 * takes `connect`, and for the same reason: neither this file nor the
 * provider gets to know what a compute session is, but both get to trigger
 * dropping one.
 */

import * as vscode from "vscode";

import { type ProfileStore } from "../profile/store";
import {
  NoSuchSessionError,
  type ViyaAuthenticationProvider,
} from "./authProvider";
import { isSignInCancelled } from "./cancellation";

/**
 * Open a session for the active profile, and say which profile that was.
 *
 * Declared here, structurally, rather than imported from `src/compute`: all this
 * command needs of a connect is that it happens and names a profile, and saying
 * so in the narrowest terms keeps the module graph pointing one way — compute
 * already reads the auth provider's id, and a type import back the other way
 * would make the pair mutually dependent to describe a single string.
 * `ConnectActiveProfile` in `compute/commands.ts` satisfies this.
 */
export type ConnectAfterSignIn = () => Promise<
  { readonly profileName: string } | undefined
>;

/**
 * What each command says, and where it says it.
 *
 * Injectable for one reason: the palette ids belong to the activated extension,
 * so a test cannot register these handlers a second time to drive them — it has
 * to call them directly, and a handler whose only observable effect is a
 * notification is untestable until the notification is a port. The defaults are
 * the real `vscode.window` calls, so production wires nothing.
 */
export interface AuthCommandDeps {
  /** Defaults to `vscode.window.showInformationMessage`. */
  readonly inform?: ((message: string) => void) | undefined;
  /** Defaults to `vscode.window.showErrorMessage`. */
  readonly report?: ((message: string) => void) | undefined;
}

/** Everything {@link signIn} touches, narrowed to the members it calls. */
export interface SignInDeps extends AuthCommandDeps {
  readonly provider: Pick<ViyaAuthenticationProvider, "createSession">;
  readonly profiles: Pick<ProfileStore, "active">;
  readonly log: vscode.LogOutputChannel;
  readonly connect: ConnectAfterSignIn;
}

/** Everything {@link signOut} touches, narrowed to the members it calls. */
export interface SignOutDeps extends AuthCommandDeps {
  readonly provider: Pick<ViyaAuthenticationProvider, "removeSession">;
  readonly profiles: Pick<ProfileStore, "active">;
  readonly log: vscode.LogOutputChannel;
  /** `src/compute/commands.ts`'s `disconnect` — ends the active profile's
   * session, if this window holds one, and re-syncs `pythonOnViya.connected`.
   * Reports its own failures and stays silent on the ordinary "nothing was
   * connected" case, the same contract `connect` already has in
   * {@link SignInDeps}. */
  readonly disconnect: () => Promise<void>;
}

export function registerAuthCommands(
  context: vscode.ExtensionContext,
  provider: ViyaAuthenticationProvider,
  profiles: ProfileStore,
  log: vscode.LogOutputChannel,
  connect: ConnectAfterSignIn,
  disconnect: () => Promise<void>,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("pythonOnViya.signIn", () =>
      signIn({ provider, profiles, log, connect }),
    ),
    vscode.commands.registerCommand("pythonOnViya.signOut", () =>
      signOut({ provider, profiles, log, disconnect }),
    ),
  );
}

export async function signIn(deps: SignInDeps): Promise<void> {
  const inform = deps.inform ?? showInformation;

  if (deps.profiles.active() === undefined) {
    inform(
      vscode.l10n.t("Select a SAS Viya connection profile before signing in."),
    );
    return;
  }

  try {
    const session = await deps.provider.createSession();

    // One message for one command, whichever way the connect goes. A connect
    // that did not happen has already said why — the manager reports its own
    // failures and stays silent on a cancellation — so this arm says only the
    // part that would otherwise be lost: that the sign-in itself worked, and a
    // second attempt is not what is needed.
    const connection = await deps.connect();
    inform(
      connection === undefined
        ? vscode.l10n.t("Signed in to SAS Viya as {0}.", session.account.label)
        : vscode.l10n.t(
            'Signed in as {0}, and connected using profile "{1}".',
            session.account.label,
            connection.profileName,
          ),
    );
  } catch (error) {
    if (isSignInCancelled(error)) {
      // Closing the browser is an answer, and the answer is no. Showing an error
      // for it tells the user that the thing they just chose to do went wrong —
      // and the log line was already written where the cancellation happened, so
      // there is nothing left to say here.
      return;
    }

    // The provider rejects to satisfy its contract with VS Code, which shows the
    // rejection to whoever asked for a session. Invoked from the palette there
    // is no such caller, so the command shows it — but only as a message, never
    // as an unhandled rejection in the log the user cannot read.
    reportSignInFailure(deps.log, error, deps.report ?? showError);
  }
}

export async function signOut(deps: SignOutDeps): Promise<void> {
  const inform = deps.inform ?? showInformation;
  const log = deps.log;

  const active = deps.profiles.active();
  if (active === undefined) {
    inform(vscode.l10n.t("There is no connection profile to sign out of."));
    return;
  }

  try {
    // Only the session. The client secret is configuration the user entered, not
    // something signing out should destroy — deleting a profile does that.
    await deps.provider.removeSession(active.profile.id);
    // Signing in opens a session (ADR-0013); signing out is the mirror
    // image. Without this, `pythonOnViya.connected` and the session this
    // window holds both survive a sign-out — Connect stays hidden and the
    // next run fails against a session whose token was just revoked. See
    // this file's own top-of-module comment for the 2026-08-27 finding that
    // caught it missing.
    await deps.disconnect();
    inform(vscode.l10n.t('Signed out of "{0}".', active.name));
  } catch (error) {
    if (!(error instanceof NoSuchSessionError)) {
      // Everything else has to be visible. This arm catches the workspace-trust
      // refusal, a secret store that would not delete, and a `setContext` that
      // did not answer — none of which mean the user is signed out, and the
      // first of which is a sentence naming the command that fixes it. Reporting
      // any of them as "you are not signed in" states the opposite of what
      // happened, in a reassuring voice, while the credential is still on disk.
      reportSignOutFailure(log, error, active.name, deps.report ?? showError);
      return;
    }

    // The narrow, ordinary case: the provider does not recognise the id. Reached
    // when the profile stops existing between `profiles.active()` above and the
    // provider's own lookup — a settings edit landing mid-command — and not
    // worth an error dialog, because the user asked to be signed out of
    // something that is no longer there.
    log.info(
      vscode.l10n.t(
        'Nothing to sign out of for "{0}": {1}',
        active.name,
        describe(error),
      ),
    );
    inform(vscode.l10n.t('You are not signed in to "{0}".', active.name));
  }
}

function reportSignInFailure(
  log: vscode.LogOutputChannel,
  error: unknown,
  report: (message: string) => void,
): void {
  const detail = describe(error);
  log.error(vscode.l10n.t("Signing in to SAS Viya failed: {0}", detail));
  report(detail);
}

/**
 * Shows a sign-out failure, and names the profile in the log line but not in the
 * dialog.
 *
 * The dialog is the provider's own sentence verbatim. The one that matters most
 * is the workspace-trust refusal, which already names the folder and the command
 * that fixes it, and wrapping it in "signing out of Prod failed:" pushes that
 * instruction into the second half of a longer sentence for no gain.
 */
function reportSignOutFailure(
  log: vscode.LogOutputChannel,
  error: unknown,
  name: string,
  report: (message: string) => void,
): void {
  const detail = describe(error);
  log.error(vscode.l10n.t('Signing out of "{0}" failed: {1}', name, detail));
  report(detail);
}

function showInformation(message: string): void {
  void vscode.window.showInformationMessage(message);
}

function showError(message: string): void {
  void vscode.window.showErrorMessage(message);
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

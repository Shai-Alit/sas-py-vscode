// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The sign-in and sign-out commands.
 *
 * Thin on purpose, in the same way `src/profile/commands.ts` is thin: this file
 * answers "which profile" and "do we have the client secret", and hands the rest
 * to `browserFlow.ts`. It holds no OAuth logic at all.
 *
 * Both commands act on the *active* profile rather than asking which one, because
 * the active profile is already visible in the status bar and a picker that
 * appears every time would be a second place to change something the user has
 * already chosen. Switching profile is its own command.
 */

import * as vscode from "vscode";

import { type ViyaProfile } from "../profile/model";
import { type ProfileStore } from "../profile/store";
import { signInWithBrowser } from "./browserFlow";
import { type SessionStore } from "./sessionStore";
import { type AuthUriHandler } from "./uriHandler";

export function registerAuthCommands(
  context: vscode.ExtensionContext,
  profiles: ProfileStore,
  sessions: SessionStore,
  handler: AuthUriHandler,
  log: vscode.LogOutputChannel,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("pythonOnViya.signIn", () =>
      signIn(context, profiles, sessions, handler, log),
    ),
    vscode.commands.registerCommand("pythonOnViya.signOut", () =>
      signOut(profiles, sessions, log),
    ),
  );
}

async function signIn(
  context: vscode.ExtensionContext,
  profiles: ProfileStore,
  sessions: SessionStore,
  handler: AuthUriHandler,
  log: vscode.LogOutputChannel,
): Promise<void> {
  const active = profiles.active();
  if (active === undefined) {
    void vscode.window.showInformationMessage(
      vscode.l10n.t("Select a SAS Viya connection profile before signing in."),
    );
    return;
  }

  const clientSecret = await resolveClientSecret(active.profile, profiles);
  if (clientSecret === undefined) return;

  await signInWithBrowser(
    {
      profileId: active.profile.id,
      endpoint: active.profile.endpoint,
      clientId: active.profile.clientId,
      clientSecret,
      // Version detection is Phase 2. Until it exists the deployment is
      // genuinely unknown, and `clientId.ts` is built to behave sensibly on
      // exactly that: it tries the built-in client and translates the
      // deployment's own refusal into the advice a version check would have
      // given up front.
    },
    {
      handler,
      sessions,
      log,
      extensionId: context.extension.id,
    },
  );
}

/**
 * The client secret to sign in with, `""` when there is none, or `undefined`
 * when the user cancelled.
 *
 * The prompt exists because of a promise made elsewhere: importing profiles from
 * the SAS extension deliberately does not copy secrets, and tells the user they
 * will be asked for it the first time they connect. This is that moment. A secret
 * the user supplies here is stored, so it is asked for once rather than at every
 * sign-in.
 *
 * An empty answer is a real answer — plenty of registered clients are public and
 * have no secret — so it is stored as nothing and not asked about again.
 */
async function resolveClientSecret(
  profile: ViyaProfile,
  profiles: ProfileStore,
): Promise<string | undefined> {
  if (profile.clientId === undefined || profile.clientId === "") {
    // The built-in client is public: there is no secret, and asking for one
    // would invite the user to invent an answer.
    return "";
  }

  const stored = await profiles.secret(profile);
  if (stored !== undefined) return stored;

  const typed = await vscode.window.showInputBox({
    title: vscode.l10n.t("Sign in to SAS Viya"),
    prompt: vscode.l10n.t(
      'Client secret for "{0}" (leave empty if this client has none)',
      profile.clientId,
    ),
    password: true,
    ignoreFocusOut: true,
  });
  if (typed === undefined) return undefined;

  if (typed !== "") await profiles.setSecret(profile, typed);
  return typed;
}

async function signOut(
  profiles: ProfileStore,
  sessions: SessionStore,
  log: vscode.LogOutputChannel,
): Promise<void> {
  const active = profiles.active();
  if (active === undefined) {
    void vscode.window.showInformationMessage(
      vscode.l10n.t("There is no connection profile to sign out of."),
    );
    return;
  }

  // Only the session. The client secret is configuration the user entered, not
  // something signing out should destroy — deleting a profile does that.
  await sessions.clear(active.profile.id);
  log.info(vscode.l10n.t('Signed out of "{0}".', active.name));
  void vscode.window.showInformationMessage(
    vscode.l10n.t('Signed out of "{0}".', active.name),
  );
}

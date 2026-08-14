// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The `AuthenticationProvider` VS Code talks to.
 *
 * Structure follows: client/src/components/AuthProvider.ts in
 * sassoftware/vscode-sas-extension (Apache-2.0). No code was copied.
 *
 * This is the shell. Every decision it makes is next door: `identity.ts` reads
 * the user, `accounts.ts` decides what counts as a change, `signIn.ts` decides
 * what a callback means, `sessionStore.ts` holds the refresh token. What is left
 * here is the part that needs an editor — registering with the authentication
 * API, showing a prompt, firing an event.
 *
 * ## The four upstream defects this is written not to repeat
 *
 * Read `AuthProvider.ts` upstream before changing any of this; the audit is in
 * `PRODUCTION_PLAN.md` under slice 1c.
 *
 * 1. **One session for the whole extension.** Upstream stores a single `SASAuth`
 *    blob, so a second profile overwrites the first. Here every session is keyed
 *    on the profile id and `supportsMultipleAccounts` is declared, because two
 *    deployments open at once is the normal case for anyone who has a test Viya
 *    and a production one.
 * 2. **`getSessions` refreshes on every call.** The Accounts menu polls, so that
 *    turns opening a menu into a network round trip, and a transient network
 *    failure into a silent sign-out. Here a cached token is served as-is and a
 *    refresh happens only when {@link needsRefresh} says the token is spent —
 *    which it can say, because 1b-i resolves `expires_in` to an absolute
 *    `expiresAt` at the moment the token is issued.
 * 3. **`removeSession` falls back to the active profile** when it does not
 *    recognise the id, which turns a caller's bug into signing the user out of
 *    something they never named. Here an unknown id is an error.
 * 4. **The session write is not awaited.** Here it is, so a window closing
 *    immediately after sign-in cannot lose the session it just established.
 *
 * ## What is deliberately in memory only
 *
 * The access token. `sessionStore.ts` persists the refresh token and nothing
 * else, and this class does not widen that: a credential written to disk that
 * will be dead within the hour buys a few minutes of convenience for a second
 * long-lived copy of something worth stealing.
 *
 * The resolved identity is cached in memory too, for the length of the window.
 * Probe finding 9 records that this resource sends `no-store` and no `ETag`, so
 * there is nothing to revalidate against — ask once and hold the answer. The
 * cache is reused only when a token is *renewed*; a fresh sign-in always asks
 * again, because that is the moment the user could have chosen someone else.
 * {@link IdentitySource} carries the distinction.
 */

import * as vscode from "vscode";

import type { ViyaProfile } from "../profile/model";
import type { ProfileStore } from "../profile/store";
import { diffSessions, isEmptyDiff, type SessionSummary } from "./accounts";
import { signInWithBrowser, type BrowserSignInDeps } from "./browserFlow";
import { BUILT_IN_CLIENT_ID } from "./clientId";
import {
  accountId as toAccountId,
  accountLabel,
  fetchCurrentUser,
  type IdentityDeps,
  type ViyaUser,
} from "./identity";
import { localiseAuthProblem } from "./messages";
import { describeAuthProblem } from "./problems";
import type { SessionStore } from "./sessionStore";
import {
  needsRefresh,
  refreshTokens,
  type TokenEndpointDeps,
  type Tokens,
} from "./tokenEndpoint";
import type { AuthUriHandler } from "./uriHandler";

/**
 * The provider id, which is also the `authentication` contribution's id and the
 * first argument to `vscode.authentication.getSession`.
 *
 * Bare `pythonOnViya`, matching the settings namespace. Not `sas`, which is
 * upstream's and which two extensions installed side by side would collide on.
 */
export const AUTH_PROVIDER_ID = "pythonOnViya";

/**
 * The name shown in the Accounts menu.
 *
 * A function rather than a constant, and called at registration time: a
 * module-level `vscode.l10n.t()` runs while the module is still being loaded,
 * which on some hosts is before the bundle for the active display language has
 * been read, and would freeze the English string for the life of the window.
 *
 * "SAS Viya" is a product name, so most locales will pass it through unchanged.
 * It goes through `l10n` anyway for two reasons: the manifest already contributes
 * this label as `%authentication.label%`, so the source is translatable in one
 * place and not the other, and a locale that writes the name in a non-Latin
 * script — where a transliteration is what a reader expects — has nowhere to say
 * so if the string never reaches the bundle.
 */
export function authProviderLabel(): string {
  return vscode.l10n.t("SAS Viya");
}

/**
 * The `when` clause key Phase 2 onward gates on.
 *
 * Set through `setContext` rather than exposed as an API, because a `when`
 * clause is the only consumer and a second way to ask the same question is a
 * second way for it to be answered differently.
 */
export const AUTHORIZED_CONTEXT_KEY = "pythonOnViya.authorized";

/** Viya's OAuth does not use scopes; every session declares the same empty set. */
const NO_SCOPES: readonly string[] = [];

/** Ports with real defaults, so an integration test need not reach the network. */
export interface AuthProviderDeps {
  token?: TokenEndpointDeps | undefined;
  identity?: IdentityDeps | undefined;
  /** Defaults to {@link vscode.commands.executeCommand} for `setContext`. */
  setContext?: ((key: string, value: unknown) => Thenable<unknown>) | undefined;
  /**
   * The browser-facing ports of {@link signInWithBrowser}, passed straight
   * through.
   *
   * Only the three that would otherwise launch a browser or block on a modal;
   * `handler`, `sessions`, `log` and `extensionId` are this provider's own and
   * are not a caller's to substitute. Without this, `createSession` opens a real
   * browser the moment it is called, so the one path that has to be exercised —
   * signing in again while a session for the same profile is still held — could
   * not be tested at all.
   */
  browser?:
    | Pick<BrowserSignInDeps, "asExternalUri" | "openExternal" | "showInputBox">
    | undefined;
}

/**
 * Where the tokens being recorded came from, which decides whether the identity
 * already in memory still describes them.
 *
 * `"renewed-token"` is a refresh of the session that is already held: same
 * grant, same user, and the identity resource sends `no-store` with no `ETag`
 * (probe finding 9), so there is nothing to revalidate against and asking again
 * would put a network round trip behind opening the Accounts menu.
 *
 * `"new-sign-in"` went through the browser, where the user chose who to be. A
 * second sign-in on the same profile while the first is still live is the
 * ordinary way to switch accounts on one deployment, and reusing the cache there
 * hands back a session labelled with the previous user while carrying the new
 * user's token — a wrong name against a real credential, which is worse than no
 * name at all.
 */
type IdentitySource = "renewed-token" | "new-sign-in";

/** What is held in memory for a profile that is signed in right now. */
interface LiveSession {
  readonly tokens: Tokens;
  readonly user: ViyaUser;
  readonly endpoint: string;
}

export class ViyaAuthenticationProvider
  implements vscode.AuthenticationProvider, vscode.Disposable
{
  private readonly changed =
    new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();

  readonly onDidChangeSessions = this.changed.event;

  /** Keyed on profile id. Holds the access token, which never reaches disk. */
  private readonly live = new Map<string, LiveSession>();

  /** The last list handed out, so {@link diffSessions} has a `before`. */
  private published: readonly SessionSummary[] = [];

  /**
   * `extensionId` rather than the whole `ExtensionContext`, for the reason given
   * at `ProfileStorageContext` in `src/profile/store.ts`: a real context can only
   * be obtained by being an extension, and one string is all this needs — the
   * authority of the `vscode://` callback URI the browser flow registers.
   */
  constructor(
    private readonly extensionId: string,
    private readonly profiles: ProfileStore,
    private readonly sessions: SessionStore,
    private readonly handler: AuthUriHandler,
    private readonly log: vscode.LogOutputChannel,
    private readonly deps: AuthProviderDeps = {},
  ) {}

  /**
   * Every session this window can serve without asking the user anything.
   *
   * `scopes` is accepted and ignored, which is honest rather than lazy: Viya's
   * OAuth issues no scoped tokens, so there is no narrower session to hand back
   * and pretending otherwise would mean returning nothing for any non-empty
   * request.
   */
  async getSessions(): Promise<vscode.AuthenticationSession[]> {
    const sessions: vscode.AuthenticationSession[] = [];

    for (const name of this.profiles.names()) {
      const profile = this.profiles.get(name);
      if (profile === undefined) continue;

      const session = await this.resolve(profile);
      if (session !== undefined) {
        sessions.push(session);
      }
    }

    await this.publish(sessions);
    return sessions;
  }

  /**
   * Signs in, through the same browser flow the sign-in command uses.
   *
   * There is exactly one implementation of signing in and this is it — the
   * command in `commands.ts` calls straight through. Two implementations is how
   * the Accounts menu and the command palette end up disagreeing about who is
   * signed in, and the disagreement always surfaces as a bug report about
   * something else.
   *
   * Rejects rather than returning `undefined` on failure, because that is the
   * contract: VS Code shows the rejection to whoever asked for the session.
   */
  async createSession(): Promise<vscode.AuthenticationSession> {
    const active = this.profiles.active();
    if (active === undefined) {
      throw new Error(
        vscode.l10n.t(
          "Select a SAS Viya connection profile before signing in.",
        ),
      );
    }

    const clientSecret = await this.clientSecret(active.profile);
    if (clientSecret === undefined) {
      throw new Error(vscode.l10n.t("Sign-in was cancelled."));
    }

    const tokens = await signInWithBrowser(
      {
        profileId: active.profile.id,
        endpoint: active.profile.endpoint,
        clientId: active.profile.clientId,
        clientSecret,
        // Version detection is Phase 2. Until it exists the deployment is
        // genuinely unknown, and `clientId.ts` is built for exactly that.
      },
      {
        handler: this.handler,
        sessions: this.sessions,
        log: this.log,
        extensionId: this.extensionId,
        ...(this.deps.browser ?? {}),
        ...(this.deps.token === undefined ? {} : { token: this.deps.token }),
      },
    );
    if (tokens === undefined) {
      // `signInWithBrowser` has already reported why, to the log and to the
      // user. Re-reporting here would show the same failure twice.
      throw new Error(
        vscode.l10n.t("Signing in to SAS Viya did not complete."),
      );
    }

    const session = await this.establish(active.profile, tokens, "new-sign-in");
    if (session === undefined) {
      throw new Error(
        vscode.l10n.t(
          "Signed in, but Viya would not say who you are signed in as. See the Python on Viya log for details.",
        ),
      );
    }

    await this.refreshPublished();
    return session;
  }

  /**
   * Signs out of one session.
   *
   * An id this provider did not issue is an error. Upstream falls back to the
   * active profile here, which means a caller with a stale id silently signs the
   * user out of a deployment they did not name — and, because it is a fallback
   * rather than a failure, nothing anywhere reports that it happened.
   */
  async removeSession(sessionId: string): Promise<void> {
    const profile = this.profileById(sessionId);
    if (profile === undefined) {
      throw new Error(
        vscode.l10n.t(
          "There is no SAS Viya sign-in with that id to sign out of.",
        ),
      );
    }

    this.live.delete(profile.id);
    await this.sessions.clear(profile.id);
    this.log.info(vscode.l10n.t("Signed out of {0}.", profile.endpoint));
    await this.refreshPublished();
  }

  dispose(): void {
    this.live.clear();
    this.changed.dispose();
  }

  /**
   * The session for a profile, without prompting.
   *
   * The order matters. A live, unexpired token is served straight from memory —
   * this is the path the Accounts menu takes every time it polls, and it must
   * not touch the network. Only a token that is spent, or absent because this
   * window has just opened, reaches the refresh.
   */
  private async resolve(
    profile: ViyaProfile,
  ): Promise<vscode.AuthenticationSession | undefined> {
    const held = this.live.get(profile.id);
    if (held !== undefined && !needsRefresh(held.tokens, Date.now())) {
      return toSession(profile.id, held);
    }

    const stored = await this.sessions.read(profile.id);
    if (stored === undefined) {
      // Not signed in, or signed in to a deployment that issues no refresh
      // token. Either way there is nothing to serve and nothing to report.
      this.live.delete(profile.id);
      return undefined;
    }

    const clientSecret = (await this.profiles.secret(profile)) ?? "";
    const result = await refreshTokens(
      {
        endpoint: profile.endpoint,
        // The same default the sign-in flow resolves. A refresh must present
        // the client the token was issued to, and defaulting to `""` here would
        // renew nothing on any deployment using the built-in client — which is
        // every Viya 4 from 2022.11 on, and so almost all of them.
        clientId:
          profile.clientId === undefined || profile.clientId === ""
            ? BUILT_IN_CLIENT_ID
            : profile.clientId,
        clientSecret,
        refreshToken: stored.refreshToken,
      },
      this.deps.token ?? {},
    );
    if (!result.ok) {
      // Logged, never shown. Nobody asked for this: it happened because a menu
      // was opened. A modal here would interrupt whatever the user was actually
      // doing to tell them about a background failure they did not cause.
      this.log.warn(
        vscode.l10n.t(
          "Could not renew the sign-in for {0}: {1}",
          profile.endpoint,
          describeAuthProblem(result.problem),
        ),
      );
      this.live.delete(profile.id);
      return undefined;
    }

    return await this.establish(profile, result.tokens, "renewed-token");
  }

  /**
   * Records a fresh token set against a profile and resolves who it belongs to.
   *
   * `identity` is not a tuning knob — it is which question the caller is
   * answering. See {@link IdentitySource}.
   */
  private async establish(
    profile: ViyaProfile,
    tokens: Tokens,
    identity: IdentitySource,
  ): Promise<vscode.AuthenticationSession | undefined> {
    const cached =
      identity === "renewed-token" ? this.live.get(profile.id) : undefined;
    let user = cached?.endpoint === profile.endpoint ? cached.user : undefined;

    if (user === undefined) {
      const result = await fetchCurrentUser(
        {
          endpoint: profile.endpoint,
          accessToken: tokens.accessToken,
          tokenType: tokens.tokenType,
        },
        this.deps.identity ?? {},
      );
      if (!result.ok) {
        this.log.error(
          vscode.l10n.t(
            "Could not read the signed-in user for {0}: {1}",
            profile.endpoint,
            describeAuthProblem(result.problem),
          ),
        );
        void vscode.window.showErrorMessage(
          localiseAuthProblem(result.problem),
        );
        return undefined;
      }
      user = result.user;
    }

    const session: LiveSession = { tokens, user, endpoint: profile.endpoint };
    this.live.set(profile.id, session);
    await this.sessions.write(profile.id, tokens);
    return toSession(profile.id, session);
  }

  /**
   * Re-reads the session list and fires the event if it actually moved.
   *
   * Going through {@link getSessions} rather than constructing the new list here
   * is deliberate: the event has to describe what a listener would see if it
   * asked, and the only way to guarantee that is to ask.
   */
  private async refreshPublished(): Promise<void> {
    await this.getSessions();
  }

  /** Publishes a new list, firing the change event only on a real transition. */
  private async publish(
    sessions: readonly vscode.AuthenticationSession[],
  ): Promise<void> {
    const now = sessions.map(summarise);
    const diff = diffSessions(this.published, now);
    this.published = now;

    await this.setAuthorized(now.length > 0);

    if (isEmptyDiff(diff)) return;
    this.changed.fire({
      added: diff.added.map((summary) => this.rehydrate(summary)),
      removed: diff.removed.map((summary) => this.rehydrate(summary)),
      changed: diff.changed.map((summary) => this.rehydrate(summary)),
    });
  }

  /**
   * Turns a summary back into the session VS Code's event type demands.
   *
   * `accounts.ts` compares summaries precisely because they carry no access
   * token; the event signature wants full sessions. A removed session no longer
   * has a token to give, and `""` is the honest value — there is no credential
   * behind a session that has just been signed out of.
   */
  private rehydrate(summary: SessionSummary): vscode.AuthenticationSession {
    const held = this.live.get(summary.id);
    return {
      id: summary.id,
      accessToken: held?.tokens.accessToken ?? "",
      account: { id: summary.accountId, label: summary.accountLabel },
      scopes: NO_SCOPES,
    };
  }

  private async setAuthorized(authorized: boolean): Promise<void> {
    const setContext =
      this.deps.setContext ??
      ((key: string, value: unknown) =>
        vscode.commands.executeCommand("setContext", key, value));
    await setContext(AUTHORIZED_CONTEXT_KEY, authorized);
  }

  private profileById(id: string): ViyaProfile | undefined {
    for (const name of this.profiles.names()) {
      const profile = this.profiles.get(name);
      if (profile?.id === id) return profile;
    }
    return undefined;
  }

  /**
   * The client secret to sign in with, `""` when there is none, or `undefined`
   * when the user cancelled.
   *
   * The prompt exists because of a promise made elsewhere: importing profiles
   * from the SAS extension deliberately does not copy secrets, and tells the
   * user they will be asked the first time they connect. This is that moment.
   *
   * An empty answer is a real answer — plenty of registered clients are public —
   * so it is recorded as "this client has none" rather than discarded.
   * `ProfileStore.secret` is tri-state for exactly this reason; collapsing `""`
   * and `undefined` is what makes a public client prompt at every sign-in.
   */
  private async clientSecret(
    profile: ViyaProfile,
  ): Promise<string | undefined> {
    if (profile.clientId === undefined || profile.clientId === "") {
      // The built-in client is public: there is no secret, and asking for one
      // would invite the user to invent an answer.
      return "";
    }

    const stored = await this.profiles.secret(profile);
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

    await this.profiles.setSecret(profile, typed);
    return typed;
  }
}

function toSession(
  profileId: string,
  live: LiveSession,
): vscode.AuthenticationSession {
  return {
    id: profileId,
    accessToken: live.tokens.accessToken,
    account: {
      id: toAccountId(live.endpoint, live.user.id),
      label: accountLabel(live.user),
    },
    scopes: NO_SCOPES,
  };
}

function summarise(session: vscode.AuthenticationSession): SessionSummary {
  return {
    id: session.id,
    accountId: session.account.id,
    accountLabel: session.account.label,
  };
}

/**
 * Registers the provider with VS Code.
 *
 * `supportsMultipleAccounts` belongs here and only here. The `authentication`
 * entry in `package.json` carries an `id` and a `label` and nothing else — it
 * exists so VS Code knows the provider is coming before the extension has
 * activated, which is what lets the Accounts menu offer "Sign in with SAS Viya"
 * on a window where nothing has woken us up yet. The `id` in the two places has
 * to match, and {@link AUTH_PROVIDER_ID} is the reason it does.
 *
 * Without `supportsMultipleAccounts`, VS Code treats a second `createSession`
 * as replacing the first, which is exactly the single-session behaviour slice
 * 1a's profile model was designed to get away from.
 */
export function registerAuthProvider(
  context: vscode.ExtensionContext,
  provider: ViyaAuthenticationProvider,
): void {
  context.subscriptions.push(
    provider,
    vscode.authentication.registerAuthenticationProvider(
      AUTH_PROVIDER_ID,
      authProviderLabel(),
      provider,
      { supportsMultipleAccounts: true },
    ),
  );
}

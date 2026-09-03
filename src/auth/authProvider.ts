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
import { SignInCancelledError } from "./cancellation";
import { BUILT_IN_CLIENT_ID } from "./clientId";
import {
  accountForEndpoint,
  accountId as toAccountId,
  accountLabel,
  fetchCurrentUser,
  type IdentityDeps,
  type ViyaUser,
} from "./identity";
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

/**
 * How long {@link ViyaAuthenticationProvider.getSessions} waits for a profile it
 * has to renew over the network before answering without that profile.
 *
 * This is a policy about a **UI poll**, not about the deployment. The Accounts
 * menu is drawn from this call, and a deployment that is switched off — Sean's
 * first one shuts down at weekends — costs the full 30-second token timeout
 * (`tokenEndpoint.DEFAULT_TIMEOUT_MS`) before it fails. Every other profile's
 * session would be held behind it, so opening a menu to look at an account that
 * is signed in and working is half a minute of spinner.
 *
 * Ten seconds sits between the two things it has to separate: far above any
 * healthy round trip, and a third of the timeout that bounds the request itself,
 * so the answer arrives well before the network gives up. Exceeding it is not a
 * failure and nothing is abandoned — see
 * {@link ViyaAuthenticationProvider.resolveOnce} for what happens to the renewal
 * that was still running.
 *
 * Not a setting. A user cannot know a number whose only observable effect is how
 * long a menu waits before it redraws itself a moment later.
 */
export const RESOLVE_BUDGET_MS = 10_000;

/**
 * The other outcome of the race in {@link ViyaAuthenticationProvider.within}.
 *
 * A symbol rather than `undefined`, because `undefined` is already a real answer
 * there — "this profile is not signed in" — and collapsing the two would log a
 * profile with no stored token as a slow deployment on every single poll.
 */
const BUDGET_SPENT = Symbol("the resolve budget is spent");

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
  /**
   * Whether this window's folder is trusted. Defaults to
   * {@link vscode.workspace.isTrusted}.
   *
   * Injectable because the integration host cannot be made untrusted. It opens
   * an empty window, and `security.workspace.trust.emptyWindow` defaults to
   * true, so `vscode.workspace.isTrusted` is `true` for the whole run and the
   * closed branch would never execute. A security gate whose closed state is
   * never exercised is a comment.
   */
  isTrusted?: (() => boolean) | undefined;
  /**
   * Defaults to {@link RESOLVE_BUDGET_MS}.
   *
   * Injectable so the tests for it need not take ten seconds each. Nothing in
   * production sets it.
   */
  resolveBudgetMs?: number | undefined;
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

/**
 * Thrown by {@link ViyaAuthenticationProvider.removeSession} for an id this
 * provider did not issue.
 *
 * A type rather than a sentence a caller matches on. The sign-out command has to
 * separate "there was nothing there to sign out of", which is an ordinary
 * outcome, from the workspace-trust refusal and a secret store that would not
 * delete, which are not — and the only other discriminator on offer is the
 * localised message below. Matching that would work in English and silently
 * swallow the trust refusal in every other display language, which is the worst
 * way for a failure to become invisible: it passes review, and it passes the
 * tests, in the one locale anybody runs them in.
 */
export class NoSuchSessionError extends Error {}

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

  private readonly signedOut = new vscode.EventEmitter<void>();

  /**
   * Fires once when {@link removeSession} completes a deliberate sign-out. The
   * palette `Sign Out` command and VS Code's Accounts menu both route through
   * that method, and nothing else does.
   *
   * Deliberately distinct from {@link onDidChangeSessions}: that event's
   * `removed` is a *diff* of the published list, so it also fires for a
   * profile a slow renewal or an unreadable keychain entry dropped for one
   * poll (see {@link within}) and will bring back on the next — a false
   * positive a consumer must not read as "the user signed out". Its existing
   * consumer, `forgetProfile`, tolerates that because a dropped connection
   * just reconnects; Phase 5d-iv's Problems-panel clear does not self-heal,
   * so it listens here instead.
   */
  readonly onDidSignOut = this.signedOut.event;

  /** Keyed on profile id. Holds the access token, which never reaches disk. */
  private readonly live = new Map<string, LiveSession>();

  /**
   * Renewals that are still running, keyed on profile id.
   *
   * The map exists because {@link RESOLVE_BUDGET_MS} exists. A poll that gives
   * up on a profile does not stop the renewal, and the menu polls: without this,
   * every poll against an unreachable deployment would open another socket to it
   * and leave the previous attempt running, so the one deployment that is down
   * is also the one accumulating connections. One renewal per profile at a time,
   * and every caller waiting on that profile waits on the same promise.
   */
  private readonly resolving = new Map<
    string,
    Promise<vscode.AuthenticationSession | undefined>
  >();

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
   * Every session this window can serve without asking the user anything,
   * narrowed to one account when the caller named one.
   *
   * `scopes` is accepted and ignored, which is honest rather than lazy: Viya's
   * OAuth issues no scoped tokens, so there is no narrower session to hand back
   * and pretending otherwise would mean returning nothing for any non-empty
   * request. `options.account` is the opposite — it is honoured, and it is what
   * lets a window with two profiles get the session for the one it is asking
   * about instead of whichever the host picked.
   *
   * **Resolve everything, publish everything, return the subset.** The filter is
   * the last thing that happens and it never reaches {@link publish}. Publishing
   * a filtered list would fire a change event announcing that every session the
   * caller did not ask about had been removed, and flip
   * {@link AUTHORIZED_CONTEXT_KEY} to false whenever the account named happened
   * to have no session — a `when` clause turning off because somebody else's
   * account was queried. The narrowing is the caller's view, not the world.
   *
   * An untrusted folder has no sessions, by construction: this is the call that
   * would otherwise read the secret store and renew a token, and it is reached
   * by opening a menu rather than by asking for anything, so it says nothing.
   *
   * **The account named is the one worth waiting for.** Naming one is what
   * separates the two kinds of caller this method has: a poll drawing the
   * Accounts menu names nothing, while a caller that already knows which account
   * it wants — the compute connect, since #84 — is a deliberate request whose
   * answer is worth a slow deployment. So the named profile is waited for and
   * the rest are bounded by {@link RESOLVE_BUDGET_MS}. The remaining gap is
   * honest and small: a connect with no hint to offer, which is a window with
   * two profiles on one deployment, is bounded like a poll.
   */
  async getSessions(
    _scopes?: readonly string[],
    options?: vscode.AuthenticationProviderSessionOptions,
  ): Promise<vscode.AuthenticationSession[]> {
    const account = options?.account;
    const sessions = await this.allSessions(
      account === undefined
        ? undefined
        : this.profileForAccount(account)?.profile.id,
    );

    if (account === undefined) {
      return sessions;
    }
    return sessions.filter((session) => session.account.id === account.id);
  }

  /**
   * Every resolvable session, published as the complete picture.
   *
   * Concurrent rather than serial, which is the half of #133 that is pure gain:
   * the profiles have nothing to do with each other, and resolving them in turn
   * made the wait the *sum* of every deployment's latency. `Promise.all`
   * preserves input order, so the published list still follows the profile order
   * rather than whichever deployment answered first — a menu that reorders
   * itself according to network weather is its own defect.
   *
   * `unbounded` is the one profile, if any, the caller is entitled to wait for.
   */
  private async allSessions(
    unbounded?: string,
  ): Promise<vscode.AuthenticationSession[]> {
    if (!this.trusted()) {
      // Published, not just returned. The list VS Code holds and the
      // `pythonOnViya.authorized` context key both have to say "nothing here",
      // or a `when` clause somewhere offers to run code on a server using a
      // session this call has just refused to produce.
      await this.publish([]);
      return [];
    }

    const budget = this.deps.resolveBudgetMs ?? RESOLVE_BUDGET_MS;
    const profiles: ViyaProfile[] = [];
    for (const name of this.profiles.names()) {
      const profile = this.profiles.get(name);
      if (profile !== undefined) profiles.push(profile);
    }

    const resolved = await Promise.all(
      profiles.map(async (profile) => {
        const renewal = this.resolveOnce(profile);
        return profile.id === unbounded
          ? await renewal
          : await this.within(budget, renewal, profile);
      }),
    );

    const sessions = resolved.filter(
      (session): session is vscode.AuthenticationSession =>
        session !== undefined,
    );

    await this.publish(sessions);
    return sessions;
  }

  /**
   * {@link resolve}, but at most one at a time per profile, and never throwing.
   *
   * Both properties are here for the same reason — that a caller may now walk
   * away from this promise. See {@link resolving} for the one-at-a-time half.
   *
   * The other half is that a rejection nobody is waiting for is an unhandled
   * rejection, which in the extension host is a stack trace in a log the user
   * did not open and cannot act on. `resolve` reaches a keychain and a settings
   * read, both of which can throw, so this is not hypothetical. Catching it here
   * also fixes something that predates the budget: under `Promise.all` — and
   * under the serial loop before it — one profile whose keychain entry could not
   * be read failed the *whole* list, which is the same defect as #133 wearing
   * different clothes. Logged as a warning, never shown: nobody asked, a menu
   * was opened.
   */
  private resolveOnce(
    profile: ViyaProfile,
  ): Promise<vscode.AuthenticationSession | undefined> {
    const running = this.resolving.get(profile.id);
    if (running !== undefined) return running;

    const started = this.resolve(profile)
      .catch((error: unknown) => {
        this.log.warn(
          vscode.l10n.t(
            "Could not read the sign-in for {0}: {1}",
            profile.endpoint,
            error instanceof Error ? error.message : String(error),
          ),
        );
        return undefined;
      })
      .finally(() => {
        this.resolving.delete(profile.id);
      });

    this.resolving.set(profile.id, started);
    return started;
  }

  /**
   * A renewal's answer, or nothing once the budget is spent.
   *
   * What it deliberately does not do is cancel. The renewal keeps running, and
   * when it lands it writes the session into {@link live} exactly as it would
   * have — so the next call, which for the Accounts menu is the next poll and
   * for anything else is the next request, serves that profile from memory with
   * no network at all. Giving up on the wait is not giving up on the sign-in.
   *
   * Nothing is re-published when a late renewal lands, though the account will
   * be missing from the menu until something asks again. Publishing from here
   * would fire a change event from a call that has already returned, racing the
   * next `getSessions` for `published` — and a renewal that lands late every
   * time would then drive a publish every time. The staleness lasts until the
   * next poll; the alternative is a feedback loop.
   */
  private async within(
    budgetMs: number,
    renewal: Promise<vscode.AuthenticationSession | undefined>,
    profile: ViyaProfile,
  ): Promise<vscode.AuthenticationSession | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const spent = new Promise<typeof BUDGET_SPENT>((resolve) => {
      timer = setTimeout(() => {
        resolve(BUDGET_SPENT);
      }, budgetMs);
    });

    try {
      const answer = await Promise.race([renewal, spent]);
      if (answer !== BUDGET_SPENT) return answer;

      // Debug, not warning. Nothing has failed — the renewal is still running
      // and the profile is expected back — so this is a note for reading the
      // log after the fact, not an event.
      this.log.debug(
        `renewing the sign-in for ${profile.endpoint} is taking longer than ${String(budgetMs)}ms; answering without it`,
      );
      return undefined;
    } finally {
      // The timer outlives the race it lost. Left uncleared, every poll leaves
      // a ten-second timer behind holding a closure over this provider.
      clearTimeout(timer);
    }
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
   * A **cancellation** rejects too — there is no other way out of this signature
   * — but with a {@link SignInCancelledError}, so that a caller can tell "the
   * user changed their mind" from "this did not work" and show nothing for the
   * first. Both cancellations that exist reach this the same way: the browser
   * flow throws one, the secret prompt below throws the other.
   *
   * `options.account` names which deployment to sign in to, and it wins over the
   * active profile. The Accounts menu's *sign in again* passes the account row
   * it was clicked on; without this, that row would sign the user in to whatever
   * profile happened to be active and then quietly replace a different account's
   * session with it.
   */
  async createSession(
    _scopes?: readonly string[],
    options?: vscode.AuthenticationProviderSessionOptions,
  ): Promise<vscode.AuthenticationSession> {
    this.requireTrust();

    const requested = options?.account;
    const active =
      requested === undefined
        ? this.profiles.active()
        : this.profileForAccount(requested);
    if (active === undefined) {
      throw new Error(
        requested === undefined
          ? vscode.l10n.t(
              "Select a SAS Viya connection profile before signing in.",
            )
          : vscode.l10n.t(
              'No connection profile uses the SAS Viya deployment that "{0}" is signed in to.',
              requested.label,
            ),
      );
    }

    const clientSecret = await this.clientSecret(active.profile);
    if (clientSecret === undefined) {
      // The masked prompt was dismissed. The second place a sign-in is
      // cancelled, and the only one `signInWithBrowser` cannot see, because it
      // happens before the browser opens.
      this.log.info(vscode.l10n.t("Sign-in was cancelled."));
      throw new SignInCancelledError();
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
   *
   * That error is a {@link NoSuchSessionError} and the other two are not, which
   * is what lets a caller treat "nothing to remove" as ordinary while still
   * showing the trust refusal and a failing secret store.
   */
  async removeSession(sessionId: string): Promise<void> {
    // Gated too, though signing out only deletes. In an untrusted folder
    // `getSessions` hands back nothing, so every id reaching here is one this
    // window never issued, and the honest answer is the one the other two give
    // rather than "there is no sign-in with that id" — which is true, but says
    // the profile is wrong when the folder is.
    this.requireTrust();

    const profile = this.profileById(sessionId);
    if (profile === undefined) {
      throw new NoSuchSessionError(
        vscode.l10n.t(
          "There is no SAS Viya sign-in with that id to sign out of.",
        ),
      );
    }

    this.live.delete(profile.id);
    await this.sessions.clear(profile.id);
    this.log.info(vscode.l10n.t("Signed out of {0}.", profile.endpoint));
    await this.refreshPublished();
    // After the publish, so a listener that re-reads the session list sees it
    // already without this profile. Fires on the deliberate path only — never
    // from `refreshPublished`'s own diff.
    this.signedOut.fire();
  }

  /**
   * Re-reads the session list after the user trusts the folder.
   *
   * Trust can be granted in a window that is already open, and this extension
   * declares `untrustedWorkspaces.supported: "limited"`, so it keeps running
   * across that transition rather than being restarted into a trusted host.
   * Without this the gate above stays effectively closed until a reload: the
   * stored refresh token is readable, nothing asks, and the Accounts menu goes
   * on showing nothing while the user waits for the thing they just permitted.
   */
  async trustGranted(): Promise<void> {
    await this.refreshPublished();
  }

  dispose(): void {
    this.live.clear();
    // Dropped, not awaited and not cancelled. A renewal already in flight is a
    // request this provider no longer has anywhere to put the answer; the
    // transport's own timeout ends it, and holding the map would keep this
    // provider reachable from a pending promise after the window is done with
    // it.
    this.resolving.clear();
    this.changed.dispose();
    this.signedOut.dispose();
  }

  /**
   * The session for a profile, without prompting.
   *
   * The order matters. A live, unexpired token is served straight from memory —
   * this is the path the Accounts menu takes every time it polls, and it must
   * not touch the network. Only a token that is spent, or absent because this
   * window has just opened, reaches the refresh.
   *
   * Every route out of here that is not a session says why, in the log and
   * nowhere else. Nobody is waiting on this call — it happens because a menu was
   * drawn — so none of it is worth a dialog, and all of it is worth having when
   * someone asks why they are not signed in any more.
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
      // Two different facts, and only one of them is ordinary.
      //
      // A stored entry that exists but cannot be parsed is not either of them:
      // `SessionStore.read` has already discarded it and said so at warning
      // level, so what is left here is genuine absence.
      if (held === undefined) {
        // Nobody is signed in to this profile — a fresh window, a sign-out, or
        // a profile never used. Debug, and unlocalised like every other debug
        // line, because the Accounts menu polls this for every profile it can
        // see: at info a window with one unused profile would write this line
        // for as long as it stayed open.
        this.log.debug(`no stored sign-in for ${profile.endpoint}`);
      } else {
        // The one that looks like a defect from the outside: the user was
        // signed in a moment ago and the account has just left the menu. It
        // means the deployment issued no refresh token, so there was never
        // anything to renew from and the session could only last as long as its
        // access token. Info, not debug, because it happens exactly once — the
        // line below drops the expired session, so every later poll takes the
        // branch above — and because it is the answer to a question the user is
        // about to ask.
        this.log.info(
          vscode.l10n.t(
            "The sign-in for {0} has expired, and no stored sign-in was kept to renew it from. Sign in again to continue.",
            profile.endpoint,
          ),
        );
      }
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
        // Logged, never shown, on either path — for two different reasons.
        //
        // On `"new-sign-in"` the user is waiting on an answer, but they will get
        // one: `createSession` throws when this returns `undefined`, and VS Code
        // shows that rejection to whoever asked. A dialog here would be the same
        // failure reported twice, in two different wordings.
        //
        // On `"renewed-token"` nobody asked at all — a menu was opened, or a
        // token aged out — and a modal would interrupt whatever the user was
        // actually doing to report a background failure they did not cause. Same
        // reasoning as the refresh branch in `resolve`, and the severity follows
        // the same rule: an error the user is waiting on, a warning otherwise.
        const message = vscode.l10n.t(
          "Could not read the signed-in user for {0}: {1}",
          profile.endpoint,
          describeAuthProblem(result.problem),
        );
        if (identity === "new-sign-in") {
          this.log.error(message);
        } else {
          this.log.warn(message);
        }
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
   * Going through {@link allSessions} rather than constructing the new list here
   * is deliberate: the event has to describe what a listener would see if it
   * asked, and the only way to guarantee that is to ask. It asks the unfiltered
   * one — a refresh has no caller and therefore no account to narrow to.
   */
  private async refreshPublished(): Promise<void> {
    await this.allSessions();
  }

  /**
   * The profile an account belongs to, preferring the active one.
   *
   * An account names a deployment and a user; a profile names a deployment. Two
   * profiles can therefore share one account, and when one of them is active
   * that is the one meant — the alternative is signing in to a profile the user
   * is not looking at because it sorts first.
   */
  private profileForAccount(
    account: vscode.AuthenticationSessionAccountInformation,
  ): { name: string; profile: ViyaProfile } | undefined {
    const active = this.profiles.active();
    if (active !== undefined && ownsAccount(active.profile, account)) {
      return active;
    }

    for (const name of this.profiles.names()) {
      const profile = this.profiles.get(name);
      if (profile !== undefined && ownsAccount(profile, account)) {
        return { name, profile };
      }
    }
    return undefined;
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

  /**
   * Whether this window may hold a SAS Viya session at all.
   *
   * Workspace trust is not a formality here. A folder carries settings, and
   * `pythonOnViya.connectionProfiles` names the endpoint every token is
   * requested from and sent to; the manifest already lists it as a restricted
   * configuration for that reason. Signing in from an untrusted folder means a
   * repository someone cloned this morning gets to choose which server the user
   * authenticates to and, from Phase 2 on, runs code on under their identity.
   */
  private trusted(): boolean {
    return (this.deps.isTrusted ?? (() => vscode.workspace.isTrusted))();
  }

  /** {@link trusted}, as a precondition for the two calls that act. */
  private requireTrust(): void {
    if (this.trusted()) return;
    throw new Error(
      vscode.l10n.t(
        "Connecting to SAS Viya requires a trusted folder. Run Workspaces: Manage Workspace Trust and trust this folder, then try again.",
      ),
    );
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

/**
 * Whether an account was issued for this profile's deployment.
 *
 * Asked as "is this the sole account for that endpoint", with a list of one, so
 * the rule that builds an account id and the rule that reads one back stay in
 * the same function in `identity.ts`. A second, inlined prefix comparison here
 * is how the two drift apart the next time the id gains a component.
 */
function ownsAccount(
  profile: ViyaProfile,
  account: vscode.AuthenticationSessionAccountInformation,
): boolean {
  return accountForEndpoint(profile.endpoint, [account]) !== undefined;
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
    // Trust is granted while the window is open, and this extension keeps
    // running across that transition rather than being restarted. See
    // {@link ViyaAuthenticationProvider.trustGranted}.
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      void provider.trustGranted();
    }),
  );
}

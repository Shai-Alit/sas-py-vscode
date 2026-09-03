// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import * as vscode from "vscode";

import {
  AUTHORIZED_CONTEXT_KEY,
  AUTH_PROVIDER_ID,
  NoSuchSessionError,
  ViyaAuthenticationProvider,
} from "../../../src/auth/authProvider";
import { accountId } from "../../../src/auth/identity";
import { SessionStore } from "../../../src/auth/sessionStore";
import type { HttpTransport } from "../../../src/auth/transport";
import { AuthUriHandler } from "../../../src/auth/uriHandler";
import { ProfileStore } from "../../../src/profile/store";
import {
  delay,
  memoryMemento,
  memorySecrets,
  recordingLog,
  type LoggedLine,
} from "../../helpers/auth-host";
import { extensionId } from "../../helpers/manifest";

/**
 * The `AuthenticationProvider`, inside a real editor.
 *
 * Two different things are being proven here and they need different setups.
 *
 * The first is *registration*: that VS Code knows about a provider called
 * `pythonOnViya`, that the manifest agrees, and that asking for a session on a
 * window where nobody has signed in comes back empty rather than throwing. That
 * runs against the activated extension.
 *
 * The second is *behaviour*: refresh, the change event, the context key, and the
 * rule that `getSessions` must not touch the network for a token that is still
 * good. Those need a provider whose stores and transport are ours, so the tests
 * below build one. It is never registered — two providers under one id is an
 * error — so nothing here disturbs the extension's own.
 *
 * The Accounts menu polls `getSessions`. That is why "does not refresh a token
 * that is still good" is the most valuable assertion in the file: without it, an
 * open menu is a stream of token requests, and a deployment having a bad minute
 * signs the user out of something that was working.
 */

/** Not credentials: shapes that look like them, so the tests can follow them. */
const FAKE_ACCESS = "access-token-placeholder";
const FAKE_REFRESH = "refresh-token-placeholder";
const NEXT_ACCESS = "second-access-token-placeholder";

const ENDPOINT = "https://viya.example.com";
/** A second deployment, for the tests about which account a call is about. */
const OTHER_ENDPOINT = "https://viya-test.example.com";
const PROFILE_ID = "auth-provider-integration";
const OTHER_PROFILE_ID = "auth-provider-integration-second";
const USER_ID = "a7f3c1d9e2b4f6a80";
/** A second person at the same deployment, for the switch-accounts test. */
const OTHER_USER_ID = "b1c8d4e0f2a6b3c70";

/**
 * The origin of a URL, for assertions that mean "this deployment and no other".
 *
 * `url.startsWith(OTHER_ENDPOINT)` reads the same and is what these tests used
 * to say, but it is a host check only by accident: it is equally true of
 * `https://viya-test.example.com.example.net/`, and CodeQL says so
 * (`js/incomplete-url-substring-sanitization`, four alerts on this file). A
 * parsed-origin comparison is the check that was always meant. Silencing the
 * alert is a side effect of making it exact — the constant no longer reaches a
 * substring test at all — and it is worth doing in a test rather than dismissing
 * because the same shape in `src/` would be a real defect, and an accepted
 * alert here teaches the next reader that the shape is fine.
 */
const originOf = (url: string): string => new URL(url).origin;

interface Harness {
  provider: ViyaAuthenticationProvider;
  profiles: ProfileStore;
  sessions: SessionStore;
  /** Every URL the transport was asked for, in order. */
  requests: string[];
  /**
   * Who the identity endpoint says is signed in. Mutable mid-test: signing in
   * again as somebody else is the case the cache has to notice.
   */
  whoami: { id: string; name: string };
  /**
   * Whether the folder is trusted, as the provider sees it. Mutable mid-test:
   * trust is granted in a window that is already open, and this extension goes
   * on running across that transition instead of being restarted.
   */
  trust: { granted: boolean };
  /** Answers for the sign-in paste box, consumed in order. */
  answers: string[];
  /** Every set of options the paste box was opened with. */
  prompts: vscode.InputBoxOptions[];
  /** Keys and values passed to `setContext`. */
  contexts: { key: string; value: unknown }[];
  /** Sessions the change event reported, flattened. */
  events: vscode.AuthenticationProviderAuthenticationSessionsChangeEvent[];
  /** One entry per `onDidSignOut` fire — the deliberate-sign-out signal
   * (Phase 5d-iv), distinct from a `removed` in {@link events}. */
  signOuts: true[];
  /** Requests held by a stalled endpoint, and the way to let them answer. */
  stalled: Stalled;
  /** Every line the provider logged, with its level. See {@link recordingLog}. */
  logged: LoggedLine[];
  dispose(): void;
}

/**
 * A deployment that does not answer, and a way to make it answer later.
 *
 * The shape #133 is about. A `Promise` that is simply never resolved would prove
 * the budget and nothing else; being able to release it is what lets the tests
 * assert the second half — that the renewal was still running, landed, and was
 * served from memory afterwards rather than started again.
 */
interface Stalled {
  /** How many requests are being held right now. */
  readonly count: () => number;
  /** Answers every held request as the endpoint normally would. */
  readonly release: () => void;
}

function harness(
  options: {
    identityStatus?: number;
    refreshOk?: boolean;
    /** Lifetime of the tokens the fake endpoint issues. Default one hour. */
    expiresIn?: number;
    /**
     * A deployment configured not to issue refresh tokens. Not a failure and
     * not rare: the grant works, and the session simply cannot outlive its
     * access token because there is nothing to renew it from.
     */
    refreshToken?: boolean;
    /** Whether the folder starts out trusted. Default true, as the host is. */
    trusted?: boolean;
    /**
     * A deployment whose every request hangs until {@link Stalled.release}.
     *
     * Matched on the URL rather than on the profile, because that is what an
     * unreachable deployment is: the profile is fine and the host is not.
     */
    stall?: string;
    /** How long the provider waits for a profile it has to renew. */
    resolveBudgetMs?: number;
  } = {},
): Harness {
  const recorder = recordingLog("auth provider");
  const log = recorder.channel;
  const secrets = memorySecrets();
  const requests: string[] = [];
  const contexts: { key: string; value: unknown }[] = [];
  const events: vscode.AuthenticationProviderAuthenticationSessionsChangeEvent[] =
    [];
  const signOuts: true[] = [];
  const whoami = { id: USER_ID, name: "Dana Whitfield" };
  const trust = { granted: options.trusted ?? true };
  const answers: string[] = [];
  const prompts: vscode.InputBoxOptions[] = [];

  const held: (() => void)[] = [];
  // Sticky, rather than draining once. A renewal is two requests — the token
  // then the identity — and the second is only issued once the first answers, so
  // a release that only emptied the queue would hold the renewal at the second
  // leg and prove nothing. This is a deployment coming back, not one reply.
  let released = false;
  const stalled: Stalled = {
    count: () => held.length,
    release: () => {
      released = true;
      for (const answer of held.splice(0)) answer();
    },
  };

  // The init argument is deliberately not declared: nothing here reads it, and
  // a declared-but-unused parameter is a lint error rather than documentation.
  const transport: HttpTransport = async (url) => {
    requests.push(url);

    if (
      !released &&
      options.stall !== undefined &&
      url.startsWith(options.stall)
    ) {
      await new Promise<void>((resolve) => held.push(resolve));
    }

    if (url.includes("/identities/")) {
      const status = options.identityStatus ?? 200;
      return Promise.resolve({
        ok: status < 300,
        status,
        headers:
          status === 401
            ? { "www-authenticate": 'Bearer error="invalid_token"' }
            : {},
        text: () =>
          Promise.resolve(
            status < 300
              ? JSON.stringify({
                  id: whoami.id,
                  name: whoami.name,
                  externalLoginIds: ["dwhitfield"],
                })
              : "",
          ),
      });
    }

    // The token endpoint.
    const ok = options.refreshOk ?? true;
    return Promise.resolve({
      ok,
      status: ok ? 200 : 400,
      headers: {},
      text: () =>
        Promise.resolve(
          ok
            ? JSON.stringify({
                access_token: NEXT_ACCESS,
                ...(options.refreshToken === false
                  ? {}
                  : { refresh_token: FAKE_REFRESH }),
                token_type: "bearer",
                expires_in: options.expiresIn ?? 3600,
              })
            : JSON.stringify({ error: "invalid_grant" }),
        ),
    });
  };

  const profiles = new ProfileStore(
    {
      secrets,
      workspaceState: memoryMemento(),
      globalState: memoryMemento(),
    },
    log,
  );
  const sessions = new SessionStore(secrets, log);
  const handler = new AuthUriHandler(log);

  const provider = new ViyaAuthenticationProvider(
    extensionId(),
    profiles,
    sessions,
    handler,
    log,
    {
      token: { transport },
      identity: { transport },
      setContext: (key, value) => {
        contexts.push({ key, value });
        return Promise.resolve(undefined);
      },
      // The host's own answer is `true` for the whole run — it opens an empty
      // window, and empty windows are trusted — so the closed branch of the
      // gate is unreachable without this.
      isTrusted: () => trust.granted,
      ...(options.resolveBudgetMs === undefined
        ? {}
        : { resolveBudgetMs: options.resolveBudgetMs }),
      // Enough of the browser flow to drive `createSession` unattended. No
      // callback is ever dispatched here, so every sign-in below finishes
      // through the paste box — which is the ordinary route on a deployment
      // whose client registers only `oob` anyway. `browser-flow.test.ts` owns
      // the race between the two arms; this file only needs a way in.
      browser: {
        openExternal: () => Promise.resolve(true),
        showInputBox: async (
          boxOptions: vscode.InputBoxOptions,
          cancel: vscode.CancellationToken,
        ): Promise<string | undefined> => {
          prompts.push(boxOptions);
          while (answers.length === 0) {
            if (cancel.isCancellationRequested) return undefined;
            await delay(5);
          }
          return answers.shift();
        },
      },
    },
  );

  provider.onDidChangeSessions((event) => {
    events.push(event);
  });
  provider.onDidSignOut(() => {
    signOuts.push(true);
  });

  return {
    provider,
    profiles,
    sessions,
    requests,
    whoami,
    trust,
    answers,
    prompts,
    contexts,
    events,
    signOuts,
    stalled,
    logged: recorder.lines,
    dispose(): void {
      // The log channel is deliberately not disposed; see `testLogChannel`.
      provider.dispose();
      profiles.dispose();
      handler.dispose();
      secrets.dispose();
    },
  };
}

/** The lines whose text matches, at whatever level each was written. */
function linesMatching(logged: LoggedLine[], pattern: RegExp): LoggedLine[] {
  return logged.filter((line) => pattern.test(line.message));
}

const SECTION = "pythonOnViya";

async function set(key: string, value: unknown): Promise<void> {
  await vscode.workspace
    .getConfiguration(SECTION)
    .update(key, value, vscode.ConfigurationTarget.Global);
}

async function configureProfile(): Promise<void> {
  await set("connectionProfiles", {
    Prod: { version: 1, id: PROFILE_ID, endpoint: ENDPOINT },
  });
  await set("defaultProfile", "Prod");
}

/**
 * Two deployments in one window, with `Prod` active — the shape every account
 * hint exists for, and the one no test could express until `getSessions` and
 * `createSession` took an account.
 */
async function configureBothProfiles(): Promise<void> {
  await set("connectionProfiles", {
    Prod: { version: 1, id: PROFILE_ID, endpoint: ENDPOINT },
    Test: { version: 1, id: OTHER_PROFILE_ID, endpoint: OTHER_ENDPOINT },
  });
  await set("defaultProfile", "Prod");
}

describe("Viya authentication provider", () => {
  describe("as VS Code sees it", () => {
    before(async () => {
      const extension = vscode.extensions.getExtension(extensionId());
      assert.ok(extension, `${extensionId()} is not loaded`);
      await extension.activate();
    });

    it("contributes an authentication provider under the extension's id", () => {
      const extension = vscode.extensions.getExtension(extensionId());
      assert.ok(extension);

      const contributed = authenticationContributions(extension);
      const entry = contributed.find((item) => item.id === AUTH_PROVIDER_ID);

      assert.ok(entry, `contributes.authentication has no ${AUTH_PROVIDER_ID}`);
      // Without a label the Accounts menu offers a nameless row, which is worse
      // than not offering one.
      assert.ok(entry.label, "the authentication contribution has no label");
    });

    it("answers a session request on a window with nothing signed in", async () => {
      // `createIfNone: false` must not prompt, must not throw, and must not
      // reach the network. A provider that throws here breaks the Accounts menu
      // for every extension in the window, not just this one.
      const session = await vscode.authentication.getSession(
        AUTH_PROVIDER_ID,
        [],
        { createIfNone: false },
      );

      assert.equal(session, undefined);
    });
  });

  describe("with stores and transport under test", () => {
    let h: Harness;

    beforeEach(async () => {
      h = harness();
      await configureProfile();
    });

    afterEach(async () => {
      h.dispose();
      // The host reuses one user-data directory for the whole run, so a profile
      // left behind is a profile the next suite has to reason about.
      await set("connectionProfiles", undefined);
      await set("defaultProfile", undefined);
    });

    it("reports no sessions, and no authorization, before anyone signs in", async () => {
      const sessions = await h.provider.getSessions();

      assert.deepEqual(sessions, []);
      assert.equal(h.requests.length, 0, "an empty store made a request");
      assert.deepEqual(h.contexts.at(-1), {
        key: AUTHORIZED_CONTEXT_KEY,
        value: false,
      });
    });

    it("materialises a session from a stored refresh token", async () => {
      // The fresh-window case: the access token was never written to disk, so
      // the first read has to renew it and then ask who it belongs to.
      await h.sessions.write(PROFILE_ID, {
        accessToken: FAKE_ACCESS,
        refreshToken: FAKE_REFRESH,
        tokenType: "bearer",
      });

      const sessions = await h.provider.getSessions();

      assert.equal(sessions.length, 1);
      // Only the first read is optional-chained; asserting it narrows
      // `sessions[0]` for the rest, and a provably redundant chain is an error.
      assert.equal(sessions[0]?.id, PROFILE_ID);
      assert.equal(sessions[0].accessToken, NEXT_ACCESS);
      assert.equal(sessions[0].account.id, accountId(ENDPOINT, USER_ID));
      assert.equal(sessions[0].account.label, "Dana Whitfield");
      assert.deepEqual(h.contexts.at(-1), {
        key: AUTHORIZED_CONTEXT_KEY,
        value: true,
      });
    });

    it("does not refresh a token that is still good", async () => {
      // The assertion this file exists for. Upstream refreshes on every
      // `getSessions`, and the Accounts menu polls it.
      await h.sessions.write(PROFILE_ID, {
        accessToken: FAKE_ACCESS,
        refreshToken: FAKE_REFRESH,
        tokenType: "bearer",
      });
      await h.provider.getSessions();
      const afterFirst = h.requests.length;

      await h.provider.getSessions();
      await h.provider.getSessions();

      assert.equal(
        h.requests.length,
        afterFirst,
        "polling the session list went to the network",
      );
    });

    it("fires the change event once, on the transition", async () => {
      await h.sessions.write(PROFILE_ID, {
        accessToken: FAKE_ACCESS,
        refreshToken: FAKE_REFRESH,
        tokenType: "bearer",
      });

      await h.provider.getSessions();
      await h.provider.getSessions();
      await h.provider.getSessions();

      assert.equal(h.events.length, 1, "a settled session list fired an event");
      assert.equal(h.events[0]?.added?.length, 1);
    });

    it("keeps quiet when there is nothing to report", async () => {
      await h.provider.getSessions();
      await h.provider.getSessions();

      assert.deepEqual(h.events, []);
    });

    it("reports a sign-out as removed", async () => {
      await h.sessions.write(PROFILE_ID, {
        accessToken: FAKE_ACCESS,
        refreshToken: FAKE_REFRESH,
        tokenType: "bearer",
      });
      await h.provider.getSessions();

      await h.provider.removeSession(PROFILE_ID);

      assert.equal(h.events.at(-1)?.removed?.length, 1);
      assert.equal(
        h.signOuts.length,
        1,
        "onDidSignOut fired once for the deliberate sign-out",
      );
      assert.deepEqual(await h.provider.getSessions(), []);
      assert.deepEqual(h.contexts.at(-1), {
        key: AUTHORIZED_CONTEXT_KEY,
        value: false,
      });
    });

    it("reports a session as removed when it drops off a poll, but does not fire onDidSignOut for it", async () => {
      // A profile can leave the published list without the user signing out —
      // an unreadable keychain entry, a renewal that misses the resolve budget
      // (`within`), or trust revoked mid-window. All of them make `allSessions`
      // publish a shorter list, which fires `onDidChangeSessions` with a
      // `removed`; its existing consumer (`forgetProfile`) is self-healing.
      // `onDidSignOut` (Phase 5d-iv) must not fire for it — its consumer clears
      // the Problems panel, which a transient drop should not. Trust revocation
      // is the one such drop that doesn't need the in-memory token to have
      // expired first (`getSessions` serves a live token straight from memory).
      await h.sessions.write(PROFILE_ID, {
        accessToken: FAKE_ACCESS,
        refreshToken: FAKE_REFRESH,
        tokenType: "bearer",
      });
      await h.provider.getSessions();

      h.trust.granted = false;
      await h.provider.getSessions();

      assert.equal(
        h.events.at(-1)?.removed?.length,
        1,
        "the diff still reported it gone",
      );
      assert.equal(h.signOuts.length, 0, "but no deliberate sign-out fired");
    });

    it("refuses to sign out of an id it did not issue", async () => {
      // Upstream falls back to the active profile here, which turns a caller's
      // bug into signing the user out of a deployment they never named — and,
      // because it is a fallback rather than a failure, nothing reports it.
      //
      // The *type* is asserted, not just the rejection. `signOut` in
      // `commands.ts` reports this case as an ordinary outcome and everything
      // else as a failure, so a plain `Error` here would quietly turn the
      // workspace-trust refusal into "you are not signed in".
      await assert.rejects(
        () => h.provider.removeSession("not-a-profile-id"),
        NoSuchSessionError,
      );
    });

    it("does not persist the access token", async () => {
      await h.sessions.write(PROFILE_ID, {
        accessToken: FAKE_ACCESS,
        refreshToken: FAKE_REFRESH,
        tokenType: "bearer",
      });

      const sessions = await h.provider.getSessions();
      assert.equal(sessions[0]?.accessToken, NEXT_ACCESS);

      const stored = await h.sessions.read(PROFILE_ID);
      assert.equal(stored?.refreshToken, FAKE_REFRESH);
      assert.ok(
        !JSON.stringify(stored).includes(NEXT_ACCESS),
        "the access token reached the secret store",
      );
    });

    it("serves no session when the refresh is refused, and does not throw", async () => {
      // A revoked refresh token, or an administrator disabling the client. It is
      // a background failure nobody asked for, so it belongs in the log and not
      // in a dialog over whatever the user was doing.
      const refused = harness({ refreshOk: false });
      try {
        await refused.sessions.write(PROFILE_ID, {
          accessToken: FAKE_ACCESS,
          refreshToken: FAKE_REFRESH,
          tokenType: "bearer",
        });

        assert.deepEqual(await refused.provider.getSessions(), []);
        assert.deepEqual(refused.contexts.at(-1), {
          key: AUTHORIZED_CONTEXT_KEY,
          value: false,
        });
      } finally {
        refused.dispose();
      }
    });

    it("asks who signed in again when a second sign-in follows the first", async () => {
      // Switching accounts on one deployment: sign in as somebody else while the
      // first session is still held. The identity is cached in memory for the
      // window, and reusing it here would hand back a session labelled with the
      // previous user while carrying the new user's access token — a wrong name
      // against a real credential. Nothing covered this before the review that
      // found it, because until now `createSession` could not be driven without
      // opening a browser.
      h.answers.push("first-code");
      const first = await h.provider.createSession();
      assert.equal(first.account.label, "Dana Whitfield");

      h.whoami.id = OTHER_USER_ID;
      h.whoami.name = "Ravi Mehta";
      h.answers.push("second-code");
      const second = await h.provider.createSession();

      assert.equal(second.account.label, "Ravi Mehta");
      assert.equal(second.account.id, accountId(ENDPOINT, OTHER_USER_ID));
      assert.equal(h.prompts.length, 2, "the second sign-in never ran");
      assert.equal(
        h.requests.filter((url) => url.includes("/identities/")).length,
        2,
        "the second sign-in served the first sign-in's identity from cache",
      );
    });

    it("answers for the account asked for without unpublishing the others", async () => {
      await configureBothProfiles();
      for (const id of [PROFILE_ID, OTHER_PROFILE_ID]) {
        await h.sessions.write(id, {
          accessToken: FAKE_ACCESS,
          refreshToken: FAKE_REFRESH,
          tokenType: "bearer",
        });
      }
      await h.provider.getSessions();
      assert.equal(
        h.events.length,
        1,
        "two sessions did not arrive as one add",
      );

      const filtered = await h.provider.getSessions([], {
        account: { id: accountId(OTHER_ENDPOINT, USER_ID), label: "Dana" },
      });

      assert.deepEqual(
        filtered.map((session) => session.id),
        [OTHER_PROFILE_ID],
      );
      // The filter is the caller's view, never the published one. Publishing it
      // would announce the other session as removed and — when the account
      // named has no session at all — turn the authorized context key off
      // because somebody else's account was the one queried.
      assert.equal(
        h.events.length,
        1,
        "narrowing the answer reported the other session as removed",
      );
      assert.deepEqual(h.contexts.at(-1), {
        key: AUTHORIZED_CONTEXT_KEY,
        value: true,
      });
    });

    it("signs in to the profile the account names, not the active one", async () => {
      // The Accounts menu's *sign in again* passes the row it was clicked on.
      // Without this it would sign in to whichever profile happened to be
      // active — here `Prod` — and replace a different account's session.
      await configureBothProfiles();
      h.answers.push("a-code");

      const session = await h.provider.createSession([], {
        account: { id: accountId(OTHER_ENDPOINT, USER_ID), label: "Dana" },
      });

      assert.equal(session.id, OTHER_PROFILE_ID);
    });

    it("refuses an account no profile uses", async () => {
      await configureBothProfiles();

      await assert.rejects(
        () =>
          h.provider.createSession([], {
            account: {
              id: accountId("https://elsewhere.example.com", USER_ID),
              label: "Dana",
            },
          }),
        { message: /No connection profile uses/ },
      );
      // Refused before the browser flow, not after it: the paste box never
      // opened, so nothing asked the user to authorise a sign-in with nowhere
      // to put the result.
      assert.deepEqual(h.prompts, []);
    });

    it("does not ask who we are again when only the token was renewed", async () => {
      // The other half of the same decision, and the reason the cache is still
      // there: a renewal is the same grant and the same user, and this resource
      // sends `no-store` with no `ETag` (probe finding 9), so a second lookup
      // would be a network round trip that cannot learn anything. Thirty seconds
      // is inside the expiry skew, so every read renews.
      const shortLived = harness({ expiresIn: 30 });
      try {
        await shortLived.sessions.write(PROFILE_ID, {
          accessToken: FAKE_ACCESS,
          refreshToken: FAKE_REFRESH,
          tokenType: "bearer",
        });

        await shortLived.provider.getSessions();
        await shortLived.provider.getSessions();

        const identities = shortLived.requests.filter((url) =>
          url.includes("/identities/"),
        );
        const renewals = shortLived.requests.filter((url) =>
          url.includes("/SASLogon/"),
        );
        assert.equal(renewals.length, 2, "the spent token was not renewed");
        assert.equal(identities.length, 1, "a renewal re-read the identity");
      } finally {
        shortLived.dispose();
      }
    });

    it("serves no session when the deployment will not say who we are", async () => {
      // A token that renews but an identity endpoint that 401s. Reporting a
      // session with no account behind it would put an empty row in the menu.
      const anonymous = harness({ identityStatus: 401 });
      try {
        await anonymous.sessions.write(PROFILE_ID, {
          accessToken: FAKE_ACCESS,
          refreshToken: FAKE_REFRESH,
          tokenType: "bearer",
        });

        assert.deepEqual(await anonymous.provider.getSessions(), []);
      } finally {
        anonymous.dispose();
      }
    });

    it("still tells whoever asked when the identity read fails during sign-in", async () => {
      // The same failure as above, reached from the other direction, and the
      // reason that one can be silent: nobody asked for a background renewal,
      // but somebody is standing in front of a sign-in waiting for an answer.
      // `establish` reports neither case in a dialog — it logs, at error here
      // and at warning there — so this rejection is now the *only* thing that
      // tells the user, and it has to survive.
      const anonymous = harness({ identityStatus: 401 });
      try {
        anonymous.answers.push("a-code");
        await assert.rejects(() => anonymous.provider.createSession(), {
          message: /would not say who you are signed in as/,
        });
      } finally {
        anonymous.dispose();
      }
    });

    /**
     * #132. Both ways `resolve` can find nothing, told apart.
     *
     * These assert on log *wording*, which almost nothing else here does and
     * which is normally a bad trade. It is the right one exactly when the log
     * line is the whole deliverable: what is being tested is that the two
     * silences were separated at all, and at which level each landed. Nothing
     * else observable differs between them — both return no session.
     */
    it("says at debug that a profile has no stored sign-in", async () => {
      await h.provider.getSessions();

      // Mapped to levels rather than indexed, which says "once, at debug" in
      // one assertion. Indexing would need `said[0]?.level`, and the first
      // `assert.equal` on it narrows the element to non-nullish — so every
      // later `?.` on it is a lint error, and the test would only pass in the
      // order its assertions happen to be written in.
      const said = linesMatching(h.logged, /no stored sign-in for/);
      assert.deepEqual(
        said.map((line) => line.level),
        ["debug"],
        "the empty case did not say so exactly once, at debug",
      );
      assert.ok(
        said.every((line) => line.message.includes(originOf(ENDPOINT))),
        "the line did not name the deployment",
      );
      // At info this fires on every poll of the Accounts menu, for every
      // profile nobody has signed in to, for as long as the window is open.
      assert.deepEqual(
        h.logged.filter((line) => line.level === "info"),
        [],
      );
    });

    it("says at info when a session expires with nothing to renew it from", async () => {
      // A deployment that issues no refresh token. The grant works and then the
      // account leaves the Accounts menu on its own, which from the outside is
      // indistinguishable from a defect — so this one is worth saying out loud,
      // at a level the log shows without being asked. Thirty seconds is inside
      // the expiry skew, so the token is spent by the time anything reads it.
      const noRenewal = harness({ refreshToken: false, expiresIn: 30 });
      try {
        noRenewal.answers.push("a-code");
        await noRenewal.provider.createSession();

        const said = linesMatching(
          noRenewal.logged,
          /no stored sign-in was kept/,
        );
        assert.deepEqual(
          said.map((line) => line.level),
          ["info"],
          "an expiry with nothing stored was silent, or was not at info",
        );
        assert.ok(
          said.every((line) => line.message.includes(originOf(ENDPOINT))),
          "the line did not name the deployment",
        );

        // And exactly once. The expired session is dropped as it is reported,
        // so the profile falls back to the ordinary empty case rather than
        // repeating this on every poll for the rest of the window.
        await noRenewal.provider.getSessions();
        assert.equal(
          linesMatching(noRenewal.logged, /no stored sign-in was kept/).length,
          1,
          "the expiry was reported again on a later read",
        );
        assert.equal(
          linesMatching(noRenewal.logged, /no stored sign-in for/).length,
          1,
          "the later read did not fall back to the quiet case",
        );
      } finally {
        noRenewal.dispose();
      }
    });
  });

  /**
   * #133. Two profiles, one deployment that does not answer.
   *
   * The shape is Sean's: a test Viya that is switched off at weekends alongside
   * a production one that is not. Before this, `getSessions` resolved profiles
   * in turn, so the working deployment's session was held behind the full
   * thirty-second token timeout of the one that was down — and `getSessions` is
   * what the Accounts menu is drawn from.
   *
   * The budget is fifty milliseconds here rather than ten seconds. What is being
   * tested is the arrangement, not the number, and a suite that waited out the
   * real budget four times would be a minute long.
   */
  describe("when one deployment does not answer", () => {
    const BUDGET_MS = 50;
    let h: Harness;

    beforeEach(async () => {
      h = harness({ stall: OTHER_ENDPOINT, resolveBudgetMs: BUDGET_MS });
      await configureBothProfiles();
      // Both are signed in, so both have a renewal to do on the first read.
      // Without the second write the stalled profile would return before it
      // reached the network and prove nothing.
      for (const id of [PROFILE_ID, OTHER_PROFILE_ID]) {
        await h.sessions.write(id, {
          accessToken: FAKE_ACCESS,
          refreshToken: FAKE_REFRESH,
          tokenType: "bearer",
        });
      }
    });

    afterEach(async () => {
      h.dispose();
      await set("connectionProfiles", undefined);
      await set("defaultProfile", undefined);
    });

    it("answers with the profiles that did answer", async () => {
      const sessions = await h.provider.getSessions();

      assert.deepEqual(
        sessions.map((session) => session.id),
        [PROFILE_ID],
        "a deployment that is down decided what the menu shows",
      );
      // Still running, not abandoned: the budget bounds the answer, not the
      // work, which is what makes the next assertion below possible.
      assert.equal(h.stalled.count(), 1, "the renewal was not still in flight");
      // One working session is still an authorized window. A `when` clause that
      // turned off because an unrelated deployment was unreachable would
      // withdraw commands from a profile that is signed in and fine.
      assert.deepEqual(h.contexts.at(-1), {
        key: AUTHORIZED_CONTEXT_KEY,
        value: true,
      });
    });

    it("does not start a second renewal while the first is still running", async () => {
      // The reason the in-flight map exists. The menu polls, and a poll that
      // opened another socket to the deployment that is already not answering
      // would make the unreachable one the one accumulating connections.
      await h.provider.getSessions();
      await h.provider.getSessions();
      await h.provider.getSessions();

      const attempts = h.requests.filter(
        (url) => originOf(url) === originOf(OTHER_ENDPOINT),
      );
      assert.equal(attempts.length, 1, "polling piled up renewals on it");
    });

    it("serves the late arrival from memory, without asking again", async () => {
      await h.provider.getSessions();

      h.stalled.release();
      // The renewal is two hops — token then identity — and both resolve
      // immediately once released, so this is scheduling slack rather than a
      // wait on anything.
      await delay(25);

      const sessions = await h.provider.getSessions();

      assert.deepEqual(
        sessions.map((session) => session.id).sort(),
        [OTHER_PROFILE_ID, PROFILE_ID].sort(),
        "the session that landed late never appeared",
      );
      const renewals = h.requests.filter(
        (url) =>
          originOf(url) === originOf(OTHER_ENDPOINT) &&
          url.includes("/SASLogon/"),
      );
      assert.equal(renewals.length, 1, "the landed session was renewed again");
    });

    it("waits without a budget for the account the caller named", async () => {
      // A caller that names an account is not a menu poll: it knows which
      // deployment it wants and is asking deliberately, so a slow answer is
      // better than a wrong one. The compute connect is that caller.
      let settled = false;
      const asking = h.provider
        .getSessions([], {
          account: { id: accountId(OTHER_ENDPOINT, USER_ID), label: "Dana" },
        })
        .then((sessions) => {
          settled = true;
          return sessions;
        });

      await delay(BUDGET_MS * 4);
      assert.equal(settled, false, "the named account was given up on");

      h.stalled.release();

      assert.deepEqual(
        (await asking).map((session) => session.id),
        [OTHER_PROFILE_ID],
      );
    });
  });

  describe("in an untrusted folder", () => {
    let h: Harness;

    beforeEach(async () => {
      h = harness({ trusted: false });
      await configureProfile();
      // A session that is genuinely there: the point is that the gate refuses to
      // serve it, not that there was nothing to serve.
      await h.sessions.write(PROFILE_ID, {
        accessToken: FAKE_ACCESS,
        refreshToken: FAKE_REFRESH,
        tokenType: "bearer",
      });
    });

    afterEach(async () => {
      h.dispose();
      await set("connectionProfiles", undefined);
      await set("defaultProfile", undefined);
    });

    it("serves nothing, and reaches neither the store nor the network", async () => {
      assert.deepEqual(await h.provider.getSessions(), []);
      assert.equal(
        h.requests.length,
        0,
        "an untrusted folder renewed a token anyway",
      );
    });

    it("says so through the authorized context key", async () => {
      // The `when` clause Phase 2 gates running code on. If this stayed true
      // while `getSessions` refused to serve, a menu would offer to run code on
      // a server using a session that cannot be produced.
      await h.provider.getSessions();

      assert.deepEqual(h.contexts.at(-1), {
        key: AUTHORIZED_CONTEXT_KEY,
        value: false,
      });
    });

    it("refuses to sign in, and names the reason", async () => {
      // Rejecting rather than returning empty: this one the user did ask for,
      // and "nothing happened" is the least useful possible answer.
      await assert.rejects(() => h.provider.createSession(), {
        message: /trusted folder/,
      });
      assert.equal(h.prompts.length, 0, "the sign-in flow started anyway");
    });

    it("refuses to sign out for the same reason, not a different one", async () => {
      // The id is real. Without the gate this would reach `profileById`, find
      // it, and clear a credential; with a gate that only covered the other two
      // it would report "no sign-in with that id", which says the profile is
      // wrong when the folder is.
      await assert.rejects(() => h.provider.removeSession(PROFILE_ID), {
        message: /trusted folder/,
      });
      // And it is not the error the sign-out command treats as benign. Without
      // this, the gate could be reported to the user as "you are not signed in"
      // — which would be the second time this refusal was described as
      // something the profile did wrong.
      await assert.rejects(
        () => h.provider.removeSession(PROFILE_ID),
        (error: unknown) => !(error instanceof NoSuchSessionError),
      );
      assert.notEqual(
        await h.sessions.read(PROFILE_ID),
        undefined,
        "the refresh token was cleared from an untrusted folder",
      );
    });

    it("picks the session up when trust is granted, without a reload", async () => {
      assert.deepEqual(await h.provider.getSessions(), []);

      h.trust.granted = true;
      await h.provider.trustGranted();

      assert.equal(h.events.at(-1)?.added?.length, 1);
      assert.deepEqual(h.contexts.at(-1), {
        key: AUTHORIZED_CONTEXT_KEY,
        value: true,
      });
    });
  });
});

interface AuthenticationContribution {
  id?: string;
  label?: string;
}

/**
 * The manifest's `contributes.authentication`, read from the loaded extension
 * rather than from the file on disk — the packaged manifest is the one VS Code
 * reads the provider id out of.
 */
function authenticationContributions(
  extension: vscode.Extension<unknown>,
): AuthenticationContribution[] {
  const packaged: unknown = extension.packageJSON as unknown;
  if (
    typeof packaged !== "object" ||
    packaged === null ||
    !("contributes" in packaged)
  ) {
    throw new Error("the loaded extension has no contributes section");
  }

  const section: unknown = packaged.contributes;
  if (
    typeof section !== "object" ||
    section === null ||
    !("authentication" in section) ||
    !Array.isArray(section.authentication)
  ) {
    throw new Error("the loaded extension contributes no authentication");
  }

  return section.authentication as AuthenticationContribution[];
}

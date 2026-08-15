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
  testLogChannel,
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
  dispose(): void;
}

function harness(
  options: {
    identityStatus?: number;
    refreshOk?: boolean;
    /** Lifetime of the tokens the fake endpoint issues. Default one hour. */
    expiresIn?: number;
    /** Whether the folder starts out trusted. Default true, as the host is. */
    trusted?: boolean;
  } = {},
): Harness {
  const log = testLogChannel("auth provider");
  const secrets = memorySecrets();
  const requests: string[] = [];
  const contexts: { key: string; value: unknown }[] = [];
  const events: vscode.AuthenticationProviderAuthenticationSessionsChangeEvent[] =
    [];
  const whoami = { id: USER_ID, name: "Dana Whitfield" };
  const trust = { granted: options.trusted ?? true };
  const answers: string[] = [];
  const prompts: vscode.InputBoxOptions[] = [];

  // The init argument is deliberately not declared: nothing here reads it, and
  // a declared-but-unused parameter is a lint error rather than documentation.
  const transport: HttpTransport = (url) => {
    requests.push(url);

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
                refresh_token: FAKE_REFRESH,
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
    dispose(): void {
      // The log channel is deliberately not disposed; see `testLogChannel`.
      provider.dispose();
      profiles.dispose();
      handler.dispose();
      secrets.dispose();
    },
  };
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
      assert.deepEqual(await h.provider.getSessions(), []);
      assert.deepEqual(h.contexts.at(-1), {
        key: AUTHORIZED_CONTEXT_KEY,
        value: false,
      });
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

// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import * as vscode from "vscode";

import {
  AUTHORIZED_CONTEXT_KEY,
  AUTH_PROVIDER_ID,
  ViyaAuthenticationProvider,
} from "../../../src/auth/authProvider";
import { accountId } from "../../../src/auth/identity";
import { SessionStore } from "../../../src/auth/sessionStore";
import type { HttpTransport } from "../../../src/auth/transport";
import { AuthUriHandler } from "../../../src/auth/uriHandler";
import { ProfileStore } from "../../../src/profile/store";
import {
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
const PROFILE_ID = "auth-provider-integration";
const USER_ID = "a7f3c1d9e2b4f6a80";

interface Harness {
  provider: ViyaAuthenticationProvider;
  profiles: ProfileStore;
  sessions: SessionStore;
  /** Every URL the transport was asked for, in order. */
  requests: string[];
  /** Keys and values passed to `setContext`. */
  contexts: { key: string; value: unknown }[];
  /** Sessions the change event reported, flattened. */
  events: vscode.AuthenticationProviderAuthenticationSessionsChangeEvent[];
  dispose(): void;
}

function harness(
  options: { identityStatus?: number; refreshOk?: boolean } = {},
): Harness {
  const log = testLogChannel("auth provider");
  const secrets = memorySecrets();
  const requests: string[] = [];
  const contexts: { key: string; value: unknown }[] = [];
  const events: vscode.AuthenticationProviderAuthenticationSessionsChangeEvent[] =
    [];

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
                  id: USER_ID,
                  name: "Dana Whitfield",
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
                expires_in: 3600,
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
      await assert.rejects(() => h.provider.removeSession("not-a-profile-id"));
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

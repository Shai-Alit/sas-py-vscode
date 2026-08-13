// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { SessionStore } from "../../../src/auth/sessionStore";
import {
  SESSION_SCHEMA_VERSION,
  sessionSecretKey,
} from "../../../src/auth/signIn";
import type { Tokens } from "../../../src/auth/tokenEndpoint";
import { secretKey } from "../../../src/profile/model";
import { memorySecrets, testLogChannel } from "../../helpers/auth-host";

/**
 * The session store, in a host, against a `SecretStorage` double.
 *
 * Why a double and what it costs is written up in `test/helpers/auth-host.ts`.
 * The short version: a context is only given to `activate`, and the alternative
 * was a test-only export on the extension's public surface. The real
 * `context.secrets` is exercised through the sign-out command next door.
 *
 * What is actually under test here is the store's own behaviour on the paths that
 * only reach a decision at runtime — a corrupt entry, a grant with no refresh
 * token — both of which log through `vscode.l10n.t()` and so cannot be reached
 * from the unit tier at all.
 */

/** Not a credential: a shape that looks like one. */
const FAKE_REFRESH = "refresh-token-placeholder";
const PROFILE_ID = "session-store-integration";

function tokens(): Tokens {
  return {
    accessToken: "access-token-placeholder",
    refreshToken: FAKE_REFRESH,
    tokenType: "bearer",
    expiresAt: Date.now() + 3_600_000,
  };
}

/** A grant from a deployment configured not to issue refresh tokens. */
function tokensWithoutRefresh(): Tokens {
  return { accessToken: "access-token-placeholder", tokenType: "bearer" };
}

describe("stored sessions", () => {
  // One channel for the suite, not one per test: see `testLogChannel`.
  const log = testLogChannel("session store");
  let secrets: ReturnType<typeof memorySecrets>;
  let store: SessionStore;

  beforeEach(() => {
    secrets = memorySecrets();
    store = new SessionStore(secrets, log);
  });

  afterEach(() => {
    secrets.dispose();
  });

  it("round-trips a session through the keychain", async () => {
    await store.write(PROFILE_ID, tokens());

    const read = await store.read(PROFILE_ID);
    assert.ok(read, "a session was written and did not come back");
    assert.equal(read.refreshToken, FAKE_REFRESH);
  });

  it("stamps the stored record with a schema version", async () => {
    // The version is what lets a future shape be recognised as old rather than
    // corrupt, and it is only visible in the raw entry — `StoredSession` does not
    // carry it, because nothing above this layer should be deciding on it.
    await store.write(PROFILE_ID, tokens());

    const raw = secrets.entries.get(sessionSecretKey(PROFILE_ID));
    assert.ok(raw);
    assert.deepEqual(JSON.parse(raw) as unknown, {
      v: SESSION_SCHEMA_VERSION,
      refreshToken: FAKE_REFRESH,
    });
  });

  it("persists the refresh token and nothing else", async () => {
    // Not tidiness: an access token on disk is a second long-lived copy of a
    // credential bought for a few minutes of convenience. Upstream keeps both.
    await store.write(PROFILE_ID, tokens());

    const raw = secrets.entries.get(sessionSecretKey(PROFILE_ID)) ?? "";
    assert.ok(!raw.includes("access-token-placeholder"), raw);
  });

  it("keys the session apart from the profile's client secret", () => {
    // Two secrets per profile, and signing out must destroy exactly one of them.
    // Both are keyed on the generated `id` rather than the name, which is
    // ADR-0007's delta from upstream.
    assert.notEqual(
      sessionSecretKey(PROFILE_ID),
      secretKey({ id: PROFILE_ID }),
    );
  });

  it("stores nothing under a name the user could rename", async () => {
    await store.write(PROFILE_ID, tokens());
    assert.deepEqual(
      [...secrets.entries.keys()],
      [`pythonOnViya.session.${PROFILE_ID}`],
    );
  });

  it("has nothing to report for a profile that never signed in", async () => {
    assert.equal(await store.read("never-signed-in"), undefined);
  });

  it("clears rather than storing a grant with no refresh token", async () => {
    // Some deployments are configured not to issue one. The honest record of
    // that is no stored session, so the next window starts at the browser.
    await store.write(PROFILE_ID, tokens());
    await store.write(PROFILE_ID, tokensWithoutRefresh());

    assert.equal(secrets.entries.size, 0);
    assert.equal(await store.read(PROFILE_ID), undefined);
  });

  it("discards an entry it cannot read instead of complaining forever", async () => {
    await secrets.store(sessionSecretKey(PROFILE_ID), "{ not json");

    assert.equal(await store.read(PROFILE_ID), undefined);
    assert.equal(
      secrets.entries.size,
      0,
      "an unreadable session was left in the keychain",
    );
  });

  it("discards an entry written by a schema it does not know", async () => {
    await secrets.store(
      sessionSecretKey(PROFILE_ID),
      JSON.stringify({ v: SESSION_SCHEMA_VERSION + 1, refreshToken: "x" }),
    );

    assert.equal(await store.read(PROFILE_ID), undefined);
    assert.equal(secrets.entries.size, 0);
  });

  it("forgets a session on request and does not mind being asked twice", async () => {
    await store.write(PROFILE_ID, tokens());
    await store.clear(PROFILE_ID);
    await store.clear(PROFILE_ID);

    assert.equal(secrets.entries.size, 0);
  });
});

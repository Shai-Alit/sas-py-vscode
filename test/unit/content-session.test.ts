// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  type ContentClient,
  type ContentClientConfig,
} from "../../src/content/client";
import {
  ContentSession,
  type AccountLike,
  type SessionLike,
} from "../../src/content/contentSession";

/**
 * The adapter lifecycle behind the SAS Content view — build, endpoint-cache,
 * sign-out clear — and the silent, account-hinted token flow. This is the
 * logic `contentExplorer.ts` used to carry inline; it lives here so the unit
 * tier can pin it, the way `src/run/environmentPanel.ts` splits its store out.
 */

const ENDPOINT = "https://viya.example.com";
const OTHER_ENDPOINT = "https://other.example.com";

function harness(
  over: {
    accounts?: readonly AccountLike[];
    getSession?: (
      a: AccountLike | undefined,
    ) => Promise<SessionLike | undefined>;
  } = {},
) {
  const configs: ContentClientConfig[] = [];
  const noopClient: ContentClient = {
    send: () => Promise.reject(new Error("unused")),
  };
  const session = new ContentSession({
    createClient: (config) => {
      configs.push(config);
      return noopClient;
    },
    listAccounts: () => Promise.resolve(over.accounts ?? []),
    getSession:
      over.getSession ??
      (() => Promise.resolve<SessionLike | undefined>({ accessToken: "tok" })),
  });
  return { session, configs };
}

describe("content/ContentSession", () => {
  it("builds one adapter per endpoint and reuses it while the endpoint holds", () => {
    const { session, configs } = harness();
    const a = session.adapterFor(ENDPOINT);
    const b = session.adapterFor(ENDPOINT);
    assert.ok(a);
    assert.equal(a, b);
    assert.equal(configs.length, 1);
    assert.equal(configs[0]?.root, ENDPOINT);
  });

  it("serves a distinct adapter per endpoint and keeps each one", () => {
    const { session, configs } = harness();
    const a = session.adapterFor(ENDPOINT);
    const b = session.adapterFor(OTHER_ENDPOINT);
    assert.notEqual(a, b);
    assert.deepEqual(
      configs.map((c) => c.root),
      [ENDPOINT, OTHER_ENDPOINT],
    );
    // Going back to the first endpoint reuses its adapter — a file still open
    // from it survives a profile switch.
    assert.equal(session.adapterFor(ENDPOINT), a);
    assert.equal(configs.length, 2);
  });

  it("returns undefined for an absent endpoint without dropping the cache", () => {
    const { session, configs } = harness();
    const a = session.adapterFor(ENDPOINT);
    assert.equal(session.adapterFor(undefined), undefined);
    assert.equal(session.adapterFor(ENDPOINT), a);
    assert.equal(configs.length, 1);
  });

  it("clear() forces the next adapterFor to rebuild", () => {
    const { session, configs } = harness();
    session.adapterFor(ENDPOINT);
    session.clear();
    session.adapterFor(ENDPOINT);
    assert.equal(configs.length, 2);
  });

  describe("the token function it hands the client", () => {
    it("resolves the account for the endpoint and returns the session's token", async () => {
      const hints: (AccountLike | undefined)[] = [];
      const { session, configs } = harness({
        accounts: [
          { id: `${ENDPOINT}::alex` },
          { id: `${OTHER_ENDPOINT}::sam` },
        ],
        getSession: (account) => {
          hints.push(account);
          return Promise.resolve({ accessToken: "live-token" });
        },
      });
      session.adapterFor(ENDPOINT);
      const token = await configs[0]?.token();
      assert.equal(token, "live-token");
      assert.equal(hints[0]?.id, `${ENDPOINT}::alex`);
    });

    it("throws when there is no session, so the client reports not-authenticated", async () => {
      const { session, configs } = harness({
        getSession: () => Promise.resolve(undefined),
      });
      session.adapterFor(ENDPOINT);
      await assert.rejects(() => Promise.resolve(configs[0]?.token()));
    });

    it("passes no hint when the endpoint matches no single account", async () => {
      const hints: (AccountLike | undefined)[] = [];
      const { session, configs } = harness({
        accounts: [],
        getSession: (account) => {
          hints.push(account);
          return Promise.resolve({ accessToken: "t" });
        },
      });
      session.adapterFor(ENDPOINT);
      await configs[0]?.token();
      assert.deepEqual(hints, [undefined]);
    });
  });
});

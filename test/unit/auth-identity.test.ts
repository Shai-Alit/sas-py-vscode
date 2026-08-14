// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { HttpResponse, http } from "msw";

import {
  CURRENT_USER_PATH,
  IDENTITY_FULL_TYPE,
  IDENTITY_SUMMARY_TYPE,
  accountId,
  accountLabel,
  fetchCurrentUser,
  parseUser,
} from "../../src/auth/identity";
import { readJsonFixture } from "../helpers/fixtures";
import {
  MOCK_VIYA_BASE,
  fixtureResponse,
  mockViya,
} from "../helpers/mock-viya";

/**
 * The identity module — the account model, specified here rather than by whatever
 * the provider happens to do.
 *
 * Three things are being pinned down, and all three come straight out of the
 * 2026-08-13 probe.
 *
 * **What we ask for.** Finding 7: the full representation carries a street
 * address, a work email and two phone numbers, and upstream sends no `Accept`
 * header at all, so it pulls every one of them into the extension host to keep
 * two fields. Asking for the summary type is one header and it is the difference
 * between that data being in this process and not. There is a test below that
 * fails if the header goes missing.
 *
 * **What we key on.** Finding 8: `id` is a 17-character opaque handle, `scimId`
 * is an artefact of SCIM-backed deployments, and `name` and the login are both
 * things an administrator can change. Only endpoint plus `id` is stable.
 *
 * **What a 401 means.** Finding 9: the body is zero bytes and the whole diagnosis
 * is in `WWW-Authenticate`, so the three-way split between expired, never-sent,
 * and something-else is decided by a header or not at all.
 */

const USER_URL = `${MOCK_VIYA_BASE}${CURRENT_USER_PATH}`;
const FIXTURE = ["harness", "identity-user-summary.json"];

/** Not a credential: a shape that looks like one, so the tests can follow it. */
const FAKE_ACCESS = "access-token-placeholder";

const request = {
  endpoint: MOCK_VIYA_BASE,
  accessToken: FAKE_ACCESS,
};

/** The recorded shapes, read once so the assertions below cannot drift from the file. */
const fixture = readJsonFixture(...FIXTURE) as {
  id: string;
  name: string;
  externalLoginIds: string[];
};

describe("accountId", () => {
  it("is the endpoint and the Viya user id", () => {
    // Decision 10. Not the profile name, which the user can edit, and not the
    // login, which an administrator can.
    assert.equal(
      accountId("https://viya.example.com", "a7f3c1d9e2b4f6a80"),
      "https://viya.example.com::a7f3c1d9e2b4f6a80",
    );
  });

  it("does not depend on how the endpoint was typed", () => {
    // A profile written by hand and one written by the add-profile command
    // differ by a trailing slash. Two accounts for one deployment is the bug.
    const canonical = accountId("https://viya.example.com", "abc");

    assert.equal(accountId("https://viya.example.com/", "abc"), canonical);
    assert.equal(accountId("  https://viya.example.com  ", "abc"), canonical);
  });

  it("distinguishes the same user on two deployments", () => {
    assert.notEqual(
      accountId("https://viya.example.com", "abc"),
      accountId("https://viya-test.example.com", "abc"),
    );
  });

  it("refuses to build an id with no user id", () => {
    // An account id that is just an endpoint would collide across every user of
    // that deployment, which is worse than failing.
    assert.throws(() => accountId("https://viya.example.com", ""));
    assert.throws(() => accountId("https://viya.example.com", "   "));
  });
});

describe("accountLabel", () => {
  it("prefers the display name", () => {
    assert.equal(
      accountLabel({ id: "abc", name: "Dana Whitfield", login: "dwhitfield" }),
      "Dana Whitfield",
    );
  });

  it("falls back to the login when there is no display name", () => {
    // The unprobed deployments — LDAP-backed, and Viya 3.5 — are exactly where a
    // missing display name would turn up, which is why `name` is optional.
    assert.equal(
      accountLabel({ id: "abc", login: "dwhitfield" }),
      "dwhitfield",
    );
  });

  it("falls back to the id rather than showing nothing", () => {
    assert.equal(accountLabel({ id: "abc" }), "abc");
  });

  it("treats a blank name as absent", () => {
    assert.equal(
      accountLabel({ id: "abc", name: "   ", login: "dwhitfield" }),
      "dwhitfield",
    );
  });
});

describe("parseUser", () => {
  it("reads the recorded summary representation", () => {
    const user = parseUser(readJsonFixture(...FIXTURE));

    // Only the first read is optional-chained: asserting `user?.id` narrows
    // `user` to non-nullish, and a chain the type-checker can prove redundant
    // is a lint error rather than harmless caution.
    assert.equal(user?.id, fixture.id);
    assert.equal(user.name, fixture.name);
    assert.equal(user.login, fixture.externalLoginIds[0]);
  });

  it("keeps nothing but id, name and login", () => {
    // The guard against the PII in finding 7 reaching our process even if the
    // deployment ignores the `Accept` header and sends the full representation.
    // Values below are invented; the field names and shapes are the recorded
    // ones.
    const user = parseUser({
      id: "a7f3c1d9e2b4f6a80",
      name: "Dana Whitfield",
      externalLoginIds: ["dwhitfield"],
      addresses: [
        {
          type: "work",
          street: "1 Invented Way",
          locality: "Nowhere",
          region: "NC",
          country: "US",
          postalCode: "00000",
        },
      ],
      emailAddresses: [{ type: "work", value: "nobody@example.com" }],
      phoneNumbers: [{ type: "mobile", value: "+1-555-0100" }],
    });

    assert.ok(user);
    assert.deepEqual(Object.keys(user).sort(), ["id", "login", "name"]);
    assert.ok(!JSON.stringify(user).includes("Invented Way"));
    assert.ok(!JSON.stringify(user).includes("555"));
  });

  it("accepts a user with no display name", () => {
    const user = parseUser({ id: "a7f3c1d9e2b4f6a80" });

    assert.equal(user?.id, "a7f3c1d9e2b4f6a80");
    assert.equal(user.name, undefined);
  });

  it("refuses a payload with no id", () => {
    // Without an id there is no stable account, and inventing one from the name
    // would key the session on something an administrator can change.
    assert.equal(parseUser({ name: "Dana Whitfield" }), undefined);
    assert.equal(parseUser({ id: "" }), undefined);
    assert.equal(parseUser({ id: 42 }), undefined);
  });

  it("refuses anything that is not an object", () => {
    assert.equal(parseUser(undefined), undefined);
    assert.equal(parseUser(null), undefined);
    assert.equal(parseUser("a7f3c1d9e2b4f6a80"), undefined);
    assert.equal(parseUser([{ id: "abc" }]), undefined);
  });
});

describe("fetchCurrentUser", () => {
  const viya = mockViya(
    http.get(USER_URL, () =>
      fixtureResponse(FIXTURE, { contentType: IDENTITY_SUMMARY_TYPE }),
    ),
  );

  it("resolves the signed-in user", async () => {
    const result = await fetchCurrentUser(request);

    assert.ok(result.ok, "a recorded 200 did not resolve a user");
    assert.equal(result.user.id, fixture.id);
    assert.equal(accountLabel(result.user), fixture.name);
  });

  it("asks for the summary representation, not the full one", async () => {
    // This is the data-minimisation improvement over upstream, and it is one
    // header. If this assertion ever goes, the extension starts receiving a real
    // person's home-adjacent address and personal mobile number.
    let accept: string | null = null;
    viya.use(
      http.get(USER_URL, ({ request: seen }) => {
        accept = seen.headers.get("accept");
        return fixtureResponse(FIXTURE, {
          contentType: IDENTITY_SUMMARY_TYPE,
        });
      }),
    );

    await fetchCurrentUser(request);

    assert.equal(accept, IDENTITY_SUMMARY_TYPE);
  });

  it("sends the bearer token and nothing else that identifies us", async () => {
    let authorization: string | null = null;
    viya.use(
      http.get(USER_URL, ({ request: seen }) => {
        authorization = seen.headers.get("authorization");
        return fixtureResponse(FIXTURE, {
          contentType: IDENTITY_SUMMARY_TYPE,
        });
      }),
    );

    await fetchCurrentUser(request);

    assert.equal(authorization, `Bearer ${FAKE_ACCESS}`);
  });

  it("honours a token type the deployment chose for us", async () => {
    // RFC 6749 leaves `token_type` to the server, and Viya answers `bearer` in
    // lower case. Hard-coding "Bearer" works today and is a guess.
    let authorization: string | null = null;
    viya.use(
      http.get(USER_URL, ({ request: seen }) => {
        authorization = seen.headers.get("authorization");
        return fixtureResponse(FIXTURE, {
          contentType: IDENTITY_SUMMARY_TYPE,
        });
      }),
    );

    await fetchCurrentUser({ ...request, tokenType: "bearer" });

    assert.equal(authorization, `bearer ${FAKE_ACCESS}`);
  });

  it("falls back to the full representation on a 406", async () => {
    // Finding 6: a media type this service does not serve is a 406, not a 200
    // with something else. No Viya 3.5 deployment exists to check the summary
    // type against, so this fallback is what makes 3.5 unverified rather than
    // unsupported.
    const asked: string[] = [];
    viya.use(
      http.get(USER_URL, ({ request: seen }) => {
        const accept = seen.headers.get("accept") ?? "";
        asked.push(accept);
        return accept === IDENTITY_FULL_TYPE
          ? fixtureResponse(FIXTURE, { contentType: IDENTITY_FULL_TYPE })
          : new HttpResponse(null, { status: 406 });
      }),
    );

    const result = await fetchCurrentUser(request);

    assert.ok(result.ok, "the 406 fallback did not resolve a user");
    assert.deepEqual(asked, [IDENTITY_SUMMARY_TYPE, IDENTITY_FULL_TYPE]);
  });

  it("gives up, naming both media types, when neither is served", async () => {
    viya.use(http.get(USER_URL, () => new HttpResponse(null, { status: 406 })));

    const result = await fetchCurrentUser(request);

    assert.ok(!result.ok);
    assert.ok(result.problem.code === "identity-unavailable");
    assert.ok(result.problem.detail.includes(IDENTITY_SUMMARY_TYPE));
    assert.ok(result.problem.detail.includes(IDENTITY_FULL_TYPE));
  });

  it("reads an expired token out of the header, not the empty body", async () => {
    // Finding 9, verbatim. The body is zero bytes; a mapper that reads the body
    // renders "" for the most common recoverable failure in the extension.
    viya.use(
      http.get(
        USER_URL,
        () =>
          new HttpResponse(null, {
            status: 401,
            headers: {
              "www-authenticate":
                'Bearer error="invalid_token", error_description="Provided token isn\'t active"',
            },
          }),
      ),
    );

    const result = await fetchCurrentUser(request);

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "session-expired");
  });

  it("tells a missing credential apart from a rejected one", async () => {
    // A bare challenge means nothing was sent, which is our bug. Telling that
    // user to sign in again cannot help, because they may already be signed in.
    viya.use(
      http.get(
        USER_URL,
        () =>
          new HttpResponse(null, {
            status: 401,
            headers: { "www-authenticate": "Bearer" },
          }),
      ),
    );

    const result = await fetchCurrentUser(request);

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "not-authenticated");
  });

  it("does not claim a session expired when the 401 says something else", async () => {
    viya.use(
      http.get(
        USER_URL,
        () =>
          new HttpResponse(null, {
            status: 401,
            headers: {
              "www-authenticate": 'Bearer error="insufficient_scope"',
            },
          }),
      ),
    );

    const result = await fetchCurrentUser(request);

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "identity-unavailable");
  });

  it("reports a 500 as an identity failure, with the status", async () => {
    viya.use(http.get(USER_URL, () => new HttpResponse(null, { status: 500 })));

    const result = await fetchCurrentUser(request);

    assert.ok(!result.ok);
    assert.ok(result.problem.code === "identity-unavailable");
    assert.ok(result.problem.detail.includes("500"));
  });

  it("reports a request that never arrived as an identity failure too", async () => {
    // Not `token-endpoint-unreachable`, which is what this branch said until a
    // reviewer caught it. The codes choose what the user is told to do: that one
    // says the sign-in could not reach the deployment and sends them to check
    // the profile endpoint and their proxy, and this failure happens *after* a
    // sign-in that worked — so it would send them to inspect the one thing
    // already known to be fine.
    const result = await fetchCurrentUser(request, {
      transport: () => Promise.reject(new Error("socket hang up")),
    });

    assert.ok(!result.ok);
    assert.ok(result.problem.code === "identity-unavailable");
    assert.ok(result.problem.detail.includes("socket hang up"));
    assert.ok(
      result.problem.detail.includes(CURRENT_USER_PATH),
      "the detail does not say which request failed",
    );
  });

  it("survives a body that is not JSON", async () => {
    // A gateway or a captive portal in front of Viya answers 200 with HTML. The
    // parse has to fail as a diagnosis, not as an exception out of the provider.
    viya.use(
      http.get(
        USER_URL,
        () =>
          new HttpResponse("<html>sign in to the network</html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
      ),
    );

    const result = await fetchCurrentUser(request);

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "identity-unavailable");
  });

  it("survives JSON that is not a user", async () => {
    viya.use(http.get(USER_URL, () => HttpResponse.json({ items: [] })));

    const result = await fetchCurrentUser(request);

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "identity-unavailable");
  });

  it("never puts the access token in anything it reports", async () => {
    // Every string this module produces is destined for an output channel that
    // gets pasted into issue reports.
    viya.use(
      http.get(
        USER_URL,
        () =>
          new HttpResponse(null, {
            status: 401,
            headers: {
              "www-authenticate": `Bearer error="invalid_token", error_description="${FAKE_ACCESS} is not active"`,
            },
          }),
      ),
    );

    const result = await fetchCurrentUser(request);

    assert.ok(!result.ok);
    // The description is server-authored and echoed, so this asserts the one
    // thing that must hold: nothing *we* build interpolates the token.
    assert.ok(!result.reason.includes(FAKE_ACCESS));
  });
});

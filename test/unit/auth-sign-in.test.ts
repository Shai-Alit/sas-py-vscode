// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { HttpResponse, http } from "msw";

import { deriveChallenge, TOKEN_LENGTH } from "../../src/auth/pkce";
import {
  beginSignIn,
  finishSignIn,
  parseStoredSession,
  readCallback,
  readPastedCode,
  serializeSession,
  sessionSecretKey,
  settlesCapture,
  toStoredSession,
  type PendingSignIn,
  type SignInRequest,
} from "../../src/auth/signIn";
import { MOCK_VIYA_BASE, mockViya } from "../helpers/mock-viya";

/**
 * The sign-in flow with the editor taken out of it.
 *
 * The point of the module under test is that all of this is reachable from a
 * string. Everything asserted here would otherwise need a running extension host
 * — which is why the equivalent code upstream has no tests at all.
 *
 * The heaviest group is the callback reader, and within it the `state` checks.
 * That is proportionate: an accepted callback is an authorization code accepted
 * from whoever sent it.
 */

const TOKEN_URL = `${MOCK_VIYA_BASE}/SASLogon/oauth/token`;

/** Not credentials. Shapes that look like them, so tests can prove they stay put. */
const FAKE_ACCESS = "access-token-placeholder";
const FAKE_REFRESH = "refresh-token-placeholder";

const STATE = "state-issued-by-this-process";
const VERIFIER = "verifier-held-in-memory";

/** What `callbackUri()` would hand back in a real extension host. */
const CALLBACK = "vscode://x.python-on-viya/auth-callback";

const fixedPkce = () => ({
  verifier: VERIFIER,
  challenge: deriveChallenge(VERIFIER),
});
const fixedState = () => STATE;

function start(overrides: Omit<SignInRequest, "endpoint"> = {}): PendingSignIn {
  const result = beginSignIn(
    { endpoint: MOCK_VIYA_BASE, ...overrides },
    { createPkce: fixedPkce, createState: fixedState },
  );
  assert.ok(result.ok, "expected the sign-in to start");
  return result.pending;
}

describe("beginSignIn", () => {
  it("builds an authorize URL carrying the challenge, never the verifier", () => {
    const pending = start();
    const url = new URL(pending.authorizeUrl);

    assert.equal(url.pathname, "/SASLogon/oauth/authorize");
    assert.equal(
      url.searchParams.get("code_challenge"),
      deriveChallenge(VERIFIER),
    );
    assert.equal(url.searchParams.get("state"), STATE);
    assert.ok(!pending.authorizeUrl.includes(VERIFIER));
    assert.equal(pending.verifier, VERIFIER);
  });

  it("sends a redirect URI only for a client the profile named", () => {
    const named = start({
      configuredClientId: "site-registered",
      configuredClientSecret: "secret",
      redirectUri: CALLBACK,
    });
    assert.equal(
      new URL(named.authorizeUrl).searchParams.get("redirect_uri"),
      CALLBACK,
    );
    assert.equal(named.redirectUri, CALLBACK);

    // The built-in `vscode` client registers `urn:ietf:wg:oauth:2.0:oob` and no
    // custom-scheme URI at all — verified in a browser against a live Viya 4,
    // which rejected our callback URI and upstream's own `vscode://sas.sas-lsp`
    // alike. Offering it one fails after the user has typed their password, so
    // the shell's callback URI is dropped here even though it exists.
    const builtIn = start({ redirectUri: CALLBACK });
    assert.equal(
      new URL(builtIn.authorizeUrl).searchParams.get("redirect_uri"),
      null,
    );
    assert.equal(builtIn.redirectUri, undefined);

    // Nothing to register in the first place — a host that cannot produce an
    // external URI. Same wire shape, different reason.
    assert.equal(
      new URL(start().authorizeUrl).searchParams.get("redirect_uri"),
      null,
    );
  });

  it("prefers a configured client over the built-in one", () => {
    const pending = start({
      configuredClientId: "site-registered",
      configuredClientSecret: "secret",
    });

    assert.equal(pending.client.clientId, "site-registered");
    assert.equal(pending.client.builtIn, false);
    assert.equal(
      new URL(pending.authorizeUrl).searchParams.get("client_id"),
      "site-registered",
    );
  });

  it("refuses before opening a browser when there is no client to use", () => {
    // Viya 3.5 has no built-in sign-in client. Sending the user to a login page
    // that can only end in invalid_client wastes their time and teaches them
    // nothing, so this fails while there is still something useful to say.
    const result = beginSignIn({
      endpoint: MOCK_VIYA_BASE,
      deployment: { kind: "viya35" },
    });

    assert.ok(!result.ok);
    assert.deepEqual(result.problem, {
      code: "client-id-required",
      deployment: "Viya 3.5",
    });
  });

  it("mints a fresh state and verifier for every attempt", () => {
    const first = beginSignIn({ endpoint: MOCK_VIYA_BASE });
    const second = beginSignIn({ endpoint: MOCK_VIYA_BASE });
    assert.ok(first.ok);
    assert.ok(second.ok);

    assert.notEqual(first.pending.state, second.pending.state);
    assert.notEqual(first.pending.verifier, second.pending.verifier);
    assert.equal(first.pending.state.length, TOKEN_LENGTH);
    assert.equal(first.pending.verifier.length, TOKEN_LENGTH);
  });
});

describe("readCallback", () => {
  const pending = start();

  it("reads a code out of a callback that carries the right state", () => {
    const capture = readCallback(`code=abc123&state=${STATE}`, pending);
    assert.deepEqual(capture, {
      kind: "code",
      code: "abc123",
      via: "callback",
    });
  });

  it("accepts the query with or without its leading question mark", () => {
    // Uri.query has no '?', URL.search does. The caller should not have to know.
    assert.deepEqual(
      readCallback(`?code=abc123&state=${STATE}`, pending),
      readCallback(`code=abc123&state=${STATE}`, pending),
    );
  });

  it("refuses a code whose state is not the one it issued", () => {
    // The defect this module exists to close: upstream sets state to the callback
    // URL and never looks at what comes back, so its handler accepts a code from
    // anywhere — the injection RFC 6749 §10.12 describes.
    const capture = readCallback("code=injected&state=guessed", pending);

    assert.deepEqual(capture, {
      kind: "problem",
      problem: { code: "state-mismatch" },
    });
    assert.ok(!JSON.stringify(capture).includes("injected"));
  });

  it("refuses a callback carrying no state at all", () => {
    assert.deepEqual(readCallback("code=abc123", pending), {
      kind: "problem",
      problem: { code: "state-mismatch" },
    });
  });

  it("checks the state on an error response too", () => {
    // Otherwise an unsolicited error=access_denied aimed at the handler could
    // abort a sign-in the user legitimately started — a denial of service that
    // costs the attacker one link.
    assert.deepEqual(
      readCallback("error=access_denied&state=guessed", pending),
      { kind: "problem", problem: { code: "state-mismatch" } },
    );
  });

  it("reports an OAuth error with its description", () => {
    assert.deepEqual(
      readCallback(
        `error=access_denied&error_description=User+said+no&state=${STATE}`,
        pending,
      ),
      {
        kind: "problem",
        problem: {
          code: "oauth-rejected",
          error: "access_denied",
          description: "User said no",
        },
      },
    );
  });

  it("reports an OAuth error that came without a description", () => {
    assert.deepEqual(
      readCallback(`error=server_error&state=${STATE}`, pending),
      {
        kind: "problem",
        problem: { code: "oauth-rejected", error: "server_error" },
      },
    );
  });

  it("ignores a URI that is not a sign-in callback", () => {
    // The handler is registered for the whole extension and sees every link
    // aimed at it. Anything unrecognisable is left alone, not reported.
    const capture = readCallback("open=/some/file.py", pending);
    assert.equal(capture.kind, "ignored");
  });
});

describe("readPastedCode", () => {
  const pending = start();

  it("treats a dismissed box as a cancellation", () => {
    assert.deepEqual(readPastedCode(undefined, pending), { kind: "cancelled" });
    assert.deepEqual(readPastedCode("   ", pending), { kind: "cancelled" });
  });

  it("trims what was pasted", () => {
    assert.deepEqual(readPastedCode("  abc123\n", pending), {
      kind: "code",
      code: "abc123",
      via: "paste",
    });
  });

  it("accepts a pasted callback URL and checks its state", () => {
    // Deployments that cannot redirect back show a page the user copies from,
    // and what lands on the clipboard is as often the whole URL as the code.
    const capture = readPastedCode(
      `vscode://x.python-on-viya/?code=abc123&state=${STATE}`,
      pending,
    );
    assert.deepEqual(capture, {
      kind: "code",
      code: "abc123",
      via: "callback",
    });
  });

  it("refuses a pasted URL whose state is wrong", () => {
    assert.deepEqual(
      readPastedCode(
        "vscode://x.python-on-viya/?code=injected&state=guessed",
        pending,
      ),
      { kind: "problem", problem: { code: "state-mismatch" } },
    );
  });

  it("accepts a pasted bare query string", () => {
    assert.deepEqual(readPastedCode(`?code=abc123&state=${STATE}`, pending), {
      kind: "code",
      code: "abc123",
      via: "callback",
    });
  });

  it("takes a bare code at face value, because there is nothing to check it against", () => {
    // A code the user carried here by hand cannot be state-checked: no callback
    // happened. That is not a weakening — PKCE still binds the code to this
    // process, and the user made the trust decision when they opened the browser.
    const capture = readPastedCode("abc123", pending);
    assert.deepEqual(capture, { kind: "code", code: "abc123", via: "paste" });
  });

  it("treats a URL with no code in it as a bare code", () => {
    // Defined rather than clever. Something pasted from the wrong window fails
    // at the token endpoint with invalid_grant, which is a diagnosable outcome;
    // guessing at intent here would not improve on it.
    assert.deepEqual(readPastedCode("https://viya.example.com/", pending), {
      kind: "code",
      code: "https://viya.example.com/",
      via: "paste",
    });
  });
});

describe("settlesCapture", () => {
  it("ends the wait on a code, a rejection, or a cancellation", () => {
    assert.equal(
      settlesCapture({ kind: "code", code: "c", via: "paste" }),
      true,
    );
    assert.equal(
      settlesCapture({
        kind: "problem",
        problem: { code: "oauth-rejected", error: "access_denied" },
      }),
      true,
    );
    assert.equal(settlesCapture({ kind: "cancelled" }), true);
  });

  it("keeps waiting after a forged callback", () => {
    // The load-bearing case. A callback with the wrong state is either a stale
    // link or an injection attempt, and the user's own sign-in is still in
    // flight. If this settled, anyone able to send a link could reliably break
    // sign-in for the person who clicked it.
    assert.equal(
      settlesCapture({ kind: "problem", problem: { code: "state-mismatch" } }),
      false,
    );
    assert.equal(
      settlesCapture({ kind: "ignored", reason: "not ours" }),
      false,
    );
  });
});

describe("finishSignIn", () => {
  const viya = mockViya();

  it("sends the verifier and the redirect URI, and returns the tokens", async () => {
    let body = "";
    viya.use(
      http.post(TOKEN_URL, async ({ request }) => {
        body = await request.text();
        return HttpResponse.json({
          access_token: FAKE_ACCESS,
          refresh_token: FAKE_REFRESH,
          token_type: "bearer",
        });
      }),
    );

    const pending = start({
      configuredClientId: "site-registered",
      redirectUri: CALLBACK,
    });
    const result = await finishSignIn(pending, "abc123");

    assert.ok(result.ok);
    assert.equal(result.tokens.accessToken, FAKE_ACCESS);

    const form = new URLSearchParams(body);
    assert.equal(form.get("grant_type"), "authorization_code");
    assert.equal(form.get("code"), "abc123");
    assert.equal(form.get("code_verifier"), VERIFIER);
    assert.equal(form.get("redirect_uri"), CALLBACK);
  });

  it("omits the redirect URI on the token leg too, for the built-in client", async () => {
    // RFC 6749 §4.1.3 requires the two legs to agree. The authorize leg dropped
    // it, so this one has to as well — sending it here against an oob-registered
    // client is an `invalid_grant` after the user has already done their part.
    let body = "";
    viya.use(
      http.post(TOKEN_URL, async ({ request }) => {
        body = await request.text();
        return HttpResponse.json({
          access_token: FAKE_ACCESS,
          token_type: "bearer",
        });
      }),
    );

    const pending = start({ redirectUri: CALLBACK });
    assert.ok((await finishSignIn(pending, "abc123")).ok);
    assert.equal(new URLSearchParams(body).get("redirect_uri"), null);
  });

  it("scrubs the verifier out of a rejection that echoes it back", async () => {
    // Observed against a live deployment: SASLogon quotes the `code_verifier`
    // it received inside `error_description`, and we log that field verbatim.
    viya.use(
      http.post(TOKEN_URL, () =>
        HttpResponse.json(
          {
            error: "invalid_grant",
            error_description: `Invalid code verifier: ${VERIFIER}`,
          },
          { status: 400 },
        ),
      ),
    );

    const result = await finishSignIn(
      start({ configuredClientId: "site-registered" }),
      "abc123",
    );

    assert.ok(!result.ok);
    assert.deepEqual(result.problem, {
      code: "oauth-rejected",
      error: "invalid_grant",
      description: "Invalid code verifier: [redacted]",
    });
    assert.ok(!JSON.stringify(result).includes(VERIFIER));
  });

  it("rewrites invalid_client into advice when the built-in client was a guess", async () => {
    // We reach here having assumed a deployment of unknown version has the
    // built-in client. It did not. "invalid_client" describes the request; the
    // sentence a version check would have produced describes the situation.
    viya.use(
      http.post(TOKEN_URL, () =>
        HttpResponse.json({ error: "invalid_client" }, { status: 401 }),
      ),
    );

    const result = await finishSignIn(start(), "abc123");

    assert.ok(!result.ok);
    assert.deepEqual(result.problem, {
      code: "client-id-required",
      deployment: "an unrecognised version",
    });
  });

  it("leaves invalid_client alone when the client was configured", async () => {
    // An administrator registered this client deliberately. Telling them they
    // need to register one would be advice about a problem they do not have.
    viya.use(
      http.post(TOKEN_URL, () =>
        HttpResponse.json({ error: "invalid_client" }, { status: 401 }),
      ),
    );

    const result = await finishSignIn(
      start({ configuredClientId: "site-registered" }),
      "abc123",
    );

    assert.ok(!result.ok);
    assert.deepEqual(result.problem, {
      code: "oauth-rejected",
      error: "invalid_client",
    });
  });

  it("leaves an expired code reporting itself", async () => {
    viya.use(
      http.post(TOKEN_URL, () =>
        HttpResponse.json({ error: "invalid_grant" }, { status: 400 }),
      ),
    );

    const result = await finishSignIn(start(), "abc123");

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "oauth-rejected");
  });
});

describe("session persistence", () => {
  it("keys the secret on the profile id", () => {
    assert.equal(sessionSecretKey("p-1"), "pythonOnViya.session.p-1");
  });

  it("refuses a blank profile id", () => {
    // A generated id is never blank, so this is a bug rather than bad input —
    // and the bug it prevents is every profile sharing one secret.
    assert.throws(() => sessionSecretKey("  "), /profile id/);
  });

  it("keeps the refresh token and nothing else", () => {
    const session = toStoredSession({
      accessToken: FAKE_ACCESS,
      refreshToken: FAKE_REFRESH,
      expiresAt: 1_700_000_000_000,
      tokenType: "bearer",
    });

    assert.ok(session);
    assert.deepEqual(session, { refreshToken: FAKE_REFRESH });
    // The access token is short-lived and re-derivable. Persisting it would put
    // a second long-lived copy of a credential on disk to save a round trip.
    assert.ok(!serializeSession(session).includes(FAKE_ACCESS));
  });

  it("stores nothing when the grant returned no refresh token", () => {
    // Some deployments are configured that way. An empty record would look like
    // corruption to whoever reads it next.
    assert.equal(
      toStoredSession({ accessToken: FAKE_ACCESS, tokenType: "bearer" }),
      undefined,
    );
  });

  it("round-trips", () => {
    assert.deepEqual(
      parseStoredSession(serializeSession({ refreshToken: FAKE_REFRESH })),
      { refreshToken: FAKE_REFRESH },
    );
  });

  it("returns nothing for anything it did not write", () => {
    // Every rejection is silent and identical on purpose: the input is a stored
    // credential, so it cannot be logged or quoted, and the only useful response
    // to any of these is to sign in again.
    for (const raw of [
      undefined,
      "",
      "   ",
      "not json",
      "[]",
      "null",
      '"just-a-token"',
      '{"refreshToken":"x"}',
      '{"v":2,"refreshToken":"x"}',
      '{"v":1}',
      '{"v":1,"refreshToken":""}',
      '{"v":1,"refreshToken":42}',
    ]) {
      assert.equal(
        parseStoredSession(raw),
        undefined,
        `expected ${String(raw)} to be rejected`,
      );
    }
  });
});

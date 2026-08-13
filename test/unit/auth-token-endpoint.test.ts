// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { HttpResponse, http } from "msw";

import {
  EXPIRY_SKEW_MS,
  type FetchLike,
  type Tokens,
  buildAuthorizeUrl,
  exchangeAuthorizationCode,
  needsRefresh,
  refreshTokens,
} from "../../src/auth/tokenEndpoint";
import { MOCK_VIYA_BASE, mockViya } from "../helpers/mock-viya";

/**
 * The token endpoint, against a mock Viya.
 *
 * Three groups of assertion, in rough order of how likely each is to save
 * somebody: what we send (a wrong grant type is a bad afternoon), what we do with
 * a *failed* response (upstream's weakest area, and the one users actually meet),
 * and what we refuse to put in a log.
 *
 * That last one is not decoration. A token response body contains an access token
 * and a refresh token, and every string this module produces is destined for an
 * output channel that gets pasted into issue reports.
 */

const TOKEN_URL = `${MOCK_VIYA_BASE}/SASLogon/oauth/token`;

/** Not a credential: a shape that looks like one, so the tests can prove it never escapes. */
// credential-scan: allow — test placeholder, never a real token
const FAKE_ACCESS = "access-token-placeholder";
// credential-scan: allow — test placeholder, never a real token
const FAKE_REFRESH = "refresh-token-placeholder";

const baseRequest = {
  endpoint: MOCK_VIYA_BASE,
  clientId: "vscode",
  clientSecret: "",
};

/** Frozen clock, so `expiresAt` is an arithmetic assertion rather than a range. */
const NOW = 1_700_000_000_000;
const now = (): number => NOW;

describe("buildAuthorizeUrl", () => {
  it("carries the PKCE challenge and the state", () => {
    const url = new URL(
      buildAuthorizeUrl({
        endpoint: MOCK_VIYA_BASE,
        clientId: "vscode",
        codeChallenge: "challenge-value",
        state: "state-value",
      }),
    );

    assert.equal(url.pathname, "/SASLogon/oauth/authorize");
    assert.equal(url.searchParams.get("client_id"), "vscode");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("code_challenge"), "challenge-value");
    assert.equal(url.searchParams.get("state"), "state-value");
    assert.equal(url.searchParams.get("redirect_uri"), null);
  });

  it("never puts the verifier in the URL", () => {
    // The authorize URL goes through the user's browser and any TLS interception
    // in front of it. The verifier is the one value that must not.
    const url = buildAuthorizeUrl({
      endpoint: MOCK_VIYA_BASE,
      clientId: "vscode",
      codeChallenge: "challenge-value",
      state: "state-value",
    });
    assert.ok(!url.includes("code_verifier"));
  });

  it("includes a redirect URI only when there is one", () => {
    const withRedirect = new URL(
      buildAuthorizeUrl({
        endpoint: MOCK_VIYA_BASE,
        clientId: "vscode",
        codeChallenge: "c",
        state: "s",
        redirectUri: "vscode://publisher.python-on-viya",
      }),
    );
    assert.equal(
      withRedirect.searchParams.get("redirect_uri"),
      "vscode://publisher.python-on-viya",
    );

    const blank = new URL(
      buildAuthorizeUrl({
        endpoint: MOCK_VIYA_BASE,
        clientId: "vscode",
        codeChallenge: "c",
        state: "s",
        redirectUri: "",
      }),
    );
    assert.equal(blank.searchParams.get("redirect_uri"), null);
  });

  it("does not double the slash on an endpoint that ends in one", () => {
    const url = buildAuthorizeUrl({
      endpoint: "https://viya.example.com///",
      clientId: "vscode",
      codeChallenge: "c",
      state: "s",
    });
    assert.ok(
      url.startsWith("https://viya.example.com/SASLogon/oauth/authorize?"),
    );
  });
});

describe("exchangeAuthorizationCode", () => {
  const viya = mockViya();

  it("posts the authorization_code grant as a form", async () => {
    let contentType: string | null = null;
    let body = "";
    viya.use(
      http.post(TOKEN_URL, async ({ request }) => {
        contentType = request.headers.get("content-type");
        body = await request.text();
        return HttpResponse.json({
          access_token: FAKE_ACCESS,
          refresh_token: FAKE_REFRESH,
          token_type: "bearer",
          expires_in: 3600,
        });
      }),
    );

    const result = await exchangeAuthorizationCode(
      { ...baseRequest, code: "the-code", codeVerifier: "the-verifier" },
      { now },
    );

    assert.ok(result.ok, "expected the exchange to succeed");
    assert.match(String(contentType), /application\/x-www-form-urlencoded/);

    const form = new URLSearchParams(body);
    assert.equal(form.get("grant_type"), "authorization_code");
    assert.equal(form.get("code"), "the-code");
    assert.equal(form.get("code_verifier"), "the-verifier");
    assert.equal(form.get("client_id"), "vscode");
  });

  it("converts expires_in into an absolute instant", async () => {
    // The delta from upstream, which keeps neither the duration nor the instant
    // and so has to spend a request discovering that a token has died.
    viya.use(
      http.post(TOKEN_URL, () =>
        HttpResponse.json({
          access_token: FAKE_ACCESS,
          token_type: "bearer",
          expires_in: 3600,
        }),
      ),
    );

    const result = await exchangeAuthorizationCode(
      { ...baseRequest, code: "c", codeVerifier: "v" },
      { now },
    );

    assert.ok(result.ok);
    assert.equal(result.tokens.expiresAt, NOW + 3_600_000);
    assert.equal(result.tokens.accessToken, FAKE_ACCESS);
    assert.equal(result.tokens.tokenType, "bearer");
  });

  it("reads expires_in when it arrives as a string", async () => {
    viya.use(
      http.post(TOKEN_URL, () =>
        HttpResponse.json({
          access_token: FAKE_ACCESS,
          expires_in: "600",
        }),
      ),
    );

    const result = await exchangeAuthorizationCode(
      { ...baseRequest, code: "c", codeVerifier: "v" },
      { now },
    );

    assert.ok(result.ok);
    assert.equal(result.tokens.expiresAt, NOW + 600_000);
    // Defaulted, because the server did not say.
    assert.equal(result.tokens.tokenType, "bearer");
  });

  it("leaves expiresAt absent rather than guessing one", async () => {
    viya.use(
      http.post(TOKEN_URL, () =>
        HttpResponse.json({ access_token: FAKE_ACCESS }),
      ),
    );

    const result = await exchangeAuthorizationCode(
      { ...baseRequest, code: "c", codeVerifier: "v" },
      { now },
    );

    assert.ok(result.ok);
    assert.equal(result.tokens.expiresAt, undefined);
  });

  it("ignores a nonsensical expires_in instead of computing a stale instant", async () => {
    for (const expires_in of [0, -1, "soon", null]) {
      viya.use(
        http.post(TOKEN_URL, () =>
          HttpResponse.json({ access_token: FAKE_ACCESS, expires_in }),
        ),
      );
      const result = await exchangeAuthorizationCode(
        { ...baseRequest, code: "c", codeVerifier: "v" },
        { now },
      );
      assert.ok(result.ok);
      assert.equal(
        result.tokens.expiresAt,
        undefined,
        `expires_in ${JSON.stringify(expires_in)} should be ignored`,
      );
    }
  });

  it("sends a redirect URI only when given one", async () => {
    let body = "";
    viya.use(
      http.post(TOKEN_URL, async ({ request }) => {
        body = await request.text();
        return HttpResponse.json({ access_token: FAKE_ACCESS });
      }),
    );

    await exchangeAuthorizationCode(
      { ...baseRequest, code: "c", codeVerifier: "v" },
      { now },
    );
    assert.equal(new URLSearchParams(body).get("redirect_uri"), null);

    await exchangeAuthorizationCode(
      {
        ...baseRequest,
        code: "c",
        codeVerifier: "v",
        redirectUri: "vscode://x.y",
      },
      { now },
    );
    assert.equal(new URLSearchParams(body).get("redirect_uri"), "vscode://x.y");
  });
});

describe("refreshTokens", () => {
  const viya = mockViya();

  it("posts the refresh_token grant", async () => {
    let body = "";
    viya.use(
      http.post(TOKEN_URL, async ({ request }) => {
        body = await request.text();
        return HttpResponse.json({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 300,
        });
      }),
    );

    const result = await refreshTokens(
      { ...baseRequest, refreshToken: FAKE_REFRESH },
      { now },
    );

    assert.ok(result.ok);
    const form = new URLSearchParams(body);
    assert.equal(form.get("grant_type"), "refresh_token");
    assert.equal(form.get("refresh_token"), FAKE_REFRESH);
    assert.equal(result.tokens.refreshToken, "new-refresh");
    assert.equal(result.tokens.expiresAt, NOW + 300_000);
  });

  it("carries the old refresh token forward when rotation is off", async () => {
    // UAA only returns a new refresh token when rotation is enabled. Dropping
    // the one we already hold would turn a working silent refresh into a fresh
    // browser sign-in on the next expiry.
    viya.use(
      http.post(TOKEN_URL, () =>
        HttpResponse.json({ access_token: "new-access", expires_in: 300 }),
      ),
    );

    const result = await refreshTokens(
      { ...baseRequest, refreshToken: FAKE_REFRESH },
      { now },
    );

    assert.ok(result.ok);
    assert.equal(result.tokens.refreshToken, FAKE_REFRESH);
  });
});

describe("token endpoint failures", () => {
  const viya = mockViya();

  const exchange = (deps = {}) =>
    exchangeAuthorizationCode(
      { ...baseRequest, code: "c", codeVerifier: "v" },
      { now, ...deps },
    );

  it("reports the OAuth error envelope instead of a bare status", async () => {
    viya.use(
      http.post(TOKEN_URL, () =>
        HttpResponse.json(
          {
            error: "invalid_grant",
            error_description: "Authorization code expired",
          },
          { status: 400 },
        ),
      ),
    );

    const result = await exchange();

    assert.ok(!result.ok);
    assert.deepEqual(result.problem, {
      code: "oauth-rejected",
      error: "invalid_grant",
      description: "Authorization code expired",
    });
  });

  it("omits the description rather than carrying an undefined one", async () => {
    viya.use(
      http.post(TOKEN_URL, () =>
        HttpResponse.json({ error: "invalid_client" }, { status: 401 }),
      ),
    );

    const result = await exchange();

    assert.ok(!result.ok);
    assert.deepEqual(result.problem, {
      code: "oauth-rejected",
      error: "invalid_client",
    });
  });

  it("trusts the error envelope over a rewritten status", async () => {
    // A gateway that turns everything into 200 is not hypothetical in the
    // deployments this extension targets. The envelope is the better evidence.
    viya.use(
      http.post(TOKEN_URL, () =>
        HttpResponse.json({ error: "unauthorized_client" }, { status: 200 }),
      ),
    );

    const result = await exchange();

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "oauth-rejected");
  });

  it("does not put an HTML error page into the log", async () => {
    // The realistic shape of this: a corporate proxy returning its own sign-in
    // page. Reporting the size and the status is actionable; quoting the page is
    // noise, and the same branch would quote a body that had a token in it.
    const html = "<html><body>Proxy authentication required</body></html>";
    viya.use(
      http.post(
        TOKEN_URL,
        () =>
          new HttpResponse(html, {
            status: 407,
            headers: { "content-type": "text/html" },
          }),
      ),
    );

    const result = await exchange();

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "token-response-malformed");
    assert.ok(!result.reason.includes("<html>"));
    assert.ok(!JSON.stringify(result.problem).includes("Proxy authentication"));
    assert.match(result.reason, /407/);
  });

  it("rejects JSON that is not an object", async () => {
    viya.use(
      http.post(TOKEN_URL, () => HttpResponse.json(["not", "a", "token"])),
    );

    const result = await exchange();

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "token-response-malformed");
  });

  it("rejects a 200 with no access token", async () => {
    viya.use(
      http.post(TOKEN_URL, () => HttpResponse.json({ token_type: "bearer" })),
    );

    const result = await exchange();

    assert.ok(!result.ok);
    assert.deepEqual(result.problem, {
      code: "token-response-malformed",
      detail: "no access_token field",
    });
  });

  it("rejects an empty-string access token", async () => {
    viya.use(
      http.post(TOKEN_URL, () => HttpResponse.json({ access_token: "" })),
    );

    const result = await exchange();

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "token-response-malformed");
  });

  it("reports an unreachable endpoint without echoing the request", async () => {
    // The request body holds the client secret and the authorization code. A
    // thrown network error can carry the request in its cause chain, which is
    // why only the message is kept.
    const failing: FetchLike = () =>
      Promise.reject(new Error("connect ECONNREFUSED 10.0.0.1:443"));

    const result = await exchange({ fetch: failing });

    assert.ok(!result.ok);
    assert.deepEqual(result.problem, {
      code: "token-endpoint-unreachable",
      detail: "connect ECONNREFUSED 10.0.0.1:443",
    });
    assert.ok(!result.reason.includes("code_verifier"));
    assert.ok(!result.reason.includes("client_secret"));
  });

  it("survives a rejection that is not an Error", async () => {
    const failing: FetchLike = () => Promise.reject("just a string");

    const result = await exchange({ fetch: failing });

    assert.ok(!result.ok);
    assert.deepEqual(result.problem, {
      code: "token-endpoint-unreachable",
      detail: "unknown error",
    });
  });

  it("reports a non-OAuth error status distinctly from a parse failure", async () => {
    viya.use(
      http.post(TOKEN_URL, () =>
        HttpResponse.json({ message: "gateway timeout" }, { status: 504 }),
      ),
    );

    const result = await exchange();

    assert.ok(!result.ok);
    assert.deepEqual(result.problem, {
      code: "token-response-malformed",
      detail: "HTTP 504 with no OAuth error field",
    });
  });
});

describe("needsRefresh", () => {
  const withExpiry = (expiresAt: number): Tokens => ({
    accessToken: FAKE_ACCESS,
    tokenType: "bearer",
    expiresAt,
  });

  it("is false while the token has time left beyond the skew", () => {
    assert.equal(
      needsRefresh(withExpiry(NOW + EXPIRY_SKEW_MS + 1), NOW),
      false,
    );
  });

  it("is true once the token is inside the skew window", () => {
    // The point of the skew: a token with seconds left passes a naive check and
    // then fails the request it was checked for.
    assert.equal(needsRefresh(withExpiry(NOW + EXPIRY_SKEW_MS), NOW), true);
    assert.equal(needsRefresh(withExpiry(NOW + 1_000), NOW), true);
  });

  it("is true for a token that has already expired", () => {
    assert.equal(needsRefresh(withExpiry(NOW - 1), NOW), true);
  });

  it("is false when the expiry is unknown", () => {
    // No evidence either way. Answering "yes" would refresh on every call; the
    // 401 path is the backstop, which is the position upstream is permanently in.
    assert.equal(
      needsRefresh({ accessToken: FAKE_ACCESS, tokenType: "bearer" }, NOW),
      false,
    );
  });

  it("honours an explicit skew", () => {
    assert.equal(needsRefresh(withExpiry(NOW + 5_000), NOW, 0), false);
    assert.equal(needsRefresh(withExpiry(NOW + 5_000), NOW, 10_000), true);
  });
});

// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The SASLogon OAuth endpoints: building the authorize URL, and the two token
 * grants — `authorization_code` and `refresh_token`.
 *
 * **This module must never import `vscode`.**
 *
 * Structure follows: client/src/connection/rest/auth.ts in
 * sassoftware/vscode-sas-extension (Apache-2.0). No code was copied. The request
 * shapes are upstream's, because those are field-proven against real deployments
 * and are not ours to improve on speculatively; the handling of the *responses*
 * is not. See docs/adr/0008-auth-core-transport-and-security-deltas.md.
 *
 * ## No HTTP client dependency
 *
 * `package.json` has `"dependencies": {}` and slice 0d spent real effort keeping
 * it that way — every install script denied, an audit gate that fails on any
 * advisory in the production tree at any severity. Upstream uses `axios`; this
 * takes an {@link HttpTransport} port, defaulting to the `node:https`
 * implementation in `./transport`. The port is not there for tests — msw
 * intercepts both `fetch` and `ClientRequest`, so it would have covered that
 * either way — it is the seam the transport itself hangs from, without reaching
 * into anything above.
 *
 * Slice 1b-ii replaced that default, which in 1b-i was `globalThis.fetch`.
 * `./transport` explains why at length; the short version is that `fetch` cannot
 * see the operating system certificate trust store, and internal certificate
 * authorities are ordinary in enterprise Viya.
 *
 * ## Nothing here logs a credential
 *
 * The response body of a token request contains an access token and a refresh
 * token. It is never put into a {@link AuthProblem}, never into a `reason`, and
 * never into an exception message, because those end up in the output channel and
 * from there in issue reports. Only the OAuth `error` and `error_description`
 * fields are quoted back, and only those, because they are specified to be
 * diagnostics rather than data.
 *
 * That leaves one hole, and {@link post} closes it: the deployment can quote our
 * own request back at us inside `error_description`, and it does. See the scrub
 * there.
 */

import { redactSecrets, redactText, type AuthProblem } from "./problems";
import {
  nodeHttpTransport,
  type TransportResponse,
  type HttpTransport,
} from "./transport";

/** SASLogon's OAuth base, relative to the deployment root. */
const OAUTH_BASE = "/SASLogon/oauth";

/**
 * How long to wait for the token endpoint before giving up.
 *
 * Upstream has no timeout at all, which behind a corporate proxy that blackholes
 * rather than refuses is a sign-in that hangs until the user gives up — with no
 * message, because nothing failed. Thirty seconds is generous for a request that
 * normally takes well under one.
 */
export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Treat a token as expired this long before it really is.
 *
 * Covers the round trip and any modest clock disagreement between here and the
 * deployment. Without it, a token with two seconds left passes the check and then
 * fails the request it was checked for.
 */
export const EXPIRY_SKEW_MS = 60_000;

export interface TokenEndpointDeps {
  /** Defaults to {@link nodeHttpTransport}. */
  transport?: HttpTransport | undefined;
  /** Defaults to `Date.now`. Injected so expiry arithmetic is testable. */
  now?: (() => number) | undefined;
  /** Defaults to {@link DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number | undefined;
}

/**
 * A token set, with expiry resolved to an absolute instant.
 *
 * `expiresAt` rather than the `expires_in` the server sends, converted the moment
 * the response is read. A duration is only meaningful relative to when it was
 * issued, and keeping it as one means every later reader has to know that instant
 * too. Upstream keeps neither, so its only way to discover that a token has died
 * is to spend a request finding out — `refreshToken()` there fires a throwaway
 * `headersForRoot()` call on every invocation purely to see whether it 401s.
 */
export interface Tokens {
  accessToken: string;
  /** Absent when the grant returned no refresh token. */
  refreshToken?: string;
  /** Epoch milliseconds. Absent when the server sent no `expires_in`. */
  expiresAt?: number;
  /** Normally `bearer`. Kept because the header this builds is the server's to name. */
  tokenType: string;
}

export type TokenResult =
  | { ok: true; tokens: Tokens }
  | { ok: false; reason: string; problem: AuthProblem };

export interface AuthorizeUrlRequest {
  /** Deployment root, e.g. `https://viya.example.com`. */
  endpoint: string;
  clientId: string;
  /** From `createPkcePair()`. The challenge, never the verifier. */
  codeChallenge: string;
  /** From `createState()`. Checked when the callback arrives. */
  state: string;
  /** Sent only when the deployment has a redirect URI registered for this client. */
  redirectUri?: string | undefined;
}

/** Trailing slashes off, so joining a path cannot produce a double slash. */
function root(endpoint: string): string {
  return endpoint.replace(/\/+$/, "");
}

/**
 * The URL to open in the user's browser to begin sign-in.
 *
 * `state` is required by this signature, which is the whole point. Upstream sets
 * the parameter to the callback URL and never validates what comes back, so its
 * URI handler will accept an authorization code originating from anywhere — the
 * injection RFC 6749 §10.12 describes. Making it a mandatory, unguessable value
 * here means the shell has something real to compare against.
 */
export function buildAuthorizeUrl(request: AuthorizeUrlRequest): string {
  const params = new URLSearchParams([
    ["client_id", request.clientId],
    ["response_type", "code"],
    ["code_challenge_method", "S256"],
    ["code_challenge", request.codeChallenge],
    ["state", request.state],
  ]);
  if (request.redirectUri !== undefined && request.redirectUri !== "") {
    params.set("redirect_uri", request.redirectUri);
  }
  return `${root(request.endpoint)}${OAUTH_BASE}/authorize?${params.toString()}`;
}

export interface AuthorizationCodeRequest {
  endpoint: string;
  clientId: string;
  clientSecret: string;
  /** The authorization code from the callback or the paste box. */
  code: string;
  /** The verifier whose challenge began this exchange. */
  codeVerifier: string;
  redirectUri?: string | undefined;
}

export interface RefreshRequest {
  endpoint: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

/** Redeems an authorization code for tokens. */
export function exchangeAuthorizationCode(
  request: AuthorizationCodeRequest,
  deps: TokenEndpointDeps = {},
): Promise<TokenResult> {
  const form = new URLSearchParams({
    client_id: request.clientId,
    client_secret: request.clientSecret,
    grant_type: "authorization_code",
    code: request.code,
    code_verifier: request.codeVerifier,
  });
  if (request.redirectUri !== undefined && request.redirectUri !== "") {
    form.set("redirect_uri", request.redirectUri);
  }
  return post(request.endpoint, form, deps, undefined);
}

/**
 * Exchanges a refresh token for a new token set.
 *
 * The refresh token we sent is carried forward when the response omits one.
 * Refresh-token rotation is a per-deployment UAA setting: with it off, the server
 * returns only a new access token, and dropping the refresh token we already hold
 * would turn a working silent refresh into a fresh browser sign-in.
 */
export function refreshTokens(
  request: RefreshRequest,
  deps: TokenEndpointDeps = {},
): Promise<TokenResult> {
  const form = new URLSearchParams({
    client_id: request.clientId,
    client_secret: request.clientSecret,
    grant_type: "refresh_token",
    refresh_token: request.refreshToken,
  });
  return post(request.endpoint, form, deps, request.refreshToken);
}

/**
 * Should this token be refreshed before it is used?
 *
 * A token with no known expiry is *not* reported as expired: we have no evidence
 * either way, and answering "yes" would refresh on every single call. The 401
 * path remains the backstop for that case, which is the situation upstream is
 * permanently in.
 */
export function needsRefresh(
  tokens: Tokens,
  now: number,
  skewMs: number = EXPIRY_SKEW_MS,
): boolean {
  return tokens.expiresAt !== undefined && now >= tokens.expiresAt - skewMs;
}

/** Narrows a parsed JSON value to an object without asserting anything about it. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** A field, if it is a non-empty string. */
function readString(
  body: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = body[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * `expires_in` as a positive number of seconds.
 *
 * Accepts the numeric string as well as the number: RFC 6749 §5.1 says seconds
 * and real servers have sent both, and a token whose lifetime we failed to read
 * because of a JSON type falls back to the 401 path silently.
 */
function readExpiresIn(body: Record<string, unknown>): number | undefined {
  const raw = body.expires_in;
  const seconds =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim() !== ""
        ? Number(raw)
        : Number.NaN;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

/**
 * The fields of a token request that are not credentials.
 *
 * Everything else in either form is one: the client secret, the authorization
 * code, the PKCE verifier, the refresh token. The list names the safe fields
 * rather than the dangerous ones on purpose — a grant added later is scrubbed
 * without anyone remembering to add it here, and the cost of this list being
 * wrong is a redacted diagnostic instead of a leaked credential.
 *
 * `redirect_uri` is on it deliberately. It is public by construction — it was in
 * the browser's address bar — and the deployment quotes it back when it does not
 * match what the client registered. That message is the entire diagnosis for a
 * misregistered client; it is what identified the built-in client's `oob`-only
 * registration on 2026-08-13, and scrubbing it would have hidden that.
 */
const PUBLIC_FORM_FIELDS: ReadonlySet<string> = new Set([
  "client_id",
  "grant_type",
  "redirect_uri",
]);

/** Every value in the form that must not come back out in a message. */
function credentialsIn(form: URLSearchParams): string[] {
  const secrets: string[] = [];
  for (const [name, value] of form) {
    if (!PUBLIC_FORM_FIELDS.has(name)) secrets.push(value);
  }
  return secrets;
}

/**
 * {@link submit}, with everything the request carried scrubbed back out of what
 * the deployment said about it.
 *
 * Written after a real failed exchange on 2026-08-13 logged this, verbatim:
 *
 * ```text
 * the deployment rejected the sign-in: invalid_grant (Invalid code verifier: <the verifier>)
 * ```
 *
 * SASLogon echoes the field it objected to back inside `error_description`. That
 * is a helpful diagnostic and a credential at the same time, and the same
 * behaviour on the refresh grant would quote a refresh token — which, unlike a
 * spent verifier, is long-lived and is the whole session.
 *
 * The scrub lives here rather than at either call site because this is the one
 * place both grants pass through *and* the one place the values are in scope
 * without a caller having to list them from memory. `authProvider.resolve` logs
 * the refresh failure directly, so a scrub applied only in `finishSignIn` would
 * have covered the sign-in and left the renewal — the path that runs every hour,
 * unattended — leaking. The alternative, dropping `error_description`, trades one
 * bad case for permanent blindness in the most useful diagnostic in the flow.
 */
async function post(
  endpoint: string,
  form: URLSearchParams,
  deps: TokenEndpointDeps,
  fallbackRefreshToken: string | undefined,
): Promise<TokenResult> {
  const result = await submit(endpoint, form, deps, fallbackRefreshToken);
  if (result.ok) return result;

  const secrets = credentialsIn(form);
  return {
    ok: false,
    reason: redactText(result.reason, secrets),
    problem: redactSecrets(result.problem, secrets),
  };
}

async function submit(
  endpoint: string,
  form: URLSearchParams,
  deps: TokenEndpointDeps,
  fallbackRefreshToken: string | undefined,
): Promise<TokenResult> {
  const send: HttpTransport = deps.transport ?? nodeHttpTransport;
  const now = deps.now ?? Date.now;
  const url = `${root(endpoint)}${OAUTH_BASE}/token`;

  let response: TransportResponse;
  let text: string;
  try {
    response = await send(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: form.toString(),
      signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    text = await response.text();
  } catch (error) {
    // The message, not the error object. `nodeHttpTransport` already builds a
    // fresh Error for exactly this reason, but an injected transport is under no
    // such obligation, and a rejection's cause chain can carry the request that
    // produced it — whose body is a client secret and an authorization code.
    const detail = error instanceof Error ? error.message : "unknown error";
    return {
      ok: false,
      reason: `could not reach ${url}`,
      problem: { code: "token-endpoint-unreachable", detail },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Deliberately reports the status and length, never the body. A proxy login
    // page or an HTML error page is exactly the case this branch exists for, and
    // pasting one into a log helps nobody.
    return {
      ok: false,
      reason: `the token endpoint answered HTTP ${String(response.status)} with a body that is not JSON`,
      problem: {
        code: "token-response-malformed",
        detail: `HTTP ${String(response.status)}, ${String(text.length)} bytes, not JSON`,
      },
    };
  }

  const body = asRecord(parsed);
  if (!body) {
    return {
      ok: false,
      reason: `the token endpoint answered HTTP ${String(response.status)} with JSON that is not an object`,
      problem: {
        code: "token-response-malformed",
        detail: `HTTP ${String(response.status)}, JSON but not an object`,
      },
    };
  }

  // The error envelope is checked before `ok`, not after. A deployment behind a
  // gateway that rewrites the status can still send a well-formed OAuth error,
  // and that envelope is worth more than the status line.
  const error = readString(body, "error");
  if (error !== undefined) {
    const description = readString(body, "error_description");
    return {
      ok: false,
      reason: `the deployment rejected the request: ${error}`,
      problem: {
        code: "oauth-rejected",
        error,
        ...(description === undefined ? {} : { description }),
      },
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: `the token endpoint answered HTTP ${String(response.status)}`,
      problem: {
        code: "token-response-malformed",
        detail: `HTTP ${String(response.status)} with no OAuth error field`,
      },
    };
  }

  const accessToken = readString(body, "access_token");
  if (accessToken === undefined) {
    return {
      ok: false,
      reason: "the token endpoint answered without an access token",
      problem: {
        code: "token-response-malformed",
        detail: "no access_token field",
      },
    };
  }

  const refreshToken =
    readString(body, "refresh_token") ?? fallbackRefreshToken;
  const expiresIn = readExpiresIn(body);

  return {
    ok: true,
    tokens: {
      accessToken,
      tokenType: readString(body, "token_type") ?? "bearer",
      ...(refreshToken === undefined ? {} : { refreshToken }),
      ...(expiresIn === undefined
        ? {}
        : { expiresAt: now() + expiresIn * 1000 }),
    },
  };
}

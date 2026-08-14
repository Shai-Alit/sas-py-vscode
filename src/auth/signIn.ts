// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The sign-in flow, minus the editor.
 *
 * **This module must never import `vscode`.**
 *
 * Structure follows: client/src/connection/rest/auth.ts in
 * sassoftware/vscode-sas-extension (Apache-2.0). No code was copied.
 *
 * Upstream's `getTokens()` is a single 60-line function that opens a browser,
 * registers a URI handler, shows an input box, races the two, and posts to the
 * token endpoint. Every one of those steps needs an extension host, so the whole
 * thing is reachable only by a test that launches an editor — which is why, in
 * practice, none of it is tested at all.
 *
 * The split here puts the *decisions* in this file and leaves the shell holding
 * only the calls it cannot avoid: open a browser, register a handler, show a box,
 * write a secret. What arrives from those is handed straight back here. The
 * questions worth getting right — is this callback ours, did the state match, is
 * a rejected callback grounds for abandoning the paste box, what is worth
 * persisting — are all answerable in the unit tier, against a string.
 *
 * ## The state check lives here
 *
 * ADR-0008 records the defect this exists to close: upstream sets `state` to the
 * callback URL and never looks at what comes back, so its URI handler will accept
 * an authorization code that originated anywhere. That is the injection RFC 6749
 * §10.12 describes. {@link readCallback} refuses a callback whose `state` is not
 * the one {@link beginSignIn} issued, and it does so before reading anything else
 * out of the query.
 */

import {
  describeDeployment,
  explainsMissingClient,
  resolveClient,
  type ClientCredentials,
  type Deployment,
} from "./clientId";
import { createPkcePair, createState, stateMatches } from "./pkce";
import type { AuthProblem } from "./problems";
import {
  buildAuthorizeUrl,
  exchangeAuthorizationCode,
  type TokenEndpointDeps,
  type TokenResult,
  type Tokens,
} from "./tokenEndpoint";

export interface SignInRequest {
  /** Deployment root, e.g. `https://viya.example.com`. */
  endpoint: string;
  /** `clientId` from the profile. Blank and absent mean the same thing. */
  configuredClientId?: string | undefined;
  /** The matching secret from `SecretStorage`, if the profile has one. */
  configuredClientSecret?: string | undefined;
  /** What is known about the Viya version. Defaults to unknown. */
  deployment?: Deployment | undefined;
  /**
   * The callback URI the shell will listen on, already passed through
   * `env.asExternalUri()`.
   *
   * Absent when the host cannot produce one at all. Present is an *offer*, not
   * an instruction: {@link beginSignIn} sends it only when the profile named the
   * client, because the built-in client registers `urn:ietf:wg:oauth:2.0:oob`
   * and rejects any `redirect_uri` at all.
   */
  redirectUri?: string | undefined;
}

/** One sign-in attempt, from the authorize URL to the token exchange. */
export interface PendingSignIn {
  readonly endpoint: string;
  readonly client: ClientCredentials;
  readonly deployment: Deployment;
  /**
   * The `redirect_uri` actually sent, which both legs must agree on
   * (RFC 6749 §4.1.3). `undefined` on the built-in client even when the shell
   * offered one — see {@link beginSignIn}.
   */
  readonly redirectUri: string | undefined;
  /**
   * The value a callback has to carry to be believed.
   *
   * Not a credential in the sense the rest of this directory means it — it
   * authenticates the *callback*, not the user — but it is still never logged,
   * because an attacker who learns it can forge the thing it exists to detect.
   */
  readonly state: string;
  /** The PKCE verifier. Held in memory, sent only in the token request. */
  readonly verifier: string;
  /** Where to send the user's browser. */
  readonly authorizeUrl: string;
}

export type SignInStart =
  | { ok: true; pending: PendingSignIn }
  | { ok: false; reason: string; problem: AuthProblem };

/** Injection points, so a test can pin the values that are otherwise random. */
export interface SignInDeps {
  createPkce?: (() => { verifier: string; challenge: string }) | undefined;
  createState?: (() => string) | undefined;
}

/**
 * Resolves the client, mints PKCE and `state`, and builds the authorize URL.
 *
 * Fails before opening a browser when the deployment has no built-in client and
 * the profile names none — sending the user to a login page that can only end in
 * `invalid_client` wastes their time and teaches them nothing.
 *
 * ## The built-in client gets no `redirect_uri`, and that is not a limitation
 *
 * Verified against a live Viya 4 deployment on 2026-08-13, by hand, in a
 * browser. The built-in `vscode` client registers exactly one redirect value —
 * `urn:ietf:wg:oauth:2.0:oob` — and no custom-scheme URI at all. Sending it any
 * `redirect_uri` fails, and it fails *after* the user has typed their password,
 * on a page reading "did not match one of the registered values". Our callback
 * URI was rejected. So was upstream's own `vscode://sas.sas-lsp`, which is how
 * we know this is not about who the extension is.
 *
 * With the parameter omitted, the deployment falls back to oob and displays the
 * authorization code for the user to copy. **On the built-in client the paste
 * box is therefore the only route, not the fallback** — the URI handler can only
 * ever fire against a client an administrator registered with a real
 * `vscode://` redirect, which is why a profile that names a `clientId` still
 * sends one.
 *
 * Upstream reaches the same place by a different road: `getTokens` in
 * `client/src/connection/rest/auth.ts` sends no `redirect_uri` either, and puts
 * the callback URL in `state` instead. That does nothing — authorizing with
 * `state` set to a `vscode://` URL, in both the single- and double-encoded
 * spellings upstream produces, displayed a code and never offered to open the
 * editor. Worth recording because it looks like a working redirect mechanism
 * and is not one; and because it is the reason upstream cannot validate
 * `state`, while we still can.
 *
 * The decision lives here rather than at the call site because this is where the
 * client is resolved, and because `finishSignIn` reads `pending.redirectUri` for
 * the token leg — RFC 6749 §4.1.3 requires the two legs to agree, and one
 * assignment is how they are made unable to disagree.
 */
export function beginSignIn(
  request: SignInRequest,
  deps: SignInDeps = {},
): SignInStart {
  const deployment = request.deployment ?? { kind: "unknown" };
  const resolution = resolveClient({
    configuredClientId: request.configuredClientId,
    configuredClientSecret: request.configuredClientSecret,
    deployment,
  });
  if (!resolution.ok) {
    return resolution;
  }

  const pkce = (deps.createPkce ?? createPkcePair)();
  const state = (deps.createState ?? createState)();
  const redirectUri = resolution.client.builtIn
    ? undefined
    : request.redirectUri;

  return {
    ok: true,
    pending: {
      endpoint: request.endpoint,
      client: resolution.client,
      deployment,
      redirectUri,
      state,
      verifier: pkce.verifier,
      authorizeUrl: buildAuthorizeUrl({
        endpoint: request.endpoint,
        clientId: resolution.client.clientId,
        codeChallenge: pkce.challenge,
        state,
        redirectUri,
      }),
    },
  };
}

/**
 * What one arm of the code capture produced.
 *
 * `ignored` is not a failure. The URI handler is registered against the whole
 * extension, so it sees every `vscode://` link aimed at us — including, in
 * future, ones that have nothing to do with signing in. Anything that is not
 * recognisably an OAuth callback is left alone rather than reported.
 */
export type CodeCapture =
  | { kind: "code"; code: string; via: "callback" | "paste" }
  | { kind: "problem"; problem: AuthProblem }
  | { kind: "ignored"; reason: string }
  | { kind: "cancelled" };

/**
 * Reads an authorization code out of a callback query string.
 *
 * Accepts the query with or without its leading `?`, which is the difference
 * between `Uri.query` and `URL.search` and not something the caller should have
 * to remember.
 *
 * **The state check comes first and applies to both arms.** An `error` response
 * is validated exactly as a success is: an unsolicited `error=access_denied`
 * aimed at the handler would otherwise be able to abort a sign-in that is
 * legitimately in progress, which is a denial of service against a flow the user
 * started. Nothing from the query is put into a problem except the OAuth `error`
 * and `error_description` fields, which RFC 6749 §4.1.2.1 defines as
 * human-readable diagnostics.
 */
export function readCallback(
  query: string,
  pending: PendingSignIn,
): CodeCapture {
  const params = new URLSearchParams(
    query.startsWith("?") ? query.slice(1) : query,
  );
  const code = params.get("code") ?? "";
  const error = params.get("error") ?? "";

  if (code === "" && error === "") {
    return { kind: "ignored", reason: "no code and no error in the callback" };
  }

  if (!stateMatches(pending.state, params.get("state") ?? "")) {
    return { kind: "problem", problem: { code: "state-mismatch" } };
  }

  if (error !== "") {
    const description = params.get("error_description");
    return {
      kind: "problem",
      problem:
        description === null || description === ""
          ? { code: "oauth-rejected", error }
          : { code: "oauth-rejected", error, description },
    };
  }

  return { kind: "code", code, via: "callback" };
}

/**
 * Reads whatever the user typed into the paste box.
 *
 * `undefined` means the box closed without a value. That is ambiguous at the
 * source and the shell has to disambiguate it before calling here: VS Code
 * resolves `showInputBox` with `undefined` both when the user dismisses it and
 * when its cancellation token fires, and the second case is the *successful*
 * one — it is what the URI handler does after winning the race. Treating that as
 * a cancellation would fail every sign-in that worked.
 *
 * A pasted callback URL is accepted as well as a bare code. Deployments that
 * cannot redirect back show the user a page they are meant to copy from, and
 * what lands on the clipboard is as often the whole URL as the code inside it.
 * A URL goes through {@link readCallback}, so it is state-checked like any other
 * callback; a bare code cannot be, because the user carried it here by hand and
 * there is nothing to compare. That is not a weakening — it is the same trust
 * decision the user made by opening the browser, and PKCE still binds the code
 * to this process.
 */
export function readPastedCode(
  raw: string | undefined,
  pending: PendingSignIn,
): CodeCapture {
  if (raw === undefined) {
    return { kind: "cancelled" };
  }
  const text = raw.trim();
  if (text === "") {
    return { kind: "cancelled" };
  }

  if (text.startsWith("?")) {
    return readCallback(text, pending);
  }
  const url = parseUrl(text);
  if (url?.searchParams.has("code")) {
    return readCallback(url.search, pending);
  }

  return { kind: "code", code: text, via: "paste" };
}

function parseUrl(text: string): URL | undefined {
  try {
    return new URL(text);
  } catch {
    return undefined;
  }
}

/**
 * Does this capture end the wait, or should the other arm keep going?
 *
 * The interesting case is `state-mismatch`, which does **not** settle. A callback
 * carrying the wrong state is either a stale link from a previous attempt or the
 * injection the check exists to catch, and in both cases the user's own sign-in
 * is still in flight. Letting a forged callback tear down the paste box would
 * hand an attacker a reliable way to break sign-in for anyone they can send a
 * link to. It is logged and discarded, and the flow carries on.
 *
 * A genuine `oauth-rejected` does settle: the deployment answered the request we
 * made, and no code is coming.
 */
export function settlesCapture(capture: CodeCapture): boolean {
  switch (capture.kind) {
    case "code":
      return true;
    case "problem":
      return capture.problem.code !== "state-mismatch";
    case "ignored":
      return false;
    case "cancelled":
      return true;
  }
}

/**
 * Redeems a captured code for tokens.
 *
 * The one piece of interpretation here is the rewrite: when we guessed that a
 * deployment of unknown version has the built-in client and the deployment
 * answered `invalid_client`, the useful message is not "invalid_client" — it is
 * the sentence a version check would have produced before the browser ever
 * opened. See {@link explainsMissingClient}, which is deliberately narrow so that
 * a wrong secret or an expired code keeps its own message.
 */
export async function finishSignIn(
  pending: PendingSignIn,
  code: string,
  deps: TokenEndpointDeps = {},
): Promise<TokenResult> {
  const result = await exchangeAuthorizationCode(
    {
      endpoint: pending.endpoint,
      clientId: pending.client.clientId,
      clientSecret: pending.client.clientSecret,
      code,
      codeVerifier: pending.verifier,
      redirectUri: pending.redirectUri,
    },
    deps,
  );

  if (result.ok) {
    return result;
  }

  // The failure arrives already scrubbed. SASLogon echoes the `code_verifier` it
  // received back inside `error_description`, so a mismatched exchange would
  // otherwise hand us our own PKCE secret to log; `tokenEndpoint.ts` removes
  // everything the request carried before returning, which is a better place for
  // it than here because the refresh grant needs the same treatment and never
  // comes through this function.
  if (explainsMissingClient(result.problem, pending.client)) {
    const where = describeDeployment(pending.deployment);
    return {
      ok: false,
      reason: `cannot sign in to ${where} without a client id`,
      problem: { code: "client-id-required", deployment: where },
    };
  }

  return result;
}

/**
 * The `SecretStorage` key for a profile's session.
 *
 * Keyed on the profile's generated `id`, never its name — ADR-0007's delta from
 * upstream. A name is a user-editable label; renaming a profile must not orphan
 * its stored session, and two profiles that briefly share a name during an edit
 * must not share a secret.
 */
export function sessionSecretKey(profileId: string): string {
  if (profileId.trim() === "") {
    throw new Error("a session secret needs a profile id");
  }
  return `pythonOnViya.session.${profileId}`;
}

/**
 * What is worth keeping between sessions.
 *
 * The refresh token and nothing else. An access token is short-lived and can be
 * re-derived from the refresh token, so persisting it buys a few minutes of
 * convenience in exchange for a second long-lived copy of a credential on disk —
 * and the expiry that governs it is a fact about a token we would then have to
 * keep in step. Upstream persists both.
 *
 * `v` is a schema version rather than decoration. This value outlives the
 * extension that wrote it: an install from six months ago is entitled to have
 * written a different shape, and the alternative to a version is guessing from
 * the keys present.
 */
export interface StoredSession {
  readonly refreshToken: string;
}

/** The schema version {@link serializeSession} writes. */
export const SESSION_SCHEMA_VERSION = 1;

/**
 * Turns a token set into the thing to persist, or `undefined` when there is
 * nothing worth persisting.
 *
 * A grant that returned no refresh token is not a failure — some deployments are
 * configured that way — it just means the next sign-in starts at the browser
 * again. Storing an empty record would make that look like corruption later.
 */
export function toStoredSession(tokens: Tokens): StoredSession | undefined {
  const refreshToken = tokens.refreshToken ?? "";
  return refreshToken === "" ? undefined : { refreshToken };
}

export function serializeSession(session: StoredSession): string {
  return JSON.stringify({
    v: SESSION_SCHEMA_VERSION,
    refreshToken: session.refreshToken,
  });
}

/**
 * Reads back what {@link serializeSession} wrote, or `undefined` for anything
 * else.
 *
 * Every rejection here is silent and returns the same thing, which is
 * deliberate. The input is a stored credential: it cannot be logged, it cannot
 * be quoted in an error, and the only useful response to any of the ways it can
 * be wrong — truncated, from an older schema, hand-edited, from a keychain entry
 * that belongs to something else — is to sign in again. A caller that
 * distinguished the cases could not act differently on them.
 */
export function parseStoredSession(
  raw: string | undefined,
): StoredSession | undefined {
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  const record = asRecord(parsed);
  if (record?.v !== SESSION_SCHEMA_VERSION) {
    return undefined;
  }

  const refreshToken = record.refreshToken;
  if (typeof refreshToken !== "string" || refreshToken === "") {
    return undefined;
  }

  return { refreshToken };
}

/** Narrows a parsed JSON value to an object without asserting anything about it. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

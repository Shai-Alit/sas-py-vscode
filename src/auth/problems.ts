// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * What can go wrong while signing in, as codes rather than prose.
 *
 * Mirrors the arrangement in `src/profile/model.ts` and `src/profile/problems.ts`,
 * deliberately: this file names the failures and writes the English sentence that
 * goes to the output channel, and the shell — landing in slice 1b-ii — renders the
 * user-facing half through `vscode.l10n.t()`. The split is what keeps this module
 * free of `vscode` and therefore testable in the unit tier.
 *
 * **This module must never import `vscode`.**
 *
 * One rule governs everything here: **a problem never carries a credential.** Not
 * a token, not a code, not a verifier, not a secret, not the raw response body
 * that might contain any of them. These strings go to a log the user will paste
 * into an issue. The OAuth `error` and `error_description` fields are the
 * exception that proves it — they are specified to be human-readable diagnostics,
 * and they are quoted verbatim precisely because they are the only part of a
 * failed token response that is safe to repeat.
 */

/**
 * A sign-in failure.
 *
 * Adding a member breaks the build in the shell's renderer until it is handled,
 * for the reason spelled out in `src/profile/problems.ts`: an exhaustive `switch`
 * with an explicit `string` return and no `default` fails to type-check when a
 * case is missing, which turns "someone forgot to translate this" from a string
 * shipped to a translated user into a compile error.
 */
export type AuthProblem =
  /**
   * The deployment has no built-in sign-in client and the profile does not name
   * one. `deployment` describes what we know about the version, for the log; the
   * user-facing message has to name what to ask an administrator for.
   */
  | { code: "client-id-required"; deployment: string }
  /** The token endpoint answered with an OAuth error envelope. */
  | { code: "oauth-rejected"; error: string; description?: string }
  /** The request never got an answer — DNS, TLS, proxy, timeout. */
  | { code: "token-endpoint-unreachable"; detail: string }
  /** An answer arrived but was not a token response. */
  | { code: "token-response-malformed"; detail: string }
  /**
   * A callback arrived whose `state` is not the one we issued.
   *
   * The core half of this check is {@link stateMatches} in `./pkce`; the caller
   * lands in slice 1b-ii with the URI handler that receives the callback. This is
   * the defect the upstream audit turned up — see ADR-0008.
   */
  | { code: "state-mismatch" }
  /**
   * The deployment says the token we sent is no longer good — a 401 whose
   * `WWW-Authenticate` carries `error="invalid_token"`.
   *
   * Separate from `oauth-rejected` because it is the recoverable one and the
   * only correct response is to sign in again. `description` is the server's own
   * `error_description`, quoted verbatim on the same reasoning as the OAuth
   * fields above: RFC 6750 §3 specifies it as a human-readable diagnostic.
   */
  | { code: "session-expired"; description?: string }
  /**
   * A 401 whose challenge carries no error parameters, which RFC 6750 §3 says
   * means the request arrived with no credentials at all.
   *
   * Almost always our bug rather than the user's — a request that forgot its
   * `Authorization` header — and worth distinguishing for exactly that reason.
   * Telling this user to sign in again sends them round a loop that cannot fix
   * it. See probe finding 9.
   */
  | { code: "not-authenticated" }
  /**
   * The current user could not be read, for a reason that is not about the token
   * being dead.
   *
   * `detail` describes the failure — a status code, a missing field, a media
   * type the deployment would not serve — and never the response body, which on
   * this endpoint contains the user's address, email and phone numbers.
   */
  | { code: "identity-unavailable"; detail: string };

/**
 * The English sentence for a log.
 *
 * Lower-case fragments without a trailing full stop, matching `describeProblem`
 * in `src/profile/model.ts`: these get embedded in a longer line by the caller.
 * The user-facing sentences are the shell's job and are worded differently, which
 * is intentional — one is read by the person signing in, the other by whoever is
 * reading a log a week later.
 */
export function describeAuthProblem(problem: AuthProblem): string {
  switch (problem.code) {
    case "client-id-required":
      return `no built-in sign-in client on this deployment (${problem.deployment}) and the profile does not set clientId`;
    case "oauth-rejected":
      return problem.description === undefined
        ? `the deployment rejected the sign-in: ${problem.error}`
        : `the deployment rejected the sign-in: ${problem.error} (${problem.description})`;
    case "token-endpoint-unreachable":
      return `could not reach the token endpoint: ${problem.detail}`;
    case "token-response-malformed":
      return `the token endpoint answered with something that is not a token response: ${problem.detail}`;
    case "state-mismatch":
      return "the sign-in callback did not carry the state value this request issued, so it was discarded";
    case "session-expired":
      return problem.description === undefined
        ? "the deployment reports the access token is no longer active"
        : `the deployment reports the access token is no longer active: ${problem.description}`;
    case "not-authenticated":
      return "the request reached the deployment without credentials, so it was refused";
    case "identity-unavailable":
      return `could not read the signed-in user: ${problem.detail}`;
  }
}

/** What a scrubbed secret is replaced with. Deliberately not the empty string. */
const REDACTED = "[redacted]";

/**
 * Removes known secrets from a server-supplied diagnostic.
 *
 * Written after a real failed exchange logged this, verbatim:
 *
 * ```text
 * the deployment rejected the sign-in: invalid_grant (Invalid code verifier: <the verifier>)
 * ```
 *
 * SASLogon echoes the `code_verifier` it received back inside
 * `error_description`. RFC 7636 §4.1 makes that value a secret whose entire
 * purpose is to stay in this process until the token exchange, and the log is a
 * file people attach to bug reports. The exposure is small — a verifier is
 * single-use and the attempt it belonged to has already failed — but it is a
 * secret leaving through our own log line, which is the kind of leak that gets
 * discovered by someone else.
 *
 * The fix is not to stop logging `error_description`. That field is the most
 * useful diagnostic in the whole flow, and dropping it to avoid one bad case
 * would trade a real leak for a permanent blindness. Scrubbing the values we
 * already know keeps both.
 *
 * Empty secrets are skipped: a public client's secret is `""`, and replacing
 * every empty string in a message would redact the whole message.
 */
export function redactText(text: string, secrets: readonly string[]): string {
  return secrets.reduce(
    (scrubbed, secret) =>
      secret === "" ? scrubbed : scrubbed.split(secret).join(REDACTED),
    text,
  );
}

/**
 * {@link redactText} applied to the one field of a problem that quotes the
 * deployment verbatim.
 *
 * Returns the same object when nothing changed, so a caller can tell — and so
 * the common path allocates nothing.
 */
export function redactSecrets(
  problem: AuthProblem,
  secrets: readonly string[],
): AuthProblem {
  switch (problem.code) {
    case "oauth-rejected": {
      if (problem.description === undefined) return problem;
      const description = redactText(problem.description, secrets);
      return description === problem.description
        ? problem
        : { ...problem, description };
    }
    case "session-expired": {
      if (problem.description === undefined) return problem;
      const description = redactText(problem.description, secrets);
      return description === problem.description
        ? problem
        : { ...problem, description };
    }
    default:
      // Every other variant carries only values this process produced.
      return problem;
  }
}

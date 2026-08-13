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
  | { code: "state-mismatch" };

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
  }
}

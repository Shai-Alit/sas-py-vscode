// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import { type AuthProblem, describeAuthProblem } from "../auth/problems";
import { type ViyaError, describeViyaError } from "../wire/viyaError";

/**
 * What can go wrong while talking to the Compute service, as codes rather than
 * prose.
 *
 * The arrangement is the one `src/auth/problems.ts` and `src/profile/problems.ts`
 * already use, and for the same reason: this file names the failures and writes
 * the English sentence that goes to the output channel, while the shell — slice
 * 2a-ii — renders the user-facing half through `vscode.l10n.t()`.
 *
 * **This module must never import `vscode`.**
 *
 * The `application/vnd.sas.error+json` envelope every Viya service returns is
 * read by `src/wire/viyaError.ts` — {@link ViyaError}, {@link readViyaError} and
 * {@link describeViyaError} live there since Phase 6a-i (ADR-0025), because the
 * Folders and Files services answer a failure with the same shape. This file
 * keeps only the Compute-specific vocabulary: which of Compute's own failure
 * modes a caller is looking at, and how to say so.
 */

/**
 * A Compute failure.
 *
 * As in `auth/problems.ts`, adding a member breaks the build in every renderer
 * until it is handled, which is the point of an exhaustive `switch` with an
 * explicit `string` return and no `default`.
 */
export type ComputeProblem =
  /** The request never got an answer — DNS, TLS, proxy, timeout, abort. */
  | { code: "compute-unreachable"; detail: string }
  /**
   * A 401. **Not re-diagnosed here.**
   *
   * Slice 1c already reads RFC 6750's `error` and `error_description` out of the
   * `WWW-Authenticate` challenge and tells a dead token (`invalid_token`, the
   * recoverable case) apart from a request that carried no credentials at all
   * (a bare `Bearer`, which is our bug and which signing in again cannot fix).
   * That analysis is not specific to the identities service, so this variant
   * carries its verdict rather than growing a second copy that will drift.
   */
  | { code: "unauthorized"; problem: AuthProblem }
  /**
   * A 403: authenticated, but not permitted.
   *
   * Distinct from {@link ComputeProblem} `compute-rejected` because it is the one
   * failure whose remedy is a conversation with an administrator rather than
   * anything the user can do in the editor — most often a compute context they
   * can see in a list but may not start a session on.
   */
  | { code: "forbidden"; error: ViyaError }
  /**
   * The session is no longer there.
   *
   * Sessions are reaped after `attributes.sessionInactiveTimeout`, which a live
   * deployment reports as **900 seconds** (finding 18). This is therefore an
   * ordinary consequence of leaving the editor for lunch, not an error, and the
   * only correct response is to start another session and say so quietly.
   *
   * The probe never waited a session out, so the *shape* a reaped session
   * produces is inferred: a 404 is what a deleted one gives, and that is the one
   * `session.ts` maps here.
   *
   * An earlier draft of this comment said a 401 should be folded in too, on the
   * reasoning that a dead session and a dead token are one recoverable event.
   * That is wrong, and `session.ts` deliberately does not do it. The remedy for a
   * gone session is to create another one; the remedy for a dead token is to
   * obtain another token. A caller handed `session-gone` for a 401 would create a
   * session with the credential that just failed, fail again, and go round —
   * quietly, since this variant's whole point is that it is not worth reporting.
   * A 401 keeps its `unauthorized` reading, which slice 1c's challenge analysis
   * has already made properly.
   */
  | { code: "session-gone"; error: ViyaError }
  /**
   * The session never left the state it was created in.
   *
   * Distinct from `compute-unreachable`: the deployment is answering, promptly
   * and correctly, that nothing has happened. The usual cause is server-side and
   * not the user's to fix — a compute context whose SAS process cannot start, or
   * a launcher queue with nothing to hand it — so the message has to be honest
   * that waiting longer is unlikely to help. `seconds` is how long we waited, and
   * is included because "it is taking a while" is not actionable without it.
   */
  | { code: "session-not-ready"; state: string; seconds: number }
  /** Any other non-2xx. `error.status` carries which. */
  | { code: "compute-rejected"; error: ViyaError }
  /** A 2xx whose body was not what the representation should have been. */
  | { code: "response-malformed"; detail: string }
  /**
   * A representation did not offer the link relation the next step needs.
   *
   * Three readings, and nothing in the response separates them: this account is
   * not authorized for the operation on that resource, the resource is in a
   * state where the operation is unavailable, or the deployment does not support
   * it at all — a live possibility on any Viya 4 release this project has not
   * measured, and exactly how this layer is meant to discover version
   * differences (ADR-0010). Findings 54 and
   * 55 put the first of the three at the front, and forbid reporting the third
   * as though the response had established it. `resource` says what was being
   * read, since a bare relation name is not enough to act on.
   */
  | { code: "link-missing"; rel: string; resource: string }
  /**
   * A link pointed somewhere other than this deployment.
   *
   * A security stop rather than a service failure: every request built from a
   * link carries the user's bearer token, so following an absolute or
   * protocol-relative `href` would send that token to a host the response named.
   * Nothing observed on a real deployment does this, which is why it is refused
   * rather than accommodated. See `ForeignLinkError` in `../wire/links`.
   */
  | { code: "foreign-link"; rel: string; href: string };

/**
 * The English sentence for a log.
 *
 * Lower-case fragments with no trailing full stop, matching `describeProblem` in
 * `src/profile/model.ts` and `describeAuthProblem`: the caller embeds these in a
 * longer line. The user-facing wording is 2a-ii's job and is deliberately
 * different — one is read by the person waiting for their code to run, the other
 * by whoever is reading a log a week later.
 */
export function describeComputeProblem(problem: ComputeProblem): string {
  switch (problem.code) {
    case "compute-unreachable":
      return `could not reach the compute service: ${problem.detail}`;
    case "unauthorized":
      // Delegated, not duplicated — the whole reason the variant carries an
      // `AuthProblem` instead of a status code.
      return `the compute service refused the request: ${describeAuthProblem(problem.problem)}`;
    case "forbidden":
      return `not permitted${describeViyaError(problem.error)}`;
    case "session-gone":
      return `the compute session is no longer available${describeViyaError(problem.error)}`;
    case "session-not-ready":
      return `the compute session was still "${problem.state}" after ${String(problem.seconds)} seconds`;
    case "compute-rejected":
      return `the compute service returned HTTP ${String(problem.error.status)}${describeViyaError(problem.error)}`;
    case "response-malformed":
      return `the compute service answered with something unexpected: ${problem.detail}`;
    case "link-missing":
      // "in the response this account read", not "does not offer": finding 54
      // measured a summary carrying three fewer relations than its own
      // resource, so the absence belongs to the response and not to the
      // deployment. The log line is where the next occurrence of #135 will be
      // diagnosed from, and it has to describe what was seen.
      return `the ${problem.resource} carried no "${problem.rel}" link in the response this account read`;
    case "foreign-link":
      return `the "${problem.rel}" link pointed outside this deployment and was not followed: ${problem.href}`;
  }
}

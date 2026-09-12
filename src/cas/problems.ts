// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * What can go wrong while reading the CAS browsing tree from `casManagement`,
 * as codes rather than prose.
 *
 * **This module must never import `vscode`.**
 *
 * The arrangement mirrors `src/content/problems.ts` rather than
 * `src/data/problems.ts`'s: `casManagement` is a genuinely independent Viya
 * service, reachable with nothing but an endpoint and a token (Finding
 * 8.2 — no CAS session, no compute session), so this file names its own
 * vocabulary rather than wrapping `ComputeProblem` the way `DataProblem`
 * wraps a `DataAccessApi` failure that rides on a compute session
 * ([ADR-0033](../../docs/adr/0033-cas-adapter-shape.md)). The
 * `application/vnd.sas.error+json` envelope itself is read by
 * `src/wire/viyaError.ts`; this file keeps only the CAS-specific reading of
 * it.
 *
 * There is no `session-gone`/`session-busy` analogue, for the same reason
 * `src/content/problems.ts` has none: browsing is not bound to any session
 * this project owns.
 */

import { type AuthProblem, describeAuthProblem } from "../auth/problems";
import { type ViyaError, describeViyaError } from "../wire/viyaError";

/**
 * A CAS-browsing failure.
 *
 * As in `content/problems.ts` and `data/problems.ts`, adding a member breaks
 * the build in every renderer until it is handled — an exhaustive `switch`
 * with an explicit `string` return and no `default`.
 */
export type CasProblem =
  /** The request never got an answer — DNS, TLS, proxy, timeout, abort. */
  | { code: "cas-unreachable"; detail: string }
  /**
   * A 401, or no token to send at all. Not re-diagnosed here — the variant
   * carries the auth layer's own verdict (`AuthProblem`), the same
   * delegation `content/problems.ts` makes.
   *
   * `noSession` is set only when this project never obtained a token at all
   * (the token function threw) — not for a 401 the deployment actually
   * answered, including a bare-challenge one. Mirrors
   * `ContentProblem.unauthorized`'s own distinction and the reason for it.
   */
  | { code: "unauthorized"; problem: AuthProblem; noSession?: true }
  /** A 403: authenticated, but not permitted to read this server, caslib, or
   * table. Distinct from `cas-rejected` because the remedy is a conversation
   * with whoever administers CAS access, not anything the user can do in the
   * editor. */
  | { code: "forbidden"; error: ViyaError }
  /** Any other non-2xx. `error.status` carries which — a `404` (a table
   * dropped between one expand and the next) is left unclassified here, the
   * same way `src/content/problems.ts` leaves its own 404s. */
  | { code: "cas-rejected"; error: ViyaError }
  /** A 2xx whose body was not the representation it should have been — no
   * `items` array on a listing, no object at all. */
  | { code: "response-malformed"; detail: string }
  /**
   * A representation did not offer the link relation the next step needs.
   *
   * The same three unseparated readings `compute/problems.ts` and
   * `content/problems.ts` document: not authorized for the operation, the
   * resource is in a state where it is unavailable, or this deployment does
   * not support it. `resource` names what was being read.
   */
  | { code: "link-missing"; rel: string; resource: string }
  /** A link pointed somewhere other than this deployment. A security stop,
   * not a service failure: every request built from a link carries the
   * bearer token. See `ForeignLinkError` in `../wire/links`. */
  | { code: "foreign-link"; rel: string; href: string };

/**
 * The English sentence for a log.
 *
 * Lower-case fragment, no trailing full stop — matching
 * `describeContentProblem`/`describeDataProblem`, whose caller embeds these
 * in a longer line.
 */
export function describeCasProblem(problem: CasProblem): string {
  switch (problem.code) {
    case "cas-unreachable":
      return `could not reach the CAS management service: ${problem.detail}`;
    case "unauthorized":
      return problem.noSession === true
        ? "no active SAS Viya session for this deployment"
        : `the CAS management service refused the request: ${describeAuthProblem(problem.problem)}`;
    case "forbidden":
      return `not permitted to read this CAS resource${describeViyaError(problem.error)}`;
    case "cas-rejected":
      return `the CAS management service returned HTTP ${String(problem.error.status)}${describeViyaError(problem.error)}`;
    case "response-malformed":
      return `the CAS management service answered with something unexpected: ${problem.detail}`;
    case "link-missing":
      return `the ${problem.resource} carried no "${problem.rel}" link in the response this account read`;
    case "foreign-link":
      return `the "${problem.rel}" link pointed outside this deployment and was not followed: ${problem.href}`;
  }
}

// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * What can go wrong while reading the SAS Content tree from the Folders and
 * Files services, as codes rather than prose.
 *
 * **This module must never import `vscode`.**
 *
 * The arrangement is `src/compute/problems.ts`'s, one service over: this file
 * names the failures and writes the English sentence for the log
 * ({@link describeContentProblem}). The read-only tree only logs — a failed
 * folder listing is not shown as a notification — so there is no
 * `l10n.t()`-backed `messages.ts` counterpart yet; that returns with slice 6b,
 * when an action the user took directly (open a file, save it) can fail and
 * warrants a message. The `application/vnd.sas.error+json` envelope both
 * services return on a failure (finding 100, and finding 17 before it) is read
 * by `src/wire/viyaError.ts`; this file keeps only the Content vocabulary.
 *
 * There is no `session-gone` analogue. Browsing content is not bound to a
 * compute session — `src/content/contentExplorer.ts` talks to the Folders
 * service with nothing but an endpoint and a token — so a 404 here is an
 * ordinary `content-rejected` (a folder deleted elsewhere, most likely) and is
 * left unclassified, exactly as `src/compute/client.ts` leaves its own 404s.
 */

import { type AuthProblem, describeAuthProblem } from "../auth/problems";
import { type ViyaError, describeViyaError } from "../wire/viyaError";

/**
 * A Content failure.
 *
 * As in `auth/problems.ts` and `compute/problems.ts`, adding a member breaks
 * the build in every renderer until it is handled — an exhaustive `switch`
 * with an explicit `string` return and no `default`.
 */
export type ContentProblem =
  /** The request never got an answer — DNS, TLS, proxy, timeout, abort. */
  | { code: "content-unreachable"; detail: string }
  /**
   * A 401, or no token to send at all. Not re-diagnosed here — the variant
   * carries slice 1c's verdict (`AuthProblem`), the same delegation
   * `compute/problems.ts` makes and for the same reason: the challenge
   * analysis is not specific to any one service.
   *
   * `noSession` is set only when `src/content/client.ts` never obtained a
   * token — `config.token()` threw, so nothing was sent and there is no live
   * session for this deployment. It is *not* set for a 401 the deployment
   * actually answered, including a bare-challenge one that `challengeProblem`
   * also reads as `not-authenticated` (which the auth layer defines as a
   * dropped `Authorization` header — our bug, "please report this", not a
   * sign-in loop). `src/content/contentFileSystem.ts` needs the two apart: the
   * first warrants a sign-in prompt, the second does not.
   */
  | { code: "unauthorized"; problem: AuthProblem; noSession?: true }
  /**
   * A 403: authenticated, but not permitted to read this folder. Distinct
   * from `content-rejected` because the remedy is a conversation with whoever
   * administers the folder's permissions, not anything the user can do in the
   * editor.
   */
  | { code: "forbidden"; error: ViyaError }
  /**
   * Any other non-2xx. `error.status` carries which. A 404 lands here (a
   * folder removed between one expand and the next), as does a 400 from a
   * malformed delegate name (finding 97) — the tree treats both as "there is
   * nothing to show here" rather than surfacing them as errors.
   */
  | { code: "content-rejected"; error: ViyaError }
  /** A 2xx whose body was not the representation it should have been — no
   * `items` array on a listing, no object at all. */
  | { code: "response-malformed"; detail: string }
  /**
   * A representation did not offer the link relation the next step needs.
   *
   * The same three unseparated readings `compute/problems.ts` documents: not
   * authorized for the operation, the resource is in a state where it is
   * unavailable, or this deployment does not support it. `resource` names what
   * was being read.
   */
  | { code: "link-missing"; rel: string; resource: string }
  /**
   * A link pointed somewhere other than this deployment. A security stop, not
   * a service failure: every request built from a link carries the bearer
   * token. See `ForeignLinkError` in `../wire/links`.
   */
  | { code: "foreign-link"; rel: string; href: string };

/**
 * The English sentence for a log.
 *
 * Lower-case fragments, no trailing full stop — the caller embeds these in a
 * longer line, matching `describeComputeProblem` and `describeAuthProblem`.
 */
export function describeContentProblem(problem: ContentProblem): string {
  switch (problem.code) {
    case "content-unreachable":
      return `could not reach the SAS Content service: ${problem.detail}`;
    case "unauthorized":
      return problem.noSession === true
        ? "no active SAS Viya session for this deployment"
        : `the SAS Content service refused the request: ${describeAuthProblem(problem.problem)}`;
    case "forbidden":
      return `not permitted to read this content${describeViyaError(problem.error)}`;
    case "content-rejected":
      return `the SAS Content service returned HTTP ${String(problem.error.status)}${describeViyaError(problem.error)}`;
    case "response-malformed":
      return `the SAS Content service answered with something unexpected: ${problem.detail}`;
    case "link-missing":
      return `the ${problem.resource} carried no "${problem.rel}" link in the response this account read`;
    case "foreign-link":
      return `the "${problem.rel}" link pointed outside this deployment and was not followed: ${problem.href}`;
  }
}

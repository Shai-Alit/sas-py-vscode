// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import { type AuthProblem, describeAuthProblem } from "../auth/problems";

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
 * ## Why there is no `redactSecrets` here
 *
 * Its absence next to `auth/problems.ts` is deliberate rather than an oversight.
 * That module needs one because SASLogon echoes the PKCE `code_verifier` back
 * inside `error_description`, so a value we sent came home in a diagnostic. The
 * Compute service is not in that position: the only credential a Compute request
 * carries is the bearer token, it travels in a header, and nothing in the error
 * envelope reflects request headers. What the envelope *does* reflect is the
 * request path, which is why {@link readViyaError} drops the `path:` entry
 * rather than quoting it — see the note there.
 *
 * If a future variant ever quotes a request body back to us, this file needs the
 * same treatment `auth/problems.ts` got, and the exhaustive `switch` below is
 * what will make that a compile error rather than a silent leak.
 */

/**
 * The longest server-supplied fragment that will be repeated in a problem.
 *
 * The transport already refuses a body over `MAX_BODY_BYTES` (1 MiB), so this is
 * not a memory bound — it is a legibility one. These strings end up on a single
 * log line and inside a notification, and a deployment is free to put a stack
 * trace in `message`. Two hundred characters is about three lines of an output
 * channel: long enough for every real Viya diagnostic seen so far, which run to
 * a sentence, and short enough that a pathological one cannot bury the rest of
 * the log.
 *
 * Clipping is visible — the value ends in an ellipsis — because a diagnostic
 * that has been silently truncated is worse than one that says so.
 */
export const MAX_DETAIL_LENGTH = 200;

/**
 * A Viya error response, reduced to the parts worth repeating.
 *
 * Every field but `status` is optional, because the only one guaranteed to exist
 * is the one that did not come from the body. A deployment behind a gateway can
 * answer a Compute request with HTML, an empty body, or a JSON document of some
 * entirely different shape, and each of those still has to produce a usable
 * problem rather than an exception.
 */
export interface ViyaError {
  /** The HTTP status actually received — not the envelope's `httpStatusCode`. */
  readonly status: number;
  /** The envelope's `message`, clipped. Short and generic: `"Not Found"`. */
  readonly message?: string | undefined;
  /**
   * The envelope's `errorCode`, an integer whose meanings are not documented
   * anywhere reachable — `5837` is "no such session". Carried because it is what
   * SAS technical support will ask for, and never branched on: keying behaviour
   * on an undocumented number would couple us to one deployment's build.
   */
  readonly errorCode?: number | undefined;
  /** The human sentence from `details`, clipped. The useful part. */
  readonly detail?: string | undefined;
  /**
   * The `correlator:` entry from `details`.
   *
   * The one identifier that lets SAS support find this request in the
   * deployment's own logs, so it is worth surfacing to the user even though it
   * means nothing to them.
   */
  readonly correlator?: string | undefined;
}

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
  /**
   * No compute context by that name is visible to this user.
   *
   * Not an HTTP failure: the contexts collection answers `200` with an empty
   * `items`, because "you may not see it" and "it does not exist" are the same
   * response by design. So the message must offer both readings.
   */
  | { code: "no-such-context"; name: string }
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
   * it at all — which on Viya 3.5 is a live possibility and is exactly how this
   * layer is meant to discover version differences (ADR-0010). Findings 54 and
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
   * rather than accommodated. See `ForeignLinkError` in `./links`.
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
    case "no-such-context":
      return `no compute context named "${problem.name}" is visible to this user`;
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

/**
 * The parenthesised tail describing a {@link ViyaError}, or the empty string.
 *
 * Separate from {@link describeComputeProblem} because three variants carry an
 * error and all three should describe it identically. Prefers `detail` — the
 * human sentence — over `message`, which is generic to the point of uselessness
 * (`"Not Found"`), and appends the correlator when there is one so the log line
 * a user pastes into a support ticket already contains what support will ask
 * for.
 */
export function describeViyaError(error: ViyaError): string {
  const parts: string[] = [];
  if (error.detail !== undefined) parts.push(error.detail);
  else if (error.message !== undefined) parts.push(error.message);
  // `String()` rather than interpolating the number directly: the repo's
  // `restrict-template-expressions` rejects a number in a template.
  if (error.errorCode !== undefined)
    parts.push(`error code ${String(error.errorCode)}`);
  if (error.correlator !== undefined)
    parts.push(`correlator ${error.correlator}`);
  return parts.length === 0 ? "" : ` (${parts.join(", ")})`;
}

/** Prefixes `details` uses for machine entries rather than human ones. */
const PATH_PREFIX = "path:";
const CORRELATOR_PREFIX = "correlator:";

/**
 * Reads a Viya error response into the parts worth repeating.
 *
 * **Total.** It is handed the raw response text and a status, and it always
 * produces a {@link ViyaError}; there is no failure mode. A body that is not
 * JSON, is JSON of another shape, or is empty simply yields an error carrying
 * nothing but the status. That matters more than it sounds: this function runs
 * on the failure path, often on the failure path of a teardown, and a parser
 * that can throw there replaces a diagnosable problem with an opaque one.
 *
 * The envelope is finding 17; this instance of it is the 404 from the session
 * probe, with the identifiers cut:
 *
 * ```json
 * { "message": "Not Found", "errorCode": 5837, "httpStatusCode": 404,
 *   "details": [ "A session with the ID \"…\" could not be found.",
 *                "path: /compute/sessions/…",
 *                "correlator: cca95fbe-…" ] }
 * ```
 *
 * `details` mixes one human sentence with two machine entries. The correlator is
 * kept, and the `path:` entry is **dropped rather than quoted**: it tells the
 * user nothing they did not already know, it is the one field that reflects our
 * own request back at us, and a request path can carry a filter expression
 * naming a context. There is no credential in it — but the cheapest way to keep
 * that true as this layer grows is to not repeat request-derived text at all.
 *
 * `httpStatusCode` inside the body is ignored in favour of the real HTTP status.
 * They agreed in every response observed, and if they ever disagree the one that
 * governs what happened is the one on the wire.
 */
export function readViyaError(status: number, body: string): ViyaError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // HTML from a gateway, a truncated body, or nothing at all.
    return { status };
  }
  if (typeof parsed !== "object" || parsed === null) return { status };

  const envelope = parsed as Record<string, unknown>;
  const message = clip(envelope.message);
  const rawCode: unknown = envelope.errorCode;
  const errorCode =
    typeof rawCode === "number" && Number.isFinite(rawCode)
      ? rawCode
      : undefined;

  let detail: string | undefined;
  let correlator: string | undefined;
  const details: unknown = envelope.details;
  if (Array.isArray(details)) {
    for (const entry of details as readonly unknown[]) {
      if (typeof entry !== "string") continue;
      const trimmed = entry.trim();
      if (trimmed.startsWith(CORRELATOR_PREFIX)) {
        correlator ??= clip(trimmed.slice(CORRELATOR_PREFIX.length).trim());
        continue;
      }
      if (trimmed.startsWith(PATH_PREFIX)) continue;
      detail ??= clip(trimmed);
    }
  }

  return {
    status,
    ...(message === undefined ? {} : { message }),
    ...(errorCode === undefined ? {} : { errorCode }),
    ...(detail === undefined ? {} : { detail }),
    ...(correlator === undefined ? {} : { correlator }),
  };
}

/**
 * A server-supplied string, bounded and normalised, or `undefined` if there is
 * nothing there.
 *
 * Newlines collapse to spaces because these are log *fragments* — a value with a
 * newline in it breaks the line it was embedded in, and a stack trace pasted
 * into `message` would otherwise take over the output channel.
 */
function clip(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const flattened = value.replace(/\s+/g, " ").trim();
  if (flattened === "") return undefined;

  // Measured and cut in **code points**, not UTF-16 code units. `String.slice`
  // cuts between the halves of a surrogate pair, so a message ending in an emoji
  // or a CJK extension character at exactly the boundary would be reported with
  // a lone surrogate in front of the ellipsis — rendered as a replacement
  // character, in a string whose entire job is to be read. Raised in review of
  // 2a-i as cosmetic, which it is; it is also two lines to get right.
  //
  // This does not preserve grapheme clusters: a family emoji or a combining
  // accent can still be split. `Intl.Segmenter` would, and is deliberately not
  // used — the bound exists for legibility rather than correctness, and a log
  // fragment does not warrant carrying a segmenter.
  const points = Array.from(flattened);
  return points.length <= MAX_DETAIL_LENGTH
    ? flattened
    : `${points.slice(0, MAX_DETAIL_LENGTH).join("")}…`;
}

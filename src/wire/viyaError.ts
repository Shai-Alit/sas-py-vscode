// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Reading the `application/vnd.sas.error+json` envelope every SAS Viya service
 * returns on a failure.
 *
 * **This module must never import `vscode`.**
 *
 * This started as part of `src/compute/problems.ts` and moved here in Phase
 * 6a-i (ADR-0025). The envelope is not Compute's — the Folders and Files
 * services behind the SAS Content explorer answer a failure with the same
 * shape (finding 17), and `src/content/problems.ts` reads it through this
 * module rather than carrying a second copy of {@link readViyaError}. The
 * per-service problem *vocabularies* (`ComputeProblem`, `ContentProblem`) stay
 * next to the code that produces them; only the envelope reader is shared.
 *
 * ## Why there is no `redactSecrets` here
 *
 * `auth/problems.ts` needs one because SASLogon echoes the PKCE `code_verifier`
 * back inside `error_description`, so a value we sent came home in a diagnostic.
 * A Viya REST error is not in that position: the only credential a request
 * carries is the bearer token, it travels in a header, and nothing in the error
 * envelope reflects request headers. What the envelope *does* reflect is the
 * request path, which is why {@link readViyaError} drops the `path:` entry
 * rather than quoting it — see the note there.
 *
 * If a future variant ever quotes a request body back to us, this file needs the
 * same treatment `auth/problems.ts` got.
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
 * answer a request with HTML, an empty body, or a JSON document of some entirely
 * different shape, and each of those still has to produce a usable problem
 * rather than an exception.
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
 * The parenthesised tail describing a {@link ViyaError}, or the empty string.
 *
 * Kept separate from the per-service problem describers (`describeComputeProblem`,
 * `describeContentProblem`) because each of them carries a `ViyaError` in more
 * than one variant and all of those should describe it identically. Prefers
 * `detail` — the human sentence — over `message`, which is generic to the point
 * of uselessness (`"Not Found"`), and appends the correlator when there is one so
 * the log line a user pastes into a support ticket already contains what support
 * will ask for.
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

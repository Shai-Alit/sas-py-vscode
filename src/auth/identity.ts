// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Who is signed in — the name for the Accounts menu, and the id the account is
 * keyed on.
 *
 * **This module must never import `vscode`.**
 *
 * Structure follows: client/src/connection/rest/identities.ts in
 * sassoftware/vscode-sas-extension (Apache-2.0). No code was copied.
 *
 * Upstream is twenty-six lines: an axios client, a `GET`, and an interface
 * declaring `{id, name}`. Everything below that upstream does not do comes from
 * probing the endpoint against a live Viya 4 before writing any of it — findings
 * 6 to 9 in `PROBE-FINDINGS.md`. Three of the four changed what got built.
 *
 * ## The `Accept` header is the whole data-minimisation story
 *
 * Upstream sends no `Accept` header at all, so axios's default applies and the
 * deployment returns its full representation. On the probed deployment that was
 * sixteen fields including, for a real person, a street address with postal
 * code, a work email, and two phone numbers one of which was a mobile. Upstream
 * reads all of it into the extension host and keeps two fields.
 *
 * {@link IDENTITY_SUMMARY_TYPE} is the same URL and the same `200`, minus those
 * three arrays. It is one header, and it is the difference between that data
 * being in this process — reachable from a crash dump, a heap snapshot, or a
 * verbose log somebody attaches to an issue — and never arriving.
 *
 * ## Why there is a fallback
 *
 * Finding 6: asking for a media type this service does not serve is a **406**,
 * and the obvious guess (`application/vnd.sas.identity+json`, the one the
 * service name invites) is one of those. No Viya 3.5 deployment was available to
 * probe, so whether 3.5 serves the summary type is unknown. A 406 on the summary
 * type therefore retries with the full type and drops the PII fields as it
 * parses, which is what lets Viya 3.5 be *unverified* rather than *unsupported*.
 *
 * ## Nothing here reads the response body into an error
 *
 * The body of a successful response to this endpoint is the user's personal
 * data. Every failure path reports a status code, a media type, or the name of a
 * missing field, and never the body — the same rule the rest of this directory
 * follows for credentials, for a different reason and with the same conclusion.
 */

import { challengeProblem, parseBearerChallenge } from "./challenge";
import type { AuthProblem } from "./problems";
import {
  nodeHttpTransport,
  type HttpTransport,
  type TransportResponse,
} from "./transport";

/** The identities service's handle for whoever the token belongs to. */
export const CURRENT_USER_PATH = "/identities/users/@currentUser";

/**
 * The representation without `addresses`, `emailAddresses` or `phoneNumbers`.
 *
 * Confirmed to return `200` on Viya 4 (finding 7). Ask for this first, always.
 */
export const IDENTITY_SUMMARY_TYPE =
  "application/vnd.sas.identity.user.summary+json";

/**
 * The full representation, used only after the summary type is refused.
 *
 * Confirmed to return `200` on Viya 4 (finding 6). Note what is *not* here:
 * `application/vnd.sas.identity+json` is the guess the service name invites and
 * it is a 406. Media types on this project are pinned by probe, never derived
 * from a service name.
 */
export const IDENTITY_FULL_TYPE = "application/vnd.sas.identity.user+json";

/** How long to wait before giving up on the identity request. */
export const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * The fields worth keeping about the signed-in user.
 *
 * A deliberate subset of what the endpoint returns, and the subset is the point:
 * a field that is not on this interface is one that cannot end up somewhere it
 * should not be. `id` is the only one anything is keyed on.
 */
export interface ViyaUser {
  /**
   * The identities service's own id, from the `self` link
   * `/identities/users/{id}`.
   *
   * Opaque: on the probed deployment it was seventeen characters, not a UUID and
   * not the login name. On an LDAP-backed provider it may well *be* the login
   * name, which is why nothing user-facing should assume it is meaningless.
   */
  readonly id: string;
  /** The display name, `Given Family` on the probed deployment. */
  readonly name?: string;
  /** `externalLoginIds[0]` — the login name, and an administrator can change it. */
  readonly login?: string;
}

export type IdentityResult =
  | { ok: true; user: ViyaUser }
  | { ok: false; reason: string; problem: AuthProblem };

export interface CurrentUserRequest {
  /** Deployment root, already normalised by `src/profile/model.ts`. */
  endpoint: string;
  accessToken: string;
  /** From the token response. Schemes are case-insensitive; `Bearer` is the default. */
  tokenType?: string | undefined;
}

export interface IdentityDeps {
  /** Defaults to {@link nodeHttpTransport}. */
  transport?: HttpTransport | undefined;
  /** Defaults to {@link DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number | undefined;
}

/**
 * The id an account is keyed on: the deployment plus the Viya user id.
 *
 * Decision 10, settled 2026-08-13. Both halves are load-bearing. The user id
 * alone would let two profiles pointing at different deployments collide the
 * moment a directory issues the same id twice, and an account that collides is
 * an access token handed to the wrong Viya — a confused deputy with the user's
 * own credentials. The endpoint alone would merge two people who use the same
 * deployment from one machine.
 *
 * What is deliberately *not* used: `scimId`, which was identical to `id` on the
 * probed deployment only because it is SCIM-backed and may be absent entirely;
 * and `externalLoginIds[0]` or `name`, which are the two fields an administrator
 * can change underneath a signed-in user. Re-keying an account because somebody
 * fixed a typo in a display name signs that user out for no reason.
 */
export function accountId(endpoint: string, userId: string): string {
  const trimmed = userId.trim();
  if (trimmed === "") {
    throw new Error("an account id needs a Viya user id");
  }
  return `${root(endpoint)}::${trimmed}`;
}

/**
 * What to show in the Accounts menu.
 *
 * Display name, then login, then the raw id. The chain exists because only `id`
 * was established as always present — finding 8 observed `name` on one
 * SCIM-backed deployment, and a directory that does not populate a display name
 * is an ordinary thing rather than a corrupt one. Falling all the way back to
 * the id is ugly, and it is still better than an account row with no label.
 *
 * `title` is not in this chain on purpose: it is a **job title**, not a display
 * name. "Principal Software Engineer" in the Accounts menu would be nobody's
 * idea of who is signed in.
 */
export function accountLabel(user: ViyaUser): string {
  return firstNonEmpty(user.name, user.login) ?? user.id;
}

/**
 * Reads a user out of whatever the endpoint returned, or `undefined` when it is
 * not one.
 *
 * Only `id` is required. That is a deliberate departure from the 1c-i punch
 * list, which said `name` was required too, and it is worth spelling out
 * because the two rules cannot both hold: decision 10 specifies a label fallback
 * from `name` to the login to the id, and a parser that rejects a user without a
 * `name` makes both fallback arms unreachable. The endpoint we could probe is
 * SCIM-backed and populated `name`; the ones we could not — LDAP-backed, and
 * Viya 3.5 — are exactly where a missing display name would show up. Rejecting
 * the whole user over a cosmetic field would turn that into "cannot sign in".
 */
export function parseUser(raw: unknown): ViyaUser | undefined {
  const record = asRecord(raw);
  if (!record) {
    return undefined;
  }

  const id = readString(record, "id");
  if (id === undefined) {
    return undefined;
  }

  const name = readString(record, "name");
  const login = readFirstString(record, "externalLoginIds");

  return {
    id,
    ...(name === undefined ? {} : { name }),
    ...(login === undefined ? {} : { login }),
  };
}

/**
 * Asks the deployment who the token belongs to.
 *
 * Two requests at most: the summary representation, and — only on a 406 — the
 * full one. Anything else is a single round trip.
 */
export async function fetchCurrentUser(
  request: CurrentUserRequest,
  deps: IdentityDeps = {},
): Promise<IdentityResult> {
  const first = await send(request, IDENTITY_SUMMARY_TYPE, deps);
  if (first.kind === "unsupported-media-type") {
    // Finding 6: 406 is what a media type this deployment does not serve looks
    // like. Viya 3.5 is unverified, so this is the branch that keeps it working.
    const second = await send(request, IDENTITY_FULL_TYPE, deps);
    return second.kind === "unsupported-media-type"
      ? {
          ok: false,
          reason: "the deployment serves neither identity media type",
          problem: {
            code: "identity-unavailable",
            detail: `HTTP 406 for both ${IDENTITY_SUMMARY_TYPE} and ${IDENTITY_FULL_TYPE}`,
          },
        }
      : second.result;
  }
  return first.result;
}

type Attempt =
  | { kind: "result"; result: IdentityResult }
  | { kind: "unsupported-media-type" };

async function send(
  request: CurrentUserRequest,
  mediaType: string,
  deps: IdentityDeps,
): Promise<Attempt> {
  const transport = deps.transport ?? nodeHttpTransport;
  const url = `${root(request.endpoint)}${CURRENT_USER_PATH}`;

  let response: TransportResponse;
  try {
    response = await transport(url, {
      method: "GET",
      headers: {
        authorization: `${request.tokenType ?? "Bearer"} ${request.accessToken}`,
        accept: mediaType,
      },
      signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    // The message only. An injected transport's rejection can carry the request
    // that produced it, and this request's headers contain an access token.
    const message = error instanceof Error ? error.message : "unknown error";
    return {
      kind: "result",
      result: {
        ok: false,
        reason: `could not reach ${url}`,
        // `identity-unavailable`, not `token-endpoint-unreachable`, even though
        // the failure is a transport failure and the two read alike from here.
        // The request that failed went to the identities service, and the codes
        // are not descriptions — they choose what the user is told to do.
        // `token-endpoint-unreachable` says the sign-in could not reach the
        // deployment and sends them to check the profile endpoint and their
        // proxy; this happens *after* a sign-in that worked, so that advice
        // sends them to look at the one thing already known to be fine. Every
        // other failure arm in this function already says `identity-unavailable`
        // — this one differed because it was written from the token endpoint's
        // version of the same `catch`.
        problem: {
          code: "identity-unavailable",
          detail: `${CURRENT_USER_PATH} — ${message}`,
        },
      },
    };
  }

  if (response.status === 406) {
    return { kind: "unsupported-media-type" };
  }

  if (response.status === 401) {
    return { kind: "result", result: unauthorized(response) };
  }

  if (!response.ok) {
    return {
      kind: "result",
      result: {
        ok: false,
        reason: `the identities service answered HTTP ${String(response.status)}`,
        problem: {
          code: "identity-unavailable",
          detail: `HTTP ${String(response.status)} from ${CURRENT_USER_PATH}`,
        },
      },
    };
  }

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      kind: "result",
      result: {
        ok: false,
        reason: "the identities service answered with a body that is not JSON",
        problem: {
          code: "identity-unavailable",
          detail: `HTTP ${String(response.status)}, ${String(text.length)} bytes, not JSON`,
        },
      },
    };
  }

  const user = parseUser(parsed);
  if (user === undefined) {
    return {
      kind: "result",
      result: {
        ok: false,
        reason: "the identities service answered without a user id",
        problem: {
          code: "identity-unavailable",
          detail: "no id field in the current-user response",
        },
      },
    };
  }

  return { kind: "result", result: { ok: true, user } };
}

/**
 * Turns a 401 into the right one of two very different messages.
 *
 * Finding 9: the body is zero bytes, so the challenge header is the only place
 * the answer can come from. A challenge carrying `error="invalid_token"` means
 * the token died and the user should sign in again; a bare `Bearer` means
 * nothing was sent, which the user cannot fix by signing in again because they
 * may already be signed in.
 *
 * Both of those readings now live in {@link challengeProblem}, because 2a-i
 * needed the same two from Compute. Only the third arm — an error token this
 * service has to interpret for itself — stays here, and only the `reason`
 * wording is this module's own.
 */
function unauthorized(response: TransportResponse): IdentityResult {
  const header = response.headers["www-authenticate"];
  const problem = challengeProblem(header);

  if (problem?.code === "not-authenticated") {
    return {
      ok: false,
      reason:
        "the identities service refused a request carrying no credentials",
      problem,
    };
  }

  if (problem?.code === "session-expired") {
    return {
      ok: false,
      reason: "the access token is no longer active",
      problem,
    };
  }

  // `insufficient_scope` and anything else RFC 6750 §3.1 allows — the cases
  // `challengeProblem` deliberately declines to answer. The error token is a
  // specified diagnostic and safe to quote; it is not a credential and it did
  // not come from the body. The `?? ""` is unreachable: a challenge with no
  // error token was answered above.
  const error = parseBearerChallenge(header)?.params.error ?? "";
  return {
    ok: false,
    reason: `the identities service refused the request: ${error}`,
    problem: {
      code: "identity-unavailable",
      detail: `HTTP 401, WWW-Authenticate error=${error}`,
    },
  };
}

/** Trailing slashes off, so joining a path cannot produce a double slash. */
function root(endpoint: string): string {
  // Trimmed as well as de-slashed. The account id built from this is compared
  // across windows and across restarts, so two spellings of one endpoint — a
  // hand-edited setting with a stray space, a pasted URL with a trailing slash —
  // have to reduce to one string or the same deployment appears twice in the
  // Accounts menu.
  return endpoint.trim().replace(/\/+$/, "");
}

function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (value !== undefined && value.trim() !== "") {
      return value;
    }
  }
  return undefined;
}

/** Narrows a parsed JSON value to an object without asserting anything about it. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** A field, if it is a non-empty string once trimmed. */
function readString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * The first usable string in an array field.
 *
 * `externalLoginIds` was a one-entry array on the probed deployment, and the
 * shape is an array because a user can have logins from several providers. The
 * first is the one upstream's own UI shows.
 */
function readFirstString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim() !== "") {
      return entry;
    }
  }
  return undefined;
}

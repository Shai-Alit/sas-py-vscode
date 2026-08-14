// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * One request to the Compute service, driven by a link.
 *
 * **This module must never import `vscode`.**
 *
 * Structure follows: client/src/connection/rest/ in
 * sassoftware/vscode-sas-extension (Apache-2.0). No code was copied.
 *
 * ## Why a link and not a path
 *
 * Every method here takes a {@link Link} the deployment handed us, not a path
 * this extension composed. That is ADR-0010 in one sentence: the only URL this
 * project writes down is the deployment root from the profile, and everything
 * below it is navigated by relation. It is also why there is no equivalent of
 * upstream's `link.href.replace("/compute", "")` — hrefs arrive root-relative and
 * already carrying `/compute` (finding 13), and {@link resolveHref} joins them to
 * the root without rewriting either side.
 *
 * A link is more than an href, which is the second reason to pass the whole
 * thing: it carries the method, and the media types for the request and the
 * response. Deriving the headers from it means the caller cannot pair a `POST`
 * body with the `Accept` of a `GET`, and it means a deployment that renames a
 * media type between versions is followed rather than fought.
 *
 * ## What this layer decides and what it refuses to
 *
 * It maps transport outcomes onto {@link ComputeProblem}: unreachable, 401, 403,
 * anything else non-2xx, and a JSON body that will not parse. It deliberately
 * does **not** interpret a 404 — whether that means "this session is gone" or
 * "no context by that name" depends on what was asked for, and only the caller
 * knows. Those callers turn a `compute-rejected` 404 into the variant that says
 * something useful.
 *
 * ## No process-global state
 *
 * Upstream keeps a mutable `Configuration` singleton on the module, so a second
 * profile in the same window overwrites the first one's base URL. Everything
 * this client needs is on {@link ComputeClientConfig}, and the token arrives as a
 * **function** rather than a string so a session that outlives one access token
 * picks up the next one without being rebuilt.
 */

import { challengeProblem } from "../auth/challenge";
import {
  nodeHttpTransport,
  type HttpTransport,
  type TransportResponse,
} from "../auth/transport";
import {
  ForeignLinkError,
  computeMediaType,
  linkMethod,
  resolveHref,
  type Link,
} from "./links";
import {
  describeViyaError,
  readViyaError,
  type ComputeProblem,
} from "./problems";

/**
 * How long to wait on a request that is not a long poll.
 *
 * Generous compared with the identity request's fifteen seconds, because
 * creating a compute session starts a SAS process on the server and the observed
 * time to a `201` was seconds rather than milliseconds. A caller that knows
 * better — the state long poll, which asks the server to hold the connection —
 * passes its own.
 */
export const DEFAULT_TIMEOUT_MS = 30_000;

export type ComputeResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; problem: ComputeProblem };

export interface ComputeClientConfig {
  /**
   * The deployment root, already normalised by `src/profile/model.ts`.
   *
   * May carry a path prefix — `normaliseEndpoint` returns
   * `` `${origin}${path}` `` — so this is the whole base, not an origin.
   */
  root: string;
  /**
   * Produces the current access token.
   *
   * A function, not a string. A compute session can outlive the token that
   * created it, and the alternative — handing the client a string at
   * construction — is how a long-running session starts failing with 401s that
   * a refresh has already fixed.
   */
  token: () => string | Promise<string>;
  /** Defaults to {@link nodeHttpTransport}. */
  transport?: HttpTransport | undefined;
  /** Defaults to {@link DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number | undefined;
}

export interface ComputeRequest {
  /** The link to follow. Its `method` and media types drive the request. */
  link: Link;
  /** Serialised as JSON when present. Absent means no request body at all. */
  body?: unknown;
  /**
   * Sent as `If-Match`, and **only when held**.
   *
   * Finding 18: `DELETE /compute/sessions/{id}` answered `204` with no
   * `If-Match` at all, so the header upstream attaches unconditionally is not
   * required. Sending an ETag we are not sure of turns a working teardown into a
   * `412` and leaves a SAS process running on the server until it times out.
   */
  etag?: string | undefined;
  /**
   * Sent as `If-None-Match` — a conditional read, or the state long poll.
   *
   * Finding 19: `GET …/state?wait=5` with this header held the connection for
   * five seconds and then answered `304`. That 304 is a **successful** read
   * meaning "still what you had", which is why it is not a failure here.
   */
  ifNoneMatch?: string | undefined;
  /** Cancels the request. Combined with the timeout, not replaced by it. */
  signal?: AbortSignal | undefined;
  /** Overrides {@link ComputeClientConfig.timeoutMs} for this one request. */
  timeoutMs?: number | undefined;
}

export interface ComputeResponse {
  readonly status: number;
  /** `304` — the conditional read matched. {@link ComputeResponse.body} is unset. */
  readonly notModified: boolean;
  /**
   * The `ETag` response header, echoed **verbatim**.
   *
   * Weak validators (`W/"…"`) are ordinary here and the `W/` prefix is part of
   * the value: stripping it produces a validator the server does not recognise.
   */
  readonly etag?: string | undefined;
  /** The `Location` header after a `201`, as sent — root-relative (finding 18). */
  readonly location?: string | undefined;
  readonly contentType?: string | undefined;
  /** The raw response text, whether or not it parsed. */
  readonly text: string;
  /** The parsed body when the response was JSON, `undefined` otherwise. */
  readonly body: unknown;
}

export interface ComputeClient {
  send(request: ComputeRequest): Promise<ComputeResult<ComputeResponse>>;
}

export function createComputeClient(
  config: ComputeClientConfig,
): ComputeClient {
  return {
    send: async (request) => await sendRequest(config, request),
  };
}

async function sendRequest(
  config: ComputeClientConfig,
  request: ComputeRequest,
): Promise<ComputeResult<ComputeResponse>> {
  const { link } = request;
  const method = linkMethod(link);

  let url: string;
  try {
    url = resolveHref(config.root, link.href);
  } catch (error) {
    if (error instanceof ForeignLinkError) {
      return {
        ok: false,
        reason: error.message,
        problem: { code: "foreign-link", rel: link.rel, href: link.href },
      };
    }
    throw error;
  }

  let token: string;
  try {
    token = await config.token();
  } catch (error) {
    // The message only, and for the same reason as everywhere else in this
    // codebase: the thrown value came from the sign-in machinery, which handles
    // tokens. `not-authenticated` rather than `session-expired` because nothing
    // was presented to the deployment at all — asking the user to sign in again
    // when the refresh itself is broken sends them round a loop.
    return {
      ok: false,
      reason: `could not obtain an access token: ${messageOf(error)}`,
      problem: { code: "unauthorized", problem: { code: "not-authenticated" } },
    };
  }

  const headers: Record<string, string> = {
    // Viya issues bearer tokens and the token endpoint has never answered with
    // another scheme, so unlike the identity request there is no `tokenType` to
    // thread through — the caller hands over a token, not a credential envelope.
    authorization: `Bearer ${token}`,
  };

  const accept = acceptFor(link, method);
  if (accept !== undefined) headers.accept = accept;

  let body: string | undefined;
  if (request.body !== undefined) {
    body = JSON.stringify(request.body);
    headers["content-type"] = computeMediaType(link.type) ?? "application/json";
  }

  if (request.etag !== undefined) headers["if-match"] = request.etag;
  if (request.ifNoneMatch !== undefined) {
    headers["if-none-match"] = request.ifNoneMatch;
  }

  const transport = config.transport ?? nodeHttpTransport;
  const timeout = AbortSignal.timeout(
    request.timeoutMs ?? config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  // Combined, not chosen between. A caller's signal cancels a request the user
  // walked away from; the timeout stops one the deployment never answers. Either
  // alone leaves the other failure hanging.
  const signal =
    request.signal === undefined
      ? timeout
      : AbortSignal.any([request.signal, timeout]);

  let response: TransportResponse;
  let text: string;
  try {
    response = await transport(url, { method, headers, body, signal });
    text = await response.text();
  } catch (error) {
    // The message only. An injected transport's rejection can carry the request
    // that produced it, and this request's headers contain an access token.
    return {
      ok: false,
      reason: "could not reach the compute service",
      problem: {
        code: "compute-unreachable",
        // The href, not the resolved URL: the root is already in the log from
        // sign-in, and repeating it on every failure line adds nothing.
        detail: `${method} ${link.href} — ${messageOf(error)}`,
      },
    };
  }

  const etag = response.headers.etag;
  const location = response.headers.location;
  const contentType = response.headers["content-type"];

  if (response.status === 304) {
    return {
      ok: true,
      value: {
        status: 304,
        notModified: true,
        ...(etag === undefined ? {} : { etag }),
        ...(contentType === undefined ? {} : { contentType }),
        text,
        body: undefined,
      },
    };
  }

  if (response.status === 401) {
    const problem = challengeProblem(response.headers["www-authenticate"]);
    if (problem !== undefined) {
      return {
        ok: false,
        reason:
          problem.code === "session-expired"
            ? "the access token is no longer active"
            : "the compute service refused a request carrying no credentials",
        problem: { code: "unauthorized", problem },
      };
    }
    // `insufficient_scope` and anything else RFC 6750 §3.1 allows — the readings
    // `challengeProblem` declines to make, because they are not "sign in again".
    // Falling through to the generic arm keeps them visible without this layer
    // inventing a third answer to a question 1c already owns.
  }

  if (response.status === 403) {
    const error = readViyaError(response.status, text);
    return {
      ok: false,
      reason: `the compute service refused the request${describeViyaError(error)}`,
      problem: { code: "forbidden", error },
    };
  }

  if (!response.ok) {
    const error = readViyaError(response.status, text);
    return {
      ok: false,
      // Deliberately unclassified. A 404 here may mean the session is gone or
      // that no context matched, and only the caller that built the request
      // knows which — see the note at the top of this file.
      reason: `the compute service answered HTTP ${String(response.status)}${describeViyaError(error)}`,
      problem: { code: "compute-rejected", error },
    };
  }

  let parsed: unknown;
  if (isJson(contentType) && text.trim() !== "") {
    try {
      parsed = JSON.parse(text);
    } catch {
      return {
        ok: false,
        reason: "the compute service answered with a body that is not JSON",
        problem: {
          code: "response-malformed",
          // Not the body. It parsed as nothing, so quoting it would put an
          // arbitrary server payload in the log to no purpose.
          detail: `${method} ${link.href} answered HTTP ${String(response.status)} as ${contentType ?? "an unknown type"}, which did not parse`,
        },
      };
    }
  }

  return {
    ok: true,
    value: {
      status: response.status,
      notModified: false,
      ...(etag === undefined ? {} : { etag }),
      ...(location === undefined ? {} : { location }),
      ...(contentType === undefined ? {} : { contentType }),
      text,
      body: parsed,
    },
  };
}

/**
 * The `Accept` header for a link, or nothing.
 *
 * `responseType` is the authority when the deployment sends one. Falling back to
 * `type` is correct **only on a GET**: on a `POST` or `PUT`, `type` describes the
 * body being sent, and asking for it back is how a create call ends up demanding
 * the `…definition+json` it just uploaded.
 *
 * When neither is present the header is omitted rather than guessed. Finding 6
 * is the reason: asking for a media type a service does not serve is a `406`,
 * which fails the request outright, whereas sending no `Accept` yields the
 * server's default representation — which is the one the link intended.
 */
function acceptFor(link: Link, method: string): string | undefined {
  const declared = computeMediaType(link.responseType);
  if (declared !== undefined) return declared;
  return method === "GET" ? computeMediaType(link.type) : undefined;
}

/**
 * Whether a `Content-Type` promises JSON.
 *
 * Every Viya representation is a vendor type ending `+json` (finding 14 —
 * except in `links[].type`, where the suffix is missing and
 * {@link computeMediaType} puts it back), and an error is
 * `application/vnd.sas.error+json` (finding 17), which ends the same way.
 * Anything else is a gateway's HTML or a log file.
 *
 * The essence is taken before the comparison because the parameters are not
 * decoration: finding 17's error type carries both `charset` and `version`, so
 * an equality test against the whole header value would read a perfectly good
 * error body as unparseable.
 */
function isJson(contentType: string | undefined): boolean {
  if (contentType === undefined) return false;
  const [essence = ""] = contentType.split(";");
  const trimmed = essence.trim().toLowerCase();
  return trimmed === "application/json" || trimmed.endsWith("+json");
}

/** The message of a thrown value, and nothing else it might be carrying. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

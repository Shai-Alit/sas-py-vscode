// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * One request to the Folders or Files service, driven by a link.
 *
 * **This module must never import `vscode`.**
 *
 * Structure follows: `client/src/connection/rest/` in
 * sassoftware/vscode-sas-extension (Apache-2.0). No code was copied. It is the
 * read-scoped sibling of `src/compute/client.ts` — same wire, same rules —
 * re-derived from that client's shape rather than sharing it, per
 * [ADR-0025](../../docs/adr/0025-shared-wire-layer.md): promoting the whole
 * Compute client into `src/wire/` is a larger refactor than Phase 6 needs, so
 * `src/content/` gets its own small follower built on `src/wire/` and
 * `src/auth/transport.ts`.
 *
 * ## Read-only, deliberately
 *
 * This slice (6a-ii) is a browse-only tree, so `send` has no `body`, no
 * `If-Match`, no raw upload arm — every request it makes is a `GET`. The
 * mutating arms arrive with 6b/6c when a `readFile`/`writeFile`/create first
 * needs them, added against a probe rather than guessed at now. What is here is
 * the same transport-outcome mapping the Compute client already carries and
 * that has already been through review: unreachable, 401 (via slice 1c's
 * challenge reading), 403, any other non-2xx (read as an
 * `application/vnd.sas.error+json` envelope — finding 100), and a JSON body that
 * will not parse.
 *
 * ## Why a link and not a path
 *
 * ADR-0010: the only URL this project writes down is the deployment root from
 * the profile; everything below it is navigated by relation. The Folders
 * service hands back the same `{ rel, href, method, type }` envelope the
 * Compute service does (`src/wire/links.ts`), so {@link resolveHref} joins an
 * href to the root without rewriting either side, and a `ForeignLinkError`
 * becomes a `content-rejected`-adjacent {@link ContentProblem} rather than a
 * request sent to a host the response named.
 *
 * ## No process-global state
 *
 * Everything the client needs is on {@link ContentClientConfig}, and the token
 * arrives as a **function** so a long-lived tree view picks up a refreshed
 * access token without the client being rebuilt.
 */

import { challengeProblem, parseBearerChallenge } from "../auth/challenge";
import {
  nodeHttpTransport,
  type HttpTransport,
  type TransportResponse,
} from "../auth/transport";
import {
  ForeignLinkError,
  linkMethod,
  resolveHref,
  sasMediaType,
  type Link,
} from "../wire/links";
import { describeViyaError, readViyaError } from "../wire/viyaError";
import { type ContentProblem } from "./problems";

/**
 * How long to wait on a Folders/Files request.
 *
 * These are small JSON reads against a metadata service — a folder
 * representation or a page of members — so the identity request's fifteen
 * seconds is the right order of magnitude, not the Compute client's thirty
 * (which is sized for a request that starts a SAS process).
 */
export const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * A failed Content call, named on its own so a helper that only handles
 * failures need not be generic — the same split `ComputeFailure` makes.
 */
export interface ContentFailure {
  ok: false;
  reason: string;
  problem: ContentProblem;
}

export type ContentResult<T> = { ok: true; value: T } | ContentFailure;

export interface ContentClientConfig {
  /** The deployment root, already normalised by `src/profile/model.ts`. May
   * carry a path prefix, so this is the whole base, not an origin. */
  root: string;
  /**
   * Produces the current access token. A function, not a string: a tree view
   * outlives the token that first populated it, and a client holding a string
   * starts failing with 401s a refresh has already fixed.
   */
  token: () => string | Promise<string>;
  /** Defaults to {@link nodeHttpTransport}. `src/extension.ts` passes one
   * carrying the `pythonOnViya.userProvidedCertificates` CA agent (slice
   * 5d-i) so a deployment behind a private CA is browsable too. */
  transport?: HttpTransport | undefined;
  /** Defaults to {@link DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number | undefined;
}

export interface ContentRequest {
  /** The link to follow. Its `method` and media types drive the request. */
  link: Link;
  /** Cancels the request. Combined with the timeout, not replaced by it. */
  signal?: AbortSignal | undefined;
  /** Overrides {@link ContentClientConfig.timeoutMs} for this one request. */
  timeoutMs?: number | undefined;
}

export interface ContentResponse {
  readonly status: number;
  readonly contentType?: string | undefined;
  /** The raw response text, whether or not it parsed. */
  readonly text: string;
  /** The parsed body when the response was JSON, `undefined` otherwise. */
  readonly body: unknown;
}

export interface ContentClient {
  send(request: ContentRequest): Promise<ContentResult<ContentResponse>>;
}

export function createContentClient(
  config: ContentClientConfig,
): ContentClient {
  return {
    send: async (request) => await sendRequest(config, request),
  };
}

async function sendRequest(
  config: ContentClientConfig,
  request: ContentRequest,
): Promise<ContentResult<ContentResponse>> {
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
    // The message only: the thrown value came from the sign-in machinery.
    // `not-authenticated` rather than `session-expired` because nothing was
    // presented to the deployment at all.
    return {
      ok: false,
      reason: `could not obtain an access token: ${messageOf(error)}`,
      problem: { code: "unauthorized", problem: { code: "not-authenticated" } },
    };
  }

  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
  };
  // Only what the link declares. Finding 100: asking for a media type the
  // endpoint does not serve — `application/vnd.sas.error+json` among them — is
  // a 406, whereas sending no `Accept` yields the default representation the
  // link intended.
  const accept = sasMediaType(link.responseType) ?? sasMediaType(link.type);
  if (method === "GET" && accept !== undefined) headers.accept = accept;

  const transport = config.transport ?? nodeHttpTransport;
  const timeout = AbortSignal.timeout(
    request.timeoutMs ?? config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  // Combined, not chosen between — a caller's signal cancels a request the user
  // walked away from; the timeout stops one the deployment never answers. The
  // same chain `src/compute/client.ts` documents and pins in
  // `test/integration/runtime.test.ts`.
  const signal =
    request.signal === undefined
      ? timeout
      : AbortSignal.any([request.signal, timeout]);

  let response: TransportResponse;
  let text: string;
  try {
    response = await transport(url, { method, headers, signal });
    text = await response.text();
  } catch (error) {
    // The message only. An injected transport's rejection can carry the
    // request that produced it, and this request's headers contain a token.
    return {
      ok: false,
      reason: "could not reach the SAS Content service",
      problem: {
        code: "content-unreachable",
        detail: `${method} ${link.href} — ${messageOf(error)}`,
      },
    };
  }

  const contentType = response.headers["content-type"];

  if (response.status === 401) {
    const challenge = parseBearerChallenge(
      response.headers["www-authenticate"],
    );
    const problem = challengeProblem(challenge);
    if (problem !== undefined) {
      return {
        ok: false,
        reason:
          problem.code === "session-expired"
            ? "the access token is no longer active"
            : "the SAS Content service refused a request carrying no credentials",
        problem: { code: "unauthorized", problem },
      };
    }
    // `insufficient_scope` and anything else RFC 6750 §3.1 allows falls
    // through to the generic arm rather than this layer inventing a reading.
  }

  if (response.status === 403) {
    const error = readViyaError(response.status, text);
    return {
      ok: false,
      reason: `the SAS Content service refused the request${describeViyaError(error)}`,
      problem: { code: "forbidden", error },
    };
  }

  if (!response.ok) {
    const error = readViyaError(response.status, text);
    return {
      ok: false,
      // Unclassified on purpose: a 404 may be a folder deleted elsewhere, a
      // 400 a malformed delegate name (finding 97). The caller decides what
      // absence means.
      reason: `the SAS Content service answered HTTP ${String(response.status)}${describeViyaError(error)}`,
      problem: { code: "content-rejected", error },
    };
  }

  let parsed: unknown;
  if (isJson(contentType) && text.trim() !== "") {
    try {
      parsed = JSON.parse(text);
    } catch {
      return {
        ok: false,
        reason: "the SAS Content service answered with a body that is not JSON",
        problem: {
          code: "response-malformed",
          detail: `${method} ${link.href} answered HTTP ${String(response.status)} as ${contentType ?? "an unknown type"}, which did not parse`,
        },
      };
    }
  }

  return {
    ok: true,
    value: {
      status: response.status,
      ...(contentType === undefined ? {} : { contentType }),
      text,
      body: parsed,
    },
  };
}

/**
 * Whether a `Content-Type` promises JSON.
 *
 * Every Folders/Files representation is a vendor type ending `+json`, a
 * collection is `application/vnd.sas.collection+json`, and an error is
 * `application/vnd.sas.error+json` (finding 100) — all end the same way. The
 * essence is taken first because finding 100's error type carries `charset` and
 * `version` parameters.
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

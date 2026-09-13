// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * One request to the `casManagement` service, driven by a link.
 *
 * **This module must never import `vscode`.**
 *
 * The read-scoped sibling of `src/content/client.ts` — same wire, same
 * rules, re-derived rather than shared, per
 * [ADR-0033](../../docs/adr/0033-cas-adapter-shape.md): `casManagement`
 * needs no session of its own (Finding 8.2), so this client is built the
 * same "endpoint plus a token function" way `src/content/client.ts` is, not
 * the compute-session-borrowing way `src/data/adapter.ts` reads its own
 * requests through `ComputeClient`.
 *
 * ## Narrower than `ContentClient`, deliberately
 *
 * `src/cas/adapter.ts`'s calls this slice needs are all `GET`, plus one
 * bodyless `PUT` (the JIT-load toggle, Finding 8.8 — a query parameter, no
 * request body at all). There is no file content to write, so this carries
 * none of `ContentRequest`'s `rawBody`/`jsonBody`/`contentDisposition`/`etag`/
 * `maxBodyBytes` — they would be dead parameters with no caller.
 *
 * ## The load-toggle's response is plain text, not JSON
 *
 * Finding 8.8: `PUT .../tables/{name}/state?value=loaded` answers `200` with
 * a `text/plain` body (`"loaded"`), even though the link's own
 * `responseType` advertises `application/json,text/plain`. {@link isJson}
 * gates the JSON parse on the *response's actual* `Content-Type`, not on
 * what the link claimed it might be, so this needs no special case: `body`
 * comes back `undefined` and the caller reads `text` instead — the same
 * `ContentResponse.text`-first design `src/content/client.ts`'s own raw-bytes
 * reply already relies on.
 */

import {
  nodeHttpTransport,
  type HttpTransport,
  type TransportResponse,
} from "../auth/transport";
import { challengeProblem, parseBearerChallenge } from "../auth/challenge";
import {
  ForeignLinkError,
  linkMethod,
  resolveHref,
  sasMediaType,
  type Link,
} from "../wire/links";
import { describeViyaError, readViyaError } from "../wire/viyaError";
import { type CasProblem } from "./problems";

/**
 * How long to wait on a `casManagement` request — a small JSON read against a
 * metadata service, the same order of magnitude as `src/content/client.ts`'s
 * own default and for the same reason (this is not a request that starts a
 * SAS process, unlike the Compute client's 30s).
 */
export const DEFAULT_TIMEOUT_MS = 15_000;

/** A failed CAS call, named on its own so a helper that only handles
 * failures need not be generic — the same split `ContentFailure` makes. */
export interface CasFailure {
  ok: false;
  reason: string;
  problem: CasProblem;
}

export type CasResult<T> = { ok: true; value: T } | CasFailure;

export interface CasClientConfig {
  /** The deployment root, already normalised by `src/profile/model.ts`. */
  root: string;
  /** Produces the current access token. A function, not a string — see
   * `ContentClientConfig.token`'s own doc comment for why. */
  token: () => string | Promise<string>;
  /** Defaults to {@link nodeHttpTransport}. `src/extension.ts` passes one
   * carrying the `pythonOnViya.userProvidedCertificates` CA agent (slice
   * 5d-i) so a deployment behind a private CA is browsable here too. */
  transport?: HttpTransport | undefined;
  /** Defaults to {@link DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number | undefined;
}

export interface CasRequest {
  /** The link to follow. Its `method` and media types drive the request. */
  link: Link;
  /** Cancels the request. Combined with the timeout, not replaced by it. */
  signal?: AbortSignal | undefined;
  /** Overrides {@link CasClientConfig.timeoutMs} for this one request. */
  timeoutMs?: number | undefined;
}

export interface CasResponse {
  readonly status: number;
  readonly contentType?: string | undefined;
  /** The raw response text, whether or not it parsed. */
  readonly text: string;
  /** The parsed body when the response was JSON, `undefined` otherwise —
   * see this module's own doc comment for why the load toggle's plain-text
   * reply relies on this being `undefined` rather than an error. */
  readonly body: unknown;
}

export interface CasClient {
  send(request: CasRequest): Promise<CasResult<CasResponse>>;
}

export function createCasClient(config: CasClientConfig): CasClient {
  return {
    send: async (request) => await sendRequest(config, request),
  };
}

async function sendRequest(
  config: CasClientConfig,
  request: CasRequest,
): Promise<CasResult<CasResponse>> {
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
    return {
      ok: false,
      reason: `could not obtain an access token: ${messageOf(error)}`,
      problem: {
        code: "unauthorized",
        problem: { code: "not-authenticated" },
        noSession: true,
      },
    };
  }

  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
  };
  const accept = sasMediaType(link.responseType) ?? sasMediaType(link.type);
  if (accept !== undefined) headers.accept = accept;

  const transport = config.transport ?? nodeHttpTransport;
  const timeout = AbortSignal.timeout(
    request.timeoutMs ?? config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
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
    return {
      ok: false,
      reason: "could not reach the CAS management service",
      problem: {
        code: "cas-unreachable",
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
            : "the CAS management service refused a request carrying no credentials",
        problem: { code: "unauthorized", problem },
      };
    }
  }

  if (response.status === 403) {
    const error = readViyaError(response.status, text);
    return {
      ok: false,
      reason: `the CAS management service refused the request${describeViyaError(error)}`,
      problem: { code: "forbidden", error },
    };
  }

  if (!response.ok) {
    const error = readViyaError(response.status, text);
    return {
      ok: false,
      reason: `the CAS management service answered HTTP ${String(response.status)}${describeViyaError(error)}`,
      problem: { code: "cas-rejected", error },
    };
  }

  let parsed: unknown;
  if (isJson(contentType) && text.trim() !== "") {
    try {
      parsed = JSON.parse(text);
    } catch {
      return {
        ok: false,
        reason:
          "the CAS management service answered with a body that is not JSON",
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

/** Whether a `Content-Type` promises JSON — the same rule
 * `src/content/client.ts`'s own `isJson` applies, so the plain-text load-toggle
 * reply (Finding 8.8) is correctly left unparsed. */
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

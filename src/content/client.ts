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
 * ## Read plus write content and structure
 *
 * 6a-ii shipped this `GET`-only. 6b added one mutating arm — a
 * `PUT`/`rawBody`/`If-Match` request against a file's `content` sub-resource
 * (findings 6.1/6.2) — so a remote `.py` opens and saves in place. 6c-i adds
 * the structural mutations (folder/file create, rename, delete) behind the tree
 * context menu, which need a **JSON** request body ({@link ContentRequest.jsonBody})
 * and, for file create, a `Content-Disposition`
 * ({@link ContentRequest.contentDisposition}) — findings 6.3–6.8. The `PUT`
 * content shape is the one the live probe measured: `If-Match` with the file's
 * current ETag is required (a bare `PUT` is `428`, a stale one `412` — finding
 * 6.2), the response carries a fresh `ETag`/`Last-Modified`, and the sent
 * `Content-Type` is not validated but is echoed back for correctness.
 *
 * The transport-outcome mapping follows the one the Compute client carries and
 * that has been through review: unreachable, a response body past the size cap
 * (`content-too-large`, so a file over `readFileContent`'s 10 MiB reads as too
 * large rather than as an unreachable host), 401 (via slice 1c's challenge
 * reading), 403, any other non-2xx (read as an `application/vnd.sas.error+json`
 * envelope — findings 100 and 6.2 — so `409`/`412`/`428` arrive as
 * `content-rejected` carrying `error.status`), and a JSON body that will not
 * parse. A `200` body that is itself a wrapped error — the name-validation
 * endpoints answer `200` with `{valid:false, error:{…}}` (finding 6.6) — is not
 * this layer's to unwrap; `src/content/adapter.ts` reads that shape.
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
  ResponseTooLargeError,
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
  /**
   * A raw request body, sent exactly as given — no decode, no re-encode. Only a
   * non-`GET` link carries one. Mirrors `ComputeRequest.rawBody`: a file's
   * bytes go to `PUT .../content` verbatim (finding 6.1's `updateContent`
   * relation), and byte fidelity is the whole point. Mutually exclusive with
   * {@link ContentRequest.jsonBody}.
   */
  rawBody?: Uint8Array | undefined;
  /**
   * A JSON request body — `JSON.stringify`'d and sent under the link's media
   * type (or `application/json`). The 6c-i structural mutations use it: the
   * folder-create `{name}` payload, the `addMember` `{uri,type,name,contentType}`
   * payload, the rename `{name}` payload (finding 6.5 — a *minimal* body; the
   * full representation echoed back is rejected `400`/`errorCode 1177` on
   * Stable 2026.06, finding 6.7). Mutually exclusive with
   * {@link ContentRequest.rawBody}.
   */
  jsonBody?: unknown;
  /**
   * Sent as `Content-Disposition`. File create needs
   * `filename*=UTF-8''<name>` so the Files service names the new resource
   * (finding 6.4); nothing else sets it.
   */
  contentDisposition?: string | undefined;
  /**
   * The `Content-Type` for {@link ContentRequest.rawBody} (or an override for a
   * {@link ContentRequest.jsonBody}). Finding 6.2: the Files service does not
   * validate it against the registered type, but the file's own media type is
   * echoed back for correctness. Defaults to `application/octet-stream` for a
   * raw body, or the link's media type for a JSON one.
   */
  contentType?: string | undefined;
  /**
   * Sent as `If-Match`, and only when held. Finding 6.2: `PUT .../content` with
   * no precondition is `428`, and with a stale ETag is `412` — so a write path
   * that means to be safe always carries one.
   */
  etag?: string | undefined;
  /**
   * Overrides the transport's 1 MiB default response-body cap
   * (`MAX_BODY_BYTES`) for this one request. {@link ContentAdapter.readFileContent}
   * passes one so a large `.py` still opens; every other Content call is a small
   * JSON read and leaves it at the default.
   */
  maxBodyBytes?: number | undefined;
  /** Cancels the request. Combined with the timeout, not replaced by it. */
  signal?: AbortSignal | undefined;
  /** Overrides {@link ContentClientConfig.timeoutMs} for this one request. */
  timeoutMs?: number | undefined;
}

export interface ContentResponse {
  readonly status: number;
  readonly contentType?: string | undefined;
  /**
   * The `ETag` response header, when present. On a file read or a successful
   * `PUT .../content` this is the file's current entity tag (findings 6.1/6.2)
   * — the value the next conditional write sends back as `If-Match`.
   */
  readonly etag?: string | undefined;
  /** The `Last-Modified` response header, when present — the `mtime` a
   * `vscode.FileStat` reports and the fallback precondition the Files service
   * also accepts (`If-Unmodified-Since`, finding 6.2). */
  readonly lastModified?: string | undefined;
  /** The raw response text, whether or not it parsed. */
  readonly text: string;
  /** The parsed body when the response was JSON, `undefined` otherwise. */
  readonly body: unknown;
  /**
   * The response body as raw bytes, when the transport provided them —
   * {@link ContentAdapter.readFileContent} reads this rather than {@link text},
   * whose UTF-8 decode is lossy for a file that is not text. The same choice
   * `src/compute/files.ts` documents for `rawBody`.
   */
  readonly rawBody?: Uint8Array | undefined;
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
    // presented to the deployment at all. `noSession` marks *this* origin —
    // no token was ever obtained — apart from a 401 the deployment answered
    // with a bare challenge, which `challengeProblem` below also reads as
    // `not-authenticated`: `src/content/contentFileSystem.ts` shows a sign-in
    // prompt for the former and the auth layer's "please report this" for the
    // latter.
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
  // Only what the link declares. Finding 100: asking for a media type the
  // endpoint does not serve — `application/vnd.sas.error+json` among them — is
  // a 406, whereas sending no `Accept` yields the default representation the
  // link intended. Sent on a mutating call too: `POST /folders/folders` and
  // `addMember` return their new representation, and finding 6.6 saw the wrong
  // `Accept` 406 there as well. A link with no media type (the `updateContent`
  // PUT, the raw content GET) still sends no `Accept`.
  const accept = sasMediaType(link.responseType) ?? sasMediaType(link.type);
  if (accept !== undefined) headers.accept = accept;

  // The write arm. A request carries at most one of `rawBody` (a file's bytes,
  // verbatim — finding 6.1's `updateContent`) or `jsonBody` (the 6c-i
  // structural mutations — `JSON.stringify`'d under the link's media type).
  // `If-Match` is set only when the caller passes an `etag`: finding 6.2
  // measured a bare `PUT .../content` as `428`, and
  // `src/content/contentFileSystem.ts` keeps that from happening by refusing the
  // save when it holds no ETag; the folder rename PUT is unconditional
  // (finding 6.5 — `If-Match` optional there, a stale one still `412`).
  let body: string | Uint8Array | undefined;
  if (request.rawBody !== undefined) {
    body = request.rawBody;
    headers["content-type"] = request.contentType ?? "application/octet-stream";
  } else if (request.jsonBody !== undefined) {
    body = JSON.stringify(request.jsonBody);
    headers["content-type"] =
      request.contentType ?? sasMediaType(link.type) ?? "application/json";
  }
  if (request.contentDisposition !== undefined) {
    headers["content-disposition"] = request.contentDisposition;
  }
  if (request.etag !== undefined) headers["if-match"] = request.etag;

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
  let rawBody: Uint8Array | undefined;
  try {
    response = await transport(url, {
      method,
      headers,
      body,
      signal,
      maxBodyBytes: request.maxBodyBytes,
    });
    text = await response.text();
    // Read from the same already-buffered response as `text` — no extra network
    // cost (see `TransportResponse.bytes`) — so a caller that only reads `body`
    // never pays for it. `readFileContent` is the one caller that needs it.
    rawBody = await response.bytes?.();
  } catch (error) {
    // A body over the cap is not an unreachable host — the request got an
    // answer, it was just too big to read (`readFileContent` raises the cap to
    // 10 MiB and the transport enforces it). Kept apart so the user is told the
    // file is too large rather than to check their proxy.
    if (error instanceof ResponseTooLargeError) {
      return {
        ok: false,
        reason: `${method} ${link.href} answered with a body over ${String(error.capBytes)} bytes`,
        problem: { code: "content-too-large", limitBytes: error.capBytes },
      };
    }
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
  const etag = response.headers.etag;
  const lastModified = response.headers["last-modified"];

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
      ...(etag === undefined ? {} : { etag }),
      ...(lastModified === undefined ? {} : { lastModified }),
      text,
      body: parsed,
      ...(rawBody === undefined ? {} : { rawBody }),
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

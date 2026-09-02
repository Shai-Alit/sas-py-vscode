// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The HTTP transport port, and its default implementation over Node's
 * `http`/`https` modules.
 *
 * **This module must never import `vscode`.**
 *
 * ## Why not `fetch`
 *
 * Slice 1b-i defaulted this port to `globalThis.fetch`, and ADR-0008 recorded
 * proxy support as an open question with three unattractive answers: add
 * `undici` as the first runtime dependency, hand-roll a `CONNECT` tunnel, or
 * narrow the supported configuration. There is a fourth answer, and it is better
 * than all three — make the request through `https.request`.
 *
 * Global `fetch` is undici speaking to `net`/`tls` sockets directly. It never
 * touches the `http`/`https` modules, and that layer is the only one an extension
 * shares with the editor around it. Requests made through it inherit whatever the
 * host has arranged there; requests made through `fetch` inherit nothing.
 *
 * The observable consequence is what matters, and it is established
 * independently of the mechanism: upstream `vscode-sas-extension`'s REST client
 * is `axios.create({ baseURL })` and nothing else — no proxy code, no TLS code —
 * yet it works inside enterprises behind proxies and behind internal certificate
 * authorities. `axios` uses `http`/`https`. That is the entire explanation. (The
 * one piece of TLS code upstream does carry, `CAHelper.ts`, lives in activation
 * rather than the client and mutates `https.globalAgent` process-wide; slice
 * 5d-i does the scoped version of that job — see below.)
 *
 * ## The certificate half is the important half
 *
 * A corporate proxy is the case this started from, but it is not the common one.
 * Enterprise Viya deployments routinely present a certificate from an internal
 * CA, and a transport that does not consult the operating system trust store
 * fails such a deployment at sign-in, with a TLS error, before any of the OAuth
 * logic in this directory runs. There is no proxy anywhere in that picture. It
 * would have been reported as "the extension cannot connect to my Viya".
 *
 * ## The `agent` seam
 *
 * The zero-config default ({@link nodeHttpTransport}) sets no `agent` on the
 * request, and that is the point rather than an omission: passing an agent
 * replaces whatever the host arranged, which is the thing being inherited.
 *
 * {@link createNodeHttpTransport} is the seam for the day an explicit CA bundle
 * has to be attached — which `fetch` could not have offered without a
 * dependency. Slice 5d-i (the deferred 1c-ii) uses it: `src/auth/caAgent.ts`
 * builds a dedicated `https.Agent` from `pythonOnViya.userProvidedCertificates`
 * and `src/extension.ts` threads the resulting transport through the auth
 * provider and the compute session manager. The agent is attached only to
 * `https:` requests; a loopback `http:` request ignores it.
 *
 * **Redirects are not followed.** `fetch` follows them; `https.request` does not,
 * and here that is the safer default rather than a gap to fill in. The body of
 * every request this module makes contains a client secret and either an
 * authorization code or a refresh token. Replaying that to a location named by
 * the server, without a human seeing where it went, is a credential disclosure
 * waiting for a misconfigured gateway. A 3xx arrives at the caller as a non-`ok`
 * response carrying its status, which is a diagnosable outcome.
 */

import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { type Agent, request as httpsRequest } from "node:https";

/**
 * How much of a response body to read before giving up on it, absent a
 * per-request override.
 *
 * A token response is a few hundred bytes. This is not sized to be generous, it
 * is sized to bound the damage when the thing on the other end is not a token
 * endpoint at all — a proxy that streams an error page, or a misrouted request
 * that lands on something enormous. Without a cap, that is memory growth with an
 * unhappy user at the end of it rather than an error.
 *
 * {@link TransportRequest.maxBodyBytes} overrides this per request. The one
 * caller that needs to (`src/compute/files.ts`'s rich-output content fetch,
 * slice 3c-i, ADR-0019) raises it to accommodate a real figure, up to
 * ADR-0019's own 10 MiB cap — every other caller (a token response, a compute
 * session or job representation) keeps this default unchanged.
 */
export const MAX_BODY_BYTES = 1_048_576;

/** The subset of a response this project reads. */
export interface TransportResponse {
  /** True for 2xx. Redirects are not followed, so a 3xx is not `ok`. */
  readonly ok: boolean;
  readonly status: number;
  /**
   * Response headers, names lower-cased, repeated values joined with `", "`.
   *
   * Added in 1c-i, and not for completeness. Probe finding 9 in
   * `PROBE-FINDINGS.md` recorded that a Viya deployment answers an expired token
   * with **401 and a zero-byte body** — the entire diagnosis is in
   * `WWW-Authenticate`. A response type carrying only `ok`, `status` and `text()`
   * can tell the difference between "expired, sign in again" and "not permitted"
   * only by guessing, so the most common recoverable failure in the extension
   * would have reached the user as "request failed".
   *
   * Lower-casing is not a nicety either. Node already lower-cases what it parses,
   * but an injected transport is under no such obligation, and HTTP field names
   * are case-insensitive, so a reader that indexes this by a literal would
   * otherwise work in the unit tier and fail against a real server.
   */
  readonly headers: Readonly<Record<string, string>>;
  text(): Promise<string>;
  /**
   * The response body as raw bytes, exactly as received — never decoded.
   *
   * **Optional.** Every caller before slice 3c-i read `text()` alone, and
   * `Buffer.toString("utf8")` — what `text()` is built from — is a fine
   * decode for all of them: a token, a compute session, a job representation
   * are all textual. It is not a fine decode for a matplotlib figure's PNG
   * bytes, which `src/compute/files.ts`'s content fetch needs verbatim:
   * invalid-UTF-8 byte sequences (near-certain in real PNG data — its CRCs
   * and zlib streams are arbitrary bytes) get replaced with U+FFFD on decode,
   * and that replacement cannot be undone by re-encoding the string. This
   * accessor exists so that caller can read the same buffered response
   * {@link text} does, without the lossy round trip.
   *
   * `nodeHttpTransport` provides it from the same buffer `text()` reads, at
   * no extra network cost — the whole body is already read into memory
   * before either accessor is called. A caller that needs bytes and is
   * given a transport whose response has no `bytes` at all (an injected test
   * double built before this existed, say) must treat that as "cannot read
   * this response's content", not silently fall back to `text()` and accept
   * the corruption this accessor exists to avoid.
   */
  bytes?: () => Promise<Uint8Array>;
}

export interface TransportRequest {
  method: string;
  headers: Record<string, string>;
  /**
   * Absent for a request that has no body, which since 1c-i includes every `GET`
   * this project makes.
   *
   * Optional rather than `""`, because the two are not the same request on the
   * wire: an empty string still produces `content-length: 0`, and a `GET`
   * carrying a content-length is the kind of thing a strict gateway rejects and
   * nobody thinks to look at.
   *
   * **`Uint8Array`, since slice 3-pre, is not a convenience overload.** Every
   * request before that one was JSON or `text/plain`, so a `string` this module
   * hands to `.end()` and re-encodes as UTF-8 was always faithful. The
   * submission-fidelity corpus uploads a fileref's content — a user's own
   * Python file, byte for byte (ADR-0014) — and a string forces a decode-then-
   * re-encode round trip through UTF-8 that a well-formed text file happens to
   * survive but that this module has no way to promise. Passing the bytes
   * straight through removes the promise it cannot make rather than relying on
   * it. `src/compute/client.ts`'s `rawBody` is the only caller of this arm.
   */
  body?: string | Uint8Array | undefined;
  /** Cancels the request. The caller supplies the timeout. */
  signal?: AbortSignal;
  /**
   * Overrides {@link MAX_BODY_BYTES} for this one request.
   *
   * `src/compute/files.ts`'s content fetch is the only caller with a reason
   * to raise it (ADR-0019's 10 MiB rich-output cap) — every other request in
   * this codebase reads a token or a Compute JSON representation, all of
   * which are small, and keeps the default by leaving this unset.
   */
  maxBodyBytes?: number | undefined;
}

/**
 * The transport port.
 *
 * Named for what it does rather than for the API that used to implement it: the
 * previous name, `FetchLike`, stopped describing the default the moment the
 * default stopped being `fetch`. It stays a structural type that nothing
 * implements by declaration, so replacing the transport again later is a change
 * at this one seam.
 */
export type HttpTransport = (
  url: string,
  init: TransportRequest,
) => Promise<TransportResponse>;

/**
 * Turns a transport failure into an `Error` carrying a useful, credential-free
 * message.
 *
 * Node puts the interesting part in `code` — `ECONNREFUSED`, `ENOTFOUND`, and
 * above all the `UNABLE_TO_VERIFY_LEAF_SIGNATURE` and
 * `SELF_SIGNED_CERT_IN_CHAIN` family that an internal CA produces. Dropping it
 * would leave the single most likely enterprise failure reported as a bare
 * "socket hang up".
 *
 * A fresh `Error` rather than the original, because the caller puts this message
 * into a problem that reaches the output channel, and an error object's `cause`
 * chain is not guaranteed to be free of the request that produced it. The
 * request body is a client secret.
 */
function transportError(error: unknown): Error {
  if (!(error instanceof Error)) {
    return new Error("unknown transport error");
  }
  const code: unknown = (error as { code?: unknown }).code;
  return new Error(
    typeof code === "string" && code !== ""
      ? `${code}: ${error.message}`
      : error.message,
  );
}

/**
 * Flattens Node's parsed headers into the plain record {@link TransportResponse}
 * promises.
 *
 * Node hands back `string | string[] | undefined` per field, the array form being
 * for the fields HTTP allows to repeat — `set-cookie` above all. Joining with
 * `", "` is what RFC 9110 §5.3 says a repeated field means, so nothing is lost
 * for the fields this project reads, and callers get one type to handle instead
 * of three. `set-cookie` is the documented exception to that equivalence, and
 * nothing here reads cookies.
 *
 * ## Why this goes through a `Map`
 *
 * The field name comes from the server, and the obvious spelling —
 * `headers[name.toLowerCase()] = value` — is an assignment to a property named by
 * a remote party. CodeQL flags it as remote property injection, and although the
 * concrete attack does not land here (the value is always a string, and
 * `obj.__proto__ = "text"` is a silent no-op rather than pollution), "does not
 * land" is a property of today's code that the next reader has to re-derive.
 *
 * A `Map` accepts any key as data, and `Object.fromEntries` *defines* properties
 * rather than assigning them, so a `__proto__` field arrives as an own property
 * instead of reaching `Object.prototype`'s setter and vanishing. That is the
 * behaviour the test asserts, and it is strictly better than the version that
 * silently dropped such a field.
 *
 * Exported only so that property can be asserted directly. Whether Node's own
 * parser hands a `__proto__` field to this function at all has changed between
 * Node versions, so a test that drives it through a loopback server would be
 * asserting the runtime's behaviour rather than ours.
 */
export function collectHeaders(
  raw: IncomingHttpHeaders,
): Readonly<Record<string, string>> {
  const collected = new Map<string, string>();
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    collected.set(
      name.toLowerCase(),
      Array.isArray(value) ? value.join(", ") : value,
    );
  }
  return Object.fromEntries(collected);
}

/** Options for {@link createNodeHttpTransport}. */
export interface NodeHttpTransportOptions {
  /**
   * An {@link https.Agent} to use for `https:` requests, in place of Node's
   * default global agent. `src/auth/caAgent.ts` builds one from the
   * `pythonOnViya.userProvidedCertificates` setting; slice 5d-i (the deferred
   * 1c-ii) is the reason this seam exists.
   *
   * A loopback `http:` request ignores it — an `https.Agent` on an `http`
   * request is a type and behaviour mismatch, and the only `http:` endpoint
   * this project reaches is a dev-time loopback the profile validator permits.
   */
  agent?: Agent | undefined;
}

/**
 * Builds a transport over `node:https` (or `node:http` for a loopback endpoint,
 * which the profile validator permits and nothing else).
 *
 * The whole body is read before the promise settles. Token responses are small,
 * the caller reads the body in every branch it has, and buffering here means a
 * response can never be left half-read on a socket that then leaks.
 *
 * {@link nodeHttpTransport} is `createNodeHttpTransport()` with no options — the
 * zero-config default every caller had before 5d-i, unchanged.
 */
export function createNodeHttpTransport(
  options: NodeHttpTransportOptions = {},
): HttpTransport {
  return (url, init) =>
    new Promise<TransportResponse>((resolve, reject) => {
      let target: URL;
      try {
        target = new URL(url);
      } catch {
        reject(new Error(`not a valid URL: ${url}`));
        return;
      }

      const send = target.protocol === "http:" ? httpRequest : httpsRequest;
      const signal = init.signal;

      if (signal?.aborted === true) {
        reject(new Error("the request was cancelled before it was sent"));
        return;
      }

      const request = send(target, {
        method: init.method,
        ...(options.agent !== undefined && target.protocol === "https:"
          ? { agent: options.agent }
          : {}),
        headers:
          init.body === undefined
            ? init.headers
            : {
                ...init.headers,
                "content-length": String(Buffer.byteLength(init.body)),
              },
      });

      /** Runs exactly once, however the request ends. */
      let done = false;
      const finish = (act: () => void): void => {
        if (done) return;
        done = true;
        if (signal !== undefined) signal.removeEventListener("abort", onAbort);
        act();
      };

      function onAbort(): void {
        finish(() => {
          request.destroy();
          reject(new Error("the request was cancelled"));
        });
      }

      signal?.addEventListener("abort", onAbort, { once: true });

      request.on("error", (error: unknown) => {
        finish(() => {
          reject(transportError(error));
        });
      });

      const cap = init.maxBodyBytes ?? MAX_BODY_BYTES;

      request.on("response", (response) => {
        const status = response.statusCode ?? 0;
        const headers = collectHeaders(response.headers);
        const chunks: Buffer[] = [];
        let length = 0;
        let overflowed = false;

        response.on("data", (chunk: Buffer) => {
          if (overflowed) return;
          length += chunk.length;
          if (length > cap) {
            overflowed = true;
            // Stop reading rather than accumulate a body we have already decided
            // not to trust. `destroy` here ends the response, not the process.
            response.destroy();
            finish(() => {
              reject(
                new Error(`the response body exceeded ${String(cap)} bytes`),
              );
            });
            return;
          }
          chunks.push(chunk);
        });

        response.on("error", (error: unknown) => {
          finish(() => {
            reject(transportError(error));
          });
        });

        response.on("end", () => {
          // Buffered once, read both ways from the same bytes: `text()` decodes
          // it as UTF-8 (fine for every caller before 3c-i — a token, a Compute
          // JSON representation), and `bytes()` hands back a copy of the same
          // buffer undecoded, for the one caller (`src/compute/files.ts`) that
          // cannot afford `text()`'s lossy round trip. See `bytes`'s own doc
          // comment on `TransportResponse`.
          const raw = Buffer.concat(chunks);
          const body = raw.toString("utf8");
          finish(() => {
            resolve({
              ok: status >= 200 && status < 300,
              status,
              headers,
              text: () => Promise.resolve(body),
              bytes: () => Promise.resolve(new Uint8Array(raw)),
            });
          });
        });
      });

      if (init.body === undefined) {
        request.end();
      } else {
        request.end(init.body);
      }
    });
}

/**
 * The zero-config default transport: Node's default agent, and so the operating
 * system trust store the extension host has arranged. Every caller before slice
 * 5d-i used this and still does when `pythonOnViya.userProvidedCertificates` is
 * unset.
 */
export const nodeHttpTransport: HttpTransport = createNodeHttpTransport();

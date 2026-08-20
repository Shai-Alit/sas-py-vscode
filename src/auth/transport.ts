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
 * independently of the mechanism: upstream `vscode-sas-extension` contains no
 * proxy code and no TLS code whatsoever — `axios.create({ baseURL })` and nothing
 * else — yet it works inside enterprises behind proxies and behind internal
 * certificate authorities. `axios` uses `http`/`https`. That is the entire
 * explanation.
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
 * ## What is deliberately not here
 *
 * There is no `agent` option set on the request. That is the point rather than an
 * omission: passing an agent would replace whatever the host arranged, which is
 * the thing being inherited. The parameter stays available for the day an
 * explicit proxy or CA has to be attached — which `fetch` could not have offered
 * without a dependency.
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
import { request as httpsRequest } from "node:https";

/**
 * How much of a response body to read before giving up on it.
 *
 * A token response is a few hundred bytes. This is not sized to be generous, it
 * is sized to bound the damage when the thing on the other end is not a token
 * endpoint at all — a proxy that streams an error page, or a misrouted request
 * that lands on something enormous. Without a cap, that is memory growth with an
 * unhappy user at the end of it rather than an error.
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

/**
 * The default transport, over `node:https` (or `node:http` for a loopback
 * endpoint, which the profile validator permits and nothing else).
 *
 * The whole body is read before the promise settles. Token responses are small,
 * the caller reads the body in every branch it has, and buffering here means a
 * response can never be left half-read on a socket that then leaks.
 */
export const nodeHttpTransport: HttpTransport = (url, init) =>
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

    request.on("response", (response) => {
      const status = response.statusCode ?? 0;
      const headers = collectHeaders(response.headers);
      const chunks: Buffer[] = [];
      let length = 0;
      let overflowed = false;

      response.on("data", (chunk: Buffer) => {
        if (overflowed) return;
        length += chunk.length;
        if (length > MAX_BODY_BYTES) {
          overflowed = true;
          // Stop reading rather than accumulate a body we have already decided
          // not to trust. `destroy` here ends the response, not the process.
          response.destroy();
          finish(() => {
            reject(
              new Error(
                `the response body exceeded ${String(MAX_BODY_BYTES)} bytes`,
              ),
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
        const body = Buffer.concat(chunks).toString("utf8");
        finish(() => {
          resolve({
            ok: status >= 200 && status < 300,
            status,
            headers,
            text: () => Promise.resolve(body),
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

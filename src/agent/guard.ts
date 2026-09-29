// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * What the agent server checks before it reads a request body. ADR-0042.
 *
 * **This module must never import `vscode` or a Node built-in.** The one
 * comparison that needs `node:crypto` — the secret's — is handed in as
 * `authorized` by `./server`, so every rule here runs in the unit tier.
 *
 * The listener binds `127.0.0.1` only, so nothing off the machine reaches it.
 * These checks are for what is on the machine:
 *
 * - **A web page.** A browser can aim a request at `127.0.0.1` — directly, or
 *   through DNS rebinding, where a hostile name starts resolving to loopback
 *   after the page has loaded. The `Host` header still carries that name, so
 *   anything other than `127.0.0.1:<port>` or `localhost:<port>` is refused.
 *   A browser also sends `Origin` on every cross-origin `POST`; Claude Code
 *   sends none (probe (a), "13l built"), so any `Origin` at all is refused —
 *   stricter than the transport's "validate `Origin`", and cheaper than
 *   keeping an allow-list nobody needs.
 * - **Another local process or user.** It can reach the port but cannot read
 *   the per-start secret, which lives in memory and in a file under this
 *   user's profile (`./headersFile`). Every request must carry it.
 *
 * The order is deliberate: the two browser checks first, then the secret, and
 * only then anything that tells a caller about the endpoint itself — so a
 * caller without the secret learns nothing but `401`.
 */

import { isSupportedProtocolVersion } from "./protocol";

/** The one path the server answers on. */
export const MCP_PATH = "/mcp";

/** A request's headers as Node presents them, lower-cased. Structural, so a
 * test does not need `node:http` and neither does this module. */
export type RequestHeaders = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

export interface RequestHead {
  readonly method: string | undefined;
  readonly url: string | undefined;
  readonly headers: RequestHeaders;
}

export interface Rejection {
  readonly status: 400 | 401 | 403 | 404 | 405 | 415;
  /** Plain text, safe to send and to log: it never quotes the request. */
  readonly message: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface GuardContext {
  /** The port the server is actually bound to. */
  readonly port: number;
  /** Whether a bearer token is this server's secret. */
  readonly authorized: (token: string) => boolean;
}

/** `undefined` when the request may proceed to its body. */
export function checkRequest(
  head: RequestHead,
  context: GuardContext,
): Rejection | undefined {
  if (!hostAllowed(single(head.headers.host), context.port)) {
    return { status: 403, message: "Host not allowed" };
  }
  if (head.headers.origin !== undefined) {
    return { status: 403, message: "Origin not allowed" };
  }

  const token = bearerToken(single(head.headers.authorization));
  if (token === undefined || !context.authorized(token)) {
    return {
      status: 401,
      message: "Unauthorized",
      headers: { "WWW-Authenticate": 'Bearer realm="python-on-viya"' },
    };
  }

  if (pathOf(head.url) !== MCP_PATH) {
    return { status: 404, message: "Not found" };
  }
  // GET (a server-to-client stream) and DELETE (ending a session) are both
  // optional in the legacy transport, and `405` is how a server declines
  // them. This one has no stream to offer and no session to end.
  if (head.method !== "POST") {
    return {
      status: 405,
      message: "Method not allowed",
      headers: { Allow: "POST" },
    };
  }
  if (!isJson(single(head.headers["content-type"]))) {
    return { status: 415, message: "Content-Type must be application/json" };
  }

  // Sent after `initialize` has agreed a version, and absent on `initialize`
  // itself. The transport requires `400` for one this server does not speak.
  const protocolVersion = single(head.headers["mcp-protocol-version"]);
  if (
    protocolVersion !== undefined &&
    !isSupportedProtocolVersion(protocolVersion)
  ) {
    return { status: 400, message: "Unsupported MCP-Protocol-Version" };
  }
  return undefined;
}

/** The token from an `Authorization: Bearer …` header, or `undefined` when
 * the header is absent or another scheme. The scheme is case-insensitive
 * (RFC 9110 §11.1); the token is not. */
export function bearerToken(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const match = /^Bearer +(\S+) *$/i.exec(header);
  return match?.[1];
}

function hostAllowed(host: string | undefined, port: number): boolean {
  if (host === undefined) return false;
  const lower = host.toLowerCase();
  return (
    lower === `127.0.0.1:${String(port)}` ||
    lower === `localhost:${String(port)}`
  );
}

function pathOf(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  const query = url.indexOf("?");
  return query === -1 ? url : url.slice(0, query);
}

function isJson(contentType: string | undefined): boolean {
  if (contentType === undefined) return false;
  const parameters = contentType.indexOf(";");
  const mediaType =
    parameters === -1 ? contentType : contentType.slice(0, parameters);
  return mediaType.trim().toLowerCase() === "application/json";
}

/** A header Node gives as an array (a repeated one) is refused as absent,
 * never resolved by picking one of the copies. */
function single(
  value: string | readonly string[] | undefined,
): string | undefined {
  return typeof value === "string" ? value : undefined;
}

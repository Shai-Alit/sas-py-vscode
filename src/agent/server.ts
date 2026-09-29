// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The agent server's listener: `node:http` on `127.0.0.1`, one path, one
 * secret. ADR-0042.
 *
 * Everything this file decides is delegated — what a request must carry to
 * `./guard`, what a message means to `./protocol` — so what is left here is
 * the part only a real socket can show: binding, falling back when the port
 * is taken, reading a bounded body, and closing. Its tests start it on a
 * real loopback port, as `auth-transport.test.ts` does for the HTTP client.
 *
 * **Loopback only.** The host is a literal `127.0.0.1`. Not `localhost`,
 * which can resolve to `::1`; not `0.0.0.0` or `::`, which would reach the
 * network. `exclusive` stops a cluster worker sharing the handle.
 *
 * Node-only, and on `eslint.config.mjs`'s built-in allow-list (ADR-0003's
 * 2026-09-28 amendment). The web extension host has no sockets to listen on,
 * so a web build omits the agent server rather than reimplementing it.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import { checkRequest, type Rejection } from "./guard";
import { handleMcpMessage, type McpServerInfo } from "./protocol";

export const LOOPBACK_HOST = "127.0.0.1";

/** The largest body read. A legacy-era MCP request is one JSON-RPC message;
 * nothing this server answers comes near this. */
export const MAX_BODY_BYTES = 1024 * 1024;

/** Bounds on a slow client, so a connection that trickles its headers or
 * body cannot hold a socket open indefinitely. Well above anything a local
 * client needs. Node enforces both only when it checks its connections, every
 * 30 seconds by default, so it checks every second here; each bound then
 * holds to within a second. */
const HEADERS_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 30_000;
const CONNECTIONS_CHECKING_INTERVAL_MS = 1_000;

/** The ports a stored preference may name. Below 1024 needs privilege on
 * POSIX, so a value there was never one this server chose. */
const MIN_PORT = 1024;
const MAX_PORT = 65_535;

/** 32 random bytes, base64url. New for every server start and never derived
 * from anything else — in particular, not from the Viya token. */
export function createSecret(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Compares a presented token with the secret in constant time. Both are
 * hashed first so the comparison never depends on — or reveals — the
 * presented token's length, which `timingSafeEqual` would otherwise need to
 * match.
 */
export function secretMatches(secret: string, presented: string): boolean {
  return timingSafeEqual(sha256(secret), sha256(presented));
}

/** The stored port to try first, or `0` (any free port) when nothing valid is
 * stored. Read as `unknown` because `workspaceState` holds whatever an
 * earlier version wrote. */
export function preferredPort(stored: unknown): number {
  return typeof stored === "number" &&
    Number.isInteger(stored) &&
    stored >= MIN_PORT &&
    stored <= MAX_PORT
    ? stored
    : 0;
}

export interface AgentServerOptions {
  /** The port to try first; `0` lets the OS choose. */
  readonly port: number;
  readonly secret: string;
  readonly info: McpServerInfo;
  /** A request refused before its body was read. Never given the request's
   * headers, so a caller that logs it cannot log a token. */
  readonly onRejected?: ((rejection: Rejection) => void) | undefined;
  /** A request that failed after it was accepted — the client disconnected
   * mid-body, or the request timeout ended it. Nobody is left to answer.
   * Also any error the listening server emits, which would otherwise be
   * thrown. */
  readonly onError?: ((error: unknown) => void) | undefined;
}

export interface AgentServer {
  /** The port actually bound — the preferred one, or a new one when it was
   * taken. */
  readonly port: number;
  /** Stops listening and drops every open connection. Safe to call twice. */
  close(): Promise<void>;
}

/**
 * Starts listening. When the preferred port cannot be bound — taken
 * (`EADDRINUSE`), or inside a range Windows reserves (`EACCES`) — it binds
 * any free port instead; the caller compares `port` with what it asked for.
 * Any other failure rejects.
 */
export async function startAgentServer(
  options: AgentServerOptions,
): Promise<AgentServer> {
  let boundPort = 0;
  const server = createServer(
    {
      headersTimeout: HEADERS_TIMEOUT_MS,
      requestTimeout: REQUEST_TIMEOUT_MS,
      connectionsCheckingInterval: CONNECTIONS_CHECKING_INTERVAL_MS,
    },
    (request, response) => {
      handle(request, response, boundPort, options);
    },
  );

  try {
    boundPort = await listen(server, options.port);
  } catch (error) {
    if (options.port === 0 || !isRebindable(error)) throw error;
    boundPort = await listen(server, 0);
  }

  // `listen`'s own listener is gone once it has bound. Without this one, an
  // error the server emits later (a failed accept) would be thrown.
  // Nothing a loopback test can do makes a listening server emit one.
  /* c8 ignore start */
  server.on("error", (error) => {
    options.onError?.(error);
  });
  /* c8 ignore stop */

  return {
    port: boundPort,
    close: () => close(server),
  };
}

/**
 * Every reply waits until the request body has ended. A reply sent while the
 * client is still sending makes Node close the connection with the body
 * unread, and the client then meets a reset instead of the reply — on
 * Windows the reset discards the status it had not read yet (seen in
 * `agent-server.test.ts`). That matters most for `401`: it is what tells
 * Claude Code to run its `headersHelper` again after a reload. A body that is
 * refused, or that grows past the limit, is read and discarded rather than
 * kept, so memory stays bounded; `REQUEST_TIMEOUT_MS` bounds the time.
 */
function handle(
  request: IncomingMessage,
  response: ServerResponse,
  port: number,
  options: AgentServerOptions,
): void {
  const rejection = checkRequest(
    { method: request.method, url: request.url, headers: request.headers },
    {
      port,
      authorized: (token) => secretMatches(options.secret, token),
    },
  );
  if (rejection !== undefined) options.onRejected?.(rejection);

  const chunks: Buffer[] = [];
  let received = 0;
  let tooLarge = false;
  request.on("data", (chunk: Buffer) => {
    if (rejection !== undefined || tooLarge) return;
    received += chunk.length;
    if (received > MAX_BODY_BYTES) {
      tooLarge = true;
      chunks.length = 0;
      return;
    }
    chunks.push(chunk);
  });
  request.on("end", () => {
    if (rejection !== undefined) {
      sendText(
        response,
        rejection.status,
        rejection.message,
        rejection.headers,
      );
      return;
    }
    if (tooLarge) {
      sendText(response, 413, "Request body too large");
      return;
    }
    // `handleMcpMessage` never throws: every input, however malformed, has a
    // reply.
    const reply = handleMcpMessage(
      Buffer.concat(chunks).toString("utf8"),
      options.info,
    );
    if (reply.status === 202) {
      response.writeHead(202, commonHeaders()).end();
      return;
    }
    response
      .writeHead(reply.status, {
        ...commonHeaders(),
        "Content-Type": "application/json",
      })
      .end(JSON.stringify(reply.body));
  });
  // The client went away mid-body (or the request timeout destroyed the
  // socket). There is nobody left to answer.
  request.on("error", (error) => {
    options.onError?.(error);
  });
}

function sendText(
  response: ServerResponse,
  status: number,
  message: string,
  headers: Readonly<Record<string, string>> = {},
): void {
  response
    .writeHead(status, {
      ...commonHeaders(),
      ...headers,
      "Content-Type": "text/plain; charset=utf-8",
    })
    .end(message);
}

function commonHeaders(): Record<string, string> {
  return { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      const address = server.address();
      // Always an object for a TCP listener — a string only for a pipe, which
      // `listen` above never opens — so the fallback cannot be reached.
      /* c8 ignore start */
      resolve(
        typeof address === "object" && address !== null ? address.port : port,
      );
      /* c8 ignore stop */
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ host: LOOPBACK_HOST, port, exclusive: true });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    // The callback's only error is "not running", which is what a second
    // close finds — the state the caller asked for.
    server.close(() => {
      resolve();
    });
    server.closeAllConnections();
  });
}

function isRebindable(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "EADDRINUSE" || error.code === "EACCES")
  );
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

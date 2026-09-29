// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The MCP messages the agent server answers — one JSON-RPC message in, one
 * reply out. ADR-0042.
 *
 * **This module must never import `vscode` or a Node built-in.** It is the
 * part of the agent server the unit tier can reach, and the part whose
 * mistakes a client would see.
 *
 * **Legacy era only, and hand-written.** MCP's 2026-07-28 revision is
 * stateless and drops `initialize`; the revisions before it ("legacy",
 * 2025-11-25 and earlier) open with one. Claude Code 2.1.245 speaks only the
 * legacy era: it sent a bare `initialize` with `protocolVersion`
 * `"2025-11-25"`, no modern attempt and no `MCP-Protocol-Version` header
 * (probe (a) in `docs/phases/phase-12.md`'s "12o built" entry). A modern
 * client that meets a legacy server falls back to `initialize` when its first
 * `POST` draws a 4xx without a modern error body, so answering the legacy era
 * alone serves both. Revisit before legacy support ends (July 2027). The
 * official TypeScript SDK would bring an HTTP framework and a schema library
 * into an extension that has no runtime dependencies (ADR-0005) for the five
 * methods below — the same trade ADR-0010 made for the compute client.
 *
 * **Stateless.** No `Mcp-Session-Id` is issued, which the legacy transport
 * allows. Every reply is a plain `application/json` body, never an SSE
 * stream, and nothing here remembers whether `initialize` came first — so a
 * window reload, which restarts the server, leaves no session for a client to
 * lose.
 *
 * **No tools yet.** `tools/list` answers `[]` and `tools/call` refuses every
 * name. The read-only library and CAS tools are Phase 12's 12p.
 */

/** The newest version this server speaks, and the one it offers a client
 * that asks for a version it does not know. */
export const MCP_LATEST_PROTOCOL_VERSION = "2025-11-25";

/** The versions `initialize` agrees to. 2025-06-18 is kept because nothing
 * this server does differs between the two, and an older client that asks
 * for it should not be pushed to a version it may not know. */
export const MCP_PROTOCOL_VERSIONS: readonly string[] = [
  MCP_LATEST_PROTOCOL_VERSION,
  "2025-06-18",
];

/** JSON-RPC 2.0's own codes; MCP reuses them. */
export const JSON_RPC_PARSE_ERROR = -32700;
export const JSON_RPC_INVALID_REQUEST = -32600;
export const JSON_RPC_METHOD_NOT_FOUND = -32601;
export const JSON_RPC_INVALID_PARAMS = -32602;

/** What `initialize` names this server as. */
export interface McpServerInfo {
  readonly name: string;
  readonly version: string;
}

type JsonRpcId = string | number;

export interface JsonRpcSuccess {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly result: Readonly<Record<string, unknown>>;
}

export interface JsonRpcFailure {
  readonly jsonrpc: "2.0";
  /** `null` only when the request's own id could not be read. */
  readonly id: JsonRpcId | null;
  readonly error: { readonly code: number; readonly message: string };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

/**
 * The HTTP shape of a reply. `202` carries no body: the transport says a
 * notification, or a response from the client, is acknowledged that way. A
 * JSON-RPC error answering a well-formed request is still `200` — only a body
 * that is not a JSON-RPC message at all is `400`.
 */
export type McpReply =
  | { readonly status: 200; readonly body: JsonRpcResponse }
  | { readonly status: 202 }
  | { readonly status: 400; readonly body: JsonRpcFailure };

/** Whether `version` is one this server will talk. Used for the
 * `MCP-Protocol-Version` header as well as for `initialize`. */
export function isSupportedProtocolVersion(version: string): boolean {
  return MCP_PROTOCOL_VERSIONS.includes(version);
}

/**
 * The version `initialize` answers with: the client's own when this server
 * supports it, otherwise the newest this server has. The client then decides
 * whether it can live with that; the spec leaves the disconnect to it.
 */
export function negotiateProtocolVersion(requested: string): string {
  return isSupportedProtocolVersion(requested)
    ? requested
    : MCP_LATEST_PROTOCOL_VERSION;
}

/** Answers one HTTP request body. Never throws. */
export function handleMcpMessage(text: string, info: McpServerInfo): McpReply {
  let message: unknown;
  try {
    message = JSON.parse(text);
  } catch {
    // The failure's own detail is not useful to a client, and naming the
    // offset would echo part of the body back.
    return {
      status: 400,
      body: failure(null, JSON_RPC_PARSE_ERROR, "Parse error"),
    };
  }

  // An array lands here too: JSON-RPC batching left MCP in 2025-06-18, and
  // this server offers no version older than that.
  if (!isRecord(message) || message.jsonrpc !== "2.0") {
    return invalidRequest();
  }

  const method = message.method;
  const hasId = "id" in message;
  if (typeof method !== "string") {
    // A response to a request from the server. This server sends none, but
    // the transport says to acknowledge one rather than refuse it.
    return hasId && ("result" in message || "error" in message)
      ? { status: 202 }
      : invalidRequest();
  }
  if (!hasId) return { status: 202 };

  const id = message.id;
  if (typeof id !== "string" && typeof id !== "number") {
    // MCP forbids a `null` id outright, unlike plain JSON-RPC.
    return invalidRequest();
  }

  return { status: 200, body: answer(id, method, message.params, info) };
}

function answer(
  id: JsonRpcId,
  method: string,
  params: unknown,
  info: McpServerInfo,
): JsonRpcResponse {
  switch (method) {
    case "initialize": {
      const requested = isRecord(params) ? params.protocolVersion : undefined;
      if (typeof requested !== "string") {
        return failure(
          id,
          JSON_RPC_INVALID_PARAMS,
          "initialize needs a protocolVersion",
        );
      }
      return success(id, {
        protocolVersion: negotiateProtocolVersion(requested),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: info.name, version: info.version },
      });
    }
    case "ping":
      return success(id, {});
    case "tools/list":
      return success(id, { tools: [] });
    case "tools/call":
      // MCP's own code for a tool name the server does not have. The name is
      // not echoed: it is the client's input, and the client already has it.
      return failure(id, JSON_RPC_INVALID_PARAMS, "Unknown tool");
    default:
      return failure(id, JSON_RPC_METHOD_NOT_FOUND, "Method not found");
  }
}

function invalidRequest(): McpReply {
  return {
    status: 400,
    body: failure(null, JSON_RPC_INVALID_REQUEST, "Invalid Request"),
  };
}

function success(
  id: JsonRpcId,
  result: Readonly<Record<string, unknown>>,
): JsonRpcSuccess {
  return { jsonrpc: "2.0", id, result };
}

function failure(
  id: JsonRpcId | null,
  code: number,
  message: string,
): JsonRpcFailure {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  handleMcpMessage,
  isSupportedProtocolVersion,
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_METHOD_NOT_FOUND,
  JSON_RPC_PARSE_ERROR,
  MCP_LATEST_PROTOCOL_VERSION,
  negotiateProtocolVersion,
  type McpReply,
} from "../../src/agent/protocol";

/**
 * The agent server's JSON-RPC layer (ADR-0042). Each case is one request body
 * and the reply a legacy-era MCP client would get for it. The `initialize`
 * shape is what Claude Code 2.1.245 sent in probe (a), "12o built".
 */

const INFO = { name: "python-on-viya", version: "9.9.9" };

function reply(body: unknown): McpReply {
  return handleMcpMessage(
    typeof body === "string" ? body : JSON.stringify(body),
    INFO,
  );
}

function request(method: string, params?: unknown, id: unknown = 1): unknown {
  return params === undefined
    ? { jsonrpc: "2.0", id, method }
    : { jsonrpc: "2.0", id, method, params };
}

describe("agent protocol", () => {
  describe("initialize", () => {
    it("agrees the client's version when it is supported, and names the server", () => {
      assert.deepEqual(
        reply(
          request(
            "initialize",
            {
              protocolVersion: "2025-11-25",
              capabilities: { roots: {} },
              clientInfo: { name: "claude-code", version: "2.1.245" },
            },
            0,
          ),
        ),
        {
          status: 200,
          body: {
            jsonrpc: "2.0",
            id: 0,
            result: {
              protocolVersion: "2025-11-25",
              capabilities: { tools: { listChanged: false } },
              serverInfo: INFO,
            },
          },
        },
      );
    });

    it("keeps the older supported version rather than pushing the client forward", () => {
      const answer = reply(
        request("initialize", { protocolVersion: "2025-06-18" }),
      );
      assert.equal(answer.status, 200);
      assert.ok("body" in answer && "result" in answer.body);
      assert.equal(answer.body.result.protocolVersion, "2025-06-18");
    });

    it("offers its newest version for one it does not know", () => {
      const answer = reply(
        request("initialize", { protocolVersion: "2024-11-05" }),
      );
      assert.ok("body" in answer && "result" in answer.body);
      assert.equal(
        answer.body.result.protocolVersion,
        MCP_LATEST_PROTOCOL_VERSION,
      );
    });

    for (const [label, params] of [
      ["no params", undefined],
      ["params that are not an object", "2025-11-25"],
      ["a numeric protocolVersion", { protocolVersion: 20251125 }],
    ] as const) {
      it(`refuses ${label} with invalid params, still as 200`, () => {
        assert.deepEqual(reply(request("initialize", params, "a")), {
          status: 200,
          body: {
            jsonrpc: "2.0",
            id: "a",
            error: {
              code: JSON_RPC_INVALID_PARAMS,
              message: "initialize needs a protocolVersion",
            },
          },
        });
      });
    }
  });

  it("answers ping with an empty result", () => {
    assert.deepEqual(reply(request("ping", undefined, 7)), {
      status: 200,
      body: { jsonrpc: "2.0", id: 7, result: {} },
    });
  });

  it("lists no tools", () => {
    assert.deepEqual(reply(request("tools/list", {})), {
      status: 200,
      body: { jsonrpc: "2.0", id: 1, result: { tools: [] } },
    });
  });

  it("refuses every tool call without echoing the name", () => {
    const answer = reply(
      request("tools/call", { name: "<script>", arguments: {} }),
    );
    assert.deepEqual(answer, {
      status: 200,
      body: {
        jsonrpc: "2.0",
        id: 1,
        error: { code: JSON_RPC_INVALID_PARAMS, message: "Unknown tool" },
      },
    });
    assert.ok(!JSON.stringify(answer).includes("<script>"));
  });

  it("answers an unknown method with method-not-found", () => {
    assert.deepEqual(reply(request("resources/list")), {
      status: 200,
      body: {
        jsonrpc: "2.0",
        id: 1,
        error: { code: JSON_RPC_METHOD_NOT_FOUND, message: "Method not found" },
      },
    });
  });

  it("acknowledges a notification with 202 and no body", () => {
    assert.deepEqual(
      reply({ jsonrpc: "2.0", method: "notifications/initialized" }),
      { status: 202 },
    );
  });

  it("acknowledges a client's response with 202", () => {
    assert.deepEqual(reply({ jsonrpc: "2.0", id: 3, result: {} }), {
      status: 202,
    });
    assert.deepEqual(
      reply({ jsonrpc: "2.0", id: 3, error: { code: 1, message: "x" } }),
      { status: 202 },
    );
  });

  it("answers a body that is not JSON with a parse error and a null id, without echoing it", () => {
    const answer = reply("{ secret-looking text");
    assert.deepEqual(answer, {
      status: 400,
      body: {
        jsonrpc: "2.0",
        id: null,
        error: { code: JSON_RPC_PARSE_ERROR, message: "Parse error" },
      },
    });
    assert.ok(!JSON.stringify(answer).includes("secret"));
  });

  const INVALID: readonly (readonly [string, unknown])[] = [
    ["a batch", [request("ping")]],
    ["a bare string", "hello"],
    ["null", null],
    ["a message without jsonrpc", { id: 1, method: "ping" }],
    ["jsonrpc 1.0", { jsonrpc: "1.0", id: 1, method: "ping" }],
    ["a non-string method", { jsonrpc: "2.0", id: 1, method: 5 }],
    ["an id with neither result nor error", { jsonrpc: "2.0", id: 1 }],
    ["neither a method nor an id", { jsonrpc: "2.0", result: {} }],
    ["a null id", { jsonrpc: "2.0", id: null, method: "ping" }],
    ["an object id", { jsonrpc: "2.0", id: {}, method: "ping" }],
  ];
  for (const [label, body] of INVALID) {
    it(`refuses ${label} as an invalid request`, () => {
      assert.deepEqual(reply(JSON.stringify(body)), {
        status: 400,
        body: {
          jsonrpc: "2.0",
          id: null,
          error: { code: JSON_RPC_INVALID_REQUEST, message: "Invalid Request" },
        },
      });
    });
  }

  it("supports exactly the two legacy-era versions", () => {
    assert.ok(isSupportedProtocolVersion("2025-11-25"));
    assert.ok(isSupportedProtocolVersion("2025-06-18"));
    assert.ok(!isSupportedProtocolVersion("2025-03-26"));
    assert.ok(!isSupportedProtocolVersion("2026-07-28"));
    assert.equal(negotiateProtocolVersion("2025-06-18"), "2025-06-18");
    assert.equal(negotiateProtocolVersion(""), MCP_LATEST_PROTOCOL_VERSION);
  });
});

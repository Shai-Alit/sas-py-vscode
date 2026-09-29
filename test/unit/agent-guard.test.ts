// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  bearerToken,
  checkRequest,
  type RequestHead,
  type RequestHeaders,
} from "../../src/agent/guard";

/**
 * What the agent server refuses before it reads a body (ADR-0042). The order
 * of the checks is part of the contract: a caller without the secret must
 * learn nothing but `401`, so the path, method and content type are only
 * judged once the token has passed.
 */

const PORT = 45_123;
const SECRET = "s3cret";

function head(
  overrides: Partial<
    Record<string, string | readonly string[] | undefined>
  > = {},
  method = "POST",
  url = "/mcp",
): RequestHead {
  const headers: RequestHeaders = {
    host: `127.0.0.1:${String(PORT)}`,
    authorization: `Bearer ${SECRET}`,
    "content-type": "application/json",
    ...overrides,
  };
  return { method, url, headers };
}

const context = {
  port: PORT,
  authorized: (token: string) => token === SECRET,
};

function status(request: RequestHead): number | undefined {
  return checkRequest(request, context)?.status;
}

describe("agent guard", () => {
  it("lets a well-formed request through", () => {
    assert.equal(checkRequest(head(), context), undefined);
  });

  describe("Host", () => {
    for (const host of [
      `127.0.0.1:${String(PORT)}`,
      `localhost:${String(PORT)}`,
      `LOCALHOST:${String(PORT)}`,
    ]) {
      it(`accepts ${host}`, () => {
        assert.equal(status(head({ host })), undefined);
      });
    }

    for (const [label, host] of [
      ["a rebinding name", `attacker.example:${String(PORT)}`],
      ["another port", "127.0.0.1:1"],
      ["no port", "127.0.0.1"],
      ["IPv6 loopback", `[::1]:${String(PORT)}`],
      ["no Host at all", undefined],
      ["a repeated Host", [`127.0.0.1:${String(PORT)}`, "evil"]],
    ] as const) {
      it(`refuses ${label} with 403 before looking at the token`, () => {
        const rejection = checkRequest(
          head({ host, authorization: undefined }),
          context,
        );
        assert.deepEqual(rejection, {
          status: 403,
          message: "Host not allowed",
        });
      });
    }
  });

  it("refuses any Origin with 403, even a loopback one, before the token", () => {
    for (const origin of [
      "https://attacker.example",
      "http://127.0.0.1",
      "null",
    ]) {
      assert.deepEqual(
        checkRequest(head({ origin, authorization: undefined }), context),
        { status: 403, message: "Origin not allowed" },
      );
    }
  });

  describe("the secret", () => {
    const UNAUTHORIZED = {
      status: 401,
      message: "Unauthorized",
      headers: { "WWW-Authenticate": 'Bearer realm="python-on-viya"' },
    };

    for (const [label, authorization] of [
      ["no Authorization", undefined],
      ["the wrong token", "Bearer nope"],
      ["another scheme", `Basic ${SECRET}`],
      ["a repeated header", [`Bearer ${SECRET}`, `Bearer ${SECRET}`]],
    ] as const) {
      it(`refuses ${label} with 401 and a challenge`, () => {
        assert.deepEqual(
          checkRequest(head({ authorization }), context),
          UNAUTHORIZED,
        );
      });
    }

    it("answers 401, not 404 or 405, to a caller without it on any path or method", () => {
      assert.equal(
        status(head({ authorization: undefined }, "GET", "/other")),
        401,
      );
    });
  });

  it("refuses another path with 404, ignoring a query string on /mcp", () => {
    assert.deepEqual(checkRequest(head({}, "POST", "/"), context), {
      status: 404,
      message: "Not found",
    });
    assert.equal(status(head({}, "POST", "/mcp/")), 404);
    assert.equal(status(head({}, "POST", "/mcp?x=1")), undefined);
    assert.equal(
      checkRequest({ ...head(), url: undefined }, context)?.status,
      404,
    );
  });

  it("refuses GET and DELETE with 405 and Allow: POST", () => {
    for (const method of ["GET", "DELETE", "PUT"]) {
      assert.deepEqual(checkRequest(head({}, method), context), {
        status: 405,
        message: "Method not allowed",
        headers: { Allow: "POST" },
      });
    }
  });

  describe("Content-Type", () => {
    for (const contentType of [
      "application/json",
      "application/json; charset=utf-8",
      "Application/JSON ;charset=UTF-8",
    ]) {
      it(`accepts ${contentType}`, () => {
        assert.equal(status(head({ "content-type": contentType })), undefined);
      });
    }

    for (const contentType of [
      "text/plain",
      "application/x-www-form-urlencoded",
      "application/jsonp",
      undefined,
    ]) {
      it(`refuses ${String(contentType)} with 415`, () => {
        assert.deepEqual(
          checkRequest(head({ "content-type": contentType }), context),
          { status: 415, message: "Content-Type must be application/json" },
        );
      });
    }
  });

  it("refuses an unsupported MCP-Protocol-Version with 400, and accepts a supported or absent one", () => {
    assert.deepEqual(
      checkRequest(head({ "mcp-protocol-version": "2024-11-05" }), context),
      { status: 400, message: "Unsupported MCP-Protocol-Version" },
    );
    assert.equal(
      status(head({ "mcp-protocol-version": "2025-06-18" })),
      undefined,
    );
    assert.equal(
      status(head({ "mcp-protocol-version": "2025-11-25" })),
      undefined,
    );
  });

  it("never quotes the request in a rejection", () => {
    const rejection = checkRequest(
      head({ authorization: "Bearer leaked-value" }),
      context,
    );
    assert.ok(!JSON.stringify(rejection).includes("leaked-value"));
  });

  describe("bearerToken", () => {
    it("reads the token, with a case-insensitive scheme", () => {
      assert.equal(bearerToken("Bearer abc"), "abc");
      assert.equal(bearerToken("bearer abc"), "abc");
      assert.equal(bearerToken("Bearer   abc  "), "abc");
    });

    it("reads nothing from a missing, empty or malformed header", () => {
      assert.equal(bearerToken(undefined), undefined);
      assert.equal(bearerToken("Bearer"), undefined);
      assert.equal(bearerToken("Bearer "), undefined);
      assert.equal(bearerToken("Bearer a b"), undefined);
      assert.equal(bearerToken("Bearerabc"), undefined);
    });
  });
});

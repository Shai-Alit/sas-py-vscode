// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { request as httpRequest, type OutgoingHttpHeaders } from "node:http";
import { createServer, type Server } from "node:net";

import type { Rejection } from "../../src/agent/guard";
import {
  createSecret,
  isRebindable,
  LOOPBACK_HOST,
  MAX_BODY_BYTES,
  preferredPort,
  secretMatches,
  startAgentServer,
  type AgentServer,
} from "../../src/agent/server";

/**
 * The agent server's listener, on a real loopback port (ADR-0042). As in
 * `auth-transport.test.ts`, a mock would stand in for exactly the code under
 * test — binding, falling back, bounding a body, closing — so nothing here is
 * mocked. The rules themselves are `agent-guard.test.ts`'s and
 * `agent-protocol.test.ts`'s; these cases check they are wired to the socket.
 */

const SECRET = createSecret();
const INFO = { name: "python-on-viya", version: "1.2.3" };

interface Answer {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function send(
  port: number,
  options: {
    method?: string;
    path?: string;
    headers?: OutgoingHttpHeaders;
    body?: string | Buffer;
  } = {},
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: LOOPBACK_HOST,
        port,
        method: options.method ?? "POST",
        path: options.path ?? "/mcp",
        headers: {
          host: `127.0.0.1:${String(port)}`,
          authorization: `Bearer ${SECRET}`,
          "content-type": "application/json",
          ...options.headers,
        },
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
}

const INITIALIZE = JSON.stringify({
  jsonrpc: "2.0",
  id: 0,
  method: "initialize",
  params: { protocolVersion: "2025-11-25", capabilities: {} },
});

describe("agent server", () => {
  let server: AgentServer | undefined;
  const rejected: Rejection[] = [];
  const errors: unknown[] = [];

  async function start(port = 0): Promise<AgentServer> {
    server = await startAgentServer({
      port,
      secret: SECRET,
      info: INFO,
      onRejected: (rejection) => rejected.push(rejection),
      onError: (error) => errors.push(error),
    });
    return server;
  }

  afterEach(async () => {
    await server?.close();
    server = undefined;
    rejected.length = 0;
    errors.length = 0;
  });

  it("answers initialize with JSON and the hardening headers", async () => {
    const { port } = await start();
    assert.ok(port > 0);
    const answer = await send(port, { body: INITIALIZE });
    assert.equal(answer.status, 200);
    assert.equal(answer.headers["content-type"], "application/json");
    assert.equal(answer.headers["cache-control"], "no-store");
    assert.equal(answer.headers["x-content-type-options"], "nosniff");
    assert.equal(answer.headers["mcp-session-id"], undefined);
    assert.deepEqual(JSON.parse(answer.body), {
      jsonrpc: "2.0",
      id: 0,
      result: {
        protocolVersion: "2025-11-25",
        capabilities: { tools: { listChanged: false } },
        serverInfo: INFO,
      },
    });
  });

  it("acknowledges a notification with an empty 202", async () => {
    const { port } = await start();
    const answer = await send(port, {
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });
    assert.equal(answer.status, 202);
    assert.equal(answer.body, "");
    assert.equal(answer.headers["cache-control"], "no-store");
  });

  it("answers a body that is not JSON with 400", async () => {
    const { port } = await start();
    const answer = await send(port, { body: "{" });
    assert.equal(answer.status, 400);
    assert.equal(
      (JSON.parse(answer.body) as { error: { code: number } }).error.code,
      -32700,
    );
  });

  it("refuses a request without the secret with 401, a challenge, and a report that carries no header", async () => {
    const { port } = await start();
    const answer = await send(port, {
      headers: { authorization: "Bearer wrong-token-value" },
      body: INITIALIZE,
    });
    assert.equal(answer.status, 401);
    assert.equal(
      answer.headers["www-authenticate"],
      'Bearer realm="python-on-viya"',
    );
    assert.equal(answer.headers["content-type"], "text/plain; charset=utf-8");
    assert.equal(answer.body, "Unauthorized");
    assert.equal(rejected.length, 1);
    assert.ok(!JSON.stringify(rejected).includes("wrong-token-value"));
  });

  it("refuses a browser's request by Host and by Origin with 403", async () => {
    const { port } = await start();
    const rebound = await send(port, {
      headers: { host: `attacker.example:${String(port)}` },
      body: INITIALIZE,
    });
    assert.equal(rebound.status, 403);
    const crossOrigin = await send(port, {
      headers: { origin: "https://attacker.example" },
      body: INITIALIZE,
    });
    assert.equal(crossOrigin.status, 403);
  });

  it("refuses GET with 405 and Allow, once the secret is presented", async () => {
    const { port } = await start();
    const answer = await send(port, { method: "GET" });
    assert.equal(answer.status, 405);
    assert.equal(answer.headers.allow, "POST");
  });

  it("refuses a body past the limit with 413, once it has been read", async () => {
    const { port } = await start();
    const answer = await send(port, {
      body: Buffer.alloc(MAX_BODY_BYTES + 1, 0x20),
    });
    assert.equal(answer.status, 413);
    assert.equal(answer.body, "Request body too large");
  });

  it("refuses a chunked body that grows past the limit with 413", async () => {
    const { port } = await start();
    const answer = await send(port, {
      headers: { "transfer-encoding": "chunked" },
      body: Buffer.alloc(MAX_BODY_BYTES * 2, 0x20),
    });
    assert.equal(answer.status, 413);
  });

  it("delivers a 401 to a client that sent a large body with the wrong secret", async () => {
    const { port } = await start();
    const answer = await send(port, {
      headers: { authorization: "Bearer stale" },
      body: Buffer.alloc(MAX_BODY_BYTES * 2, 0x20),
    });
    assert.equal(answer.status, 401);
    assert.equal(rejected.length, 1);
  });

  it("accepts a body at exactly the limit", async () => {
    const { port } = await start();
    const padded = INITIALIZE.padEnd(MAX_BODY_BYTES, " ");
    const answer = await send(port, { body: padded });
    assert.equal(answer.status, 200);
  });

  it("reports a client that disconnects mid-body", async () => {
    const { port } = await start();
    await new Promise<void>((resolve) => {
      const req = httpRequest({
        host: LOOPBACK_HOST,
        port,
        method: "POST",
        path: "/mcp",
        headers: {
          host: `127.0.0.1:${String(port)}`,
          authorization: `Bearer ${SECRET}`,
          "content-type": "application/json",
          "content-length": "100",
        },
        agent: false,
      });
      req.on("error", () => {
        resolve();
      });
      req.write("{", () => {
        setTimeout(() => {
          req.destroy();
        }, 20);
      });
    });
    await waitFor(() => errors.length > 0);
    assert.equal(errors.length, 1);
  });

  it("binds the preferred port when it is free", async () => {
    const free = await freePort();
    const { port } = await start(free);
    assert.equal(port, free);
  });

  it("binds another port when the preferred one is taken", async () => {
    const blocker = await listenOn(0);
    const taken = portOf(blocker);
    try {
      const { port } = await start(taken);
      assert.notEqual(port, taken);
      assert.equal((await send(port, { body: INITIALIZE })).status, 200);
    } finally {
      await closeNet(blocker);
    }
  });

  it("rejects a failure it cannot recover from", async () => {
    await assert.rejects(start(70_000), RangeError);
  });

  it("closes, drops open connections, and can be closed twice", async () => {
    const started = await start();
    await send(started.port, { body: INITIALIZE });
    await started.close();
    await started.close();
    await assert.rejects(send(started.port, { body: INITIALIZE }));
    server = undefined;
  });

  describe("secretMatches", () => {
    it("matches only the same secret, whatever the presented length", () => {
      assert.ok(secretMatches(SECRET, SECRET));
      assert.ok(!secretMatches(SECRET, `${SECRET}x`));
      assert.ok(!secretMatches(SECRET, ""));
      assert.ok(!secretMatches(SECRET, "a".repeat(10_000)));
    });
  });

  describe("createSecret", () => {
    it("is 32 random bytes in base64url, new every time", () => {
      const a = createSecret();
      assert.match(a, /^[A-Za-z0-9_-]{43}$/);
      assert.notEqual(a, createSecret());
    });
  });

  describe("preferredPort", () => {
    it("keeps a stored port a user process could have bound", () => {
      assert.equal(preferredPort(1024), 1024);
      assert.equal(preferredPort(45_123), 45_123);
      assert.equal(preferredPort(65_535), 65_535);
    });

    for (const stored of [
      undefined,
      null,
      "45123",
      0,
      80,
      1023,
      65_536,
      1.5,
      NaN,
    ]) {
      it(`falls back to any port for ${String(stored)}`, () => {
        assert.equal(preferredPort(stored), 0);
      });
    }
  });

  describe("isRebindable", () => {
    function errno(code: string): Error {
      return Object.assign(new Error(code), { code });
    }

    it("falls back when the port is taken or reserved", () => {
      assert.equal(isRebindable(errno("EADDRINUSE")), true);
      assert.equal(isRebindable(errno("EACCES")), true);
    });

    it("rejects any other failure", () => {
      assert.equal(isRebindable(errno("EADDRNOTAVAIL")), false);
      assert.equal(isRebindable(new Error("EACCES")), false);
      assert.equal(isRebindable({ code: "EACCES" }), false);
      assert.equal(isRebindable(undefined), false);
    });
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !predicate(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function listenOn(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const blocker = createServer();
    blocker.once("error", reject);
    blocker.listen({ host: LOOPBACK_HOST, port }, () => {
      resolve(blocker);
    });
  });
}

function portOf(blocker: Server): number {
  const address = blocker.address();
  assert.ok(typeof address === "object" && address !== null);
  return address.port;
}

function closeNet(blocker: Server): Promise<void> {
  return new Promise((resolve) => {
    blocker.close(() => {
      resolve();
    });
  });
}

async function freePort(): Promise<number> {
  const probe = await listenOn(0);
  const port = portOf(probe);
  await closeNet(probe);
  return port;
}

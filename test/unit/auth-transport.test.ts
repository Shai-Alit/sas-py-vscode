// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import {
  MAX_BODY_BYTES,
  nodeHttpTransport,
  type TransportRequest,
} from "../../src/auth/transport";

/**
 * The default HTTP transport, against a real loopback server.
 *
 * **Deliberately not msw.** Every other suite in this tier mocks at the HTTP
 * boundary, and that is right when the subject is what a client *says*. Here the
 * subject is the transport itself — which Node module carries the request, what
 * happens to a socket that is destroyed mid-body, whether an abort listener is
 * removed. msw intercepts `ClientRequest` and would stand in for exactly the code
 * under test, so a green suite would prove very little.
 *
 * Nothing here leaves the machine. The server binds `127.0.0.1` on port 0, and
 * the one connection-failure test aims at a port that was bound and then closed,
 * so a refusal is arranged rather than hoped for.
 */

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

/** Read of the last request the server saw. */
interface Seen {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

describe("nodeHttpTransport", () => {
  let server: Server;
  let base: string;
  let handler: Handler;
  let seen: Seen | undefined;
  let calls = 0;
  /** Responses a test left open on purpose, ended in `afterEach`. */
  let pending: ServerResponse[] = [];

  before(async () => {
    server = createServer((request, response) => {
      calls += 1;
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      // Swallowed on purpose: several tests below destroy the socket from the
      // client side, and an unhandled 'error' on a response would take the
      // whole run down with it.
      request.on("error", () => undefined);
      response.on("error", () => undefined);
      request.on("end", () => {
        seen = {
          method: request.method ?? "",
          url: request.url ?? "",
          headers: request.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        };
        handler(request, response);
      });
    });
    server.on("clientError", (_error, socket) => {
      socket.destroy();
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(
      address !== null && typeof address === "object",
      "the loopback server did not report an address",
    );
    base = `http://127.0.0.1:${String(address.port)}`;
  });

  beforeEach(() => {
    calls = 0;
    seen = undefined;
    pending = [];
    handler = (_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
    };
  });

  afterEach(() => {
    for (const response of pending) response.destroy();
    pending = [];
  });

  after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  });

  const send = (path: string, init: Partial<TransportRequest> = {}) =>
    nodeHttpTransport(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=refresh_token",
      ...init,
    });

  it("sends the method, headers, and a content-length, and reads the body back", async () => {
    const response = await send("/SASLogon/oauth/token");

    assert.equal(response.ok, true);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "ok");

    assert.ok(seen);
    assert.equal(seen.method, "POST");
    assert.equal(seen.url, "/SASLogon/oauth/token");
    assert.equal(seen.body, "grant_type=refresh_token");
    // Not decoration: without an explicit content-length the request would be
    // sent chunked, and UAA in front of some gateways rejects that.
    assert.equal(seen.headers["content-length"], "24");
    assert.equal(
      seen.headers["content-type"],
      "application/x-www-form-urlencoded",
    );
  });

  it("computes content-length in bytes, not characters", async () => {
    await send("/token", { body: "note=café" });

    assert.ok(seen);
    assert.equal(seen.body, "note=café");
    // Nine characters, ten bytes. A length in characters truncates the body at
    // the server and the failure surfaces as an unrelated parse error.
    assert.equal(seen.headers["content-length"], "10");
  });

  it("reassembles a body that arrives in several chunks", async () => {
    handler = (_request, response) => {
      response.writeHead(200);
      response.write('{"access_to');
      response.end('ken":"x"}');
    };

    const response = await send("/token");

    assert.equal(await response.text(), '{"access_token":"x"}');
  });

  it("reports a non-2xx as not ok, carrying the status and the body", async () => {
    handler = (_request, response) => {
      response.writeHead(401, { "content-type": "application/json" });
      response.end('{"error":"invalid_client"}');
    };

    const response = await send("/token");

    assert.equal(response.ok, false);
    assert.equal(response.status, 401);
    // The caller parses an OAuth error envelope out of a failed response, so a
    // non-2xx has to arrive with its body intact rather than as a rejection.
    assert.equal(await response.text(), '{"error":"invalid_client"}');
  });

  it("does not follow a redirect", async () => {
    handler = (_request, response) => {
      response.writeHead(302, { location: "/elsewhere" });
      response.end();
    };

    const response = await send("/token");

    assert.equal(response.ok, false);
    assert.equal(response.status, 302);
    // The one assertion that matters here. The request body is a client secret
    // and an authorization code; replaying it at a location the server names is
    // a credential disclosure, so exactly one request may leave.
    assert.equal(calls, 1);
  });

  it("rejects a string that is not a URL", async () => {
    await assert.rejects(
      nodeHttpTransport("viya.example.com/token", {
        method: "POST",
        headers: {},
        body: "",
      }),
      /^Error: not a valid URL: viya\.example\.com\/token$/,
    );
    assert.equal(calls, 0);
  });

  it("rejects without sending when the signal is already aborted", async () => {
    await assert.rejects(
      send("/token", { signal: AbortSignal.abort() }),
      /cancelled before it was sent/,
    );
    assert.equal(calls, 0);
  });

  it("rejects when the signal aborts while the request is in flight", async () => {
    const controller = new AbortController();
    handler = (_request, response) => {
      // Never answered — the abort is the only thing that can settle this.
      pending.push(response);
      controller.abort();
    };

    await assert.rejects(
      send("/token", { signal: controller.signal }),
      /^Error: the request was cancelled$/,
    );
  });

  it("rejects a response body larger than the cap, and stops reading it", async () => {
    const chunk = "x".repeat(64 * 1024);
    handler = (_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      // A proxy error page that never ends is the case this exists for, so the
      // server keeps writing until the client goes away.
      const pump = (): void => {
        if (response.writableEnded || response.destroyed) return;
        if (response.write(chunk)) setImmediate(pump);
        else response.once("drain", pump);
      };
      pump();
    };

    await assert.rejects(
      send("/token"),
      new RegExp(`response body exceeded ${String(MAX_BODY_BYTES)} bytes`),
    );
  });

  it("prefixes Node's error code onto a connection failure", async () => {
    const port = await reservedPort();

    await assert.rejects(
      nodeHttpTransport(`http://127.0.0.1:${String(port)}/token`, {
        method: "POST",
        headers: {},
        body: "",
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        // The code is the diagnosis. An internal CA fails as
        // UNABLE_TO_VERIFY_LEAF_SIGNATURE, and dropping it leaves the most
        // likely enterprise failure reported as "socket hang up".
        assert.match(error.message, /^[A-Z_]+: /);
        // A fresh Error, never the original: the original's cause chain can
        // carry the request, whose body is a client secret.
        assert.equal(error.cause, undefined);
        return true;
      },
    );
  });

  it("uses node:https for an https URL", async () => {
    // The server on the other end speaks plaintext HTTP. An `http.request` would
    // get a clean 200 from it — the previous tests do exactly that. A TLS
    // handshake against it cannot complete, so a rejection here is the protocol
    // switch being exercised rather than mocked.
    await assert.rejects(
      nodeHttpTransport(`${base.replace("http://", "https://")}/token`, {
        method: "POST",
        headers: {},
        body: "",
      }),
    );
  });
});

/** A port that was bound and released, so connecting to it is refused. */
async function reservedPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => {
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  assert.ok(address !== null && typeof address === "object");
  const { port } = address;
  await new Promise<void>((resolve, reject) => {
    probe.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  return port;
}

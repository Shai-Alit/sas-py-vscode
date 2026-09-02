// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { Agent } from "node:https";
import {
  collectHeaders,
  createNodeHttpTransport,
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
  /**
   * The same bytes, undecoded. `body` is the UTF-8 decode, which is what almost
   * every test here wants; the fileref upload path is the one caller whose
   * whole claim is byte fidelity, and a decoded string cannot be evidence for
   * it.
   */
  raw: Buffer;
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
        const raw = Buffer.concat(chunks);
        seen = {
          method: request.method ?? "",
          url: request.url ?? "",
          headers: request.headers,
          body: raw.toString("utf8"),
          raw,
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

  it("writes a Uint8Array body through unchanged, and sizes it in bytes", async () => {
    // The `rawBody` arm — `src/compute/client.ts` is its only caller, carrying a
    // Python source file that ADR-0014 requires reach the interpreter byte for
    // byte. Every other test in this file sends a string, so without this one
    // nothing exercises `Buffer.byteLength`/`request.end` against the other
    // half of `body`'s union and the whole submission-fidelity corpus rests on
    // a boundary no test crosses.
    //
    // `0xc3 0x28` is deliberately **not** valid UTF-8: it is a lead byte
    // followed by an illegal continuation. Any decode-then-re-encode on the way
    // out replaces it with U+FFFD and three bytes arrive instead of two, so this
    // fails loudly rather than surviving by luck the way well-formed text would.
    const bytes = new Uint8Array([0xc3, 0x28, 0x0d, 0x0a, 0x09, 0x00, 0x7f]);

    await send("/compute/filerefs/case1/content", {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body: bytes,
    });

    assert.ok(seen);
    assert.equal(seen.method, "PUT");
    assert.equal(seen.raw.length, bytes.length);
    assert.deepEqual(new Uint8Array(seen.raw), bytes);
    assert.equal(seen.headers["content-length"], String(bytes.length));
  });

  it("omits content-length entirely when there is no body", async () => {
    // A `GET` carrying `content-length: 0` is the kind of thing a strict
    // gateway rejects and nobody thinks to look at. `body` is optional rather
    // than `""` precisely so this header can be absent rather than zero.
    await send("/identities/users/@currentUser", {
      method: "GET",
      headers: {},
      body: undefined,
    });

    assert.ok(seen);
    assert.equal(seen.method, "GET");
    assert.equal(seen.body, "");
    assert.equal(seen.headers["content-length"], undefined);
  });

  it("exposes response headers, lower-cased", async () => {
    // Probe finding 9: a dead Viya token is a 401 with a zero-byte body, and the
    // entire diagnosis is in `WWW-Authenticate`. A response type carrying only
    // `ok`, `status` and `text()` cannot tell "sign in again" from "not
    // permitted". Lower-casing is asserted because an injected transport is
    // under no obligation to do it and the callers index by lower-case name.
    handler = (_request, response) => {
      response.writeHead(401, {
        "WWW-Authenticate": 'Bearer error="invalid_token"',
        "Content-Type": "application/json",
      });
      response.end("");
    };

    const response = await send("/identities/users/@currentUser", {
      method: "GET",
      body: undefined,
    });

    assert.equal(response.status, 401);
    assert.equal(await response.text(), "");
    assert.equal(
      response.headers["www-authenticate"],
      'Bearer error="invalid_token"',
    );
    assert.equal(response.headers["content-type"], "application/json");
  });

  it("joins a header the server sent more than once", async () => {
    // Node hands these back as an array. A caller that does `.split(",")` on a
    // joined value is no worse off than one that ignored the extras, and a
    // `string | string[]` in the response type would push that decision into
    // every call site.
    handler = (_request, response) => {
      response.writeHead(200, { Warning: ['199 - "one"', '199 - "two"'] });
      response.end("ok");
    };

    const response = await send("/token");

    assert.equal(response.headers.warning, '199 - "one", 199 - "two"');
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

  it("returns the response's raw bytes via bytes(), undecoded", async () => {
    // `src/compute/files.ts`'s reason for existing: `text()`'s
    // `Buffer.toString("utf8")` replaces an invalid byte sequence with
    // U+FFFD, and that replacement cannot be undone by re-encoding the
    // string. `0xc3 0x28` is a lead byte followed by an illegal
    // continuation — the same deliberately-invalid pair the raw-body send
    // test above uses, here on the *response* side.
    const raw = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xc3, 0x28, 0x0a]);
    handler = (_request, response) => {
      response.writeHead(200, { "content-type": "application/octet-stream" });
      response.end(raw);
    };

    const response = await send("/compute/sessions/S/files/F/content", {
      method: "GET",
      headers: {},
      body: undefined,
    });

    assert.ok(response.bytes, "nodeHttpTransport did not provide bytes()");
    const bytes = await response.bytes();
    assert.deepEqual(new Uint8Array(bytes), new Uint8Array(raw));
    // The lossy counterpart, named so a future reader sees the contrast
    // rather than rediscovering it: decoding first and measuring the
    // re-encoded length shows the round trip does not come back the same
    // size, let alone the same bytes.
    const lossyRoundTrip = Buffer.from(await response.text(), "utf8");
    assert.notEqual(lossyRoundTrip.length, raw.length);
  });

  it("raises the cap when maxBodyBytes is given", async () => {
    // One byte over the module default, accepted only because this request
    // raised its own cap — `src/compute/files.ts`'s content fetch is the one
    // caller that does, per ADR-0019's 10 MiB rich-output limit.
    const oversized = MAX_BODY_BYTES + 1;
    handler = (_request, response) => {
      response.writeHead(200, { "content-type": "application/octet-stream" });
      response.end(Buffer.alloc(oversized, "x"));
    };

    const response = await send("/token", { maxBodyBytes: oversized });

    assert.equal(response.status, 200);
    const bytes = await response.bytes?.();
    assert.equal(bytes?.length, oversized);
  });

  it("still enforces a smaller maxBodyBytes than the module default", async () => {
    const small = 16;
    handler = (_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("x".repeat(small + 1));
    };

    await assert.rejects(
      send("/token", { maxBodyBytes: small }),
      new RegExp(`response body exceeded ${String(small)} bytes`),
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

describe("createNodeHttpTransport", () => {
  let server: Server;
  let base: string;

  before(async () => {
    server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address !== null && typeof address === "object");
    base = `http://127.0.0.1:${String(address.port)}`;
  });

  after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  /** An `https.Agent` that counts how many times the transport asked it to
   * open a connection, delegating to the real implementation after. */
  function countingAgent(): { agent: Agent; connections: () => number } {
    const agent = new Agent();
    let connections = 0;
    const real = agent.createConnection.bind(agent);
    agent.createConnection = ((
      options: Parameters<typeof real>[0],
      callback: Parameters<typeof real>[1],
    ) => {
      connections += 1;
      return real(options, callback);
    }) as typeof agent.createConnection;
    return { agent, connections: () => connections };
  }

  it("with no agent, behaves like the default transport", async () => {
    const transport = createNodeHttpTransport();

    const response = await transport(`${base}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=refresh_token",
    });

    assert.equal(response.ok, true);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "ok");
  });

  it("routes an https request through the agent it was given", async () => {
    const { agent, connections } = countingAgent();
    const transport = createNodeHttpTransport({ agent });

    // The loopback server speaks plaintext, so the TLS handshake cannot
    // complete and this rejects — but the agent being asked to open the
    // connection is the point, and that happens before the failure.
    await assert.rejects(
      transport(`${base.replace("http://", "https://")}/token`, {
        method: "POST",
        headers: {},
        body: "",
      }),
    );

    assert.equal(connections(), 1);
  });

  it("ignores the agent for a loopback http request", async () => {
    const { agent, connections } = countingAgent();
    const transport = createNodeHttpTransport({ agent });

    const response = await transport(`${base}/token`, {
      method: "GET",
      headers: {},
      body: undefined,
    });

    assert.equal(response.status, 200);
    // An https.Agent on an http request is a mismatch; the transport attaches
    // it only for `https:` targets.
    assert.equal(connections(), 0);
  });
});

describe("collectHeaders", () => {
  it("keeps a __proto__ field as data instead of losing it to the prototype", () => {
    // The header name comes from the server. Written as
    // `headers[name.toLowerCase()] = value` this field is silently discarded —
    // assigning a string to `__proto__` on a plain object is a no-op — and
    // CodeQL reads the same line as remote property injection. Going through a
    // `Map` and `Object.fromEntries` defines the property rather than assigning
    // it, so the field survives as data and the prototype is untouched.
    //
    // The key is computed on purpose: a bare `__proto__:` in an object literal
    // sets the prototype instead of creating a property, which is the hazard
    // itself rather than a way to test for it.
    const raw: IncomingHttpHeaders = {
      ["__proto__"]: "polluted",
      "WWW-Authenticate": 'Bearer error="invalid_token"',
    };
    const headers = collectHeaders(raw);

    assert.deepEqual(
      Object.entries(headers).find(([name]) => name === "__proto__"),
      ["__proto__", "polluted"],
    );
    assert.equal(Object.getPrototypeOf(headers), Object.prototype);
    assert.equal(
      headers["www-authenticate"],
      'Bearer error="invalid_token"',
      "the ordinary field was lost alongside the hostile one",
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

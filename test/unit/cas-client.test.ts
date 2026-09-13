// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  ResponseTooLargeError,
  type HttpTransport,
  type TransportRequest,
  type TransportResponse,
} from "../../src/auth/transport";
import { createCasClient } from "../../src/cas/client";
import { type Link } from "../../src/wire/links";

/**
 * The CAS client at the HTTP boundary — a fake {@link HttpTransport}
 * returning canned status/headers/body, so every arm of the
 * transport-outcome mapping is exercised without a live deployment. Mirrors
 * `content-client.test.ts`, minus the write-arm sections this read-scoped
 * client does not have (`rawBody`/`jsonBody`/`etag`), plus the load toggle's
 * own plain-text response shape (Finding 8.8).
 */

interface StubResponse {
  status: number;
  headers?: Record<string, string>;
  body?: string;
}

function transportReturning(response: StubResponse | (() => never)): {
  transport: HttpTransport;
  seen: TransportRequest[];
  urls: string[];
} {
  const seen: TransportRequest[] = [];
  const urls: string[] = [];
  const transport: HttpTransport = (url, init) => {
    urls.push(url);
    seen.push(init);
    if (typeof response === "function") {
      return Promise.reject(
        new Error("the transport could not reach the host"),
      );
    }
    const res: TransportResponse = {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      headers: response.headers ?? {},
      text: () => Promise.resolve(response.body ?? ""),
      bytes: () =>
        Promise.resolve(new TextEncoder().encode(response.body ?? "")),
    };
    return Promise.resolve(res);
  };
  return { transport, seen, urls };
}

/** The single request the transport saw, non-nullably — the same helper
 * `content-client.test.ts` uses so an assertion need not optional-chain a
 * `noUncheckedIndexedAccess` element type. */
function only(requests: readonly TransportRequest[]): TransportRequest {
  assert.equal(requests.length, 1);
  const [request] = requests;
  assert.ok(request !== undefined);
  return request;
}

const SERVERS: Link = {
  rel: "getServers",
  href: "/casManagement/servers",
  type: "application/vnd.sas.collection",
};

function clientWith(
  response: StubResponse | (() => never),
  extra?: { token?: () => string | Promise<string> },
) {
  const { transport, seen, urls } = transportReturning(response);
  const client = createCasClient({
    root: "https://viya.example.com",
    token: extra?.token ?? (() => "tok"),
    transport,
  });
  return { client, seen, urls };
}

describe("cas/client", () => {
  it("returns the parsed body and metadata on a 2xx JSON response", async () => {
    const { client, seen, urls } = clientWith({
      status: 200,
      headers: { "content-type": "application/vnd.sas.collection+json" },
      body: JSON.stringify({
        count: 1,
        items: [{ name: "cas-shared-default" }],
      }),
    });
    const result = await client.send({ link: SERVERS });
    assert.ok(result.ok);
    assert.equal(result.value.status, 200);
    assert.deepEqual(result.value.body, {
      count: 1,
      items: [{ name: "cas-shared-default" }],
    });
    assert.equal(urls[0], "https://viya.example.com/casManagement/servers");
    const call = only(seen);
    assert.equal(call.headers.authorization, "Bearer tok");
    assert.equal(call.headers.accept, "application/vnd.sas.collection+json");
  });

  it("leaves the body undefined and keeps text on a plain-text 2xx (Finding 8.8's load toggle)", async () => {
    const { client } = clientWith({
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
      body: "loaded",
    });
    const result = await client.send({
      link: {
        rel: "updateState",
        href: "/casManagement/servers/cas-shared-default/caslibs/Public/tables/X/state?value=loaded",
        method: "PUT",
        responseType: "application/json,text/plain",
      },
    });
    assert.ok(result.ok);
    assert.equal(result.value.body, undefined);
    assert.equal(result.value.text, "loaded");
  });

  it("passes a comma-joined responseType through as Accept unchanged", async () => {
    const { client, seen } = clientWith({ status: 200 });
    await client.send({
      link: {
        rel: "updateState",
        href: "/casManagement/.../state",
        method: "PUT",
        responseType: "application/json,text/plain",
      },
    });
    assert.equal(only(seen).headers.accept, "application/json,text/plain");
  });

  it("reads a dead token from the 401 challenge (session-expired)", async () => {
    const { client } = clientWith({
      status: 401,
      headers: {
        "www-authenticate":
          'Bearer error="invalid_token", error_description="Provided token isn\'t active"',
      },
    });
    const result = await client.send({ link: SERVERS });
    assert.ok(!result.ok);
    assert.equal(result.problem.code, "unauthorized");
    assert.equal(result.problem.problem.code, "session-expired");
  });

  it("maps a 403 to forbidden and reads the error envelope", async () => {
    const { client } = clientWith({
      status: 403,
      headers: { "content-type": "application/vnd.sas.error+json" },
      body: JSON.stringify({
        message: "Forbidden",
        details: ["The user is not authorized.", "correlator: abc-123"],
      }),
    });
    const result = await client.send({ link: SERVERS });
    assert.ok(!result.ok);
    assert.equal(result.problem.code, "forbidden");
    assert.equal(result.problem.error.detail, "The user is not authorized.");
  });

  it("maps any other non-2xx to cas-rejected carrying the status", async () => {
    const { client } = clientWith({
      status: 404,
      headers: { "content-type": "application/vnd.sas.error+json" },
      body: JSON.stringify({
        errorCode: 12204,
        message: "The table X could not be located.",
      }),
    });
    const result = await client.send({ link: SERVERS });
    assert.ok(!result.ok);
    assert.equal(result.problem.code, "cas-rejected");
    assert.equal(result.problem.error.status, 404);
    assert.equal(result.problem.error.errorCode, 12204);
  });

  it("maps a transport rejection to cas-unreachable, message only", async () => {
    const { client } = clientWith(() => {
      throw new Error("unused");
    });
    const result = await client.send({ link: SERVERS });
    assert.ok(!result.ok);
    assert.equal(result.problem.code, "cas-unreachable");
    assert.ok(result.problem.detail.includes("GET /casManagement/servers"));
  });

  it("reports a JSON content-type with an unparseable body as malformed", async () => {
    const { client } = clientWith({
      status: 200,
      headers: { "content-type": "application/vnd.sas.collection+json" },
      body: "{ not json",
    });
    const result = await client.send({ link: SERVERS });
    assert.ok(!result.ok);
    assert.equal(result.problem.code, "response-malformed");
  });

  it("refuses a link that points at another host", async () => {
    const { client } = clientWith({ status: 200 });
    for (const href of [
      "https://elsewhere.example/x",
      "//elsewhere.example/x",
    ]) {
      const result = await client.send({ link: { rel: "self", href } });
      assert.ok(!result.ok);
      assert.equal(result.problem.code, "foreign-link");
    }
  });

  it("reports a token function that throws as not-authenticated with noSession", async () => {
    const { client } = clientWith(
      { status: 200 },
      {
        token: () => {
          throw new Error("refresh failed");
        },
      },
    );
    const result = await client.send({ link: SERVERS });
    assert.ok(!result.ok);
    assert.equal(result.problem.code, "unauthorized");
    assert.equal(result.problem.problem.code, "not-authenticated");
    assert.equal(result.problem.noSession, true);
  });

  it("maps a ResponseTooLargeError the same as any other transport rejection (cas-unreachable)", async () => {
    // Unlike `ContentClient`, this client never overrides the transport's
    // default body cap — nothing it reads is large enough to need one — so
    // this arm intentionally does not get its own CasProblem variant.
    const failing: HttpTransport = () =>
      Promise.reject(new ResponseTooLargeError(1024));
    const client = createCasClient({
      root: "https://viya.example.com",
      token: () => "tok",
      transport: failing,
    });
    const result = await client.send({ link: SERVERS });
    assert.ok(!result.ok);
    assert.equal(result.problem.code, "cas-unreachable");
  });

  it("survives a non-Error rejection from the transport", async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- deliberately malformed rejection
    const failing: HttpTransport = () => Promise.reject("just a string");
    const client = createCasClient({
      root: "https://viya.example.com",
      token: () => "tok",
      transport: failing,
    });
    const result = await client.send({ link: SERVERS });
    assert.ok(!result.ok);
    assert.equal(result.problem.code, "cas-unreachable");
    assert.ok(result.problem.detail.endsWith("unknown error"));
  });
});

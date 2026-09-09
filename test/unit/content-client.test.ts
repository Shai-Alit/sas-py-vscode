// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  type HttpTransport,
  type TransportRequest,
  type TransportResponse,
} from "../../src/auth/transport";
import { createContentClient } from "../../src/content/client";
import { type Link } from "../../src/wire/links";

/**
 * The Content client at the HTTP boundary — a fake {@link HttpTransport}
 * returning canned status/headers/body, so every arm of the
 * transport-outcome mapping is exercised without a live deployment. The same
 * arms `compute-client.test.ts` pins, minus the mutation ones this read-only
 * slice does not have.
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

const SELF: Link = {
  rel: "self",
  href: "/folders/folders/@myFolder",
};

function clientWith(
  response: StubResponse | (() => never),
  extra?: { token?: () => string | Promise<string> },
) {
  const { transport, seen, urls } = transportReturning(response);
  const client = createContentClient({
    root: "https://viya.example.com",
    token: extra?.token ?? (() => "tok"),
    transport,
  });
  return { client, seen, urls };
}

describe("content/client", () => {
  it("returns the parsed body and metadata on a 2xx JSON response", async () => {
    const { client, seen, urls } = clientWith({
      status: 200,
      headers: { "content-type": "application/vnd.sas.content.folder+json" },
      body: JSON.stringify({ id: "x", name: "My Folder" }),
    });
    const result = await client.send({ link: SELF });
    assert.ok(result.ok);
    assert.equal(result.value.status, 200);
    assert.deepEqual(result.value.body, { id: "x", name: "My Folder" });
    assert.equal(urls[0], "https://viya.example.com/folders/folders/@myFolder");
    assert.equal(seen[0]?.headers.authorization, "Bearer tok");
  });

  it("leaves the body undefined when the response is not JSON", async () => {
    const { client } = clientWith({
      status: 200,
      headers: { "content-type": "text/html" },
      body: "<html>proxy</html>",
    });
    const result = await client.send({ link: SELF });
    assert.ok(result.ok);
    assert.equal(result.value.body, undefined);
    assert.equal(result.value.text, "<html>proxy</html>");
  });

  it("derives Accept from the link's type when there is no responseType", async () => {
    const { client, seen } = clientWith({ status: 200 });
    await client.send({
      link: {
        rel: "members",
        href: "/folders/folders/1/members",
        type: "application/vnd.sas.collection",
      },
    });
    assert.equal(
      seen[0]?.headers.accept,
      "application/vnd.sas.collection+json",
    );
  });

  it("prefers the link's responseType for Accept", async () => {
    const { client, seen } = clientWith({ status: 200 });
    await client.send({
      link: {
        rel: "self",
        href: "/folders/folders/1",
        type: "application/vnd.sas.content.folder",
        responseType: "application/vnd.sas.summary",
      },
    });
    assert.equal(seen[0]?.headers.accept, "application/vnd.sas.summary+json");
  });

  it("sends no Accept when the link declares no media type", async () => {
    const { client, seen } = clientWith({ status: 200 });
    await client.send({ link: SELF });
    assert.equal(seen[0]?.headers.accept, undefined);
  });

  it("reads a dead token from the 401 challenge (session-expired)", async () => {
    const { client } = clientWith({
      status: 401,
      headers: {
        "www-authenticate":
          'Bearer error="invalid_token", error_description="Provided token isn\'t active"',
      },
    });
    const result = await client.send({ link: SELF });
    assert.ok(!result.ok);
    assert.equal(result.problem.code, "unauthorized");
    assert.equal(result.problem.problem.code, "session-expired");
  });

  it("reads a bare Bearer 401 as not-authenticated", async () => {
    const { client } = clientWith({
      status: 401,
      headers: { "www-authenticate": "Bearer" },
    });
    const result = await client.send({ link: SELF });
    assert.ok(!result.ok);
    assert.equal(result.problem.code, "unauthorized");
    assert.equal(result.problem.problem.code, "not-authenticated");
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
    const result = await client.send({ link: SELF });
    assert.ok(!result.ok);
    assert.equal(result.problem.code, "forbidden");
    assert.equal(result.problem.error.detail, "The user is not authorized.");
  });

  it("maps any other non-2xx to content-rejected carrying the status", async () => {
    const { client } = clientWith({
      status: 404,
      headers: { "content-type": "application/vnd.sas.error+json;version=2" },
      body: JSON.stringify({
        httpStatusCode: 404,
        errorCode: 11500,
        message: "No folder with that id was found.",
        details: ["path: /folders/folders/x", "correlator: def-456"],
      }),
    });
    const result = await client.send({ link: SELF });
    assert.ok(!result.ok);
    assert.equal(result.problem.code, "content-rejected");
    assert.equal(result.problem.error.status, 404);
    assert.equal(result.problem.error.errorCode, 11500);
  });

  it("maps a transport rejection to content-unreachable, message only", async () => {
    const { client } = clientWith(() => {
      throw new Error("unused");
    });
    const result = await client.send({ link: SELF });
    assert.ok(!result.ok);
    assert.equal(result.problem.code, "content-unreachable");
    assert.ok(result.problem.detail.includes("GET /folders/folders/@myFolder"));
  });

  it("reports a JSON content-type with an unparseable body as malformed", async () => {
    const { client } = clientWith({
      status: 200,
      headers: { "content-type": "application/vnd.sas.collection+json" },
      body: "{ not json",
    });
    const result = await client.send({ link: SELF });
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

  it("reports a token function that throws as not-authenticated", async () => {
    const { client } = clientWith(
      { status: 200 },
      {
        token: () => {
          throw new Error("refresh failed");
        },
      },
    );
    const result = await client.send({ link: SELF });
    assert.ok(!result.ok);
    assert.equal(result.problem.code, "unauthorized");
    assert.equal(result.problem.problem.code, "not-authenticated");
  });

  it("survives a non-Error rejection from the transport", async () => {
    // A transport rejecting with a non-Error is the exact condition under
    // test — `error.message` on a string is undefined, so the client must
    // fall back rather than interpolate it.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- deliberately malformed rejection
    const failing: HttpTransport = () => Promise.reject("just a string");
    const client = createContentClient({
      root: "https://viya.example.com",
      token: () => "tok",
      transport: failing,
    });
    const result = await client.send({ link: SELF });
    assert.ok(!result.ok);
    assert.equal(result.problem.code, "content-unreachable");
    assert.ok(result.problem.detail.endsWith("unknown error"));
  });

  it("survives a non-Error rejection from the token function", async () => {
    const { client } = clientWith(
      { status: 200 },
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the sign-in machinery can reject with a non-Error
      { token: () => Promise.reject("not an Error") },
    );
    const result = await client.send({ link: SELF });
    assert.ok(!result.ok);
    assert.equal(result.problem.code, "unauthorized");
  });
});

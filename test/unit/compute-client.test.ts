// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import type {
  HttpTransport,
  TransportRequest,
  TransportResponse,
} from "../../src/auth/transport";
import { createComputeClient } from "../../src/compute/client";
import type { Link } from "../../src/compute/links";

/**
 * The one request helper every other Compute module goes through.
 *
 * Most of what is asserted below is header derivation, which sounds like detail
 * and is not: an `Accept` the deployment does not serve is a 406 (finding 6), an
 * `If-Match` sent when we are unsure of the ETag is a 412 that leaves a SAS
 * process running until it times out (finding 18), and a 304 read as a failure
 * turns the state long poll into an error every five seconds (finding 19).
 *
 * The suite drives an injected transport rather than a mock server. What is
 * being tested is entirely the request this module builds and the mapping it
 * makes from a response — there is no socket behaviour in it, and
 * `auth-transport.test.ts` already covers the socket.
 */

const ROOT = "https://viya.example.com";
const TOKEN = "test-token";

interface Call {
  readonly url: string;
  readonly init: TransportRequest;
}

interface Recorder {
  readonly calls: Call[];
  readonly transport: HttpTransport;
}

function response(init: {
  status?: number;
  headers?: Record<string, string>;
  text?: string;
}): TransportResponse {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: init.headers ?? {},
    text: () => Promise.resolve(init.text ?? ""),
  };
}

function record(reply: TransportResponse): Recorder {
  const calls: Call[] = [];
  const transport: HttpTransport = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(reply);
  };
  return { calls, transport };
}

/** The single call the transport received, so no test optional-chains an index. */
function only(calls: readonly Call[]): Call {
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.ok(call !== undefined);
  return call;
}

const SELF: Link = {
  rel: "self",
  href: "/compute/sessions/SESSION-ID",
  method: "GET",
  type: "application/vnd.sas.compute.session",
};

describe("createComputeClient", () => {
  describe("the request it builds", () => {
    it("joins the href to the root and follows the link's method", async () => {
      const recorder = record(response({ status: 204 }));
      const client = createComputeClient({
        root: ROOT,
        token: () => TOKEN,
        transport: recorder.transport,
      });

      await client.send({
        link: { rel: "delete", href: "/compute/sessions/S", method: "DELETE" },
      });

      const call = only(recorder.calls);
      assert.equal(call.url, `${ROOT}/compute/sessions/S`);
      assert.equal(call.init.method, "DELETE");
    });

    it("defaults to GET when the link does not say", async () => {
      const recorder = record(response({}));
      const client = createComputeClient({
        root: ROOT,
        token: () => TOKEN,
        transport: recorder.transport,
      });

      await client.send({ link: { rel: "self", href: "/compute/contexts" } });

      assert.equal(only(recorder.calls).init.method, "GET");
    });

    it("presents the token as a bearer credential", async () => {
      const recorder = record(response({}));
      const client = createComputeClient({
        root: ROOT,
        token: () => TOKEN,
        transport: recorder.transport,
      });

      await client.send({ link: SELF });

      assert.equal(
        only(recorder.calls).init.headers.authorization,
        `Bearer ${TOKEN}`,
      );
    });

    it("asks the token provider again on every request", async () => {
      // The reason `token` is a function: a compute session outlives the access
      // token that created it, and a client holding a string would keep sending
      // a dead one after a refresh had already fixed it.
      const tokens = ["first", "second"];
      let issued = 0;
      const recorder = record(response({}));
      const client = createComputeClient({
        root: ROOT,
        token: () => tokens[issued++] ?? "exhausted",
        transport: recorder.transport,
      });

      await client.send({ link: SELF });
      await client.send({ link: SELF });

      assert.deepEqual(
        recorder.calls.map((call) => call.init.headers.authorization),
        ["Bearer first", "Bearer second"],
      );
    });

    it("awaits a token provider that returns a promise", async () => {
      const recorder = record(response({}));
      const client = createComputeClient({
        root: ROOT,
        token: () => Promise.resolve("refreshed"),
        transport: recorder.transport,
      });

      await client.send({ link: SELF });

      assert.equal(
        only(recorder.calls).init.headers.authorization,
        "Bearer refreshed",
      );
    });
  });

  describe("media types", () => {
    it("asks for the link's responseType, completed to +json", async () => {
      const recorder = record(response({}));
      const client = createComputeClient({
        root: ROOT,
        token: () => TOKEN,
        transport: recorder.transport,
      });

      await client.send({
        link: {
          rel: "state",
          href: "/compute/sessions/S/state",
          method: "GET",
          type: "application/vnd.sas.compute.session",
          responseType: "text/plain",
        },
      });

      assert.equal(only(recorder.calls).init.headers.accept, "text/plain");
    });

    it("falls back to the link's type on a GET", async () => {
      const recorder = record(response({}));
      const client = createComputeClient({
        root: ROOT,
        token: () => TOKEN,
        transport: recorder.transport,
      });

      await client.send({ link: SELF });

      assert.equal(
        only(recorder.calls).init.headers.accept,
        "application/vnd.sas.compute.session+json",
      );
    });

    it("does not ask for the request type back on a POST", async () => {
      // On a POST, `type` describes the body being sent. Sending it as `Accept`
      // asks the deployment to answer with the representation we just uploaded,
      // which is a 406 waiting to happen.
      const recorder = record(response({ status: 201 }));
      const client = createComputeClient({
        root: ROOT,
        token: () => TOKEN,
        transport: recorder.transport,
      });

      await client.send({
        link: {
          rel: "createSession",
          href: "/compute/contexts/C/sessions",
          method: "POST",
          type: "application/vnd.sas.compute.session.request",
        },
        body: { name: "python-on-viya" },
      });

      const call = only(recorder.calls);
      assert.equal(call.init.headers.accept, undefined);
      assert.equal(
        call.init.headers["content-type"],
        "application/vnd.sas.compute.session.request+json",
      );
    });

    it("omits Accept rather than guessing one", async () => {
      // Finding 6: a media type the deployment does not serve is a 406, which
      // fails the request outright. No header at all gets the server's default
      // representation, which is the one the link intended.
      const recorder = record(response({}));
      const client = createComputeClient({
        root: ROOT,
        token: () => TOKEN,
        transport: recorder.transport,
      });

      await client.send({ link: { rel: "self", href: "/compute/sessions/S" } });

      assert.equal(only(recorder.calls).init.headers.accept, undefined);
    });

    it("sends no body and no Content-Type when there is nothing to send", async () => {
      const recorder = record(response({}));
      const client = createComputeClient({
        root: ROOT,
        token: () => TOKEN,
        transport: recorder.transport,
      });

      await client.send({ link: SELF });

      const call = only(recorder.calls);
      assert.equal(call.init.body, undefined);
      assert.equal(call.init.headers["content-type"], undefined);
    });

    it("serialises the body as JSON", async () => {
      const recorder = record(response({ status: 201 }));
      const client = createComputeClient({
        root: ROOT,
        token: () => TOKEN,
        transport: recorder.transport,
      });

      await client.send({
        link: {
          rel: "execute",
          href: "/compute/sessions/S/jobs",
          method: "POST",
        },
        body: { code: ["proc python;"] },
      });

      const call = only(recorder.calls);
      assert.equal(call.init.body, '{"code":["proc python;"]}');
      assert.equal(call.init.headers["content-type"], "application/json");
    });
  });

  describe("conditional requests", () => {
    it("sends If-Match only when an ETag is held", async () => {
      // Finding 18: DELETE answered 204 with no If-Match at all. Upstream sends
      // it unconditionally; sending one we are unsure of turns a working
      // teardown into a 412 and leaks a SAS process.
      const recorder = record(response({ status: 204 }));
      const client = createComputeClient({
        root: ROOT,
        token: () => TOKEN,
        transport: recorder.transport,
      });

      await client.send({
        link: { rel: "delete", href: "/compute/sessions/S", method: "DELETE" },
      });

      assert.equal(only(recorder.calls).init.headers["if-match"], undefined);
    });

    it("echoes a weak validator verbatim", async () => {
      // The `W/` prefix is part of the value. Stripping it produces a validator
      // the server does not recognise.
      const recorder = record(response({ status: 204 }));
      const client = createComputeClient({
        root: ROOT,
        token: () => TOKEN,
        transport: recorder.transport,
      });

      await client.send({
        link: { rel: "delete", href: "/compute/sessions/S", method: "DELETE" },
        etag: 'W/"1730..."',
      });

      assert.equal(
        only(recorder.calls).init.headers["if-match"],
        'W/"1730..."',
      );
    });

    it("carries If-None-Match on a conditional read", async () => {
      const recorder = record(response({ status: 304 }));
      const client = createComputeClient({
        root: ROOT,
        token: () => TOKEN,
        transport: recorder.transport,
      });

      await client.send({
        link: { rel: "state", href: "/compute/sessions/S/state?wait=5" },
        ifNoneMatch: '"running"',
      });

      assert.equal(
        only(recorder.calls).init.headers["if-none-match"],
        '"running"',
      );
    });

    it("reads a 304 as a successful read, not a failure", async () => {
      // Finding 19: the state resource is a long poll that answers 304 after the
      // wait elapses. Treating that as an error would make a healthy session
      // report a problem every five seconds.
      const client = createComputeClient({
        root: ROOT,
        token: () => TOKEN,
        transport: record(
          response({ status: 304, headers: { etag: '"running"' } }),
        ).transport,
      });

      const result = await client.send({
        link: { rel: "state", href: "/compute/sessions/S/state?wait=5" },
        ifNoneMatch: '"running"',
      });

      assert.ok(result.ok, "a 304 was reported as a failure");
      assert.equal(result.value.notModified, true);
      assert.equal(result.value.status, 304);
      assert.equal(result.value.etag, '"running"');
      assert.equal(result.value.body, undefined);
    });
  });

  describe("the response it returns", () => {
    it("parses a JSON body and keeps the text alongside it", async () => {
      const client = createComputeClient({
        root: ROOT,
        token: () => TOKEN,
        transport: record(
          response({
            headers: {
              "content-type": "application/vnd.sas.compute.session+json",
              etag: '"1"',
            },
            text: '{"id":"SESSION-ID","state":"running"}',
          }),
        ).transport,
      });

      const result = await client.send({ link: SELF });

      assert.ok(result.ok, "a 200 was reported as a failure");
      assert.deepEqual(result.value.body, {
        id: "SESSION-ID",
        state: "running",
      });
      assert.equal(result.value.text, '{"id":"SESSION-ID","state":"running"}');
      assert.equal(result.value.etag, '"1"');
      assert.equal(result.value.notModified, false);
    });

    it("carries the Location of a created resource", async () => {
      const client = createComputeClient({
        root: ROOT,
        token: () => TOKEN,
        transport: record(
          response({
            status: 201,
            headers: { location: "/compute/sessions/SESSION-ID" },
          }),
        ).transport,
      });

      const result = await client.send({
        link: {
          rel: "createSession",
          href: "/compute/contexts/C/sessions",
          method: "POST",
        },
        body: {},
      });

      assert.ok(result.ok, "a 201 was reported as a failure");
      assert.equal(result.value.location, "/compute/sessions/SESSION-ID");
    });

    it("leaves a non-JSON body unparsed rather than failing", async () => {
      // The log lines resource can be asked for as text, and a body this module
      // was not told to expect as JSON is not an error.
      const client = createComputeClient({
        root: ROOT,
        token: () => TOKEN,
        transport: record(
          response({
            headers: { "content-type": "text/plain" },
            text: "NOTE: PROCEDURE PYTHON used",
          }),
        ).transport,
      });

      const result = await client.send({ link: SELF });

      assert.ok(result.ok, "a text body was reported as a failure");
      assert.equal(result.value.body, undefined);
      assert.equal(result.value.text, "NOTE: PROCEDURE PYTHON used");
    });

    it("accepts an empty body on a 204", async () => {
      const client = createComputeClient({
        root: ROOT,
        token: () => TOKEN,
        transport: record(
          response({ status: 204, headers: { "content-type": "" } }),
        ).transport,
      });

      const result = await client.send({
        link: { rel: "delete", href: "/compute/sessions/S", method: "DELETE" },
      });

      assert.ok(result.ok, "a 204 was reported as a failure");
      assert.equal(result.value.body, undefined);
    });

    it("reports a JSON body that will not parse, without quoting it", async () => {
      const client = createComputeClient({
        root: ROOT,
        token: () => TOKEN,
        transport: record(
          response({
            headers: { "content-type": "application/json" },
            text: '{"id": ',
          }),
        ).transport,
      });

      const result = await client.send({ link: SELF });

      assert.ok(!result.ok, "a truncated body was reported as a success");
      assert.equal(result.problem.code, "response-malformed");
      assert.ok(
        !JSON.stringify(result).includes('{"id": '),
        "the unparseable body was repeated into the problem",
      );
    });
  });

  describe("failures", () => {
    it("refuses a link to another host before sending anything", async () => {
      const recorder = record(response({}));
      const client = createComputeClient({
        root: ROOT,
        token: () => TOKEN,
        transport: recorder.transport,
      });

      const result = await client.send({
        link: { rel: "next", href: "//elsewhere.example/collect" },
      });

      assert.ok(!result.ok, "a foreign link was followed");
      assert.equal(result.problem.code, "foreign-link");
      assert.equal(
        recorder.calls.length,
        0,
        "the token was sent to a host the deployment named",
      );
    });

    it("reports a transport failure without repeating the request", async () => {
      // An injected transport's rejection can carry the request that produced
      // it, and this request's headers hold an access token.
      const transport: HttpTransport = (url, init) =>
        Promise.reject(
          Object.assign(new Error("ECONNREFUSED"), { url, request: init }),
        );
      const client = createComputeClient({
        root: ROOT,
        token: () => TOKEN,
        transport,
      });

      const result = await client.send({ link: SELF });

      assert.ok(!result.ok, "a rejected transport was reported as a success");
      assert.equal(result.problem.code, "compute-unreachable");
      assert.ok(!JSON.stringify(result).includes(TOKEN));
    });

    it("reports a token provider that fails as a missing credential", async () => {
      const client = createComputeClient({
        root: ROOT,
        token: () => Promise.reject(new Error("no refresh token")),
        transport: record(response({})).transport,
      });

      const result = await client.send({ link: SELF });

      assert.ok(
        !result.ok,
        "a failed token provider was reported as a success",
      );
      assert.deepEqual(result.problem, {
        code: "unauthorized",
        problem: { code: "not-authenticated" },
      });
    });

    it("delegates a dead token to the auth module's reading", async () => {
      const client = createComputeClient({
        root: ROOT,
        token: () => TOKEN,
        transport: record(
          response({
            status: 401,
            headers: {
              "www-authenticate":
                'Bearer error="invalid_token", error_description="Provided token isn\'t active"',
            },
          }),
        ).transport,
      });

      const result = await client.send({ link: SELF });

      assert.ok(!result.ok, "a 401 was reported as a success");
      assert.deepEqual(result.problem, {
        code: "unauthorized",
        problem: {
          code: "session-expired",
          description: "Provided token isn't active",
        },
      });
    });

    it("tells a bare challenge apart from a dead token", async () => {
      const client = createComputeClient({
        root: ROOT,
        token: () => TOKEN,
        transport: record(
          response({
            status: 401,
            headers: { "www-authenticate": "Bearer" },
          }),
        ).transport,
      });

      const result = await client.send({ link: SELF });

      assert.ok(!result.ok, "a 401 was reported as a success");
      assert.deepEqual(result.problem, {
        code: "unauthorized",
        problem: { code: "not-authenticated" },
      });
    });

    it("does not read insufficient_scope as a reason to sign in again", async () => {
      // `challengeProblem` answers only the two questions 1c owns. Anything else
      // RFC 6750 §3.1 allows falls through to the unclassified arm rather than
      // this layer inventing a third reading.
      const client = createComputeClient({
        root: ROOT,
        token: () => TOKEN,
        transport: record(
          response({
            status: 401,
            headers: {
              "www-authenticate": 'Bearer error="insufficient_scope"',
            },
          }),
        ).transport,
      });

      const result = await client.send({ link: SELF });

      assert.ok(!result.ok, "a 401 was reported as a success");
      assert.equal(result.problem.code, "compute-rejected");
    });

    it("reads the error envelope on a 403", async () => {
      const client = createComputeClient({
        root: ROOT,
        token: () => TOKEN,
        transport: record(
          response({
            status: 403,
            headers: { "content-type": "application/json" },
            text: JSON.stringify({
              message: "Forbidden",
              errorCode: 4020,
              details: ["correlator: cca95fbe-0000-4000"],
            }),
          }),
        ).transport,
      });

      const result = await client.send({ link: SELF });

      assert.ok(!result.ok, "a 403 was reported as a success");
      assert.equal(result.problem.code, "forbidden");
      assert.match(result.reason, /Forbidden/);
      assert.match(result.reason, /cca95fbe-0000-4000/);
    });

    it("leaves a 404 unclassified for the caller to interpret", async () => {
      // Whether this means "the session is gone" or "no context by that name"
      // depends on what was asked for, and only the caller knows which.
      const client = createComputeClient({
        root: ROOT,
        token: () => TOKEN,
        transport: record(
          response({
            status: 404,
            headers: { "content-type": "application/json" },
            text: JSON.stringify({ message: "Not Found", errorCode: 5837 }),
          }),
        ).transport,
      });

      const result = await client.send({ link: SELF });

      assert.ok(!result.ok, "a 404 was reported as a success");
      assert.deepEqual(result.problem, {
        code: "compute-rejected",
        error: { status: 404, message: "Not Found", errorCode: 5837 },
      });
      assert.match(result.reason, /HTTP 404/);
    });

    it("reports a gateway's HTML without pretending it is an envelope", async () => {
      const client = createComputeClient({
        root: ROOT,
        token: () => TOKEN,
        transport: record(
          response({
            status: 502,
            headers: { "content-type": "text/html" },
            text: "<html><body>502 Bad Gateway</body></html>",
          }),
        ).transport,
      });

      const result = await client.send({ link: SELF });

      assert.ok(!result.ok, "a 502 was reported as a success");
      assert.deepEqual(result.problem, {
        code: "compute-rejected",
        error: { status: 502 },
      });
    });
  });

  describe("cancellation", () => {
    it("combines the caller's signal with the timeout", async () => {
      const recorder = record(response({}));
      const controller = new AbortController();
      const client = createComputeClient({
        root: ROOT,
        token: () => TOKEN,
        transport: recorder.transport,
      });

      await client.send({ link: SELF, signal: controller.signal });

      const { signal } = only(recorder.calls).init;
      assert.ok(signal !== undefined, "no signal reached the transport");

      // Both states in one assertion. Asserting `signal.aborted` is `false` and
      // then `true` narrows it to the first literal and the second comparison
      // becomes a lint error — see the note in auth-identity.test.ts.
      const before = signal.aborted;
      controller.abort();
      const after = signal.aborted;

      assert.deepEqual(
        { before, after },
        { before: false, after: true },
        "the caller's signal did not reach the transport",
      );
    });

    it("aborts on its own timeout when the caller passes no signal", async () => {
      const recorder = record(response({}));
      const client = createComputeClient({
        root: ROOT,
        token: () => TOKEN,
        transport: recorder.transport,
        timeoutMs: 1,
      });

      await client.send({ link: SELF });

      const { signal } = only(recorder.calls).init;
      assert.ok(signal !== undefined, "no signal reached the transport");
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 20);
      });
      assert.equal(signal.aborted, true, "the timeout never fired");
    });
  });
});

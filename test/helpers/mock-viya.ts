// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import { HttpResponse, type RequestHandler } from "msw";
import { setupServer, type SetupServer } from "msw/node";

import { readFixture } from "./fixtures";

/**
 * The base URL every mocked Viya request is written against.
 *
 * `.invalid` is reserved by RFC 2606 and is guaranteed never to resolve. That
 * matters: if the mock layer is ever bypassed — a handler removed, a server not
 * started, a request built before `listen()` — the request fails to resolve
 * instead of quietly reaching a real host that happens to answer. A test suite
 * that can touch the network is a test suite that will, eventually, touch
 * production.
 */
export const MOCK_VIYA_BASE = "https://viya.test.invalid";

/**
 * Installs a mock Viya for the enclosing suite and returns the server so a test
 * can add per-test handlers with `server.use(...)`.
 *
 * Call this **inside** a `describe` body. Called at module scope its hooks
 * become Mocha root hooks and apply to every suite in the run, which is not
 * what anyone means.
 *
 * ```ts
 * describe("session client", () => {
 *   const viya = mockViya(
 *     http.get(`${MOCK_VIYA_BASE}/compute/contexts`, () =>
 *       HttpResponse.json(readJsonFixture("viya4", "compute-contexts.json")),
 *     ),
 *   );
 *
 *   it("fails loudly on 503", async () => {
 *     viya.use(http.get(..., () => new HttpResponse(null, { status: 503 })));
 *     // ...
 *   });
 * });
 * ```
 *
 * `onUnhandledRequest: "error"` is the point of this helper. Mocking at the
 * HTTP boundary only buys anything if an *unmocked* call is a failure rather
 * than a silent escape to the network — otherwise the first forgotten handler
 * turns a unit test into a flaky integration test against someone's deployment.
 * `resetHandlers` after each test undoes per-test `use()` overrides so one
 * test's stub cannot leak into the next.
 */
export function mockViya(...handlers: RequestHandler[]): SetupServer {
  const server = setupServer(...handlers);

  before(() => {
    server.listen({ onUnhandledRequest: "error" });
  });

  afterEach(() => {
    server.resetHandlers();
  });

  after(() => {
    server.close();
  });

  return server;
}

/**
 * Responds with a fixture's bytes exactly as they were recorded.
 *
 * Deliberately not `HttpResponse.json(readJsonFixture(...))`, which parses the
 * file and re-serialises it. That round trip silently normalises the payload —
 * key order, number formatting, whitespace, duplicate keys — so the client
 * under test never sees the bytes Viya actually sends, and a parser bug that
 * depends on them cannot be reproduced.
 *
 * `contentType` defaults to plain JSON, but Viya is media-type driven: pass the
 * `application/vnd.sas.*+json` type the endpoint really returns whenever the
 * code under test looks at it.
 */
export function fixtureResponse(
  segments: string[],
  init: { status?: number; contentType?: string } = {},
): HttpResponse<string> {
  return new HttpResponse(readFixture(...segments), {
    status: init.status ?? 200,
    headers: { "content-type": init.contentType ?? "application/json" },
  });
}

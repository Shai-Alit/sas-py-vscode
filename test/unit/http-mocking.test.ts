// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";

import { http } from "msw";

import { readJsonFixture } from "../helpers/fixtures";
import {
  fixtureResponse,
  MOCK_VIYA_BASE,
  mockViya,
} from "../helpers/mock-viya";

describe("HTTP mocking layer", () => {
  const fixture = readJsonFixture("harness", "echo.json");

  mockViya(
    http.get(`${MOCK_VIYA_BASE}/harness/echo`, () =>
      fixtureResponse(["harness", "echo.json"]),
    ),
  );

  it("serves a fixture in place of a real request", async () => {
    const response = await fetch(`${MOCK_VIYA_BASE}/harness/echo`);

    assert.equal(response.status, 200);
    const body: unknown = await response.json();
    assert.deepEqual(body, fixture);
  });

  /**
   * The load-bearing suite in this file. `onUnhandledRequest: "error"` is what
   * turns "someone forgot a handler" into a failure rather than a real request
   * against whatever host the URL happens to name. Without proof, the mock
   * layer looks identical whether it is working or not — the suite is green
   * either way, right up until CI has no network and a hundred tests fail at
   * once.
   *
   * The proof runs against a real HTTP server on loopback, and that detail is
   * the whole test. The obvious version — assert that a request to
   * `viya.test.invalid` rejects — passes whether the mock server refuses it or
   * not, because `.invalid` never resolves and the fetch fails at DNS either
   * way. It asserts nothing. A loopback server that genuinely answers 200 is
   * the only way to tell "refused by the mock layer" apart from "could not
   * reach the network", and swapping `"error"` for `"bypass"` turns this suite
   * red exactly as it should.
   */
  describe("unhandled requests", () => {
    let server: Server;
    let origin: string;

    before(async () => {
      server = createServer((_request, response) => {
        response.writeHead(200, { "content-type": "text/plain" });
        response.end("reached the real server");
      });

      await new Promise<void>((resolve) => {
        // Port 0 asks the OS for a free one, so a busy port cannot make this
        // suite flaky on a developer's machine.
        server.listen(0, "127.0.0.1", resolve);
      });

      const address = server.address();
      assert.ok(
        address !== null && typeof address === "object",
        "the loopback server did not report an address",
      );
      origin = `http://127.0.0.1:${String(address.port)}`;
    });

    after(async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    });

    it("refuses a request nobody mocked, even one that would have succeeded", async () => {
      // This request would return 200 if it were allowed through. It prints a
      // multi-line "[MSW] Error: intercepted a request without a matching
      // request handler" block to the console; that output is the assertion
      // passing, not a failure.
      await assert.rejects(
        fetch(`${origin}/not-mocked`),
        "an unmocked request reached a live server; the mock layer is not refusing unhandled requests",
      );
    });

    it("still serves the handlers it was given", async () => {
      // Guards against the opposite failure: a mock server so strict that it
      // refuses everything would pass the test above for a useless reason.
      const response = await fetch(`${MOCK_VIYA_BASE}/harness/echo`);
      assert.equal(response.status, 200);
    });
  });
});

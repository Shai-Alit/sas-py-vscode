// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  CURRENT_USER_PATH,
  IDENTITY_SUMMARY_TYPE,
} from "../../src/auth/identity";
import { liveTarget } from "../helpers/live-gate";

/**
 * A read-only smoke test that proves the live tier can reach a real Viya 4 and
 * authenticate. It deliberately tests nothing about the extension — there is
 * no client to test yet — and exists so the tier is proven end to end before
 * anything depends on it. Phase 5b replaces it with real client coverage.
 *
 * There is no Viya 3.5 equivalent here, and there will not be one until this
 * project has actually talked to a 3.5 deployment. An empty file is honest; a
 * test written from the documentation is a claim of support we have not earned.
 */
describe("live: Viya 4 connectivity", function () {
  const target = liveTarget("viya4");

  before(function () {
    if (!target) {
      this.skip();
    }
  });

  it("authenticates as the configured user", async function () {
    if (!target) {
      // Unreachable: the hook above skipped the suite. Present because the
      // compiler cannot see that, and a non-null assertion would be a worse
      // way to tell it.
      this.skip();
      return;
    }

    const response = await fetch(new URL(CURRENT_USER_PATH, target.baseUrl), {
      headers: {
        // Imported from the module under test rather than restated here.
        // This file originally asked for `application/vnd.sas.identity+json`
        // — the guess the service name invites, and the one finding 6 had
        // already measured as a **406**. Nothing caught it, because the tier
        // had never been run against a deployment until P33. Sharing the
        // constant is what stops the string drifting a second time.
        Accept: IDENTITY_SUMMARY_TYPE,
        Authorization: `Bearer ${target.token}`,
      },

      // CONTRIBUTING.md: every network call has a timeout and an abort path.
      // That rule applies to the tests that reach the network too — a live
      // suite that hangs is a live suite that gets killed by CI with no
      // useful output.
      signal: AbortSignal.timeout(15_000),
    });

    // The status and nothing else. The response body carries a real user's
    // identity and the request carried a bearer token; neither belongs in a
    // failure message, a CI log, or a screenshot pasted into an issue.
    assert.equal(
      response.status,
      200,
      `expected 200 from ${CURRENT_USER_PATH}, got ${String(response.status)}`,
    );

    const body: unknown = await response.json();
    assert.equal(
      typeof body === "object" && body !== null && "id" in body,
      true,
      "response had no id field",
    );
  });
});

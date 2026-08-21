// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { fetchCurrentUser } from "../../src/auth/identity";
import { liveTarget } from "../helpers/live-gate";

/**
 * A read-only smoke test that proves the live tier can reach a real Viya 4 and
 * authenticate. It deliberately tests nothing about the extension's own
 * *compute* path — there is no compute client to test yet — and exists so the
 * tier is proven end to end before anything depends on it, including for the
 * common configuration where `PYTHON_ON_VIYA_ALLOW_MUTATION` is not set and
 * `viya4-job.test.ts` (the other live suite) skips entirely. Phase 5b replaces
 * this with broader real-client coverage.
 *
 * **Ported onto `fetchCurrentUser` on 2026-08-20 (slice 3a-ii).** This file
 * used to hand-roll the same request with a bare `fetch` call — the same
 * defect class as a test that copies the logic under test rather than
 * exercising it, and the reason the 406-vs-summary-media-type fallback
 * finding 6 measured had to be re-derived here by hand instead of being
 * proven by the module that actually implements it. The RUNBOOK item that
 * flagged this named `createComputeClient` as the fix; that turned out not to
 * fit, because `/identities/users/@currentUser` is an identity-service
 * endpoint, not a `/compute/...` one, and `ComputeClient.send` only follows a
 * `Link` under ADR-0010 — it has no way to reach a path outside the Compute
 * service at all. `src/auth/identity.ts`'s `fetchCurrentUser` is the actual
 * production function for exactly this request, so this test now calls that
 * instead, and gets the summary/full media-type fallback for free rather than
 * asserting a media type header by hand.
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

    // CONTRIBUTING.md: every network call has a timeout and an abort path.
    // `fetchCurrentUser` applies its own default (15s) when none is given,
    // which is the value this file used to set by hand — passed explicitly
    // here so a future change to that default does not silently change what
    // this live suite is willing to wait for.
    const result = await fetchCurrentUser(
      { endpoint: target.baseUrl, accessToken: target.token },
      { timeoutMs: 15_000 },
    );

    // The failure code and nothing else. `AuthProblem`'s `identity-unavailable`
    // carries a `detail` string that can itself hold the endpoint or an
    // upstream error message — `live-gate.ts` is unambiguous that a live
    // failure message "may name the endpoint and the status code and nothing
    // else", and `detail` here is free text this test does not control.
    assert.ok(
      result.ok,
      `fetchCurrentUser failed: ${result.ok ? "" : result.problem.code}`,
    );

    // The response body carries a real user's identity and the request
    // carried a bearer token; neither belongs in a failure message, a CI log,
    // or a screenshot pasted into an issue — which is why only `id`'s
    // presence is asserted, never its value.
    assert.equal(typeof result.user.id, "string");
    assert.notEqual(result.user.id, "");
  });
});

// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { fetchCurrentUser } from "../../src/auth/identity";
import { liveTarget } from "../helpers/live-gate";

/**
 * The Viya 3.5 tier's scaffold: one read-only suite that makes
 * `liveTarget("viya35")` reachable from a real test and proves the clean-skip
 * path on a machine with no `PYTHON_ON_VIYA_TEST_VIYA35_*` pair set.
 *
 * **This project has never talked to a live Viya 3.5 deployment.** Everything
 * the extension does for 3.5 is written from the documented shape and the
 * upstream source, not from a probe — `docs/README.md`'s standing rule is that
 * no document (and, here, no test) may present 3.5 as *supported* while that is
 * still true. So this file deliberately asserts the narrowest thing that is
 * honest: that the gate resolves, that a bearer token reaches the identities
 * service, and that a user id comes back. It does **not** touch compute,
 * sessions, jobs or `PROC PYTHON` — a suite written from documentation for
 * those would look identical to one proven against a deployment and be worth
 * far less, which is the same reasoning `test/fixtures/viya35/` is empty for.
 *
 * `/identities/users/@currentUser` is the one endpoint the production code
 * already designs around 3.5's unknowns: `src/auth/identity.ts`'s
 * summary-then-full media-type fallback exists precisely because "whether 3.5
 * serves the summary type is unknown" (finding 6), and that fallback is "what
 * lets Viya 3.5 be *unverified* rather than *unsupported*". This suite is the
 * first thing that would actually exercise it against a real 3.5.
 *
 * **The first run against real 3.5 credentials is the verification**, exactly
 * as `viya4-connectivity.test.ts`'s first run on 2026-08-19 was for Viya 4 —
 * which failed, on the media type finding 6 records. Until that run happens
 * this suite skips everywhere, and a skip is the correct outcome rather than a
 * green tick earned from documentation. Broader 3.5 coverage is the job of
 * whoever has that deployment in front of them; this file only establishes
 * where it goes and how it is gated.
 *
 * Mirrors `viya4-connectivity.test.ts` in shape — read it for why the failure
 * message may name the endpoint and the status code and nothing else, and why
 * only the presence of `id` is asserted, never its value.
 */
describe("live: Viya 3.5 connectivity", function () {
  const target = liveTarget("viya35");

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
    // Passed explicitly — the same value `fetchCurrentUser` would apply by
    // default (15s) — so a future change to that default does not silently
    // change what this live suite is willing to wait for.
    const result = await fetchCurrentUser(
      { endpoint: target.baseUrl, accessToken: target.token },
      { timeoutMs: 15_000 },
    );

    // The failure code and nothing else. `AuthProblem`'s `identity-unavailable`
    // carries a `detail` string that can itself hold the endpoint or an
    // upstream message — `live-gate.ts` is unambiguous that a live failure
    // message "may name the endpoint and the status code and nothing else".
    //
    // If this is the run that first reaches a 3.5 deployment and it fails here,
    // suspect the identity media type before anything else: finding 6 measured
    // the summary type as a `406` on Viya 4 and `fetchCurrentUser` falls back
    // to the full type on exactly that status — a 3.5 that answers `406` for
    // *both* is the case that fallback cannot save, and the one worth
    // recording as a phase-5 finding.
    assert.ok(
      result.ok,
      `fetchCurrentUser failed: ${result.ok ? "" : result.problem.code}`,
    );

    // The response body carries a real user's identity and the request carried
    // a bearer token; neither belongs in a failure message, a CI log, or a
    // screenshot pasted into an issue — which is why only `id`'s presence is
    // asserted, never its value.
    assert.equal(typeof result.user.id, "string");
    assert.notEqual(result.user.id, "");
  });
});

// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import sinon from "sinon";

/**
 * These tests exist to prove the harness itself, not the extension. They are
 * the thing that fails when the compile step, the runner, or one of the two
 * libraries the suite depends on stops working — which is worth knowing
 * *before* a real test fails for a reason nobody can reproduce.
 */
describe("test harness", () => {
  it("runs a test written against node:assert/strict", () => {
    // node:assert/strict rather than an assertion library. It is already in
    // the runtime, its `deepEqual` is the strict one, and it removes a
    // dependency from a project whose whole premise is installing nothing.
    assert.deepEqual({ contexts: ["default"] }, { contexts: ["default"] });
    assert.throws(() => {
      assert.deepEqual({ a: 1 }, { a: "1" });
    });
  });

  it("gives sinon control of time, which every timeout test will need", () => {
    // CONTRIBUTING.md requires a timeout and an abort path on every network
    // call, so nearly every one of those will need a test that advances the
    // clock instead of waiting on it. Sinon ships as an ES module with a
    // `require` condition; this test is what catches a release that drops it.
    const clock = sinon.useFakeTimers();
    try {
      let fired = false;
      setTimeout(() => {
        fired = true;
      }, 30_000);

      assert.equal(fired, false, "the timer fired without the clock advancing");
      clock.tick(30_000);
      assert.equal(
        fired,
        true,
        "the timer did not fire when the clock reached it",
      );
    } finally {
      clock.restore();
    }
  });
});

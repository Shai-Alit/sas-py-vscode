// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { liveTarget, requireMutation } from "../helpers/live-gate";

/**
 * The live-tier gate is the one piece of test infrastructure that can cause
 * damage when it is wrong: a gate that opens by accident points a suite at
 * somebody's deployment. So it is unit-tested like production code, including
 * every refusal path.
 */
describe("live-tier gate", () => {
  let realEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    realEnv = process.env;
  });

  afterEach(() => {
    process.env = realEnv;
  });

  /**
   * Replaces the environment wholesale rather than setting individual keys.
   *
   * A test that only sets what it needs passes on a developer's machine that
   * happens to export `PYTHON_ON_VIYA_TEST_VIYA4_TOKEN` and fails in CI, or
   * worse, the other way round — and this is the one gate where a false pass
   * points a suite at a real deployment. Replacing the whole object is the only
   * way to assert what is *absent*.
   */
  function withEnv(vars: Record<string, string>): void {
    process.env = vars;
  }

  it("stays shut when nothing is configured", () => {
    withEnv({});
    assert.equal(liveTarget("viya4"), undefined);
  });

  it("refuses rather than skips when only half the credentials are present", () => {
    // Found during RUNBOOK P40: this used to return `undefined`, the same as
    // a wholly unconfigured machine, so a half-configured pair reported a
    // silent skip and exit 0. One variable present is evidence someone meant
    // to configure this generation, so the missing half is a misconfiguration
    // to surface, not one to skip past.
    withEnv({ PYTHON_ON_VIYA_TEST_VIYA4_URL: "https://viya.example.com" });
    assert.throws(
      () => liveTarget("viya4"),
      /PYTHON_ON_VIYA_TEST_VIYA4_URL is set but PYTHON_ON_VIYA_TEST_VIYA4_TOKEN is not/,
    );

    withEnv({ PYTHON_ON_VIYA_TEST_VIYA4_TOKEN: "not-a-real-token" });
    assert.throws(
      () => liveTarget("viya4"),
      /PYTHON_ON_VIYA_TEST_VIYA4_TOKEN is set but PYTHON_ON_VIYA_TEST_VIYA4_URL is not/,
    );
  });

  it("treats a blank value as absent, including for the half-configured refusal", () => {
    withEnv({
      PYTHON_ON_VIYA_TEST_VIYA4_URL: "  ",
      PYTHON_ON_VIYA_TEST_VIYA4_TOKEN: "not-a-real-token",
    });
    // A blank URL is absent, not present-but-empty, so this is the same
    // half-configured case as the test above rather than a third outcome.
    assert.throws(
      () => liveTarget("viya4"),
      /PYTHON_ON_VIYA_TEST_VIYA4_TOKEN is set but PYTHON_ON_VIYA_TEST_VIYA4_URL is not/,
    );
  });

  it("stays shut when nothing at all is present for one generation", () => {
    withEnv({
      PYTHON_ON_VIYA_TEST_VIYA4_URL: "  ",
      PYTHON_ON_VIYA_TEST_VIYA4_TOKEN: "   ",
    });
    assert.equal(liveTarget("viya4"), undefined);
  });

  it("refuses to send a bearer token over plaintext HTTP", () => {
    withEnv({
      PYTHON_ON_VIYA_TEST_VIYA4_URL: "http://viya.example.com",
      PYTHON_ON_VIYA_TEST_VIYA4_TOKEN: "not-a-real-token",
    });
    assert.throws(() => liveTarget("viya4"), /https/);
  });

  it("trims trailing slashes so callers can join paths safely", () => {
    withEnv({
      PYTHON_ON_VIYA_TEST_VIYA4_URL: "https://viya.example.com///",
      PYTHON_ON_VIYA_TEST_VIYA4_TOKEN: "not-a-real-token",
    });
    assert.equal(liveTarget("viya4")?.baseUrl, "https://viya.example.com");
  });

  it("keeps mutation shut off unless it is asked for explicitly", () => {
    for (const value of ["", "0", "true", "yes", "ALLOW"]) {
      withEnv({
        PYTHON_ON_VIYA_TEST_VIYA4_URL: "https://viya.example.com",
        PYTHON_ON_VIYA_TEST_VIYA4_TOKEN: "not-a-real-token",
        PYTHON_ON_VIYA_ALLOW_MUTATION: value,
      });
      const target = liveTarget("viya4");
      assert.ok(target);
      assert.equal(
        target.allowMutation,
        false,
        `PYTHON_ON_VIYA_ALLOW_MUTATION=${JSON.stringify(value)} opened the mutation gate`,
      );
      assert.throws(() => {
        requireMutation(target);
      }, /PYTHON_ON_VIYA_ALLOW_MUTATION/);
    }
  });

  it("opens the mutation gate for exactly one value", () => {
    withEnv({
      PYTHON_ON_VIYA_TEST_VIYA4_URL: "https://viya.example.com",
      PYTHON_ON_VIYA_TEST_VIYA4_TOKEN: "not-a-real-token",
      PYTHON_ON_VIYA_ALLOW_MUTATION: "1",
    });
    const target = liveTarget("viya4");
    assert.ok(target);
    assert.equal(target.allowMutation, true);
    assert.doesNotThrow(() => {
      requireMutation(target);
    });
  });
});

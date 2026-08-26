// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  isRunTargetKind,
  resolveRunTargetKind,
  runReadiness,
  runTargetPickEntries,
  type RunTargetStatus,
} from "../../src/run/target";

describe("run/target", () => {
  describe("isRunTargetKind", () => {
    it("accepts the two known values", () => {
      assert.equal(isRunTargetKind("local"), true);
      assert.equal(isRunTargetKind("viya"), true);
    });

    it("rejects anything else", () => {
      assert.equal(isRunTargetKind(undefined), false);
      assert.equal(isRunTargetKind(""), false);
      assert.equal(isRunTargetKind("Local"), false);
      assert.equal(isRunTargetKind(42), false);
    });
  });

  describe("resolveRunTargetKind", () => {
    it("passes a known value through", () => {
      assert.equal(resolveRunTargetKind("local"), "local");
      assert.equal(resolveRunTargetKind("viya"), "viya");
    });

    it("defaults to viya for anything unrecognised, per ADR-0011", () => {
      assert.equal(resolveRunTargetKind(undefined), "viya");
      assert.equal(resolveRunTargetKind("nonsense"), "viya");
      assert.equal(resolveRunTargetKind(null), "viya");
    });
  });

  describe("runReadiness", () => {
    it("is ready when viya and a profile is active", () => {
      const status: RunTargetStatus = { kind: "viya", profileName: "verde" };
      assert.deepEqual(runReadiness(status), {
        ok: true,
        profileName: "verde",
      });
    });

    it("refuses with 'local' when the target is Local", () => {
      assert.deepEqual(runReadiness({ kind: "local" }), {
        ok: false,
        reason: "local",
      });
    });

    it("refuses with 'no-profile' when viya has no active profile", () => {
      assert.deepEqual(runReadiness({ kind: "viya" }), {
        ok: false,
        reason: "no-profile",
      });
    });
  });

  describe("runTargetPickEntries", () => {
    it("always leads with Local Python", () => {
      const entries = runTargetPickEntries([], { kind: "local" });
      assert.deepEqual(entries, [{ kind: "local", current: true }]);
    });

    it("lists every profile after Local, in the given order", () => {
      const entries = runTargetPickEntries(["verde", "prod"], {
        kind: "viya",
        profileName: "prod",
      });
      assert.deepEqual(entries, [
        { kind: "local", current: false },
        { kind: "viya", profileName: "verde", current: false },
        { kind: "viya", profileName: "prod", current: true },
      ]);
    });

    it("marks nothing current when the active profile is not in the list", () => {
      // A stale window choice pointing at a since-deleted profile — the same
      // "falls through rather than resolving to nothing" shape
      // `resolveActiveProfile` gives a deleted profile elsewhere.
      const entries = runTargetPickEntries(["verde"], {
        kind: "viya",
        profileName: "deleted",
      });
      assert.deepEqual(entries, [
        { kind: "local", current: false },
        { kind: "viya", profileName: "verde", current: false },
      ]);
    });
  });
});

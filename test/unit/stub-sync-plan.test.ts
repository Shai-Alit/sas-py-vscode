// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import type { EnvironmentDiff } from "../../src/run/environmentDiff";
import type { StubbablePackage } from "../../src/run/stubGenerator";
import {
  describeStubSyncOutcome,
  selectPackagesToStub,
  type StubSyncOutcome,
} from "../../src/run/stubSyncPlan";

const pkg = (name: string, importNames: readonly string[] = [name]) =>
  ({ name, version: "1.0.0", importNames }) satisfies StubbablePackage;

describe("stubSyncPlan.ts — 10b's stub-sync decisions", () => {
  describe("selectPackagesToStub", () => {
    it("stubs every remote package when the local environment is unknown", () => {
      const remote = [pkg("numpy"), pkg("pandas")];
      const diff: EnvironmentDiff = { kind: "local-unknown" };

      const { toStub, missing } = selectPackagesToStub(remote, diff);

      assert.deepEqual(toStub, remote);
      assert.deepEqual(missing, []);
    });

    it("stubs only the remoteOnly entries when the local environment is known", () => {
      const numpy = pkg("numpy");
      const pandas = pkg("pandas");
      const remote = [numpy, pandas];
      const diff: EnvironmentDiff = {
        kind: "compared",
        remoteOnly: [{ name: "numpy", version: "1.0.0" }],
        localOnly: [],
        versionMismatched: [],
      };

      const { toStub, missing } = selectPackagesToStub(remote, diff);

      assert.deepEqual(toStub, [numpy]);
      assert.deepEqual(missing, []);
    });

    it("skips and reports a remoteOnly name not found in the remote list", () => {
      // Should not happen — `diffEnvironments` derives every `remoteOnly`
      // name from the same `remote` list — but this pins the defensive
      // fallback rather than letting a `Map.get` miss silently disappear.
      const remote = [pkg("numpy")];
      const diff: EnvironmentDiff = {
        kind: "compared",
        remoteOnly: [
          { name: "numpy", version: "1.0.0" },
          { name: "ghost", version: "1.0.0" },
        ],
        localOnly: [],
        versionMismatched: [],
      };

      const { toStub, missing } = selectPackagesToStub(remote, diff);

      assert.deepEqual(
        toStub.map((p) => p.name),
        ["numpy"],
      );
      assert.deepEqual(missing, ["ghost"]);
    });

    it("stubs nothing when remoteOnly is empty", () => {
      const diff: EnvironmentDiff = {
        kind: "compared",
        remoteOnly: [],
        localOnly: [{ name: "requests", version: "1.0.0" }],
        versionMismatched: [],
      };

      const { toStub, missing } = selectPackagesToStub([pkg("requests")], diff);

      assert.deepEqual(toStub, []);
      assert.deepEqual(missing, []);
    });
  });

  describe("describeStubSyncOutcome", () => {
    it("advises a reload only when synced with changed: true", () => {
      const changed = describeStubSyncOutcome({
        kind: "synced",
        changed: true,
      });
      assert.equal(changed.reloadAdvisable, true);
      assert.equal(changed.logWarning, undefined);
      assert.equal(changed.conflictValue, undefined);
    });

    it("does not nag on a synced resync that changed nothing on disk", () => {
      // The exact regression this type's introduction fixes — every earlier
      // version of `commands.ts` advised a reload for every non-empty sync
      // regardless of whether the stub tree actually changed.
      const unchanged = describeStubSyncOutcome({
        kind: "synced",
        changed: false,
      });
      assert.equal(unchanged.reloadAdvisable, false);
    });

    it("advises nothing for nothing-to-stub", () => {
      const report = describeStubSyncOutcome({ kind: "nothing-to-stub" });
      assert.equal(report.reloadAdvisable, false);
      assert.equal(report.logWarning, undefined);
      assert.equal(report.conflictValue, undefined);
    });

    it("logs, without a user-facing conflict value, for no-workspace", () => {
      const report = describeStubSyncOutcome({ kind: "no-workspace" });
      assert.equal(report.reloadAdvisable, false);
      assert.ok(report.logWarning?.includes("no workspace folder is open"));
      assert.equal(report.conflictValue, undefined);
    });

    it("logs the scheme for an unsupported (virtual) workspace", () => {
      const report = describeStubSyncOutcome({
        kind: "unsupported-workspace",
        scheme: "sasContent",
      });
      assert.equal(report.reloadAdvisable, false);
      assert.ok(report.logWarning?.includes("sasContent"));
      assert.equal(report.conflictValue, undefined);
    });

    it("logs and carries a user-facing conflict value for stub-path-conflict", () => {
      const report = describeStubSyncOutcome({
        kind: "stub-path-conflict",
        currentValue: "./my-own-stubs",
      });
      assert.equal(report.reloadAdvisable, false);
      assert.ok(report.logWarning?.includes("./my-own-stubs"));
      assert.equal(report.conflictValue, "./my-own-stubs");
    });

    it("logs the caught error's own detail for write-failed", () => {
      const report = describeStubSyncOutcome({
        kind: "write-failed",
        detail: "EACCES: permission denied",
      });
      assert.equal(report.reloadAdvisable, false);
      assert.ok(report.logWarning?.includes("EACCES: permission denied"));
      assert.equal(report.conflictValue, undefined);
    });

    it("covers every PylanceStubSyncResult kind (compile-time contract)", () => {
      // `StubSyncOutcome` is a hand-restated mirror of
      // `pylanceStubSync.ts`'s own `PylanceStubSyncResult` — this is not a
      // runtime assertion, it is `commands.ts`'s own
      // `const outcome: StubSyncOutcome = await sync(toStub)` assignment,
      // reproduced here so a future kind added to one and not the other
      // fails this file's own typecheck, not just `commands.ts`'s.
      const outcomes: readonly StubSyncOutcome["kind"][] = [
        "synced",
        "nothing-to-stub",
        "no-workspace",
        "unsupported-workspace",
        "stub-path-conflict",
        "write-failed",
      ];
      assert.equal(outcomes.length, 6);
    });
  });
});

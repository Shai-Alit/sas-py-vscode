// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { syncPylanceStubs } from "../../../src/run/pylanceStubSync";

/**
 * This suite's own host (`test/integration/runTest.ts`) launches VS Code
 * with no folder open, so `vscode.workspace.workspaceFolders` is always
 * `undefined` here — the same reason no other integration test in this
 * repository exercises a real `workspaceFolders`-dependent path. That makes
 * `"no-workspace"` the one outcome reachable from this tier; the
 * `"synced"`/`"stub-path-conflict"`/write-failure paths need a real open
 * workspace, which only a hands-on VS Code session
 * (`docs/dev/manual-tests/phase-10.md`) can provide — `pylanceStubSync.ts`'s
 * own doc comment on why it stays a thin, mostly-untested-by-design shell
 * (the same `localPythonEnvironment.ts`/ADR-0021 discipline
 * `check-coverage-scope.mjs` already documents) explains why that gap is
 * accepted rather than worked around here. `stubGenerator.ts`'s and
 * `stubPathSetting.ts`'s own unit suites cover every actual decision this
 * module makes; what is left here is only real `vscode` API wiring.
 */
describe("syncPylanceStubs — 10b's stub tree + stubPath sync", () => {
  it("degrades to no-workspace, never throws, when no folder is open", async () => {
    const result = await syncPylanceStubs([
      { name: "numpy", version: "2.0.0", importNames: ["numpy"] },
    ]);
    assert.deepEqual(result, { kind: "no-workspace" });
  });

  it("degrades to no-workspace for an empty package list too", async () => {
    const result = await syncPylanceStubs([]);
    assert.deepEqual(result, { kind: "no-workspace" });
  });
});

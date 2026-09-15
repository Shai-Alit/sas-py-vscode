// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { decideStubPathAction } from "../../src/run/stubPathSetting";

describe("stubPathSetting.ts — 10b's stubPath write guard", () => {
  it("writes when nothing is set at workspace scope", () => {
    assert.deepEqual(decideStubPathAction(undefined, ".pythonOnViya/typings"), {
      kind: "write",
    });
  });

  it("is a no-op when the workspace value already matches (a repeat sync)", () => {
    assert.deepEqual(
      decideStubPathAction(".pythonOnViya/typings", ".pythonOnViya/typings"),
      { kind: "already-ours" },
    );
  });

  it("refuses to overwrite a workspace value that points somewhere else", () => {
    assert.deepEqual(
      decideStubPathAction("./my-own-stubs", ".pythonOnViya/typings"),
      { kind: "conflict", currentValue: "./my-own-stubs" },
    );
  });
});

// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  decideStubPathAction,
  type InspectedStubPathValues,
} from "../../src/run/stubPathSetting";

const UNSET: InspectedStubPathValues = {
  globalValue: undefined,
  workspaceValue: undefined,
  workspaceFolderValue: undefined,
};

describe("stubPathSetting.ts — 10b's stubPath write guard", () => {
  it("writes when nothing is set at any scope", () => {
    assert.deepEqual(decideStubPathAction(UNSET, ".pythonOnViya/typings"), {
      kind: "write",
    });
  });

  it("is a no-op when the workspace value already matches (a repeat sync)", () => {
    assert.deepEqual(
      decideStubPathAction(
        { ...UNSET, workspaceValue: ".pythonOnViya/typings" },
        ".pythonOnViya/typings",
      ),
      { kind: "already-ours" },
    );
  });

  it("refuses to overwrite a workspace value that points somewhere else", () => {
    assert.deepEqual(
      decideStubPathAction(
        { ...UNSET, workspaceValue: "./my-own-stubs" },
        ".pythonOnViya/typings",
      ),
      { kind: "conflict", currentValue: "./my-own-stubs" },
    );
  });

  it("refuses to overwrite a value set only at user (global) scope — the Codex PR #182 finding", () => {
    assert.deepEqual(
      decideStubPathAction(
        { ...UNSET, globalValue: "./my-own-stubs" },
        ".pythonOnViya/typings",
      ),
      { kind: "conflict", currentValue: "./my-own-stubs" },
    );
  });

  it("refuses to overwrite a value set only at workspace-folder scope", () => {
    assert.deepEqual(
      decideStubPathAction(
        { ...UNSET, workspaceFolderValue: "./my-own-stubs" },
        ".pythonOnViya/typings",
      ),
      { kind: "conflict", currentValue: "./my-own-stubs" },
    );
  });

  it("prefers the higher-precedence scope's value when more than one is set", () => {
    assert.deepEqual(
      decideStubPathAction(
        {
          globalValue: "./global-stubs",
          workspaceValue: "./workspace-stubs",
          workspaceFolderValue: undefined,
        },
        ".pythonOnViya/typings",
      ),
      { kind: "conflict", currentValue: "./workspace-stubs" },
    );
  });
});

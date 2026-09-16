// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import * as vscode from "vscode";

import {
  namesOwningTopLevel,
  syncPylanceStubs,
  writeStubTree,
  type RealFs,
} from "../../../src/run/pylanceStubSync";
import type { StubbablePackage } from "../../../src/run/stubGenerator";

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

/**
 * `namesOwningTopLevel` — the extension-stripping/file-type logic
 * `RealFs.listWorkspaceRootNames`'s real implementation uses, pinned
 * directly against fixture `readDirectory` tuples. A PR #182 review round
 * found the first version only recognised `.py`, so a workspace's own
 * top-level `.pyi` file (a common "types only" package shape) was never
 * added to the excluded-names set at all — this suite exists so that
 * regression, and its sibling cases, cannot come back unnoticed.
 */
describe("namesOwningTopLevel — which real workspace-root entries a generated stub must not shadow", () => {
  const dir = (name: string): readonly [string, vscode.FileType] => [
    name,
    vscode.FileType.Directory,
  ];
  const file = (name: string): readonly [string, vscode.FileType] => [
    name,
    vscode.FileType.File,
  ];

  it("includes a directory name as-is", () => {
    assert.deepEqual(namesOwningTopLevel([dir("numpy")]), ["numpy"]);
  });

  it("strips the .py extension off a single-file module", () => {
    assert.deepEqual(namesOwningTopLevel([file("six.py")]), ["six"]);
  });

  it("strips the .pyi extension off a hand-authored top-level stub file", () => {
    // The exact gap the review found: a types-only package shipped as a
    // bare `mypkg.pyi` at the workspace root, with no `.py` counterpart.
    assert.deepEqual(namesOwningTopLevel([file("mypkg.pyi")]), ["mypkg"]);
  });

  it("does not double-count a package that has both a .py and a .pyi at the top level", () => {
    const names = [...namesOwningTopLevel([file("six.py"), file("six.pyi")])];
    names.sort();
    assert.deepEqual(names, ["six", "six"]);
  });

  it("ignores a file that is neither .py nor .pyi", () => {
    assert.deepEqual(namesOwningTopLevel([file("README.md")]), []);
  });

  it("ignores a symlink or other non-file, non-directory entry", () => {
    const symlink: readonly [string, vscode.FileType] = [
      "odd",
      vscode.FileType.SymbolicLink,
    ];
    assert.deepEqual(namesOwningTopLevel([symlink]), []);
  });

  it("handles a mixed real-world listing correctly", () => {
    const names = [
      ...namesOwningTopLevel([
        dir("mypkg"),
        file("six.py"),
        file("typesonly.pyi"),
        file("README.md"),
        file(".gitignore"),
      ]),
    ];
    names.sort();
    assert.deepEqual(names, ["mypkg", "six", "typesonly"]);
  });
});

/**
 * `writeStubTree` — exercised directly against a fake {@link RealFs}. Unlike
 * `syncPylanceStubs` above, this needs no real open workspace: `workspaceRoot`
 * and `stubRoot` are plain `vscode.Uri` values this suite constructs itself,
 * and every filesystem operation goes through the injected fake. This closes
 * most of the gap a PR #182 review round found (write ordering, the
 * delete-recursive prune path, and the `nothing-to-write` early exit were all
 * previously untested) — what is still not reachable here is
 * `syncPylanceStubs`'s own `stubPath`-conflict decision and its `.update()`
 * call, both gated on a real `vscode.workspace.workspaceFolders` this
 * project's shared integration host does not open (this file's own top-of-
 * suite comment explains why). That remaining gap is a described, deferred
 * item — closing it means opening a real workspace folder in
 * `runTest.ts`, which every other integration suite in this repository
 * shares, not something to change unilaterally in one feature's own test
 * file.
 */
describe("writeStubTree — the stub-tree write/prune logic pylanceStubSync.ts uses", () => {
  const workspaceRoot = vscode.Uri.file("/fake-workspace");
  const stubRoot = vscode.Uri.joinPath(workspaceRoot, ".pythonOnViya/typings");

  const numpy: StubbablePackage = {
    name: "numpy",
    version: "2.0.0",
    importNames: ["numpy"],
  };

  function fakeRealFs(
    initial: {
      readonly topLevelDirectories?: readonly string[];
      readonly workspaceRootNames?: readonly string[];
    } = {},
  ): { readonly fs: RealFs; readonly events: string[] } {
    const events: string[] = [];
    const fs: RealFs = {
      listTopLevelDirectories: () =>
        Promise.resolve(initial.topLevelDirectories ?? []),
      listWorkspaceRootNames: () =>
        Promise.resolve(initial.workspaceRootNames ?? []),
      createDirectory: (uri) => {
        events.push(`mkdir:${uri.path}`);
        return Promise.resolve();
      },
      writeFile: (uri) => {
        events.push(`write:${uri.path}`);
        return Promise.resolve();
      },
      deleteRecursively: (uri) => {
        events.push(`delete:${uri.path}`);
        return Promise.resolve();
      },
    };
    return { fs, events };
  }

  it("writes a stub file and a .gitignore alongside the tree, and reports changed:true", async () => {
    const { fs, events } = fakeRealFs();

    const changed = await writeStubTree(workspaceRoot, stubRoot, [numpy], fs);

    assert.equal(changed, true);
    assert.ok(
      events.some((e) => e === `write:${stubRoot.path}/numpy/__init__.pyi`),
      `expected a write for the numpy stub; got: ${JSON.stringify(events)}`,
    );
    assert.ok(
      events.some((e) => e.endsWith(".pythonOnViya/.gitignore")),
      `expected a .gitignore write; got: ${JSON.stringify(events)}`,
    );
    // The stub file is written before the .gitignore — the tree's own
    // content is what matters; the .gitignore is a courtesy added once
    // there is something worth ignoring.
    const stubWriteIndex = events.findIndex((e) => e.endsWith("__init__.pyi"));
    const gitignoreWriteIndex = events.findIndex((e) =>
      e.endsWith(".gitignore"),
    );
    assert.ok(stubWriteIndex >= 0 && gitignoreWriteIndex >= 0);
    assert.ok(stubWriteIndex < gitignoreWriteIndex);
  });

  it("prunes a stale top-level directory no longer in the desired set", async () => {
    const { fs, events } = fakeRealFs({ topLevelDirectories: ["oldpkg"] });

    const changed = await writeStubTree(workspaceRoot, stubRoot, [numpy], fs);

    assert.equal(changed, true);
    assert.ok(
      events.some((e) => e === `delete:${stubRoot.path}/oldpkg`),
      `expected oldpkg to be deleted; got: ${JSON.stringify(events)}`,
    );
    // Pruning happens ahead of writing the new tree.
    const deleteIndex = events.indexOf(`delete:${stubRoot.path}/oldpkg`);
    const writeIndex = events.findIndex((e) => e.startsWith("write:"));
    assert.ok(deleteIndex < writeIndex);
  });

  it("writes nothing at all — including no .gitignore — when there is nothing to stub and nothing to prune", async () => {
    const { fs, events } = fakeRealFs();

    const changed = await writeStubTree(workspaceRoot, stubRoot, [], fs);

    assert.equal(changed, false);
    assert.deepEqual(events, []);
  });

  it("reports changed:true when pruning to an empty tree, but still writes no .gitignore", async () => {
    // The exact `StubTreeSyncPlan.changed` regression `stubGenerator.ts`'s
    // own doc comment describes: nothing left to stub is not the same
    // question as nothing changed.
    const { fs, events } = fakeRealFs({ topLevelDirectories: ["stale"] });

    const changed = await writeStubTree(workspaceRoot, stubRoot, [], fs);

    assert.equal(changed, true);
    assert.ok(events.some((e) => e === `delete:${stubRoot.path}/stale`));
    assert.ok(
      !events.some((e) => e.endsWith(".gitignore")),
      "a prune-only sync leaves nothing behind for a .gitignore to protect",
    );
  });

  it("excludes a package whose top-level name the workspace root already owns", async () => {
    const { fs, events } = fakeRealFs({ workspaceRootNames: ["numpy"] });

    const changed = await writeStubTree(workspaceRoot, stubRoot, [numpy], fs);

    assert.equal(changed, false);
    assert.deepEqual(events, []);
  });

  it("serialises concurrent syncPylanceStubs calls rather than interleaving their filesystem operations", async () => {
    // No real open workspace here either (see this suite's own top comment),
    // so both calls degrade to "no-workspace" — but that still exercises
    // `runSerialisedAfterAnyPriorSync`'s own queuing: the second call must
    // not reject or hang behind the first, and both must resolve to their
    // own correct, independent result.
    const [first, second] = await Promise.all([
      syncPylanceStubs([numpy]),
      syncPylanceStubs([]),
    ]);
    assert.deepEqual(first, { kind: "no-workspace" });
    assert.deepEqual(second, { kind: "no-workspace" });
  });
});

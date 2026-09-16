// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  excludeWorkspaceOwnedNames,
  generateStubTree,
  planStubTreeSync,
  type StubbablePackage,
} from "../../src/run/stubGenerator";

const pkg = (
  name: string,
  version: string,
  importNames: readonly string[],
): StubbablePackage => ({ name, version, importNames });

describe("stubGenerator.ts — 10b's Pylance stub tree", () => {
  describe("generateStubTree", () => {
    it("generates one <import-name>/__init__.pyi per package", () => {
      const files = generateStubTree([pkg("numpy", "2.0.0", ["numpy"])]);
      assert.deepEqual(
        files.map((file) => file.relativePath),
        ["numpy/__init__.pyi"],
      );
      assert.ok(files[0]?.content.includes("numpy 2.0.0"));
      assert.ok(
        files[0]?.content.includes("def __getattr__(name: str) -> Any: ..."),
      );
    });

    it("uses the import name, not the distribution name, when they differ", () => {
      // Pillow installs as PIL — the exact mismatch Finding 10.2's design
      // correction (`phase-10.md`) exists for.
      const files = generateStubTree([pkg("Pillow", "11.0.0", ["PIL"])]);
      assert.deepEqual(
        files.map((file) => file.relativePath),
        ["PIL/__init__.pyi"],
      );
    });

    it("generates one file per import name when a distribution provides several", () => {
      const files = generateStubTree([
        pkg("PyYAML", "6.0.3", ["_yaml", "yaml"]),
      ]);
      assert.deepEqual(files.map((file) => file.relativePath).sort(), [
        "_yaml/__init__.pyi",
        "yaml/__init__.pyi",
      ]);
    });

    it("stubs only the top-level segment of a dotted (namespace-package) import name", () => {
      // A catch-all `google/__init__.pyi` cannot make `google.protobuf`
      // resolve as a submodule — see this module's own doc comment, "Why one
      // path segment, not the dotted import name in full". Still stubs the
      // top-level name itself, which is the honest claim this feature makes.
      const files = generateStubTree([
        pkg("protobuf", "5.0.0", ["google.protobuf"]),
      ]);
      assert.deepEqual(
        files.map((file) => file.relativePath),
        ["google/__init__.pyi"],
      );
    });

    it("skips an import name that is not a legal Python identifier", () => {
      const files = generateStubTree([
        pkg("oddpkg", "1.0.0", ["", "not-an-identifier", "9startswithdigit"]),
      ]);
      assert.deepEqual(files, []);
    });

    it("de-duplicates when two packages claim the same top-level import name, deterministically", () => {
      const files = generateStubTree([
        pkg("zzz-later", "1.0.0", ["shared"]),
        pkg("aaa-first", "1.0.0", ["shared"]),
      ]);
      assert.equal(files.length, 1);
      // Packages are sorted by name before assignment, so "aaa-first" (first
      // alphabetically) wins the shared name — deterministic regardless of
      // the input array's own order.
      assert.ok(files[0]?.content.includes("aaa-first 1.0.0"));
    });

    it("sorts the result by path, for a deterministic write order", () => {
      const files = generateStubTree([
        pkg("zzz", "1.0.0", ["zzz"]),
        pkg("aaa", "1.0.0", ["aaa"]),
        pkg("mmm", "1.0.0", ["mmm"]),
      ]);
      assert.deepEqual(
        files.map((file) => file.relativePath),
        ["aaa/__init__.pyi", "mmm/__init__.pyi", "zzz/__init__.pyi"],
      );
    });

    it("returns nothing for an empty package list", () => {
      assert.deepEqual(generateStubTree([]), []);
    });

    it("returns nothing for a package with no import names", () => {
      assert.deepEqual(generateStubTree([pkg("oddpkg", "1.0.0", [])]), []);
    });

    it("strips control characters (including newlines) from name/version before they reach the generated comment", () => {
      // `name`/`version` come from Viya's own probe (`importlib.metadata`,
      // never character-validated) — a newline in either would otherwise let
      // that text escape the `#` comment line as literal file content.
      const files = generateStubTree([
        pkg("num\r\npy", "2.0.0\n# not a real comment", ["numpy"]),
      ]);
      const content = files[0]?.content ?? "";
      assert.ok(!content.includes("\r"));
      const lines = content.split("\n");
      // Every line before the blank separator must still start with `#` or
      // be blank/code — none may be attacker-controlled content that
      // escaped the first comment line.
      assert.ok(lines[0]?.startsWith("#"));
      assert.ok(lines[0]?.includes("num  py"));
      assert.ok(lines[0]?.includes("2.0.0 # not a real comment"));
    });
  });

  describe("planStubTreeSync", () => {
    it("writes every desired file, always — content is cheap to regenerate", () => {
      const desired = generateStubTree([pkg("numpy", "2.0.0", ["numpy"])]);
      const plan = planStubTreeSync(["numpy"], desired);
      assert.deepEqual(plan.toWrite, desired);
    });

    it("deletes a top-level directory no longer in the desired set", () => {
      // A package that was remoteOnly last refresh and no longer is — removed
      // from Viya, or now resolves locally too — must not leave its stale
      // stub behind (Finding 10.2's shadowing risk, if it were left in place
      // for a package that has since started resolving locally).
      const plan = planStubTreeSync(["numpy", "pandas"], []);
      assert.deepEqual(plan.toDelete, ["numpy", "pandas"]);
    });

    it("deletes only what is absent from the desired set, keeping the rest", () => {
      const desired = generateStubTree([pkg("numpy", "2.0.0", ["numpy"])]);
      const plan = planStubTreeSync(["numpy", "stale"], desired);
      assert.deepEqual(plan.toDelete, ["stale"]);
    });

    it("deletes nothing when the existing listing is empty", () => {
      const desired = generateStubTree([pkg("numpy", "2.0.0", ["numpy"])]);
      const plan = planStubTreeSync([], desired);
      assert.deepEqual(plan.toDelete, []);
    });

    it("reports changed when a desired name is not already on disk", () => {
      const desired = generateStubTree([pkg("numpy", "2.0.0", ["numpy"])]);
      const plan = planStubTreeSync([], desired);
      assert.equal(plan.changed, true);
    });

    it("reports changed when a stale directory would be deleted", () => {
      const plan = planStubTreeSync(["stale"], []);
      assert.equal(plan.changed, true);
    });

    it("reports unchanged when the desired set already matches what's on disk", () => {
      // `toWrite` always carries the full desired set regardless (this
      // type's own doc comment) — `changed` is specifically about the
      // top-level directory listing, not about `toWrite` being non-empty,
      // so a resync of an already-up-to-date tree must not report changed.
      const desired = generateStubTree([pkg("numpy", "2.0.0", ["numpy"])]);
      const plan = planStubTreeSync(["numpy"], desired);
      assert.equal(plan.changed, false);
    });

    it("reports unchanged when both sides are empty", () => {
      const plan = planStubTreeSync([], []);
      assert.equal(plan.changed, false);
    });
  });

  describe("excludeWorkspaceOwnedNames", () => {
    it("drops a generated stub whose top-level name is a real workspace directory", () => {
      const files = generateStubTree([pkg("tests-viya", "1.0.0", ["tests"])]);
      const result = excludeWorkspaceOwnedNames(files, ["tests"]);
      assert.deepEqual(result, []);
    });

    it("drops a generated stub whose top-level name is a real workspace .py file", () => {
      // `listWorkspaceRootNames` (`pylanceStubSync.ts`) strips the `.py`
      // extension before handing names here — this asserts the exclusion
      // itself matches on the bare name it is given, trusting the caller
      // for the stripping.
      const files = generateStubTree([pkg("sixlib", "1.0.0", ["six"])]);
      const result = excludeWorkspaceOwnedNames(files, ["six"]);
      assert.deepEqual(result, []);
    });

    it("keeps a generated stub whose name does not collide", () => {
      const files = generateStubTree([pkg("numpy", "2.0.0", ["numpy"])]);
      const result = excludeWorkspaceOwnedNames(files, ["tests", "six"]);
      assert.deepEqual(result, files);
    });

    it("keeps everything when the workspace root has no names to exclude", () => {
      const files = generateStubTree([pkg("numpy", "2.0.0", ["numpy"])]);
      assert.deepEqual(excludeWorkspaceOwnedNames(files, []), files);
    });

    it("excludes only the colliding entry, keeping the rest", () => {
      const files = generateStubTree([
        pkg("numpy", "2.0.0", ["numpy"]),
        pkg("tests-viya", "1.0.0", ["tests"]),
      ]);
      const result = excludeWorkspaceOwnedNames(files, ["tests"]);
      assert.deepEqual(
        result.map((file) => file.relativePath),
        ["numpy/__init__.pyi"],
      );
    });

    it("drops a collision that differs only in case — Windows and default macOS resolve it as the same directory", () => {
      const files = generateStubTree([pkg("mylib-viya", "1.0.0", ["mylib"])]);
      const result = excludeWorkspaceOwnedNames(files, ["MyLib"]);
      assert.deepEqual(result, []);
    });
  });
});

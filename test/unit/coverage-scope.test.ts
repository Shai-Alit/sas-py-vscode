// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import path from "node:path";

import { loadScript } from "../helpers/load-script";

interface CheckInput {
  excludes: string[];
  sources: string[];
  read: (file: string) => string;
}

// Property signatures rather than methods, as in secret-scan.test.ts: these are
// plain functions read off a module namespace.
interface CheckCoverageScope {
  importsHostModule: (source: string, fileName?: string) => boolean;
  sourceExcludes: (exclude: string[]) => string[];
  check: (input: CheckInput) => string[];
  checkRepository: (root: string) => string[];
}

/**
 * The check that keeps the coverage exclude list honest.
 *
 * `.c8rc.json` drops the `vscode`-importing modules out of the unit coverage
 * denominator, and an exclude list is the classic place to bury code you would
 * rather not test. What makes it defensible is that the list is derived from a
 * rule — excluded if and only if the module imports `vscode` — and that the
 * rule is checked. So these tests are less about the script than about the
 * rule: the cases below are the ways the rule can be wrong.
 *
 * The last describe block is the one that will actually fire one day. It runs
 * the check against this repository, so adding a shell module without updating
 * the list fails here, by name, rather than showing up a step later as an
 * unexplained drop in a percentage.
 */
describe("check-coverage-scope", () => {
  let script: CheckCoverageScope;

  before(async () => {
    script = await loadScript<CheckCoverageScope>("check-coverage-scope.mjs");
  });

  describe("importsHostModule", () => {
    // Every form that leaves a `require("vscode")` in the emitted JavaScript.
    const runtime = {
      namespace: 'import * as vscode from "vscode";',
      named: 'import { window } from "vscode";',
      default: 'import vscode from "vscode";',
      "side-effect only": 'import "vscode";',
      "mixed default and type": 'import vscode, { type Uri } from "vscode";',
      "re-export": 'export { window } from "vscode";',
      "import equals": 'import vscode = require("vscode");',
      "deferred dynamic import":
        'async function f() { return await import("vscode"); }',
      "deferred require": 'function f() { return require("vscode"); }',
      "single quotes": "import { window } from 'vscode';",
    };

    for (const [name, source] of Object.entries(runtime)) {
      it(`sees a ${name} import`, () => {
        assert.equal(script.importsHostModule(source), true);
      });
    }

    // Every form that does not. The type-only cases are the point of using a
    // parser: a module that imports only types compiles to nothing at all and
    // loads perfectly well in the unit tier, so excluding it from coverage
    // would take away its floor for no reason.
    const erased = {
      "type-only import": 'import type { Uri } from "vscode";',
      "type-only specifiers": 'import { type Uri, type Range } from "vscode";',
      "type-only re-export": 'export type { Uri } from "vscode";',
    };

    for (const [name, source] of Object.entries(erased)) {
      it(`ignores a ${name}`, () => {
        assert.equal(script.importsHostModule(source), false);
      });
    }

    it("ignores the word where it is not a module specifier", () => {
      // The reason this is a parser and not a regular expression. Every line
      // below matches an obvious pattern for "imports vscode" and none of them
      // is one — and the first is the commonest, because `src/` is full of
      // comments explaining which modules may and may not import the host.
      const notImports = [
        '/** Cannot be unit tested: it does `import * as vscode from "vscode"`. */',
        '// import { window } from "vscode";',
        'const specifier = "vscode";',
        'const pattern = /from "vscode"/;',
        'import { window } from "./vscode";',
        'import { window } from "vscode-uri";',
        'import { fake } from "../helpers/vscode";',
      ];
      for (const source of notImports) {
        assert.equal(
          script.importsHostModule(source),
          false,
          `false positive on: ${source}`,
        );
      }
    });

    it("does not stop at the first import", () => {
      // A guard against a visitor that returns after the first declaration:
      // the host import is rarely the first line of a real module.
      assert.equal(
        script.importsHostModule(
          ['import { z } from "node:zlib";', 'import "vscode";'].join("\n"),
        ),
        true,
      );
    });
  });

  describe("sourceExcludes", () => {
    it("takes the src entries and leaves the test-tier ones alone", () => {
      // `test/**` is excluded for a different reason — the test tier is not
      // code under measurement — and is not this check's business. Policing it
      // would demand that the test files import `vscode`, which is backwards.
      assert.deepEqual(
        script.sourceExcludes([
          "out/test/**",
          "test/**",
          "src/extension.ts",
          "src/profile/store.ts",
        ]),
        ["src/extension.ts", "src/profile/store.ts"],
      );
    });
  });

  describe("check", () => {
    const HOST = 'import * as vscode from "vscode";\n';
    const PURE = "export const answer = 42;\n";

    const run = (excludes: string[], files: Record<string, string>): string[] =>
      script.check({
        excludes,
        sources: Object.keys(files),
        read: (file) => {
          const source = files[file];
          assert.ok(source !== undefined, `unexpected read of ${file}`);
          return source;
        },
      });

    it("passes when the list matches the rule exactly", () => {
      assert.deepEqual(
        run(["src/shell.ts"], { "src/shell.ts": HOST, "src/pure.ts": PURE }),
        [],
      );
    });

    it("catches a pure module hidden in the exclude list", () => {
      // The direction with teeth. Nothing else in the repository would notice:
      // the module simply stops being measured, and its floor is gone for good.
      const problems = run(["src/pure.ts"], { "src/pure.ts": PURE });
      assert.equal(problems.length, 1);
      assert.match(problems[0] ?? "", /src\/pure\.ts/);
      assert.match(problems[0] ?? "", /does not import/);
    });

    it("catches a shell module missing from the exclude list", () => {
      const problems = run([], { "src/shell.ts": HOST });
      assert.equal(problems.length, 1);
      assert.match(problems[0] ?? "", /src\/shell\.ts/);
      assert.match(problems[0] ?? "", /not in the "exclude" list/);
    });

    it("refuses a glob", () => {
      // `src/**` would satisfy "everything excluded imports vscode" only by
      // leaving nothing to disagree with it. A pattern that cannot be checked
      // is a pattern that turns this whole script into decoration.
      const problems = run(["src/**"], { "src/shell.ts": HOST });
      assert.equal(problems.length, 2, "the glob, and the shell it hid");
      assert.match(problems[0] ?? "", /is a glob/);
    });

    it("catches an exclusion left behind by a rename", () => {
      const problems = run(["src/profile/store.ts"], { "src/store.ts": HOST });
      assert.equal(problems.length, 2, "the stale entry, and the new path");
      assert.match(problems[0] ?? "", /does not exist/);
    });

    it("reports every disagreement, not just the first", () => {
      // A gate that stops at the first problem turns one fix into three runs.
      const problems = run(["src/a.ts"], {
        "src/a.ts": PURE,
        "src/b.ts": HOST,
        "src/c.ts": HOST,
      });
      assert.equal(problems.length, 3);
    });
  });

  describe("this repository", () => {
    it("excludes a module from coverage if and only if it imports vscode", () => {
      // `out/test/unit/` → repository root.
      const repoRoot = path.resolve(__dirname, "..", "..", "..");
      assert.deepEqual(
        script.checkRepository(repoRoot),
        [],
        "the c8 exclude list and src/ have drifted apart",
      );
    });
  });
});

// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  ENVIRONMENT_PROBE_FILENAME,
  environmentProbeStatements,
  parseEnvironmentProbeFile,
} from "../../src/backend/environment";

describe("environment.ts — the stage-2 probe program and its parser", () => {
  describe("environmentProbeStatements", () => {
    it("wraps the probe in a submit/endsubmit block, with no trailing run;", () => {
      const statements = environmentProbeStatements();
      assert.equal(statements[0], "proc python;");
      assert.equal(statements[1], "submit;");
      assert.equal(statements[statements.length - 1], "endsubmit;");
      // The caller (`ProcPythonBackend.probeRuntime`) appends its own `run;`,
      // matching `reset()`'s `RESTART_STATEMENT` and `runProgram`'s per-run
      // statement — see this module's own doc comment.
      assert.ok(!statements.includes("run;"));
    });

    it("defines and deletes its own function, leaving no other top-level name", () => {
      const statements = environmentProbeStatements();
      const body = statements.join("\n");
      assert.ok(body.includes("def __pyvia_probe_environment():"));
      assert.ok(body.includes("del __pyvia_probe_environment"));
      // Only ever bound inside the function body, per this module's own doc
      // comment on why a bare script would leak names into the user's
      // long-lived namespace.
      assert.ok(!/^import /m.test(body));
    });

    it("deletes its function from a finally, so a raising probe still cleans up", () => {
      // A bare `__pyvia_probe_environment()` / `del` pair would leak the
      // function name into the user's long-lived namespace whenever the probe
      // itself raised. See this module's own doc comment.
      const statements = environmentProbeStatements();
      const call = statements.indexOf("try:");
      assert.ok(call > 0, "expected a top-level try: statement");
      assert.deepEqual(statements.slice(call), [
        "try:",
        "    __pyvia_probe_environment()",
        "finally:",
        "    del __pyvia_probe_environment",
        "endsubmit;",
      ]);
    });

    it("keeps a package only when both its name and version are non-empty strings", () => {
      // `importlib.metadata` can raise on `.metadata` and return `None` from
      // `.version` for a distribution with malformed METADATA; a single one of
      // those must not crash `sorted(set(...))` or land a `null` the parser
      // then rejects whole. See this module's own doc comment.
      const body = environmentProbeStatements().join("\n");
      assert.ok(body.includes("version = distribution.version"));
      assert.ok(
        body.includes(
          "if isinstance(name, str) and name and isinstance(version, str) and version:",
        ),
      );
    });

    it("writes to the fixed filename this module exports", () => {
      const body = environmentProbeStatements().join("\n");
      assert.ok(body.includes(JSON.stringify(ENVIRONMENT_PROBE_FILENAME)));
    });

    it("tries top_level.txt, then packages_distributions(), then a normalised guess, for import names (10b)", () => {
      // Finding: `distribution.metadata['Name']` is the PyPI name, not always
      // the `import` name — see `environment.ts`'s own doc comment. All three
      // fallback steps must be present, each guarded so a failure in one falls
      // through to the next rather than sinking the probe. `packages_distributions()`
      // is built once, ahead of the per-distribution loop (it is a global
      // reverse mapping, not something to call per distribution) — so it
      // appears earlier in program order than the per-distribution
      // `top_level.txt` read, even though `top_level.txt` is consulted first
      // at runtime for a given distribution. This asserts runtime precedence
      // by shape (a separate `if not import_names:` guard ahead of each later
      // source, never `elif`, so an earlier populated value short-circuits
      // every later guard) rather than matching the source's exact text —
      // the previous version of this test asserted on one fallback's literal
      // indentation and described the shape as `if … elif …`, which the real
      // source never was; both broke on a routine reformat and neither
      // tested behaviour a reformat could actually change.
      const body = environmentProbeStatements().join("\n");
      const topLevelIndex = body.indexOf(
        "distribution.read_text('top_level.txt')",
      );
      const packagesDistributionsIndex = body.indexOf(
        "importlib.metadata.packages_distributions()",
      );
      const fallbackGuessIndex = body.indexOf(
        "[name.replace('-', '_').replace('.', '_')]",
      );
      assert.ok(topLevelIndex > 0, "expected a top_level.txt read");
      assert.ok(
        packagesDistributionsIndex > 0,
        "expected a packages_distributions() call",
      );
      assert.ok(
        fallbackGuessIndex > 0,
        "expected a normalised-name last resort",
      );
      // Exactly two later sources, each behind its own `if not import_names:`
      // guard — `top_level.txt` itself is read unconditionally (it runs
      // first, nothing to skip yet), so only the two fallbacks after it need
      // one.
      const guardCount = body.split("if not import_names:").length - 1;
      assert.equal(
        guardCount,
        2,
        "expected exactly two `if not import_names:` fallback guards — " +
          "packages_distributions(), then the normalised guess",
      );
      assert.ok(fallbackGuessIndex > topLevelIndex);
      assert.ok(fallbackGuessIndex > packagesDistributionsIndex);
      // `packages_distributions()` was added in Python 3.10 — this project
      // does not get to assume a deployment's Python version, so the call is
      // guarded rather than bare.
      assert.ok(
        body.includes("hasattr(importlib.metadata, 'packages_distributions')"),
      );
    });
  });

  describe("parseEnvironmentProbeFile", () => {
    const validBytes = (): Uint8Array =>
      new TextEncoder().encode(
        JSON.stringify({
          version: "3.12.12 (main)",
          executable: "/usr/bin/python3",
          packages: [
            ["numpy", "2.0.0", ["numpy"]],
            ["pandas", "3.0.0", ["pandas"]],
          ],
        }),
      );

    it("parses the shape the probe script always produces", () => {
      const result = parseEnvironmentProbeFile(validBytes());
      assert.deepEqual(result, {
        kind: "available",
        version: "3.12.12 (main)",
        executable: "/usr/bin/python3",
        packages: [
          { name: "numpy", version: "2.0.0", importNames: ["numpy"] },
          { name: "pandas", version: "3.0.0", importNames: ["pandas"] },
        ],
      });
    });

    it("parses an import-name list that differs from the distribution name", () => {
      // `Pillow` installs as `PIL` — the exact mismatch Finding 10.2's design
      // correction exists for.
      const bytes = new TextEncoder().encode(
        JSON.stringify({
          version: "3.12",
          executable: "/usr/bin/python3",
          packages: [["Pillow", "11.0.0", ["PIL"]]],
        }),
      );
      const result = parseEnvironmentProbeFile(bytes);
      if (result?.kind !== "available") {
        assert.fail("expected an available result");
      }
      assert.deepEqual(result.packages, [
        { name: "Pillow", version: "11.0.0", importNames: ["PIL"] },
      ]);
    });

    it("accepts an empty import-name list rather than rejecting the entry", () => {
      // The probe itself never produces one (its own fallback chain always
      // lands on at least a normalised guess) — this asserts the parser does
      // not impose a stricter rule than the shape it actually reads.
      const bytes = new TextEncoder().encode(
        JSON.stringify({
          version: "3.12",
          executable: "/usr/bin/python3",
          packages: [["oddpkg", "1.0.0", []]],
        }),
      );
      const result = parseEnvironmentProbeFile(bytes);
      if (result?.kind !== "available") {
        assert.fail("expected an available result");
      }
      assert.deepEqual(result.packages, [
        { name: "oddpkg", version: "1.0.0", importNames: [] },
      ]);
    });

    it("accepts an empty package list", () => {
      const bytes = new TextEncoder().encode(
        JSON.stringify({
          version: "3.12.12",
          executable: "/usr/bin/python3",
          packages: [],
        }),
      );
      const result = parseEnvironmentProbeFile(bytes);
      if (result?.kind !== "available") {
        assert.fail("expected an available result");
      }
      assert.deepEqual(result.packages, []);
    });

    it("rejects bytes that are not valid UTF-8 JSON", () => {
      const bytes = new Uint8Array([0xff, 0xfe, 0x00, 0x01]);
      assert.equal(parseEnvironmentProbeFile(bytes), undefined);
    });

    it("rejects text that is not JSON at all", () => {
      const bytes = new TextEncoder().encode("not json");
      assert.equal(parseEnvironmentProbeFile(bytes), undefined);
    });

    it("rejects JSON missing version or executable", () => {
      const missingVersion = new TextEncoder().encode(
        JSON.stringify({ executable: "/usr/bin/python3", packages: [] }),
      );
      const missingExecutable = new TextEncoder().encode(
        JSON.stringify({ version: "3.12", packages: [] }),
      );
      assert.equal(parseEnvironmentProbeFile(missingVersion), undefined);
      assert.equal(parseEnvironmentProbeFile(missingExecutable), undefined);
    });

    it("rejects a packages entry that is not a three-element [name, version, importNames] triple", () => {
      const tooShort = new TextEncoder().encode(
        JSON.stringify({
          version: "3.12",
          executable: "/usr/bin/python3",
          packages: [["numpy", "2.0.0"]],
        }),
      );
      const notStrings = new TextEncoder().encode(
        JSON.stringify({
          version: "3.12",
          executable: "/usr/bin/python3",
          packages: [["numpy", 2, ["numpy"]]],
        }),
      );
      assert.equal(parseEnvironmentProbeFile(tooShort), undefined);
      assert.equal(parseEnvironmentProbeFile(notStrings), undefined);
    });

    it("rejects a packages entry whose importNames is not an array of strings", () => {
      const notAnArray = new TextEncoder().encode(
        JSON.stringify({
          version: "3.12",
          executable: "/usr/bin/python3",
          packages: [["numpy", "2.0.0", "numpy"]],
        }),
      );
      const notAllStrings = new TextEncoder().encode(
        JSON.stringify({
          version: "3.12",
          executable: "/usr/bin/python3",
          packages: [["numpy", "2.0.0", ["numpy", 2]]],
        }),
      );
      assert.equal(parseEnvironmentProbeFile(notAnArray), undefined);
      assert.equal(parseEnvironmentProbeFile(notAllStrings), undefined);
    });

    it("rejects a JSON value that is not an object", () => {
      const bytes = new TextEncoder().encode(JSON.stringify([1, 2, 3]));
      assert.equal(parseEnvironmentProbeFile(bytes), undefined);
    });

    it("rejects a JSON value that is a primitive, not object or array", () => {
      // `[1, 2, 3]` above is still `typeof "object"` in JS (arrays are), so it
      // never actually exercises the `typeof parsed !== "object"` arm of this
      // guard — only a genuine primitive does.
      const bytes = new TextEncoder().encode(JSON.stringify("just a string"));
      assert.equal(parseEnvironmentProbeFile(bytes), undefined);
    });

    it("rejects a top-level JSON null", () => {
      // `typeof null === "object"` in JS, so this exercises the guard's other
      // arm (`parsed === null`), which nothing else here reaches.
      const bytes = new TextEncoder().encode(JSON.stringify(null));
      assert.equal(parseEnvironmentProbeFile(bytes), undefined);
    });

    it("rejects a packages field that is not an array at all", () => {
      const bytes = new TextEncoder().encode(
        JSON.stringify({
          version: "3.12",
          executable: "/usr/bin/python3",
          packages: "numpy 2.0.0",
        }),
      );
      assert.equal(parseEnvironmentProbeFile(bytes), undefined);
    });
  });
});

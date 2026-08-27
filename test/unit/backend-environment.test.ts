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
  });

  describe("parseEnvironmentProbeFile", () => {
    const validBytes = (): Uint8Array =>
      new TextEncoder().encode(
        JSON.stringify({
          version: "3.12.12 (main)",
          executable: "/usr/bin/python3",
          packages: [
            ["numpy", "2.0.0"],
            ["pandas", "3.0.0"],
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
          { name: "numpy", version: "2.0.0" },
          { name: "pandas", version: "3.0.0" },
        ],
      });
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

    it("rejects a packages entry that is not a two-element string pair", () => {
      const notAPair = new TextEncoder().encode(
        JSON.stringify({
          version: "3.12",
          executable: "/usr/bin/python3",
          packages: [["numpy"]],
        }),
      );
      const notStrings = new TextEncoder().encode(
        JSON.stringify({
          version: "3.12",
          executable: "/usr/bin/python3",
          packages: [["numpy", 2]],
        }),
      );
      assert.equal(parseEnvironmentProbeFile(notAPair), undefined);
      assert.equal(parseEnvironmentProbeFile(notStrings), undefined);
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

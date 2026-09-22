// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  buildSessionOptions,
  formatSasOption,
  resolveAutoExecLines,
} from "../../src/profile/sessionSetup";

/**
 * The wire rule under test is Finding 11.7: the Compute service accepts
 * `NAME=VALUE` in `environment.options` and silently does not apply it; the
 * `NAME VALUE` form is applied. Every case here is a form a person might write in
 * a profile, and the assertion is what actually goes on the wire.
 */
describe("formatSasOption", () => {
  it("turns NAME=VALUE into NAME VALUE, the form the service applies", () => {
    assert.equal(formatSasOption("PAGESIZE=MAX"), "PAGESIZE MAX");
    assert.equal(formatSasOption("YEARCUTOFF=1950"), "YEARCUTOFF 1950");
  });

  it("leaves the space form, a bare switch and a leading dash alone", () => {
    assert.equal(formatSasOption("YEARCUTOFF 1951"), "YEARCUTOFF 1951");
    assert.equal(formatSasOption("NONUMBER"), "NONUMBER");
    assert.equal(formatSasOption("-YEARCUTOFF 1952"), "-YEARCUTOFF 1952");
    assert.equal(formatSasOption("-NOTERMINAL"), "-NOTERMINAL");
  });

  it("rewrites only the separator, never an = that belongs to the value", () => {
    assert.equal(
      formatSasOption('SASAUTOS=("/a=b" sasautos)'),
      'SASAUTOS ("/a=b" sasautos)',
    );
    // The `=` is after whitespace, so it is part of the value, not the separator.
    assert.equal(formatSasOption("SET FOO=bar"), "SET FOO=bar");
    // Same rule with only a typo's worth of whitespace in front of the `=`:
    // sent as written, not rewritten into `NAME VALUE`.
    assert.equal(formatSasOption("NAME =VALUE"), "NAME =VALUE");
    assert.equal(formatSasOption("NAME = VALUE"), "NAME = VALUE");
  });

  it("trims surrounding whitespace, including after the separator", () => {
    assert.equal(formatSasOption("  PAGESIZE=  MAX "), "PAGESIZE MAX");
  });
});

describe("buildSessionOptions", () => {
  it("puts the extension's options first so a profile can override them", () => {
    assert.deepEqual(
      buildSessionOptions(["PAGESIZE MAX"], ["PAGESIZE=60", "NONUMBER"]),
      ["PAGESIZE MAX", "PAGESIZE 60", "NONUMBER"],
    );
  });

  it("is just the base when the profile sets none", () => {
    assert.deepEqual(buildSessionOptions(["PAGESIZE MAX"], undefined), [
      "PAGESIZE MAX",
    ]);
  });

  it("drops an option that is empty after trimming", () => {
    assert.deepEqual(buildSessionOptions([], ["  ", "NONUMBER"]), ["NONUMBER"]);
  });
});

describe("resolveAutoExecLines", () => {
  const never = (): Promise<string> => {
    throw new Error("no file should be read");
  };

  it("is empty for a profile with no autoExec", async () => {
    assert.deepEqual(await resolveAutoExecLines(undefined, never), {
      lines: [],
      problems: [],
    });
  });

  it("keeps entries in the order listed, mixing lines and files", async () => {
    const result = await resolveAutoExecLines(
      [
        { type: "line", line: "%let a=1;" },
        { type: "file", filePath: "/x/setup.sas" },
        { type: "line", line: "%let c=3;" },
      ],
      (filePath) => {
        assert.equal(filePath, "/x/setup.sas");
        return Promise.resolve("%let b=2;\r\nlibname p '/tmp';\n");
      },
    );

    assert.deepEqual(result.lines, [
      "%let a=1;",
      "%let b=2;",
      "libname p '/tmp';",
      "%let c=3;",
    ]);
    assert.deepEqual(result.problems, []);
  });

  it("sends no blank lines for an empty file or a trailing newline", async () => {
    const read = (text: string) =>
      resolveAutoExecLines([{ type: "file", filePath: "/f.sas" }], () =>
        Promise.resolve(text),
      );

    assert.deepEqual((await read("")).lines, []);
    assert.deepEqual((await read("\n\n")).lines, []);
    assert.deepEqual((await read("%let a=1;\n")).lines, ["%let a=1;"]);
  });

  it("skips an unreadable file, reports it, and keeps every other entry", async () => {
    const result = await resolveAutoExecLines(
      [
        { type: "line", line: "%let a=1;" },
        { type: "file", filePath: "/missing.sas" },
        { type: "line", line: "%let c=3;" },
      ],
      () => Promise.reject(new Error("file not found")),
    );

    assert.deepEqual(result.lines, ["%let a=1;", "%let c=3;"]);
    assert.deepEqual(result.problems, [
      { filePath: "/missing.sas", reason: "file not found" },
    ]);
  });

  it("reports a non-Error rejection by its string form", async () => {
    const result = await resolveAutoExecLines(
      [{ type: "file", filePath: "/f.sas" }],
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the point is a non-Error rejection.
      () => Promise.reject("denied"),
    );
    assert.equal(result.problems[0]?.reason, "denied");
  });
});

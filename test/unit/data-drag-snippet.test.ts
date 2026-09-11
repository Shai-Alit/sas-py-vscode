// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * `src/data/dragSnippet.ts` (7d) — the variable-name heuristic, the
 * dedupe-against-the-document loop, and the two snippet bodies, all
 * `vscode`-free. `src/data/dataDragAndDrop.ts`'s own integration test covers
 * how a real `vscode.DataTransfer`/document feeds these.
 */

import assert from "node:assert/strict";

import {
  buildSd2dfSnippet,
  buildSqlPassthroughSnippet,
  dedupeIdentifier,
  deriveVariableName,
  deriveViewName,
} from "../../src/data/dragSnippet";

describe("dragSnippet: deriveVariableName", () => {
  it("lowercases and suffixes _df", () => {
    assert.equal(deriveVariableName("CLASS"), "class_df");
  });

  it("replaces a run of non-identifier characters with one underscore", () => {
    assert.equal(deriveVariableName("my-report v2"), "my_report_v2_df");
  });

  it("trims leading/trailing underscores produced by sanitizing", () => {
    assert.equal(deriveVariableName("--totals--"), "totals_df");
  });

  it("prefixes a name that would start with a digit", () => {
    assert.equal(deriveVariableName("2024data"), "t_2024data_df");
  });

  it("falls back to a generic fragment when nothing sanitizes to a real character", () => {
    assert.equal(deriveVariableName("列"), "sas_df");
  });
});

describe("dragSnippet: deriveViewName", () => {
  it("mirrors deriveVariableName's own sanitizing, suffixed _view", () => {
    assert.equal(deriveViewName("CLASS"), "class_view");
    assert.equal(deriveViewName("2024data"), "t_2024data_view");
  });
});

describe("dragSnippet: dedupeIdentifier", () => {
  it("returns the base name when it is not taken", () => {
    assert.equal(
      dedupeIdentifier("class_df", () => false),
      "class_df",
    );
  });

  it("adds a numeric suffix, starting at 2, until one is free", () => {
    const taken = new Set(["class_df", "class_df2", "class_df3"]);
    assert.equal(
      dedupeIdentifier("class_df", (name) => taken.has(name)),
      "class_df4",
    );
  });
});

describe("dragSnippet: buildSd2dfSnippet", () => {
  it("assigns a plain sd2df call", () => {
    assert.equal(
      buildSd2dfSnippet("SASHELP", "CLASS", "class_df"),
      'class_df = SAS.sd2df("SASHELP.CLASS")',
    );
  });

  it("escapes a backslash, a double quote, and a newline in the table/libref text", () => {
    const result = buildSd2dfSnippet("WORK", 'weird"na\\me\ntable', "t_df");
    assert.equal(result, 't_df = SAS.sd2df("WORK.weird\\"na\\\\me\\ntable")');
  });
});

describe("dragSnippet: buildSqlPassthroughSnippet", () => {
  it("builds a PROC SQL pass-through with the view name mirrored across both tabstop occurrences", () => {
    const result = buildSqlPassthroughSnippet(
      "SASHELP",
      "CLASS",
      "class_df",
      "class_view",
    );
    assert.equal(
      result,
      [
        `SAS.submit("""`,
        `proc sql;`,
        `  create view work.\${1:class_view} as`,
        `    select * from SASHELP.CLASS`,
        `    where \${2:1=1};`,
        `quit;`,
        `""")`,
        `class_df = SAS.sd2df("work.$1")`,
      ].join("\n"),
    );
  });

  it("escapes snippet metacharacters ($, }, \\) in the libref/table text, after Python-escaping and SAS-name-literal wrapping", () => {
    const result = buildSqlPassthroughSnippet(
      "WORK",
      "a$b}c\\d",
      "t_df",
      "t_view",
    );
    // Computed independently (not by re-running the production escaping
    // logic): `a$b}c\d` is not a bare SAS name (it contains none of
    // `[A-Za-z0-9_]` outside the `a`, `b`, `c`, `d`), so it is first wrapped
    // in a name literal (`'a$b}c\d'n`) — then that literal's one backslash
    // Python-escapes to two, each of which doubles again for snippet syntax
    // (four total), and the bare `$`/`}` each gain an escaping backslash of
    // their own. The literal's own quote/`n` delimiters are untouched by
    // either escaping layer.
    const expected =
      'SAS.submit("""\nproc sql;\n  create view work.${1:t_view} as\n    select * from WORK.\'a\\$b\\}c\\\\\\\\d\'n\n    where ${2:1=1};\nquit;\n""")\nt_df = SAS.sd2df("work.$1")';
    assert.equal(result, expected);
  });

  it("wraps a table name containing a semicolon in a SAS name literal, closing off statement injection", () => {
    const result = buildSqlPassthroughSnippet(
      "SASHELP",
      "CLASS; drop table foo",
      "class_df",
      "class_view",
    );
    assert.equal(
      result,
      [
        `SAS.submit("""`,
        `proc sql;`,
        `  create view work.\${1:class_view} as`,
        `    select * from SASHELP.'CLASS; drop table foo'n`,
        `    where \${2:1=1};`,
        `quit;`,
        `""")`,
        `class_df = SAS.sd2df("work.$1")`,
      ].join("\n"),
    );
  });

  it("doubles an embedded single quote inside a SAS name literal", () => {
    const result = buildSqlPassthroughSnippet(
      "SASHELP",
      "weird'table",
      "t_df",
      "t_view",
    );
    assert.equal(
      result,
      [
        `SAS.submit("""`,
        `proc sql;`,
        `  create view work.\${1:t_view} as`,
        `    select * from SASHELP.'weird''table'n`,
        `    where \${2:1=1};`,
        `quit;`,
        `""")`,
        `t_df = SAS.sd2df("work.$1")`,
      ].join("\n"),
    );
  });
});

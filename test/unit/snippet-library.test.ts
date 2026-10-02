// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * `src/snippets/library.ts` (13d) — the snippet file's parser, and the
 * shipped `snippets/python.json` itself: every snippet parses, every prefix
 * is `viya-` and unique, and the bodies keep what Findings 13.42–13.46
 * settled.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  parseSnippetLibrary,
  type SnippetEntry,
} from "../../src/snippets/library";

function shipped(): SnippetEntry[] {
  const result = parseSnippetLibrary(
    readFileSync(
      path.resolve(__dirname, "../../../snippets/python.json"),
      "utf8",
    ),
  );
  assert.ok(result.ok, result.ok ? "" : result.reason);
  return result.entries;
}

function byPrefix(prefix: string): SnippetEntry {
  const entry = shipped().find((e) => e.prefix === prefix);
  assert.ok(entry, `no snippet has the prefix ${prefix}`);
  return entry;
}

describe("parseSnippetLibrary", () => {
  it("returns the entries in file order, with each body's lines joined", () => {
    const result = parseSnippetLibrary(
      JSON.stringify({
        B: { prefix: "viya-b", body: ["one", "two"], description: "b" },
        A: { prefix: "viya-a", body: ["x"], description: "a" },
      }),
    );
    assert.deepEqual(result, {
      ok: true,
      entries: [
        { name: "B", prefix: "viya-b", body: "one\ntwo", description: "b" },
        { name: "A", prefix: "viya-a", body: "x", description: "a" },
      ],
    });
  });

  const malformed: [string, string, RegExp][] = [
    ["text that is not JSON", "{", /not JSON/],
    ["a JSON array", "[]", /not a JSON object/],
    ["null", "null", /not a JSON object/],
    ["an entry that is not an object", '{"A": 1}', /"A" is not an object/],
    [
      "a missing prefix",
      '{"A": {"body": ["x"], "description": "a"}}',
      /"A" has no string prefix/,
    ],
    [
      "a missing body",
      '{"A": {"prefix": "p", "description": "a"}}',
      /"A" has no body/,
    ],
    [
      "a string body",
      '{"A": {"prefix": "p", "body": "x", "description": "a"}}',
      /"A" has no body/,
    ],
    [
      "an empty body",
      '{"A": {"prefix": "p", "body": [], "description": "a"}}',
      /"A" has no body/,
    ],
    [
      "a body with a non-string line",
      '{"A": {"prefix": "p", "body": ["x", 1], "description": "a"}}',
      /"A" has no body/,
    ],
    [
      "a missing description",
      '{"A": {"prefix": "p", "body": ["x"]}}',
      /"A" has no string description/,
    ],
  ];
  for (const [what, text, reason] of malformed) {
    it(`refuses ${what}`, () => {
      const result = parseSnippetLibrary(text);
      if (result.ok) assert.fail("the text was accepted");
      assert.match(result.reason, reason);
    });
  }
});

describe("snippets/python.json", () => {
  it("holds the twelve snippets Sean chose, each with a unique viya- prefix", () => {
    const prefixes = shipped().map((e) => e.prefix);
    assert.deepEqual(prefixes, [
      "viya-read",
      "viya-write",
      "viya-sql-read",
      "viya-symget",
      "viya-symput",
      "viya-submit",
      "viya-show-figure",
      "viya-show-df",
      "viya-log-warning",
      "viya-cas-upload",
      "viya-cas-read",
      "viya-libname-secret",
    ]);
    assert.equal(new Set(prefixes).size, prefixes.length);
  });

  it("checks SYSERR after SAS.submit, whose return value is 0 even on failure (Finding 13.43)", () => {
    assert.match(byPrefix("viya-submit").body, /SAS\.symget\("SYSERR"\)/);
  });

  it("passes only SYSERR 0 and 4, so 3 (syntax-check mode, Finding 13.43) fails", () => {
    const body = byPrefix("viya-submit").body;
    assert.match(body, /if syserr not in \("0", "4"\):/);
    assert.doesNotMatch(body, /> 4/);
  });

  it("logs at the warning level, the one that is shown", () => {
    assert.match(
      byPrefix("viya-log-warning").body,
      /SAS\.logMessage\(.*, "warning"\)/,
    );
  });

  it("passes the password through %superq, never &, and checks SYSLIBRC (Findings 13.44, 13.45)", () => {
    const body = byPrefix("viya-libname-secret").body;
    // credential-scan: allow a pattern that matches a macro reference, not a password
    assert.match(body, /password="%superq\(\$\{1:dbpass\}\)"/);
    assert.doesNotMatch(body, /&/);
    assert.match(body, /SAS\.symget\("SYSLIBRC"\)/);
    assert.match(body, /%symdel \$\{1:dbpass\};/);
  });

  it("deletes the password's macro variable in a finally, so no exception skips it", () => {
    const body = byPrefix("viya-libname-secret").body;
    assert.match(body, /^try:\n[\s\S]*\nfinally:\n {4}SAS\.submit\("%symdel /m);
    assert.ok(
      body.indexOf("try:") < body.indexOf("libname "),
      "the libname is submitted inside the try",
    );
  });
});

// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * `src/cas/sqlPassthroughSnippet.ts` (11b) — the plain-string builder,
 * `vscode`-free. `src/cas/casSqlPassthroughCommand.ts`'s own integration
 * test covers how a real editor receives the result as a snippet.
 */

import assert from "node:assert/strict";

import { buildCasSqlPassthroughSnippet } from "../../src/cas/sqlPassthroughSnippet";

describe("buildCasSqlPassthroughSnippet", () => {
  it("loads fedsql, then execDirects a connection-to query with a caslib and query tabstop", () => {
    const snippet = buildCasSqlPassthroughSnippet();

    assert.equal(
      snippet,
      [
        'conn.loadactionset("fedsql")',
        "result = conn.fedsql.execDirect(",
        "    query='''select * from connection to ${1:CASLIB} (${2:select * from native_table})'''",
        ")",
        'df = result["Result Set"]',
      ].join("\n"),
    );
  });

  it("takes no input — every call returns the identical template", () => {
    assert.equal(
      buildCasSqlPassthroughSnippet(),
      buildCasSqlPassthroughSnippet(),
    );
  });
});

// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  CONTENT_SCHEME,
  contentUriString,
  resourceHrefOfQuery,
} from "../../src/content/uri";

/**
 * The `sasContent:` URI string and the file-resource href carried in its
 * query. `vscode`-free, so a plain unit — the shell just runs these through
 * `vscode.Uri.parse` / reads `uri.query`.
 */

const HREF = "/files/files/dddddddd-0000-4000-8000-000000000001";

describe("content/uri", () => {
  it("builds scheme:/name?id=href with the href verbatim", () => {
    assert.equal(
      contentUriString("analysis.py", HREF),
      `${CONTENT_SCHEME}:/analysis.py?id=${HREF}`,
    );
  });

  it("escapes only # and ? in the name segment", () => {
    assert.equal(
      contentUriString("a#b?c.py", HREF),
      `${CONTENT_SCHEME}:/a%23b%3Fc.py?id=${HREF}`,
    );
  });

  it("round-trips the href out of the query", () => {
    const uri = contentUriString("x.py", HREF);
    const query = uri.slice(uri.indexOf("?") + 1);
    assert.equal(resourceHrefOfQuery(query), HREF);
  });

  it("returns undefined for a query this extension did not write", () => {
    assert.equal(resourceHrefOfQuery(""), undefined);
    assert.equal(resourceHrefOfQuery("id="), undefined);
    assert.equal(resourceHrefOfQuery("name=x"), undefined);
    assert.equal(resourceHrefOfQuery("xid=/files/files/1"), undefined);
  });
});

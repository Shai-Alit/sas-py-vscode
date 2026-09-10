// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  CONTENT_SCHEME,
  contentUriString,
  parseContentUri,
} from "../../src/content/uri";

/**
 * The `sasContent:` URI string and the two things it carries — the file
 * resource href and the deployment root. `vscode`-free, so a plain unit; the
 * shell just runs these through `vscode.Uri.parse` / reads `uri.query`.
 */

const HREF = "/files/files/dddddddd-0000-4000-8000-000000000001";
const ROOT = "https://viya.example.com";

describe("content/uri", () => {
  it("builds scheme:/name?id=<href>&r=<encoded root>", () => {
    assert.equal(
      contentUriString("analysis.py", HREF, ROOT),
      `${CONTENT_SCHEME}:/analysis.py?id=${HREF}&r=${encodeURIComponent(ROOT)}`,
    );
  });

  it("percent-encodes # and ? in the name segment; the href rides raw", () => {
    const uri = contentUriString("a#b?c.py", HREF, ROOT);
    assert.ok(uri.startsWith(`${CONTENT_SCHEME}:/a%23b%3Fc.py?id=${HREF}&r=`));
  });

  it("encodes a bare % in the name, escaping it before # and ? so neither is double-encoded", () => {
    const uri = contentUriString("100% done #x ?y.py", HREF, ROOT);
    assert.ok(
      uri.startsWith(
        `${CONTENT_SCHEME}:/100%25 done %23x %3Fy.py?id=${HREF}&r=`,
      ),
      uri,
    );
  });

  it("round-trips the href and the deployment root out of the query", () => {
    const uri = contentUriString("x.py", HREF, ROOT);
    const query = uri.slice(uri.indexOf("?") + 1);
    assert.deepEqual(parseContentUri(query), {
      resourceHref: HREF,
      deploymentRoot: ROOT,
    });
  });

  it("preserves a deployment root that carries a path and reserved characters", () => {
    const root = "https://host.example/gw/viya?tenant=acme";
    const query = contentUriString("x.py", HREF, root)
      .split("?")
      .slice(1)
      .join("?");
    assert.equal(parseContentUri(query)?.deploymentRoot, root);
  });

  it("returns undefined unless both id and r are present and non-empty", () => {
    assert.equal(parseContentUri(""), undefined);
    assert.equal(parseContentUri("id=" + HREF), undefined);
    assert.equal(parseContentUri("r=" + encodeURIComponent(ROOT)), undefined);
    assert.equal(
      parseContentUri("id=&r=" + encodeURIComponent(ROOT)),
      undefined,
    );
    assert.equal(parseContentUri(`id=${HREF}&r=`), undefined);
  });
});

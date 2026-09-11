// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  CONTENT_FOLDER_SCHEME,
  CONTENT_READONLY_SCHEME,
  CONTENT_SCHEME,
  contentFolderUriString,
  contentReadOnlyUriString,
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

  it("builds the read-only variant under the sasContentReadOnly scheme (6d-ii)", () => {
    assert.equal(
      contentReadOnlyUriString("scratch.py", HREF, ROOT),
      `${CONTENT_READONLY_SCHEME}:/scratch.py?id=${HREF}&r=${encodeURIComponent(ROOT)}`,
    );
    // same query, so parseContentUri round-trips it too
    const query = contentReadOnlyUriString("x.py", HREF, ROOT)
      .split("?")
      .slice(1)
      .join("?");
    assert.deepEqual(parseContentUri(query), {
      resourceHref: HREF,
      deploymentRoot: ROOT,
    });
    // and it encodes the name the same way
    assert.ok(
      contentReadOnlyUriString("a#b?c.py", HREF, ROOT).startsWith(
        `${CONTENT_READONLY_SCHEME}:/a%23b%3Fc.py?id=`,
      ),
    );
  });

  it("builds the folder identity variant under the sasContentFolder scheme (ADR-0031)", () => {
    assert.equal(
      contentFolderUriString("reports", HREF, ROOT),
      `${CONTENT_FOLDER_SCHEME}:/reports?id=${HREF}&r=${encodeURIComponent(ROOT)}`,
    );
    // same query shape, so parseContentUri round-trips it too, even though
    // nothing currently reads a sasContentFolder: URI back this way
    const query = contentFolderUriString("x", HREF, ROOT)
      .split("?")
      .slice(1)
      .join("?");
    assert.deepEqual(parseContentUri(query), {
      resourceHref: HREF,
      deploymentRoot: ROOT,
    });
    // and it encodes the name the same way
    assert.ok(
      contentFolderUriString("a#b?c", HREF, ROOT).startsWith(
        `${CONTENT_FOLDER_SCHEME}:/a%23b%3Fc?id=`,
      ),
    );
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

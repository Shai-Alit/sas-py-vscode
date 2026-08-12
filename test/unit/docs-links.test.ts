// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { loadScript } from "../helpers/load-script";

interface Link {
  url: string;
  line: number;
}

interface CheckLinks {
  extractLinks: (markdown: string) => Link[];
  isSelfLink: (url: string, repository: string | undefined) => boolean;
  selfLinkTarget: (
    url: string,
    repository: string | undefined,
  ) => string | null;
}

/**
 * The link extractor behind the weekly external-link sweep.
 *
 * Only the extraction is unit-tested. Classification talks to the network by
 * definition, and a unit test that stands up a local HTTP server to assert that
 * 404 means broken is testing Node's `fetch`, not this script. The classifier
 * was instead exercised against a fixture server during development, and its
 * behaviour is written down in docs/dev/ci.md.
 *
 * Extraction is where the quiet failures live. A pattern that stops matching
 * does not report an error; it reports fewer links, and a sweep that finds
 * nothing looks exactly like a sweep that found nothing wrong.
 */
describe("docs link extraction", () => {
  let extractLinks: CheckLinks["extractLinks"];

  before(async () => {
    ({ extractLinks } = await loadScript<CheckLinks>("check-links.mjs"));
  });

  it("finds inline, reference, and autolink forms", () => {
    const links = extractLinks(
      [
        "See [the docs](https://example.org/docs).",
        "",
        "Or <https://example.org/auto>.",
        "",
        "[ref]: https://example.org/ref",
      ].join("\n"),
    );

    assert.deepEqual(
      links.map((l) => l.url),
      [
        "https://example.org/docs",
        "https://example.org/auto",
        "https://example.org/ref",
      ],
    );
  });

  it("reports the line each link was found on", () => {
    const links = extractLinks(
      [
        "# Title",
        "",
        "[a](https://example.org/a)",
        "",
        "[b](https://example.org/b)",
      ].join("\n"),
    );
    assert.deepEqual(
      links.map((l) => l.line),
      [3, 5],
    );
  });

  it("strips a link title rather than fetching it", () => {
    const [link] = extractLinks('[x](https://example.org/x "A title")');
    assert.equal(link?.url, "https://example.org/x");
  });

  it("keeps a balanced parenthesis, and stops at the one that closes the link", () => {
    // CommonMark §6.5 permits parentheses in a destination when they balance,
    // so this destination is the whole Wikipedia URL and the final `)` closes
    // the link. An earlier version stopped at the first `)`, which turned a
    // working link into `…/Unix_(computing` and would have filed it as broken
    // every Monday — the exact false alarm that teaches a reader to stop
    // opening the report.
    const [link] = extractLinks(
      "[wiki](https://en.wikipedia.org/wiki/Unix_(computing))",
    );
    assert.equal(link?.url, "https://en.wikipedia.org/wiki/Unix_(computing)");
  });

  it("does not swallow a parenthesis that belongs to the prose", () => {
    const [link] = extractLinks("(see [x](https://example.org/a))");
    assert.equal(link?.url, "https://example.org/a");
  });

  it("handles a balanced parenthesis followed by a title", () => {
    const [link] = extractLinks('[x](https://example.org/a_(b) "A title")');
    assert.equal(link?.url, "https://example.org/a_(b)");
  });

  it("treats an escaped parenthesis as part of the destination", () => {
    // The escape is markdown's, not the URL's: the server is being asked for
    // the resource, so the backslash comes back off before the request.
    const [link] = extractLinks("[x](https://example.org/a\\)b)");
    assert.equal(link?.url, "https://example.org/a)b");
  });

  it("ignores an unterminated destination rather than guessing where it ends", () => {
    // Unbalanced parentheses are not a link to CommonMark either, and a
    // checker that invents an endpoint reports a break nobody can act on.
    assert.deepEqual(extractLinks("[x](https://example.org/a"), []);
    assert.deepEqual(extractLinks("[x](https://example.org/a_(b"), []);
  });

  it("ignores relative links, which VitePress already checks", () => {
    const links = extractLinks(
      "[a](./sibling.md) and [b](../up.md) and [c](#anchor)",
    );
    assert.deepEqual(links, []);
  });

  it("ignores a bare URL in prose", () => {
    // Deliberate. Trailing sentence punctuation is not part of a URL, and a
    // regex cannot reliably tell where prose ends — so the sweep reports a
    // break that is really a full stop, once a week, until nobody reads it.
    assert.deepEqual(extractLinks("Go to https://example.org/thing."), []);
  });

  it("finds an image source, because a broken image is a broken link", () => {
    const [link] = extractLinks("![diagram](https://example.org/d.png)");
    assert.equal(link?.url, "https://example.org/d.png");
  });

  it("returns links in document order", () => {
    const links = extractLinks(
      [
        "<https://example.org/second>",
        "[first](https://example.org/first)",
      ].join("\n"),
    );
    // Three separate patterns run over the whole document, so without the sort
    // the report is ordered by pattern rather than by where the reader will
    // look for it.
    assert.deepEqual(
      links.map((l) => l.line),
      [1, 2],
    );
  });
});

/**
 * Links that point back at this repository on GitHub.
 *
 * These are resolved against the working tree rather than fetched, for a reason
 * the first live run of the sweep supplied: **GitHub answers 404, not 403, for
 * a private repository**, so every self-link read as broken and the report was
 * five-sixths false. The "403 means unverified" rule does not help, and would
 * be the wrong fix anyway — the filesystem knows the answer exactly, offline,
 * and early enough to gate a pull request on.
 */
describe("self-link resolution", () => {
  let isSelfLink: CheckLinks["isSelfLink"];
  let selfLinkTarget: CheckLinks["selfLinkTarget"];

  const REPO = "Shai-Alit/sas-py-vscode";

  before(async () => {
    ({ isSelfLink, selfLinkTarget } =
      await loadScript<CheckLinks>("check-links.mjs"));
  });

  it("recognises a link into this repository", () => {
    assert.equal(
      isSelfLink(`https://github.com/${REPO}/blob/main/README.md`, REPO),
      true,
    );
    assert.equal(
      isSelfLink("https://github.com/sassoftware/vscode-sas-extension", REPO),
      false,
    );
  });

  it("does not mistake a repository whose name merely starts the same way", () => {
    // Without the trailing slash, `…/sas-py-vscode-fork` would be treated as
    // this repository and checked against a working tree it is not in.
    assert.equal(
      isSelfLink(`https://github.com/${REPO}-fork/blob/main/README.md`, REPO),
      false,
    );
  });

  it("extracts the repository-relative path from a blob URL", () => {
    assert.equal(
      selfLinkTarget(
        `https://github.com/${REPO}/blob/main/test/fixtures/README.md`,
        REPO,
      ),
      "test/fixtures/README.md",
    );
  });

  it("ignores a fragment, which names a place inside the file", () => {
    assert.equal(
      selfLinkTarget(
        `https://github.com/${REPO}/blob/main/CONTRIBUTING.md#tests`,
        REPO,
      ),
      "CONTRIBUTING.md",
    );
  });

  it("returns null for a GitHub feature URL, which is not a file", () => {
    // `/commits/main` and `/security/advisories/new` are real destinations with
    // nothing on disk behind them. Reporting those as missing files would be a
    // false alarm of exactly the kind this whole design is trying to avoid.
    for (const url of [
      `https://github.com/${REPO}/commits/main`,
      `https://github.com/${REPO}/security/advisories/new`,
      `https://github.com/${REPO}/blob/main`,
    ]) {
      assert.equal(selfLinkTarget(url, REPO), null, url);
    }
  });

  it("treats an undiscoverable repository as no self-links, not as all of them", () => {
    // If `package.json` ever loses its `repository.url`, the slug is undefined.
    // Claiming every github.com link is a self-link would then check them all
    // against the filesystem and fail the build for links that are fine.
    assert.equal(
      isSelfLink(`https://github.com/${REPO}/blob/main/README.md`, undefined),
      false,
    );
    assert.equal(
      selfLinkTarget(
        `https://github.com/${REPO}/blob/main/README.md`,
        undefined,
      ),
      null,
    );
  });
});

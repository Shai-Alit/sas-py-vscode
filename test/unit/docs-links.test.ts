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

  it("leaves the closing paren out of the URL", () => {
    // `](url)` is greedy by temperament; a URL that swallowed the paren 404s
    // every week and the report is wrong every week.
    const [link] = extractLinks("[x](https://example.org/a_(b))");
    assert.equal(link?.url, "https://example.org/a_(b");
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

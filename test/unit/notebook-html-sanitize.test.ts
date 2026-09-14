// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { sanitizeHtml } from "../../src/notebook/htmlSanitize";

describe("notebook/htmlSanitize", () => {
  describe("sanitizeHtml", () => {
    it("passes through a plain pandas-shaped table unchanged", () => {
      const html =
        '<table border="1" class="dataframe">' +
        "<thead><tr><th></th><th>a</th></tr></thead>" +
        '<tbody><tr><th>0</th><td style="text-align: right;">1</td></tr></tbody>' +
        "</table>";
      assert.equal(sanitizeHtml(html), html);
    });

    it("drops a <script> tag and its content entirely", () => {
      const result = sanitizeHtml(
        "<div>before</div><script>alert(document.cookie)</script><div>after</div>",
      );
      assert.equal(result, "<div>before</div><div>after</div>");
      assert.ok(!result.includes("script"));
      assert.ok(!result.includes("alert"));
    });

    it("drops a script disguised inside a raw-text element's own content", () => {
      // A real parser never re-tokenizes <script>'s content as tags — this
      // confirms this sanitizer doesn't either, i.e. a "<div>" sitting inside
      // a dropped <script> block cannot resurface as a real tag boundary.
      const result = sanitizeHtml(
        '<script>var s = "<div onclick=alert(1)>";</script><p>ok</p>',
      );
      assert.equal(result, "<p>ok</p>");
    });

    it("strips on* event-handler attributes on both allowed and disallowed tags", () => {
      const result = sanitizeHtml(
        '<div onclick="alert(1)" class="kept">hi</div>' +
          '<img src="data:image/png;base64,AAAA" onerror="alert(2)">',
      );
      assert.ok(!/onclick|onerror/i.test(result));
      assert.ok(result.includes('class="kept"'));
      assert.ok(result.includes('src="data:image/png;base64,AAAA"'));
    });

    it("drops the whole style attribute rather than leaving a css exfil vector", () => {
      const result = sanitizeHtml(
        '<div style="background:url(javascript:alert(1))">x</div>',
      );
      assert.ok(!result.includes("style="));
      assert.equal(result, "<div>x</div>");
    });

    it("drops a <style> block containing @import, keeps a plain one", () => {
      const dangerous = sanitizeHtml(
        "<style>@import url(https://evil.example/x.css);</style><p>ok</p>",
      );
      assert.equal(dangerous, "<p>ok</p>");

      const plain = sanitizeHtml(
        "<style>.dataframe td { text-align: right; }</style><p>ok</p>",
      );
      assert.equal(
        plain,
        "<style>.dataframe td { text-align: right; }</style><p>ok</p>",
      );
    });

    it("drops an <img> whose src is not an inline base64 raster image", () => {
      const remote = sanitizeHtml('<img src="https://evil.example/track.png">');
      assert.equal(remote, "");
      const js = sanitizeHtml('<img src="javascript:alert(1)">');
      assert.equal(js, "");
      const svg = sanitizeHtml(
        '<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">',
      );
      assert.equal(svg, "");
    });

    it("keeps an <img> with a valid inline base64 png and its alt text", () => {
      const result = sanitizeHtml(
        '<img src="data:image/png;base64,AAAA" alt="a chart">',
      );
      assert.equal(
        result,
        '<img src="data:image/png;base64,AAAA" alt="a chart">',
      );
    });

    it("drops <iframe> and its content", () => {
      const result = sanitizeHtml(
        '<iframe src="https://evil.example"><p>fallback</p></iframe><p>ok</p>',
      );
      assert.equal(result, "<p>ok</p>");
    });

    it("drops <a>, keeping its text — no href is ever allowed through", () => {
      const result = sanitizeHtml('<a href="javascript:alert(1)">click me</a>');
      assert.equal(result, "click me");
    });

    it("strips an HTML comment, including one hiding a tag inside it", () => {
      const result = sanitizeHtml(
        "<!-- <script>alert(1)</script> --><p>ok</p>",
      );
      assert.equal(result, "<p>ok</p>");
    });

    it("drops an unknown tag but keeps its text content", () => {
      const result = sanitizeHtml("<foo bar='baz'>text</foo>");
      assert.equal(result, "text");
    });

    it("is case-insensitive for tag and attribute names", () => {
      const result = sanitizeHtml(
        '<DIV CLASS="x">hi</DIV><SCRIPT>bad()</SCRIPT>',
      );
      assert.equal(result, '<div class="x">hi</div>');
    });

    it("keeps entity-encoded angle brackets as literal text, not as tags", () => {
      const result = sanitizeHtml("&lt;script&gt;alert(1)&lt;/script&gt;");
      assert.equal(result, "&lt;script&gt;alert(1)&lt;/script&gt;");
    });

    it("only allows a numeric (optionally %-suffixed) value for sizing attributes", () => {
      const good = sanitizeHtml(
        '<table width="100%" border="1"><tr></tr></table>',
      );
      assert.equal(good, '<table width="100%" border="1"><tr></tr></table>');
      const bad = sanitizeHtml(
        '<table width="expression(alert(1))"><tr></tr></table>',
      );
      assert.equal(bad, "<table><tr></tr></table>");
    });

    it("auto-closes tags left open by malformed input, in the right order", () => {
      const result = sanitizeHtml("<div><span>unclosed");
      assert.equal(result, "<div><span>unclosed</span></div>");
    });

    it("does not treat a real HTML5 self-closing <div/> as self-closing", () => {
      // HTML (not XML) ignores the trailing "/" on a non-void element — the
      // tag stays open until an explicit close tag, exactly like a browser.
      const result = sanitizeHtml("<div/>x</div>");
      assert.equal(result, "<div>x</div>");
    });

    it("escapes a stray < in text so it can never be read as a tag start", () => {
      const result = sanitizeHtml("1 < 2");
      assert.equal(result, "1 &lt; 2");
    });

    it("skips a doctype, terminated or not", () => {
      assert.equal(sanitizeHtml("<!DOCTYPE html><p>ok</p>"), "<p>ok</p>");
      // No closing ">" at all — the rest of the input has nothing trustworthy
      // left in it, the same "stop" choice an unterminated tag makes.
      assert.equal(sanitizeHtml("<!DOCTYPE html"), "");
    });

    it("treats a malformed close tag's < as literal text, not as a tag start", () => {
      const result = sanitizeHtml("</ >ok");
      assert.equal(result, "&lt;/ &gt;ok");
    });

    it("stops at an unterminated open tag, keeping only what came before it", () => {
      const result = sanitizeHtml('hi<div class="unterminated');
      assert.equal(result, "hi");
    });

    it("keeps the first value when an attribute is repeated", () => {
      const result = sanitizeHtml('<div class="first" class="second">x</div>');
      assert.equal(result, '<div class="first">x</div>');
    });

    it("consumes an unterminated comment to the end of input", () => {
      assert.equal(sanitizeHtml("before<!-- unterminated"), "before");
    });

    it("drops an unterminated <script>, consuming to the end of input", () => {
      assert.equal(sanitizeHtml("before<script>alert(1)"), "before");
    });
  });
});

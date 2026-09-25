// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Sanitizes `text/html` output before it reaches VS Code's own built-in
 * notebook renderer (`./notebookRender.ts`'s doc comment; adversarial review,
 * 2026-09-14, Finding 1).
 *
 * ## Why this exists, and why it is not CSP
 *
 * [ADR-0021](../../docs/adr/0021-result-panel-webview.md) makes a `<script>`
 * tag inert in the result panel *structurally* — a nonce-locked CSP the panel
 * itself owns — precisely because `text/html` there is pandas/user-Python
 * output, not SAS's own trusted ODS HTML. A notebook cell's `text/html`
 * output is the exact same payload, but VS Code core's own bundled
 * `notebook-renderers` extension owns the rendering, not this extension's own
 * webview — there is no CSP for this extension to set. Sanitizing the markup
 * itself, before it ever reaches that renderer, is the only lever available
 * here; [ADR-0036](../../docs/adr/0036-notebook-html-output-is-sanitized.md)
 * records the decision and why an allow-list beats a deny-list for this.
 *
 * ## Design: allow-list, re-serialize, never copy a raw slice through
 *
 * A deny-list (strip `<script>`, strip `onerror=`) is the classic way this
 * kind of sanitizer gets bypassed — there is always one more attribute or
 * tag nobody thought to name. This instead tokenizes the input and rebuilds
 * the output from scratch: only tag names and attribute names on a fixed
 * allow-list are ever emitted, every attribute value is validated or
 * re-escaped rather than copied verbatim, and anything not recognized is
 * simply dropped. Getting an edge case wrong in this design degrades to
 * losing some formatting, not to executing script — the failure mode a
 * deny-list does not have.
 *
 * `<script>`, `<style>`'s dangerous siblings (`<textarea>`, `<title>`,
 * `<xmp>`, `<iframe>`, `<noembed>`, `<noframes>`, `<noscript>`) are handled as
 * the "raw text" elements a real HTML parser treats them as — their content
 * is never re-tokenized as tags, so a payload like
 * `<script>"<div>"</script>` cannot smuggle a `<div>` past this scan by
 * hiding it inside a tag this sanitizer already intends to drop wholesale.
 * `<style>` is the one raw-text element kept (pandas' `Styler.to_html()`
 * needs it) — its content is treated as CSS, not HTML, and dropped wholesale
 * if it contains anything that could reach outside the page (`url(`,
 * `@import`, `expression(`, `-moz-binding`, `javascript:`, `behavior:`, a
 * backslash, or an `&` — CSS lets those constructs be spelled as escapes,
 * e.g. `\75\72\6c(` for `url(`, and an HTML attribute value additionally
 * lets them be spelled as character references, e.g. `&#x72;` for `r`, so
 * either kind of encoding at all is treated as dangerous rather than decoded
 * and re-checked). `style="…"` attribute values get the same check.
 *
 * `<svg>` is dropped with its whole subtree, text included (ADR-0038). An
 * unknown tag normally keeps its children as text, but an SVG figure's
 * children are metadata (`<dc:format>image/svg+xml</dc:format>`, the
 * matplotlib version), and keeping them turned a `SAS.show(plt)` figure into
 * junk text in a cell (Finding 12.14). Nothing inside is ever emitted, so a
 * malformed or unclosed `<svg>` can only lose more content, never let any
 * through.
 *
 * No tag carries a URL-bearing attribute except `<img src>`, and that is
 * restricted to an inline `data:image/…;base64,…` value — the same
 * `img-src … data:` restriction ADR-0021 already applies to the result
 * panel's own CSP, applied here by validating the value instead of by a
 * policy header.
 */

const RAW_TEXT_DROP_TAGS = new Set([
  "script",
  "textarea",
  "title",
  "xmp",
  "iframe",
  "noembed",
  "noframes",
  "noscript",
]);

const VOID_TAGS = new Set(["br", "hr", "img", "col"]);

const ALLOWED_TAGS = new Set([
  "table",
  "caption",
  "colgroup",
  "col",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "div",
  "span",
  "p",
  "br",
  "hr",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "b",
  "i",
  "u",
  "em",
  "strong",
  "small",
  "sub",
  "sup",
  "code",
  "pre",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "img",
  "style",
]);

/** Attributes allowed on any {@link ALLOWED_TAGS} element, value passed
 * through opaque-and-escaped (except `style`, checked by {@link isDangerousCss}). */
const GLOBAL_ATTRS = new Set([
  "class",
  "style",
  "id",
  "title",
  "align",
  "valign",
  "scope",
]);

/** Allowed only as a bare non-negative integer, optionally `%`-suffixed for
 * `width`/`height` — table-sizing attributes pandas' own `to_html()` emits. */
const NUMERIC_ATTRS = new Set([
  "colspan",
  "rowspan",
  "border",
  "cellpadding",
  "cellspacing",
  "width",
  "height",
]);

const NUMERIC_VALUE = /^\d+%?$/;

/** `url(`, `@import` and friends — the CSS constructs that can reach outside
 * the page (a remote fetch, or the old IE `expression()`/`behavior:`
 * script-in-CSS tricks). Matched, not stripped: a `style` this matches is
 * dropped wholesale rather than surgically edited, which is the safer of the
 * two — a partial edit of CSS text is exactly the kind of thing a bypass
 * hides in. */
const CSS_DANGER =
  /url\s*\(|@import|expression\s*\(|-moz-binding|javascript\s*:|behavior\s*:/i;

/** A literal backslash or `&` anywhere in the value. Two independent ways
 * exist to spell `url(` (or `@import`, `javascript:`, …) without the literal
 * substring {@link CSS_DANGER} looks for ever appearing: a CSS escape
 * (`\75\72\6c(` decodes to `url(` once a real CSS parser resolves it) or an
 * HTML character reference (`&#x72;` decodes to `r` once a real HTML parser
 * builds the attribute value from source — this one applies to a `style="…"`
 * attribute specifically, since attribute values go through entity decoding
 * on the way into the DOM the same way ordinary text content does).
 * Adversarial review, 2026-09-15 (PR #177), found the backslash case first;
 * a follow-up review the same day found the `&` case survived that fix.
 * Rather than reimplement CSS-escape decoding and HTML-entity decoding to
 * check *after* them both, either character at all is treated as dangerous:
 * legitimate `Styler.to_html()` output has no reason to contain either, so
 * this loses nothing real while closing the whole class of encoding-based
 * obfuscation, not just the specific encodings a review happened to try. */
function isDangerousCss(value: string): boolean {
  return CSS_DANGER.test(value) || value.includes("\\") || value.includes("&");
}

/** Only an inline base64 raster image — the same `data:` restriction ADR-0021
 * applies to the result panel's own `img-src` CSP directive. `svg+xml` is
 * deliberately excluded: an SVG can carry its own `<script>`. */
const DATA_IMAGE_SRC =
  /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i;

/** A bare `&`, or one already starting a real entity (`&amp;`, `&#39;`,
 * `&#x27;`) left alone — escaping every `&` unconditionally would
 * double-encode legitimate entities already in the source (`R&amp;D` would
 * become `R&amp;amp;D`, a formatting regression this sanitizer has no reason
 * to cause; the value is text-safe either way, since a lone `&` this pattern
 * does escape can never combine with what follows to form markup). */
const AMPERSAND_NEEDING_ESCAPE =
  /&(?![a-zA-Z][a-zA-Z0-9]*;|#[0-9]+;|#x[0-9a-fA-F]+;)/g;

function escapeAmpersand(text: string): string {
  return text.replace(AMPERSAND_NEEDING_ESCAPE, "&amp;");
}

function escapeText(text: string): string {
  return escapeAmpersand(text).replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttrValue(value: string): string {
  return escapeAmpersand(value)
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Scans a tag's contents (from just after its name) for the unquoted `>`
 * that ends it — a plain `indexOf(">")` would stop early at a `>` inside a
 * quoted attribute value (`title=">"`, say). */
function findTagEnd(
  html: string,
  start: number,
): { readonly index: number } | undefined {
  let quote: string | undefined;
  for (let j = start; j < html.length; j += 1) {
    const c = html[j];
    if (quote !== undefined) {
      if (c === quote) quote = undefined;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === ">") return { index: j };
  }
  return undefined;
}

const ATTR_PATTERN =
  /([a-zA-Z][a-zA-Z0-9-]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** Parses `name=value` pairs out of one tag's already-bounded attribute
 * source (between the tag name and the closing `>`) — safe as a regex scan
 * because the boundary itself was already found by {@link findTagEnd}'s
 * quote-aware walk, not by this pattern. */
function parseAttrs(source: string): Map<string, string> {
  const attrs = new Map<string, string>();
  ATTR_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR_PATTERN.exec(source)) !== null) {
    const name = match[1]?.toLowerCase();
    // `?.` only for `noUncheckedIndexedAccess` — the pattern's first group
    // (`[a-zA-Z][a-zA-Z0-9-]*`) is not optional, so a successful match always
    // captures it; this branch cannot be exercised by any input.
    /* c8 ignore next */
    if (name === undefined) continue;
    if (attrs.has(name)) continue;
    attrs.set(name, match[3] ?? match[4] ?? match[5] ?? "");
  }
  return attrs;
}

/** Renders the attributes this sanitizer will keep for `tagName`, already
 * validated and escaped — `undefined` for `<img>` specifically means "no
 * valid `src`", which the caller treats as "drop the whole tag". */
function buildAttrs(
  tagName: string,
  attrs: Map<string, string>,
): string | undefined {
  let out = "";
  let sawValidImgSrc = false;
  for (const [name, value] of attrs) {
    if (tagName === "img" && name === "src") {
      if (DATA_IMAGE_SRC.test(value)) {
        out += ` src="${escapeAttrValue(value)}"`;
        sawValidImgSrc = true;
      }
      continue;
    }
    if (tagName === "img" && name === "alt") {
      out += ` alt="${escapeAttrValue(value)}"`;
      continue;
    }
    if (NUMERIC_ATTRS.has(name)) {
      if (NUMERIC_VALUE.test(value)) out += ` ${name}="${value}"`;
      continue;
    }
    if (name === "style") {
      if (!isDangerousCss(value)) out += ` style="${escapeAttrValue(value)}"`;
      continue;
    }
    if (GLOBAL_ATTRS.has(name)) out += ` ${name}="${escapeAttrValue(value)}"`;
  }
  if (tagName === "img" && !sawValidImgSrc) return undefined;
  return out;
}

/** Finds the end of one raw-text element's content — a real HTML parser's
 * own rule for `<script>`/`<style>`/etc: everything up to the literal closing
 * tag is content, never re-tokenized as markup. `end` of input counts as the
 * boundary when no closing tag appears, the same "nothing after this can be
 * trusted, stop" choice {@link sanitizeHtml}'s own unterminated-tag case
 * makes.
 *
 * The real HTML5 tokenizer ends a raw-text element on `</tagName` followed
 * by *any* tag-name-terminating character — whitespace, `/`, or `>`, not
 * only a bare `</tagName>` — and then consumes everything up to the next
 * real `>` as that end tag's (bogus) attributes, the same way a real open
 * tag's attributes are consumed. Requiring only `\s*>` here let
 * `</style/>` walk straight past this function without ending the element,
 * so content after it — including a live `<script>` — was re-emitted as
 * "safe, already-scanned CSS text" verbatim (adversarial review, 2026-09-15,
 * PR #177). Matching just the terminator and then reusing
 * {@link findTagEnd}'s own quote-aware scan for the real `>` mirrors the
 * spec instead of guessing at one more literal pattern. */
function findRawTextEnd(
  html: string,
  start: number,
  tagName: string,
): { readonly contentEnd: number; readonly afterClose: number } {
  const closeStart = new RegExp(`</${tagName}(?=[\\s/>])`, "i");
  const match = closeStart.exec(html.slice(start));
  if (match === null)
    return { contentEnd: html.length, afterClose: html.length };
  const contentEnd = start + match.index;
  const tagEnd = findTagEnd(html, contentEnd + match[0].length);
  return {
    contentEnd,
    afterClose: tagEnd === undefined ? html.length : tagEnd.index + 1,
  };
}

/**
 * Turns arbitrary `text/html` into a safe subset that cannot execute script
 * or fetch anything remote, for VS Code's own built-in notebook renderer to
 * show as real `text/html`. See this module's own doc comment for the design.
 */
export function sanitizeHtml(html: string): string {
  let out = "";
  let i = 0;
  const stack: string[] = [];
  const n = html.length;
  /** How many `<svg>` elements the scan is inside. While above zero nothing
   * is emitted — see this module's own doc comment. */
  let svgDepth = 0;
  const emit = (text: string): void => {
    if (svgDepth === 0) out += text;
  };

  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      emit(escapeText(html.slice(i)));
      break;
    }
    if (lt > i) emit(escapeText(html.slice(i, lt)));

    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (html.startsWith("<!", lt) || html.startsWith("<?", lt)) {
      const end = html.indexOf(">", lt + 2);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (html.startsWith("</", lt)) {
      const closeMatch = /^<\/([a-zA-Z][a-zA-Z0-9]*)\s*>/.exec(html.slice(lt));
      if (closeMatch === null) {
        emit("&lt;");
        i = lt + 1;
        continue;
      }
      const name = closeMatch[1]?.toLowerCase();
      i = lt + closeMatch[0].length;
      if (svgDepth > 0) {
        if (name === "svg") svgDepth -= 1;
        continue;
      }
      if (name !== undefined && stack[stack.length - 1] === name) {
        stack.pop();
        out += `</${name}>`;
      }
      // A mismatched close tag is dropped rather than reconciled against the
      // stack — always safe (the final unwind below still closes everything
      // genuinely left open), just not a perfect replay of a malformed input.
      continue;
    }

    const openMatch = /^<([a-zA-Z][a-zA-Z0-9]*)/.exec(html.slice(lt));
    if (openMatch === null) {
      emit("&lt;");
      i = lt + 1;
      continue;
    }
    // Same `noUncheckedIndexedAccess` artifact as `parseAttrs`'s own `name`
    // above — `openMatch`'s pattern requires this group to match.
    /* c8 ignore next */
    const rawName = openMatch[1] ?? "";
    const name = rawName.toLowerCase();
    const tagEnd = findTagEnd(html, lt + 1 + rawName.length);
    if (tagEnd === undefined) break; // Unterminated tag — nothing after it is trustworthy.
    const selfClosed = html[tagEnd.index - 1] === "/";
    const attrsSource = html.slice(
      lt + 1 + rawName.length,
      selfClosed ? tagEnd.index - 1 : tagEnd.index,
    );
    i = tagEnd.index + 1;

    if (RAW_TEXT_DROP_TAGS.has(name)) {
      i = findRawTextEnd(html, i, name).afterClose;
      continue;
    }
    if (name === "svg") {
      if (!selfClosed) svgDepth += 1;
      continue;
    }
    if (svgDepth > 0) {
      // A `<style>` inside an SVG is skipped as raw text, like the drop set
      // above, so its CSS is never scanned for tags.
      if (name === "style") i = findRawTextEnd(html, i, name).afterClose;
      continue;
    }
    if (name === "style") {
      const { contentEnd, afterClose } = findRawTextEnd(html, i, name);
      const css = html.slice(i, contentEnd);
      if (!isDangerousCss(css)) out += `<style>${css}</style>`;
      i = afterClose;
      continue;
    }
    if (!ALLOWED_TAGS.has(name)) continue; // Unknown/unsafe tag dropped; its children are ordinary content.

    const attrs = parseAttrs(attrsSource);
    const built = buildAttrs(name, attrs);
    if (built === undefined) continue; // `<img>` with no valid `src` — drop it entirely.
    out += `<${name}${built}>`;
    if (!VOID_TAGS.has(name)) stack.push(name);
  }

  let stillOpen: string | undefined;
  while ((stillOpen = stack.pop()) !== undefined) out += `</${stillOpen}>`;
  return out;
}

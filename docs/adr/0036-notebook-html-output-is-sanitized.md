# ADR-0036 — A notebook cell's `text/html` output is sanitized before render, not CSP-locked

- **Status:** Accepted — amended by [ADR-0038](0038-every-run-is-wrapped-in-a-named-ods-destination.md), 2026-09-24: an `<svg>` element is dropped with its whole subtree, text included, and replaced by a note; an ODS body's `<style>` is dropped in full (Finding 12.18)
- **Date:** 2026-09-14
- **Decides:** how a notebook cell's `text/html` output (the same
  `RichOutput` arm the result panel renders) is kept from executing a
  `<script>` tag, given this surface has no CSP of its own to lean on
- **Constrained by:** ADR-0021 (the result panel's CSP-based answer to the
  same threat), ADR-0005 (supply chain — the extension has zero runtime
  dependencies, and this decision keeps it that way)
- **Executed in:** slice 9c, adversarial review (Finding 1), same day as the
  slice's own code-complete cut

## Context

9c wires `text/html`/`image/png` output to VS Code core's own bundled
`notebook-renderers` extension — the finding that made a dedicated renderer
script unnecessary (`docs/phases/phase-9.md`'s 9c Runbook entry). That
renderer really does execute an embedded `<script>`: its `renderHTML()`
assigns the payload to `element.innerHTML` and then calls `domEval()`, which
copies every `<script>` tag in the markup into a live one and runs it. The
only gate is `ctx.workspace.isTrusted` — and ADR-0002 already requires a
trusted workspace before *any* code in this extension runs at all, so that
gate is always open for output this extension itself produced.

[ADR-0021](0021-result-panel-webview.md) settled the identical question for
the result panel: `text/html` there is a pandas/user-Python
`DataFrame.to_html()`-shaped repr, produced by **the user's own Python code**
running against packages someone else chose, not SAS's own trusted ODS HTML —
exactly the payload `SECURITY.md` already names as needing to stay inert. That
ADR's answer is a nonce-locked CSP the panel's own `WebviewPanel` sets: "a
`<script>` tag embedded inside a `text/html` output is inert — CSP blocks it
from executing regardless of what it contains." The notebook surface renders
the exact same `RichOutput` arm, but has no webview of this extension's own to
set a policy on — VS Code core's own renderer owns the DOM here. The
"single load-bearing difference from upstream's approach" ADR-0021 names is
therefore not available to this surface at all.

**The stakes are worse here than for the panel, not merely different.** A
notebook's outputs are serialized into the `.ipynb` file on save. A malicious
payload persists and re-executes on reopen, with no Viya round trip — including
for a colleague who opens a `.ipynb` someone sent them, inside an already-trusted
workspace (ADR-0002's gate satisfied by the workspace, not by anything specific
to that file).

## Decision

`src/notebook/htmlSanitize.ts`'s `sanitizeHtml` runs on every `text/html`
`RichOutput` before it is turned into a `vscode.NotebookCellOutputItem`
(`notebookRender.ts`'s `toNotebookOutputPieces`) — the markup that finally
reaches VS Code's own renderer is a safe subset, not the original payload.

### Allow-list and re-serialize, not deny-list and edit

A deny-list (strip `<script>`, strip `onerror=`) is the familiar answer and
the one this project already has a documented aversion to for exactly this
kind of problem — ADR-0021's own "Alternatives considered" rejected an
allow-list *parser* for the panel case, but for a different reason (CSP was
available and cheaper there). Here, with no CSP available, the choice is
between a deny-list edit and an allow-list rebuild, and an allow-list is the
one with a bounded failure mode: only tag names and attribute names on a
fixed list are ever emitted by the sanitizer itself, every attribute value is
either validated (a `data:image/…;base64,…` regex for `<img src>`, a plain
integer for a sizing attribute) or re-escaped rather than copied verbatim,
and anything the sanitizer does not recognize is simply dropped. Getting an
edge case wrong degrades to lost formatting, not to executed script.

`<script>` and its raw-text siblings (`<textarea>`, `<title>`, `<xmp>`,
`<iframe>`, `<noembed>`, `<noframes>`, `<noscript>`) are handled the way a
real HTML parser treats them: their content is never re-tokenized as markup,
so a payload cannot smuggle a tag past the scan by hiding it inside an
element the sanitizer already intends to drop wholesale. `<style>` is the one
raw-text element kept — `pandas.DataFrame.style.to_html()` needs it — with
its content treated as CSS and dropped wholesale (not surgically edited) if
it contains `url(`, `@import`, `expression(`, `-moz-binding`, `javascript:`,
or `behavior:`. No tag carries a URL-bearing attribute except `<img src>`,
restricted to an inline base64 raster image — the same restriction ADR-0021
puts on the panel's own `img-src` CSP directive, applied here by validating
the value instead of by a policy header.

### No new dependency

This is hand-written, not a library. ADR-0005 records that this extension has
zero runtime dependencies, and that the production `npm audit --omit=dev`
gate — currently vacuous — becomes real "the day a runtime dependency is
added, which is exactly the day nobody will want to be designing one."
Reaching for an HTML-parsing package here would be the first one, on a
change already under time pressure, for a problem this small a surface
(pandas/library `_repr_html_` output, not arbitrary documents) does not need
one to solve. `htmlSanitize.ts`'s own doc comment has the full design; it is
exercised by `test/unit/notebook-html-sanitize.test.ts` at 100% lines/100%
functions.

## Alternatives considered

**Build this extension's own CSP-locked notebook renderer** — the
upstream-`HTMLRenderer.ts`-shaped work 9c's own spike concluded it didn't
need, once VS Code's built-in renderer was found to already cover the
standard mimes this project's `RichOutput` union uses. Revisiting that
conclusion to get CSP back would mean contributing a `notebookRenderer` for
`text/html` alongside VS Code core's own — which already owns that mime — and
resolving the resulting priority/selection question, plus a second browser
`esbuild` context. Rejected for this decision: real, open-ended scope growth
to recover a guarantee the allow-list sanitizer already gives for the actual
threat (script execution), not a proportionate response to it. Worth
revisiting if a future need for genuinely rich, script-bearing `text/html`
output (an interactive Plotly/Bokeh-style visualization, say) ever makes the
sanitizer's "safe subset" cost too much lost functionality — that output
already renders inert either way today, matching the same "the same
load-bearing constraint" cost the result panel already accepts for the
identical case.

**Accept script execution on the notebook surface via an ADR amendment,
reasoning from ADR-0002's workspace-trust gate already being open for any
code this extension runs.** Considered, because the gate genuinely is already
open for *this extension's own* actions. Rejected: it does not follow for a
notebook file specifically, because of the persistence property above — a
`.ipynb` is a *document* a trusted-workspace user can receive from someone
else and open, at which point the "script" being trusted is not something
either party chose to run, only a file either party chose to open. That is a
materially different exposure than a webview the user only ever asks this
extension to produce for them at the moment they run code.

**A deny-list of dangerous tags/attributes, edited in place rather than
rebuilt.** Rejected on the same grounds `htmlSanitize.ts`'s own doc comment
gives: there is always one more attribute or tag nobody thought to name, and
a deny-list's failure mode is silent execution, not lost formatting.

## Consequences

`src/notebook/htmlSanitize.ts` lands in the unit-tier coverage denominator
like any other pure module (ADR-0009) — it imports nothing from `vscode`.
`notebookRender.ts`'s own `text/html` case, and its doc comment, now name
this ADR. A `text/html` output that relies on `<script>` for its rendering
(an interactive chart library's default embed, say) renders as inert,
static markup on this surface — the same cost ADR-0021 already accepts for
the result panel, now paid consistently on both surfaces rather than only
one of them silently having the guarantee the other lacks.

**Revisit trigger.** If a future slice needs to render genuinely
script-dependent `text/html` (an interactive visualization embed), the CSP
renderer alternative above is the one to build, not a looser sanitizer.

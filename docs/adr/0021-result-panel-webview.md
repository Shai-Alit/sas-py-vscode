# ADR-0021 — The result panel is a singleton `WebviewPanel`, CSP-locked, fed by a buffered message protocol, with its DOM layer kept inside the coverage denominator by a port

- **Status:** Accepted
- **Date:** 2026-08-26
- **Decides:** how 3d-ii's result panel is built — the webview mechanism, its
  Content-Security-Policy, the host↔webview messaging protocol, where the
  localisation boundary sits, how its DOM-touching code is tested, and how
  `check-coverage-scope.mjs` treats the one file that genuinely cannot be
- **Constrained by:** ADR-0009 (coverage denominator), ADR-0015 (the
  `RichOutput` union this panel renders), `SECURITY.md` ("Anything in a
  **webview** — content-security-policy gaps, `unsafe-inline`, remote script
  loading, or unvalidated messages crossing the extension/webview boundary" is
  explicitly in scope for a security report)
- **Executed in:** slice 3d-ii

## Context

This is the repository's first webview. Nothing here inherits a pattern from
elsewhere in this codebase, and the one precedent this project explicitly
takes as a reference — upstream `vscode-sas-extension`'s own
`ResultPanel.ts` — turns out not to transfer. Upstream's `showResult(html)`
takes ODS HTML *already produced by SAS itself* and assigns it straight to
`webviewPanel.webview.html` with `enableScripts: true` and no declared CSP at
all; the only script-stripping it does (`SCRIPT_REGEX`) runs on a *second*
code path (`fetchHtmlFor`, used for a hover preview) and not on the path that
actually renders the panel. That is a defensible choice for upstream's own
payload — the HTML comes from SAS's own ODS engine, not from an end user's
program — but it is not defensible for this project's payload: `text/html`
here is a pandas `DataFrame.to_html()` (or equivalent) repr, produced by
**the user's own Python code**, run against packages someone else chose on a
machine the user cannot log into. Trusting it enough to execute embedded
`<script>` is exactly the gap `SECURITY.md` already names as in-scope.

`RichOutput` (ADR-0015, `backend.ts`) has four arms — `text/plain`,
`text/html`, `image/png`, `application/vnd.python.traceback` — and 3d-i's
plan text is explicit that rendering all four, not just the two the output
channel already defers, is this slice's job: "renderers for the `RichOutput`
union." `outputChannel.ts`'s own doc comment says why a *second*, structured
rendering belongs here rather than there: a text channel cannot make an
image visible or a table tabular, and repeating a traceback as more text is
"the same information twice with no more of it readable."

Two things about this slice turned out to need a real decision before any
code was worth writing, because getting them wrong would mean redoing
foundational tooling rather than one file:

1. **How a stream of `RichOutput` reaches rendered pixels without trusting
   arbitrary user-authored HTML to execute.**
2. **How the webview's own browser-side bundle — code that, by definition,
   cannot import `vscode` and cannot run under Node — is tested**, given
   ADR-0009's coverage denominator currently recognises exactly two ways for
   a `src/` file to be legitimately unreachable by the unit tier (imports
   `vscode`; is types-only), and this is a third kind the rule has never
   seen.

## Decision

### Mechanism: one reused `WebviewPanel`, cleared per run

A single `WebviewPanel` (view type `pythonOnViya.resultPanel`), created once
and reused for every subsequent run in the window — the same singleton shape
`RunOutputChannel` already uses, for the same reason: a run names its
continuity in one place rather than accumulating tabs. `ViewColumn.Beside`,
`preserveFocus: true`, matching the output channel's own "watch alongside
your code, not pulled out of it" rule. Content is cleared (a `{type:
"reset"}` message) at the start of every run — this panel shows *this run's*
results, not a scrollback; the output channel remains the append-only
transcript across runs, and the two are not the same document by design.

**Reveal policy:** the panel is only forced into view (`.reveal()`) when a
run produces at least one output the output channel cannot already show in
full — `text/html`, `image/png`, or a structured traceback. A run that
produces only `text/plain` updates the panel's content (so a panel already
open from an earlier run stays consistent) but does not pop a second
editor-column tab open for an ordinary `print()` script. Decided this way
rather than upstream's "always show" default because upstream's ODS HTML
*is* the result for every SAS submission — there is no separate text
transcript competing with it — while here the output channel already is a
complete, always-shown transcript, and popping a second tab for a case it
adds literally nothing to is the kind of intrusion `PRODUCTION_PLAN.md`'s
"preserveFocus" ethos already argues against elsewhere in this slice's own
family.

### Content-security policy: no script may execute except this extension's own bundle

```
default-src 'none';
img-src {cspSource} data:;
style-src {cspSource} 'unsafe-inline';
script-src 'nonce-{nonce}';
```

- **`script-src 'nonce-{nonce}'`, never `'unsafe-inline'`.** The one script
  tag this extension emits carries the nonce; nothing else does. A
  `<script>` tag embedded inside a `text/html` output is inert — CSP blocks
  it from executing regardless of what it contains, which is what makes it
  safe to inject that payload's markup into the DOM at all. This is the
  single load-bearing difference from upstream's approach: upstream trusts
  its payload and therefore never needed this; this project cannot make that
  assumption about its own.
- **`style-src` allows `'unsafe-inline'`.** Rejected leaving this out: pandas'
  own `to_html()` emits inline `style` attributes for cell formatting, and a
  `style-src` that forbids them would render a `DataFrame` unstyled with no
  way for a user to fix it from their own code. This is the standard,
  accepted trade-off for rendering untrusted-but-not-executable HTML in a
  webview (VS Code's own built-in notebook renderers make the same call for
  the same reason) — a CSS-only side channel is a materially smaller risk
  than script execution, and closing it entirely would cost real
  functionality for a marginal gain.
- **`img-src` is `data:` only, plus the webview's own `cspSource`.** Every
  `image/png` output already arrives as base64 (ADR-0019's capture
  mechanism), so it is embedded as a `data:` URI directly — no
  `asWebviewUri` round trip to a file on disk is needed for images, and
  nothing here ever fetches a remote image.
- **`default-src 'none'`** closes everything not named above — no fonts, no
  media, no remote connections of any kind from inside the panel.

### Host↔webview messaging: a buffered, host-authored protocol

The host is the only side that decides *what a message says*; the webview
only ever lays out what it is handed.

- `{type: "reset"}` — a new run starting; clears prior content.
- `{type: "output", item: RenderItem}` — one streamed output, already turned
  into a fully-localised, DOM-agnostic shape by `src/run/resultPanelModel.ts`
  (pure, no `vscode`, no DOM — see below).
- `{type: "outcome", succeeded: boolean, diagnostics: readonly string[]}` /
  `{type: "failure", message: string}` — the run's conclusion, strings
  already localised host-side via `localiseBackendProblem`/`vscode.l10n.t()`,
  the same split `outputChannel.ts` already draws.
- `{type: "ready"}`, **webview → host**, sent once from the bootstrap script
  the instant its message listener is attached. The host buffers every
  message above until this arrives, then flushes them in order. This closes
  the one real race in a single-webview-document design: `postMessage` calls
  made before the webview's own script has loaded are simply lost, and a
  freshly created panel's very first output would be dropped silently
  without this handshake. A panel already loaded (every run after the
  first) already has a `ready` on file and never buffers again.

No other message travels webview → host in this slice — there is nothing
here for the user to do to the panel that changes program state, and adding
an interactive surface (copy an image, jump from a traceback frame to the
editor) is explicitly **Phase 4**'s job for the traceback-to-editor case
(`backend.ts`'s own `TracebackFrame.file` doc already assigns frame-to-editor
mapping there) and unscoped for anything else.

**The replay on `"ready"` is unconditional, and that is only correct because
of `retainContextWhenHidden: false`.** A `"ready"` message can only ever
originate from `src/webview/entry.ts`'s top-level script running, which can
only happen when the panel's webview document loads or reloads — there is no
other trigger. `retainContextWhenHidden: false` (the option this panel passes
explicitly, not just relies on as a default) is what guarantees a hide/show
cycle *is* a reload: VS Code discards the webview's document when its tab is
hidden and recreates it from `webview.html` when shown again, which is what
makes every `"ready"` this design will ever see correspond to a document that
just went blank. That is what makes replaying the whole backlog on every
`"ready"` — with no guard on whether a `"ready"` has already been seen —
correct rather than a source of duplicated content. Flipping
`retainContextWhenHidden` to `true` later (to preserve scroll position, say)
would break this reasoning and needs revisiting alongside it, not separately.

### The localisation boundary stays host-side, matching `outputChannel.ts`

Every user-facing string the webview displays — "Image", "Table", "Failed to
render output", the outcome summary — is produced by `vscode.l10n.t()` in
`src/run/resultPanel.ts` and travels across the message boundary already
finished. The webview-side code holds no English strings of its own to
translate, the same split `backend.ts`'s own doc comment already describes
for `outputChannel.ts`, extended to the second layer that now renders
`outputs`. `RichOutput.data`'s own untranslated fallback strings (`backend.ts`'s
documented, already-known gap) pass through exactly as they always have —
this slice does not touch that gap either way.

### Where the real logic lives, and where the coverage line is drawn

Three layers, in decreasing order of how much of the panel's behaviour they
carry — deliberately shaped so the layer that is hardest to test is also the
smallest possible:

1. **`src/run/resultPanelModel.ts` — pure, no `vscode`, no DOM.** Turns a
   `RichOutput` into a `RenderItem` (a plain, serialisable description: the
   image's alt text, the table's HTML string, the traceback's frames, the
   plain line's text) and turns an `ExecutionOutcome`/`BackendProblem` into
   the two outcome message shapes above. Ordinary Node-tier unit tests, the
   same shape `render.ts`'s own tests already take.
2. **`src/run/resultPanelDom.ts` — no `vscode` import, and, deliberately,
   no DOM *types* either — only DOM *concepts*, expressed against a small
   injected port.** Takes a `RenderItem` and a `DomPort` (`createElement`,
   `setAttribute`, `setText`, `appendChild` — the handful of operations
   rendering actually needs, described as this module's own interface, not
   borrowed from `lib.dom.d.ts`) and builds up the panel's content. Because
   the port is this module's own small interface rather than a real
   `HTMLElement`, this file needs nothing `tsconfig.json`'s ordinary
   `ES2022`-only `lib` doesn't already provide — which is exactly why it
   lives under `src/run/`, not `src/webview/`, and is **not** exempted from
   coverage: it is fully loadable under Node, tested in the ordinary unit
   tier against a fake `DomPort` that records what was asked of it, the
   exact shape `RunOutputChannelDeps.createChannel` already uses for
   `vscode.OutputChannel` — a port for the one thing a test cannot supply
   for real, injected, defaulting to the genuine global only at the
   composition root, which here is layer 3. This is the piece that carries
   the interesting decisions (an image gets `alt` text; a table's HTML is
   inserted as markup, not text, so real `<table>` semantics survive; a
   traceback gets a heading per frame).
3. **`src/webview/entry.ts` — the literal browser bootstrap, and the only
   file this slice puts under `src/webview/` at all.** `acquireVsCodeApi()`,
   the real `document`, a thin `DomPort` implementation that does nothing
   but forward each call to the real DOM (`createElement: (tag) =>
   document.createElement(tag)`, and so on), and a
   `window.addEventListener("message", …)` call wiring an incoming message to
   layer 2's `render`. No branch, no decision this file could get wrong that
   a test of layer 2 would not already have caught. Structurally excluded
   from the unit tier the same way a module importing `vscode` is: not
   "inconvenient to test", but literally impossible to load under Node,
   because `acquireVsCodeApi` and `document` do not exist there — which is
   also why this is the one file in the whole feature that needs
   `tsconfig.webview.json`'s DOM lib at all.

**`check-coverage-scope.mjs` gains a third, narrow, structurally-checked
exemption for layer 3**, extending the same mechanism that added
"types-only" as a second reason on 2026-08-16: `isBrowserOnly(file)` is true
for exactly the files under `src/webview/`, checked in both directions the
same as the other two — every file under `src/webview/` must be in
`.c8rc.json`'s exclude list, and every excluded path claiming this reason
must actually live there. `src/run/resultPanelModel.ts` and
`src/run/resultPanelDom.ts` are **not** excluded — they are ordinary,
unit-tested source with no DOM types and no `vscode` import, and belong in
the denominator like anything else.

### Build: a second, browser-target esbuild context

`src/webview/entry.ts` bundles to `dist/webview/resultPanel.js` via a second
`esbuild.context()` in `esbuild.mjs` — `platform: "browser"`, no `external:
["vscode"]` (nothing under `src/webview/` imports it), its own `target`
tracking Electron's bundled Chromium rather than Node. `src/run/resultPanel.ts`
references the built file via `webview.asWebviewUri`. A new `tsconfig.webview.json`
(`lib: ["ES2022", "DOM"]`, `types: []`) gives this one directory the browser
globals the rest of the extension's `tsconfig.json` deliberately excludes
(that exclusion is itself load-bearing — see its own comment on why `types`
is listed explicitly rather than left to discovery) — `src/webview/**` is
excluded from `tsconfig.json` and `tsconfig.test.json`'s `include` so the
same files are never asked to compile under both a Node-only and a
DOM-only type space at once.

## Alternatives considered

**Reassign `webview.html` wholesale on every update, upstream's own
approach.** Simpler — no message protocol, no bootstrap script, no second
esbuild context, no bidirectional handshake. Rejected: a full-document
reassignment reloads the webview's DOM from scratch on every single
streamed output during a run, which is wrong for exactly the case this slice
cares about (a long run producing several rich outputs in sequence) — it
would flash, lose any scroll position, and break any accessibility
continuity (a screen reader has no stable document to track). It also
neither builds nor needs the messaging/CSP/build-config work 3d-i's own plan
text names as this slice's explicit deliverables, so taking it would leave
those undone rather than done more simply.

**`jsdom` as a devDependency, to give the webview's DOM code a real
simulated browser under test.** Considered and rejected in favour of the
port-and-fake pattern above. This codebase already has a working answer to
"the one thing a test cannot supply for real" everywhere else
(`RunOutputChannelDeps`, `RunCommandDeps.activeTextEditor`/`showQuickPick`/
`withProgress`, `ComputeSessionDeps.createClient`) and extending it one layer
further to a `DomPort` costs nothing new, keeps the untested-by-construction
surface to a five-line bootstrap instead of a simulated browser environment,
and does not add a dependency whose only job is working around a design
choice that has a cheaper answer already living in the repository.

**A `WebviewView` (sidebar) instead of a `WebviewPanel` (editor-column
tab).** Rejected: needs a new `contributes.views` entry and a persistent
container the user did not ask for, for no benefit this slice needs — a
result belongs beside the code that produced it, matching both upstream's
own placement and the output channel's "alongside, not instead of" framing.

**Sanitising `text/html` with an allow-list parser instead of relying on
CSP.** Considered, because it is the more familiar answer to "untrusted
HTML" outside of a webview context. Rejected as unnecessary complexity here
specifically: a webview's CSP is exactly the primitive built for "let markup
through, refuse to execute it," and this project already has a documented,
audited posture on trusting host-side allow-lists (`no-restricted-imports`'s
own comments) that favours a structural guarantee over a parsing library
that itself becomes an attack surface and a dependency (ADR-0005). If a
future finding shows a CSP gap, that finding gets its own record.

## Consequences

`src/run/resultPanelModel.ts` and `src/run/resultPanelDom.ts` land in the
coverage denominator and raise the ratchet like any other slice's pure code.
`src/webview/entry.ts` does not, and `.c8rc.json`/`check-coverage-scope.mjs`
say so by name rather than by a glob — the same one-line-per-file discipline
ADR-0009 already insists on.

`src/run/resultPanel.ts` itself — the `vscode.WebviewPanel` owner, panel
creation, nonce generation, message posting and the ready-buffer — imports
`vscode` and joins `.c8rc.json`'s existing exclude list the same way
`outputChannel.ts` did; it is exercised by the integration tier the same way
`commands.ts`/`output-channel.test.ts` already are.

A new top-level source directory, `src/webview/`, exists from this slice
onward with a narrower, DOM-flavoured type space than the rest of the
extension. Anyone adding a second webview later reuses `tsconfig.webview.json`
and the `isBrowserOnly` rule rather than re-deriving them — this ADR is the
place that reasoning lives.

What this record does not settle: an interactive surface on the panel
itself (copying an image, jumping from a traceback frame to its source line)
is unscoped — the traceback-to-editor mapping is Phase 4's, per `backend.ts`'s
own doc, and nothing else here was asked for by the plan. Whether the panel
should persist across a window reload (`WebviewPanelSerializer`) is likewise
untouched; today a reload loses the panel exactly as it loses the output
channel's scrollback, and that parity is treated as acceptable rather than
decided against revisiting.

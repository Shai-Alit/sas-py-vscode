# ADR-0028 — The data viewer webview is React + ag-grid-community, not a hand-rolled grid; the dependency stays dev-only

- **Status:** Accepted
- **Date:** 2026-09-10
- **Decides:** whether 7b's data viewer (`docs/phases/phase-7.md`'s 7b slice)
  is built as a React + `ag-grid-community` webview, porting upstream
  `vscode-sas-extension`'s `DataViewer.tsx`/`useDataViewer.ts` shape, or as a
  hand-rolled paginated/virtualized table in this project's existing
  no-framework webview style — and, given that decision, how the new
  dependency is classified so it does not silently change what
  [ADR-0005](0005-supply-chain-policy.md) already decided about this
  project's dependency tree
- **Constrained by:** [ADR-0021](0021-result-panel-webview.md) (this
  project's only existing webview precedent: hand-rolled DOM, a
  `DomPort`-and-fake testing pattern chosen explicitly over `jsdom`, a CSP
  threat model reasoned about for that panel's specific payload),
  [ADR-0005](0005-supply-chain-policy.md) (the extension has zero runtime
  dependencies today, and the production `npm audit --omit=dev` gate is
  "vacuous... until the day a runtime dependency lands, which is exactly the
  day nobody will want to be designing one"), [ADR-0009](0009-coverage-scope.md)
  (coverage measures unit-reachable code; a module the unit tier structurally
  cannot load is excluded by a checked rule, not by hand)
- **Executed in:** decided in a scoping/documentation session ahead of 7b's
  own code, the same shape [ADR-0024](0024-notebooks-are-ipynb-native.md)
  used for Phase 9's format decision — this record settles the architecture
  choice and the dependency-classification choice; the CSP policy text, the
  exact coverage-exclusion wiring, and the grid's own column/pagination code
  are 7b's own implementation task, not decided here

## Context

Phase 7's own Plan section (`docs/phases/phase-7.md`) flagged this
explicitly as "the one decision 7b's own author should make deliberately
rather than defaulting into," rather than settling it during Phase 7's
2026-09-03 scoping session. Upstream's data viewer
(`client/src/webview/DataViewer.tsx`, `useDataViewer.ts`) is a
`ag-grid-react`/`ag-grid-community` grid (`^36.0.2`) using the Infinite Row
Model — a virtualized, server-paginated datasource backed by
`getRows`/`getColumns`, with client-driven column resize and a sort/filter
UI layered on top. This project's one existing webview, the result panel
(ADR-0021), is deliberately hand-rolled: no framework, a small `DomPort`
interface standing in for the real DOM under test, and a CSP that permits
no inline script under any circumstance.

Whether that precedent should extend to a second, structurally different
webview needed a real answer, not an assumption either way. The two
webviews' hard problems are not the same shape. The result panel's hard
problem is a security one: it renders `text/html` that is arbitrary output
from a user's own Python (a pandas `to_html()`/Styler repr), and it must
never let embedded `<script>` execute — a narrow, mostly-static rendering
problem where a five-line DOM port genuinely was cheaper than a framework.
A data viewer's hard problem is an interactive, stateful one: windowed
virtualization over a paginated REST source, scroll-triggered fetching with
out-of-order-response handling, resizable columns, keyboard navigation,
screen-reader row/column semantics — and none of it has an untrusted-HTML
dimension, because a table's cells are typed SAS values (`Column.type`/
`format`/`informat`, Finding 7.1), not arbitrary markup a user's code
produced. ADR-0021's own reasoning for hand-rolling does not transfer
cleanly to a problem with a different shape and no shared threat model.

This was discussed directly with Sean rather than decided unilaterally,
given the phase file's own instruction to make it deliberately. Two things
grounded the discussion beyond the codebase survey already in
`phase-7.md`'s Plan section: current published bundle-size figures for
`ag-grid-community` (approximately 338 KB min+gzip pulling in
`AllCommunityModule` the way upstream's code does; module-scoped to just
the Infinite Row Model and core grid, meaningfully less — roughly 150–250 KB
gzip), and confirmation that the Infinite Row Model — the mechanism 7b
needs — is an `ag-grid-community` (MIT, free) feature, not an Enterprise
one requiring a license.

## Decision

### 7b is built as React + `ag-grid-community`

Following `useDataViewer.ts`'s Infinite Row Model shape: a virtualized
datasource backed by `getRows`, column definitions derived from
`getColumns`. `ag-grid-enterprise` is not added — nothing 7b or 7c's own
plan (server-side sort via `createView`, a plain `where=` text filter, CSV
export, a static properties viewer) needs a Server-Side Row Model, row
grouping, or any other Enterprise-only capability; `ag-grid-community`'s
free Infinite Row Model covers the whole plan.

The reasoning, in order of weight:

1. **The category of UI problem this panel has (virtualization, resize,
   keyboard/screen-reader semantics) is one where a small team reinventing a
   mature library tends to lose over time**, not on day one but on the long
   tail of polish — scroll jank, focus loss on re-render, resize-drag
   physics, right-to-left and high-DPI behaviour — that a widely-used
   library has already absorbed real usage against. This project's
   bandwidth (a single developer paired with an AI agent) is better spent on
   the SAS/Viya-specific problems nothing else solves than on rebuilding
   grid virtualization from scratch to the same bar upstream, and dozens of
   other consumers, have already reached.
2. **ADR-0021's specific reasoning for hand-rolling does not apply here.**
   That decision's hard problem — never execute a user's own untrusted
   `text/html` — has no analogue in a data viewer, whose payload is typed
   scalar values. Extending ADR-0021's conclusion to this panel would be
   applying its answer without its premise.
3. **The bundle cost is real but small and one-time.** Roughly 250–450 KB
   gzip added to the *webview* bundle specifically (not the main extension
   bundle loaded at `activationEvents`), paid once, the first time a user
   opens a data viewer panel — not an ongoing cost to every extension
   activation.
4. **It sets up a reusable pattern rather than a one-off exception.** Phase
   9 (notebooks) and Phase 10 (environment view) are both still ahead, and
   at least one of them is plausible as a third webview. Establishing
   React/JSX once now, with its own toolchain and testing story recorded
   here, means those don't each have to invent a bespoke DOM abstraction the
   way ADR-0021 did for the result panel.

### The CSP threat model must be re-derived for this panel, not copied from ADR-0021

ADR-0021's `style-src 'unsafe-inline'` exception was justified specifically
because that panel is read-only, with "no sink to exfiltrate to and no
actions to spoof a click onto." The data viewer is not read-only in the same
sense — it has column resize now, and 7c adds sort/filter interactions — so
that specific justification does not carry over unmodified, even though
`ag-grid`'s own runtime does need the equivalent exception (it inline-styles
row positioning via CSS transforms). **7b's own implementation must write a
fresh CSP section for this panel**, reasoning about its actual threat
surface (an interactive grid over typed data with no embedded-HTML payload)
rather than citing ADR-0021's paragraph by reference. `script-src` stays
nonce-only, the same as every webview this project ships — nothing about
this decision changes that.

### The testing-boundary question is resolved the same way `src/webview/entry.ts` already is, not by adding `jsdom`

ADR-0021 rejected `jsdom` as a devDependency, reasoning that a small
injected port ("the one thing a test cannot supply for real") was cheaper
than a simulated browser, for the result panel's own layered design
(pure model → DOM-port renderer → five-line bootstrap). A React/ag-grid
component tree does not decompose into that same three-layer shape — there
is no equivalent of a `DomPort` for a mounted `AgGridReact` component
without effectively re-implementing a browser test harness, which is the
exact cost ADR-0021 declined to pay for a different reason. **7b keeps
`jsdom` out of this project's dependency tree.** The `getRows`/`getColumns`
adapter and pagination logic remain ordinary, `vscode`-free, ADR-0009-covered
unit-tested code, exactly like every other slice. The React/ag-grid wiring
itself — the actual component tree — is treated as a browser-only layer,
excluded from the unit coverage tier by [ADR-0009](0009-coverage-scope.md)'s
existing `isBrowserOnly` mechanism (the same one that already excludes
`src/webview/entry.ts`), and verified instead by this project's integration
tier, the same way `test/integration/run/result-panel.test.ts` already
verifies the result panel's CSP and rendered content in a real extension
host. This is a widening of an existing, checked exclusion mechanism, not a
new one invented for this slice.

### React, `ag-grid-community`, and `ag-grid-react` are `devDependencies`, not `dependencies` — deliberately, to keep ADR-0005's invariant intact

ADR-0005 states plainly that "the extension has zero runtime dependencies"
and that its production `npm audit --omit=dev` gate is "vacuous today
because the tree is empty; it is the real gate the day a runtime dependency
lands, which is exactly the day nobody will want to be designing one." This
project's `package.json` today has no top-level `"dependencies"` key at
all — even `esbuild`, which every build depends on, is a `devDependency`,
because esbuild bundles `src/extension.ts` and `src/webview/entry.ts` into
two self-contained files (`esbuild.mjs`) and nothing in `node_modules` is
required at the packaged extension's actual runtime.

The same fact holds for React and `ag-grid-community`/`ag-grid-react`:
`esbuild.mjs`'s webview context already bundles everything under
`src/webview/` with no `external` list (nothing there imports `vscode`,
and nothing needs to reach outside the bundle), so React and ag-grid are
consumed entirely at build time and packaged into `dist/webview/*.js` — no
different, mechanically, from how `esbuild` itself is already classified.
**They are added as `devDependencies`, matching `esbuild`'s own precedent,
specifically so this does not silently trip ADR-0005's currently-inactive
production gate.** This is a deliberate, load-bearing classification choice
recorded here — not an oversight to catch later — and it is the reason this
ADR cross-references and amends ADR-0005 directly rather than leaving the
two documents to be reconciled by whoever next reads both.

## Alternatives considered

**Hand-roll a lighter paginated/virtualized table in the existing DOM
style**, extending ADR-0021's pattern. Rejected, primarily on the reasoning
in the Decision section above: this is a UI-problem category where hand
control usually degrades to unmaintained UI polish debt over time. The
project would additionally have needed to build column resize, a
sort-indicator affordance (even though sort itself is server-side, 7c),
keyboard navigation matching platform conventions, and screen-reader
row/column semantics from nothing — a materially larger and more
open-ended engineering commitment than the toolchain/CSP/testing rework
ag-grid actually costs.

**`ag-grid-enterprise`.** Rejected: nothing in 7b or 7c's plan needs a
Server-Side Row Model, row grouping, aggregation, or any other
Enterprise-only capability. `ag-grid-community`'s free Infinite Row Model
is sufficient, and adding Enterprise would mean a $999/developer/year
license this project has no use for.

**Classify React/ag-grid as regular `dependencies`.** Rejected: they are
consumed only at build time (bundled by esbuild into `dist/webview/*.js`,
the same as every other webview asset), nothing in `node_modules` is needed
once the extension is packaged, and classifying them as production
dependencies would silently activate ADR-0005's currently-vacuous
`npm audit --omit=dev` production gate as a side effect of a UI decision,
rather than as its own deliberate event — exactly the kind of quiet
consequential change this project's own conventions ask to be flagged
explicitly instead of absorbed implicitly.

**Add `jsdom` to test the mounted grid directly.** Considered, since it is
the conventional answer for testing React components. Rejected for the
same reason ADR-0021 rejected it: this project already has a working,
cheaper answer to "the one thing a test cannot supply for real" (the
port-and-fake pattern, and — for code that is structurally unreachable by
the unit tier at all — ADR-0009's checked exclusion), and adding a second,
larger testing dependency to work around a design choice that already has
an established answer is not a trade this project has taken anywhere else.

## Consequences

**7b's own implementation must, before merging:**

- Add `react`, `react-dom`, `ag-grid-community`, `ag-grid-react` (and
  `@types/react`/`@types/react-dom`) as `devDependencies`, matching this
  ADR's classification decision, not as `dependencies`.
- Add a `.tsx` type space alongside `tsconfig.webview.json`'s existing
  DOM-lib carve-out, and a JSX loader on `esbuild.mjs`'s webview context —
  toolchain wiring, not covered by this ADR beyond naming it as required.
- Write this panel's own CSP section from its own threat model, per the
  Decision section above — not by citing ADR-0021's paragraph.
- Wire `check-coverage-scope.mjs`'s `isBrowserOnly` exclusion to cover the
  new React/ag-grid component files, and add (or extend) an integration
  test verifying the panel's CSP and rendered content, mirroring
  `result-panel.test.ts`.

**ADR-0005 is amended** (see that document's own amendment log) to note
that React and ag-grid landed as `devDependencies` for the reason given
here, and that its production-dependency revisit trigger — "the first time
a runtime dependency is added" — has still not fired.

**A precedent now exists for a second webview shape in this project.**
Phase 9 or Phase 10, if either needs a webview, has two established patterns
to choose between (ADR-0021's hand-rolled/port-tested shape, or this
decision's React/ag-grid/browser-excluded-from-coverage shape) rather than
having to re-derive either from nothing — whichever fits that slice's own
problem shape, decided the same deliberate way this one was.

**What this record does not settle:** the exact bundle-size figure once
7b's own module selection is finalized (this record cites published,
not project-measured, figures — a real number should be captured once 7b's
build exists and worth a one-line update here if materially different);
whether Phase 9 or 10 actually adopt this pattern (left to those phases'
own scoping); and any of 7b's own implementation mechanics (paging
parameters, column-def mapping, the exact CSP directive text) beyond the
threat-model obligation stated above.

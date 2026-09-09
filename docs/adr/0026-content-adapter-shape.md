# ADR-0026 — The SAS Content adapter is one concrete class, with no factory, no `ContentModel`, and no `sortBy`

- **Status:** Accepted
- **Date:** 2026-09-09
- **Decides:** the shape of `src/content/` — whether the SAS Content explorer
  ports upstream `vscode-sas-extension`'s `ContentAdapterFactory` /
  `ContentModel` / `ContentDataProvider` layering, and how it orders a folder
  listing
- **Constrained by:** [ADR-0007](0007-connection-profile-storage.md) (one
  Viya-REST profile model), [ADR-0022](0022-drop-viya-35-support.md) (Viya 4
  only), [ADR-0025](0025-shared-wire-layer.md) (`src/wire/` holds the shared
  link + error helpers; a third service builds its own small client on them),
  [ADR-0010](0010-compute-client-is-hand-written.md) (navigate by relation),
  `eslint.config.mjs`'s ban on Viya-version branching outside `src/dialects/`
- **Executed in:** slice 6a-ii

## Context

Phase 6 ports the SAS extension's Content Navigator
(`client/src/components/ContentNavigator/`,
`client/src/connection/rest/RestContentAdapter.ts`). Upstream's structure is:

```
ContentDataProvider  (TreeDataProvider + FileSystemProvider + drag/drop)
   └── ContentModel   (thin pass-through)
        └── ContentAdapter               (interface)
             └── ContentAdapterFactory   ({Rest,IOM,COM} × {SASContent,SASServer})
                  └── RestContentAdapter  (the one case that matters here)
```

Three of those four layers exist to support connection kinds and file-navigation
sources this project has ruled out for every phase — SSH/COM/IOM connections and
a "SAS Server" OS-filesystem browser are deliberate non-goals in
`PRODUCTION_PLAN.md` §3.1. Porting them would build an abstraction with exactly
one concrete case, forever — the same "a method with no measured difference
behind it is a guess with an interface around it" reasoning
`src/dialects/dialect.ts`'s restraint clause already states.

Upstream's member query also carries a `sortBy` parameter with an inline
`this.viyaCadence === "2023.03"` check gating one of its clauses — a
cadence-level version branch, which `eslint.config.mjs` forbids outside
`src/dialects/` and which `src/dialects/` has no slot for (it distinguishes
generations, not cadences within one).

## Decision

`src/content/` is one concrete adapter class and no layers above it:

- **No `ContentAdapterFactory`, no `ContentSourceType`, no `RestServerAdapter`.**
  `ContentAdapter` is a class, constructed from a `ContentClient`, not an
  interface with a dispatcher. The `Rest × SASContent` combination is the only
  one this project will ever have.
- **No `ContentModel`.** Upstream's `ContentModel` is a thin pass-through whose
  real job is letting `ContentNavigator` swap the whole adapter when a
  profile's `connectionType` changes. With one adapter kind that reason is
  gone. The `TreeDataProvider` (`src/content/contentTree.ts`) talks to the
  adapter directly. The HTTP-boundary test seam that `ContentModel` would
  otherwise have provided is a fake `ContentClient` injected into the adapter —
  the same seam `src/compute/files.ts`'s tests use against a fake
  `ComputeClient`.
- **No adapter-owned VS Code state.** The adapter is `vscode`-free: it returns
  a small service-shaped `ContentItem` (`id`, `name`, `type`, `contentType`,
  `uri`, `links`), and `contentTree.ts` re-derives every VS Code concern
  (`TreeItem`, icon, `collapsibleState`, `contextValue`) from it. So the
  adapter, its client, its types and its problem vocabulary all stay in the
  unit-tier coverage denominator (ADR-0009); only the three `vscode`-importing
  files are excluded.
- **`src/content/client.ts` is its own client**, per ADR-0025's "if a third
  service ever wants the same client, that promotion is its own decision" — a
  small, read-scoped (`GET`-only for 6a-ii) link follower re-derived from
  `src/compute/client.ts`'s already-reviewed shape, built on `src/wire/` and
  `src/auth/transport.ts`. Its mutating arms arrive with 6b/6c against a probe.
- **No `sortBy` query parameter.** The adapter omits it and orders the listing
  itself — folders before files, then by name, case-insensitively. This
  sidesteps upstream's cadence branch entirely. It is one deliberate
  behavioural deviation from upstream, recorded here and in
  `docs/phases/phase-6.md`'s "Dialect risk" note. If a later slice's probing
  reproduces a real cadence-shaped wire difference, *that* gets a dialect
  method and its own ADR — not an inline string compare.

Two paths the adapter composes rather than following a link — the
`GET /folders/folders/@name` delegate mechanism, and `${folderUri}/members` for
a folder member that carries no `members` link — are documented, load-bearing
parts of the Folders service's own URL structure (findings 97–99) that upstream
relies on identically. The query string (`limit`, `filter`) is appended raw,
matching upstream and what the live probe accepted; `resolveHref` does not
re-encode it.

## Alternatives considered

- **Port the full four-layer structure.** Rejected: three of the four layers
  serve non-goals, and the fourth (`ContentModel`) loses its reason to exist
  once there is one adapter kind. Carrying them is dead abstraction that the
  next contributor has to understand before touching the tree.
- **Keep `ContentModel` purely as a test seam.** Rejected: the fake
  `ContentClient` is already that seam, one layer down, and matches this
  project's "mock at the HTTP boundary" rule exactly. A second seam for the
  same purpose is a layer to keep in sync for no gain.
- **Port `sortBy` and add a cadence dimension to `src/dialects/`.** Rejected
  for 6a-ii: no probe in this slice reproduced a cadence-shaped difference, and
  `src/dialects/`'s own restraint clause says a method arrives when a probe or
  defect proves the difference, not before. Client-side ordering is free and
  removes the question.

## Consequences

- `src/content/` is six small `vscode`-free modules (`types`, `problems`,
  `client`, `adapter`, `contentSession`, `presentation`) plus two thin `vscode`
  shells (`contentTree`, `contentExplorer`), paralleling `src/compute/` — no
  factory, no model, no `ContentSourceType` enum for a reader to trace. The
  logic lives in the `vscode`-free modules so the unit tier reaches it; the
  shells stay branch-free, the discipline
  [ADR-0021](0021-result-panel-webview.md) states for `src/webview/`.
- A folder listing is ordered by this extension, not the server. If a future
  requirement needs the server's own ordering (a very large folder where
  client-side sort of a truncated page would mislead), that is a real change
  with its own decision — pagination past `limit` is already flagged unprobed
  in `docs/phases/phase-6.md`.
- If a second non-Compute Viya service is ever added, it either builds its own
  small client the way `src/content/client.ts` does, or that is the moment the
  ADR-0025 client promotion gets made deliberately.

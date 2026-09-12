# ADR-0033 — `CasAdapter` is one concrete class built the way `ContentAdapter` is, not the way `LibraryAdapter` is

- **Status:** Accepted
- **Date:** 2026-09-11
- **Decides:** the shape of `src/cas/`'s `CasAdapter` — whether it borrows the
  active profile's Compute session the way `LibraryAdapter` does, or is
  built directly on an endpoint and a token the way `ContentAdapter` is; and
  whether the `src/wire/` promotion question `docs/phases/phase-8.md`'s Plan
  section originally flagged as open for whichever of 7a/8a landed first is
  still open
- **Constrained by:** [ADR-0025](0025-shared-wire-layer.md) (the service-agnostic
  `src/wire/` layer), [ADR-0026](0026-content-adapter-shape.md) (one concrete
  adapter, no factory — the shape this ADR follows), [ADR-0027](0027-library-adapter-shape.md)
  (the shape this ADR deliberately does *not* follow, and why)
- **Executed in:** slice 8a

## Context

Phase 8 has no upstream file to port or audit — the SAS VS Code extension
calls no CAS APIs at all (`docs/phases/phase-8.md`'s Plan section, confirmed
by a targeted grep: every `CAS`/`CASLIB`/`swat` hit in that codebase is
syntax-reference data for the language server, not a client). So this slice's
only real design question is which of this project's own two existing
adapter shapes to follow.

Finding 8.2 (`docs/phases/phase-8.md`) settled the load-bearing fact before
any code was written: every global-scope `casManagement` browse this project
tried — servers, caslibs, tables — answered `200` with a bare bearer token and
**no `sessionId` query parameter at all**, contradicting every example in the
CAS Management API's own reference documentation. Finding 8.7 (this slice)
re-confirmed the same shape live, on the same deployment, before implementing
against it. This is exactly `src/content/`'s situation, not `src/data/`'s:
`ContentAdapter` reads the Folders/Files services with nothing but an
endpoint and a token, because that HTTP boundary has no session concept;
`LibraryAdapter` reads `DataAccessApi` through the active profile's *Compute*
session, because a library and its tables are scoped to that session
(ADR-0027). Building `CasAdapter` on top of `ComputeSessionManager` the way
`LibraryAdapter` is would invent a session dependency `casManagement`'s
global-scope browsing does not have.

The `src/wire/` promotion question the Plan section raised for whichever of
7a/8a landed first is not open any more either: ADR-0025's promotion of the
HATEOAS link helpers and the `application/vnd.sas.error+json` reader out of
`src/compute/` into `src/wire/` happened in 6a-i, before either 7a or 8a
existed, specifically so a second Viya service's client could share them
without depending on `src/compute/`. `src/data/` (7a) is already that second
caller; `src/cas/` is simply the third. Finding 8.1/8.7 confirm directly that
`casManagement`'s root `apiMeta` document is hypermedia-driven in exactly the
shape `src/wire/links.ts` already handles — bare vendor media types
(`application/vnd.sas.collection`, not `+json`-suffixed), real root-relative
`href`s on every link (`getServers` → `/casManagement/servers`) — so there is
no new request/response/media-type layer to design, and no promotion
decision left to make.

## Decision

`src/cas/` is one concrete `CasAdapter` class, built directly on `src/wire/`
and its own small `CasClient` — the same "endpoint plus a token function, no
session of its own" shape `src/content/`'s `ContentAdapter`/`ContentClient`/
`ContentSession` already use, re-derived rather than shared (the identical
reasoning ADR-0026 and `src/content/client.ts`'s own doc comment give for not
sharing `ComputeClient` itself):

- **No adapter factory, no `LibrarySessionSource`-shaped busy/session guard.**
  `CasAdapter` takes a `CasClient` and nothing else. There is no
  `session-busy`/`not-connected` `CasProblem` variant, because there is no
  session this project owns to be busy or absent — unlike `LibraryAdapter`,
  which must check `ComputeSessionManager.isBusy` before every call (Finding
  7.3, ADR-0027).
- **`CasSession` mirrors `ContentSession` exactly**: a `Map` of adapters keyed
  by deployment endpoint, built the first time an endpoint is asked for and
  reused thereafter, dropped all at once on sign-out. The token is a silent,
  account-hinted lookup — a tree refresh must never pop a browser sign-in,
  the same rule `ContentSession`/`DataSession`(-equivalent) both already
  follow for their own reasons.
- **One composed URL, not zero.** `CasAdapter.getServers` composes
  `/casManagement/servers` directly, rather than fetching the root `apiMeta`
  document and following its `getServers` link on every call. This is not a
  guess about an unlinked shape — Finding 8.1/8.7 already confirm the root's
  own `getServers` link resolves to exactly this path — it is skipping a
  round trip to a link this project has already confirmed is stable, the
  same precedent `src/content/adapter.ts` already set by composing
  `/folders/folders` directly for its own first hop (there being no link to
  it from nowhere either). Every other request in `src/cas/` is a followed
  link, never a composed one.
- **A table's columns can require a load first, and the adapter decides that
  from the table's own `state` field, not from a `404`'s `errorCode`.**
  Finding 8.3/8.8: an unloaded table's `columns` collection is a `404` until
  `PUT .../tables/{name}/state?value=loaded` succeeds — a bodyless `PUT`
  answered with plain text, not JSON. `CasAdapter.getColumns` checks
  `table.state !== "loaded"` before deciding whether to load, rather than
  reacting to the `404` itself, because `src/wire/viyaError.ts`'s own doc
  comment already establishes the house rule that an `errorCode` is "never
  branched on" — keying behaviour on an undocumented number couples this
  project to one deployment's build.

## Alternatives considered

- **Build `CasAdapter` the way `LibraryAdapter` is built — parameterised by
  profile id, borrowing `ComputeSessionManager`'s session, with an
  `isBusy`/`not-connected` guard.** Rejected: Finding 8.2/8.7 show
  global-scope CAS browsing needs no session at all, so this would invent a
  dependency and a guard against a failure mode (`session-busy`) that cannot
  occur on this path. It would also make `CasAdapter` unable to browse CAS
  without first starting a Compute session — a real capability loss for no
  benefit, since nothing about `casManagement`'s global-scope reads is
  Compute-session-scoped.
- **Fetch the root `apiMeta` document and follow its `getServers` link on
  every `getServers()` call, rather than composing `/casManagement/servers`
  directly.** Considered, and rejected only for the extra round trip: Finding
  8.1/8.7 already establish the link is stable, so following it fresh every
  time buys nothing `src/content/adapter.ts`'s own `/folders/folders`
  precedent didn't already decide is unnecessary for a project-confirmed first
  hop.
- **React to a `columns` `404`'s `errorCode: 12204` to decide whether to
  load, rather than checking `table.state` up front.** Rejected: this
  project's own `viyaError.ts` doc comment already states the reason not
  to — an undocumented numeric code is not something behaviour should key
  on, and checking the table's own `state` field (which the wire already
  gives every listing entry, per Finding 8.2/8.3) makes the branch
  unnecessary rather than merely discouraged.
- **Re-promote `src/wire/` again, or add a second shared HTTP-client layer
  above `ContentClient`/`CasClient`.** Rejected: the two clients are already
  small (a handful of methods, no session, no write arm beyond one bodyless
  `PUT`), and a shared layer above them would be introduced for two callers
  that do not yet show any divergence pressure — the same "don't design for
  a hypothetical" reasoning `src/content/client.ts`'s own doc comment gives
  for not sharing `ComputeClient` itself.

## Consequences

- `src/cas/` gets one concrete adapter and one concrete session cache, both
  `vscode`-free and unit-tested against a fake `CasClient` — matching
  `src/content/`'s shape rather than `src/data/`'s, and requiring no new
  request/response/media-type layer in `src/wire/`.
- A user can browse CAS servers, caslibs, and tables (and, once loaded, a
  table's columns) with no compute session running at all — genuinely
  independent surface, the same as SAS Content and unlike SAS Libraries.
- The 8a tree's own scope question — whether to stop at tables (mirroring
  7a) or go one level deeper to columns (mirroring what 7b/7c eventually add
  for library tables) — was resolved for this slice as "include columns,"
  which is what makes the JIT-load path (Finding 8.3/8.8) 8a's own problem
  rather than a later slice's; that is a tree-scope decision, not an
  adapter-shape one, and does not change anything this ADR decides.
- **Whether `src/cas/` ever needs a session lifecycle of its own** — for a
  session-scoped (personal) caslib, which `docs/phases/phase-8.md`'s Plan
  section explicitly left out of 8a's scope — remains open. Finding 8.7 found
  every one of the 68 caslibs on the probed deployment reports
  `scope: "global"`; nothing has been observed to require a `POST
  .../servers/{name}/sessions` call, and this ADR does not anticipate one.

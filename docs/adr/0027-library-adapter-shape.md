# ADR-0027 — `LibraryAdapter` is one concrete class, and it borrows the active profile's session rather than owning a connection

- **Status:** Accepted
- **Date:** 2026-09-09
- **Decides:** the shape of `src/data/`'s `LibraryAdapter` — whether Phase 7
  ports upstream `vscode-sas-extension`'s `LibraryAdapterFactory` /
  `ItcLibraryAdapter` layering, and how the adapter obtains the Compute
  session it reads from
- **Constrained by:** [ADR-0007](0007-connection-profile-storage.md) (one
  Viya-REST profile model, no `ConnectionType`), [ADR-0022](0022-drop-viya-35-support.md)
  (Viya 4 only), [ADR-0012](0012-compute-session-lifetime-and-storage.md)
  (sessions are profile-keyed, not a singleton), [ADR-0010](0010-compute-client-is-hand-written.md)
  (navigate by relation, not by composed URL), [ADR-0026](0026-content-adapter-shape.md)
  (the same one-concrete-adapter reasoning, applied first to `src/content/`)
- **Executed in:** slice 7a

## Context

Phase 7 ports the SAS extension's Library Navigator
(`client/src/components/LibraryNavigator/`,
`client/src/connection/rest/RestLibraryAdapter.ts`). Upstream's structure is:

```
LibraryDataProvider  (TreeDataProvider + drag/drop)
   └── LibraryModel   (thin pass-through, dispatches on LibraryItem.type)
        └── LibraryAdapter               (interface)
             └── LibraryAdapterFactory   ({Rest, {IOM,COM}})
                  └── RestLibraryAdapter  (the one case that matters here)
```

This project has no `ConnectionType` concept at all (confirmed by grep — the
only other hit is an unrelated legacy `profile/import.ts` name) and is
Viya-REST-only by design. `ItcLibraryAdapter` and the factory that dispatches
to it exist to support IOM/COM connections this project has ruled out for
every phase — the same "one concrete case, forever" reasoning ADR-0026
already applied to `src/content/`.

Separately, `RestLibraryAdapter.connect()` calls its own module-level
`getSession()` — a process-global singleton. `ComputeSessionManager`
(`sessionManager.ts`) already exists specifically to avoid that pattern: it
is profile-keyed, not global, so two profiles can hold sessions
simultaneously (a feature this project already ships). A `LibraryAdapter`
that owned its own connection the way upstream's does would quietly
reintroduce the single-session assumption `ComputeSessionManager` was built
to avoid.

A third, related question upstream's own code doesn't have to answer: its
`getLibraries` reads a library's rich detail via a composed
`.../data/{libref}#summary` URL. Findings 7.5/7.6/7.7 (`docs/phases/phase-7.md`)
established directly that `#summary` is not a real path segment — it is a URL
fragment that never reaches the wire, and the request that actually lands is
the bare `.../data/{libref}` URI with a rich-by-default `Accept`. The correct,
designed mechanism is `Accept`-header content negotiation on one URI, which
this project's `src/wire/links.ts` + `src/compute/client.ts`
(`client.send({ link })`, `acceptFor`) already implement generally, for a
different reason (ADR-0010).

## Decision

`src/data/` is one concrete `LibraryAdapter` class, constructed with access to
the active profile's Compute session rather than owning one:

- **No `LibraryAdapterFactory`, no `ItcLibraryAdapter`.** `LibraryAdapter` is
  a class, not an interface with a dispatcher. `Rest` is the only case this
  project will ever have.
- **The adapter does not call a `connect()`-and-hold pattern of its own.** It
  asks `ComputeSessionManager` for the active profile's session each time it
  needs one — `current(profileId)` for a background refresh (a tree
  populating on VS Code's own schedule should not trigger an interactive
  sign-in), the same way `procPython.ts`/`job.ts` callers already do. The
  adapter (or its consuming tree provider) is parameterised by `profileId`,
  matching `ComputeSessionManager.isBusy(profileId)`/`startSubmission(profileId)`'s
  existing shape, so Phase 7 does not quietly collapse the two-profiles-at-once
  window `ComputeSessionManager` already supports back down to one.
- **Per-item detail is a followed link, never a composed URL.** The adapter's
  equivalent of upstream's `getLibrarySummary` follow-up is: take the list
  item's own `self` link, `client.send({ link: self })`. No `#summary`/
  `#tables` string appears anywhere in this codebase — `acceptFor` already
  derives the correct `Accept` from the link's own `responseType`/`type`,
  which is what makes the rich-vs-sparse and library-vs-tables distinction
  (Findings 7.5/7.6/7.7) work with no new media-type constant.
- **A session-busy read reuses `ComputeSessionManager.isBusy`, and refuses
  rather than queues.** Finding 7.3 (reconfirmed on two deployments and two
  cadences: Findings 7.5/7.6/7.7) measured that a `DataAccessApi`-equivalent
  read blocks at the SAS kernel behind a running job — it does not error and
  does not run concurrently. `LibraryAdapter` checks `isBusy(profileId)`
  before issuing a call and, if busy, shows a visible message instead of
  issuing a request that would hang silently for the run's duration —
  mirroring `startSubmission`'s existing "refuse rather than queue"
  precedent (finding 27) rather than inventing a second design for the same
  shape of problem.
- **404 handling reuses `asSessionGone`,** not a parallel `retryOnFail` — the
  same "session expired vs. resource never existed" ambiguity `job.ts`
  already carries a documented caveat for.

## Alternatives considered

- **Port the full four-layer structure, including a factory with a single
  registered case.** Rejected: the factory and `ItcLibraryAdapter` serve a
  non-goal (IOM/COM), and porting them builds an abstraction with exactly one
  concrete case, forever — the same reasoning ADR-0026 already applied to
  `src/content/`, now applied to `src/data/`.
- **Have `LibraryAdapter` own its own `ComputeConnection`, ported closer to
  upstream's `connect()`/module-level `getSession()`.** Rejected: this project
  chose a profile-keyed session manager specifically to avoid a global
  singleton (ADR-0012), and an adapter with its own connection would bypass
  that design for one new module, silently reintroducing the single-session
  assumption for whichever profile happens to browse a library second.
- **Port `getLibrarySummary`'s composed `#summary`/`#tables` URL construction
  verbatim.** Rejected: Findings 7.5/7.6/7.7 showed this only ever worked by an
  accident of the HTTP transport stripping an unrequested URL fragment before
  the wire — porting it verbatim would carry that accident into a codebase
  whose own link-following convention already produces the correct request
  for free.
- **Let a busy-session read queue behind the running job instead of
  refusing.** Rejected for 7a: `startSubmission` already established
  "refuse rather than queue" as this project's answer to the analogous
  question on the run path (finding 27), and Finding 7.3 shows a data read is
  the same shape of problem, not a new one that warrants a different answer.

## Consequences

- `src/data/` gets one concrete adapter, no `LibraryAdapterFactory`, no
  `ItcLibraryAdapter`, no `ConnectionType`-shaped dispatch for a reader to
  trace — matching `src/content/`'s shape (ADR-0026) and `src/compute/`'s
  functional-core/thin-shell split.
- `LibraryItem` keeps its own `links` array rather than discarding it after
  parsing (upstream drops links after mapping into its own `LibraryItem`).
  This is the load-bearing change that lets the adapter follow `self`/
  `tables` by relation instead of composing a URL, and it means `readOnly`
  stays optional at the type level — genuinely absent on a bare list item,
  not defaulted to `false` — per Findings 7.2/7.5.
- A tree populated by `LibraryAdapter` never triggers an interactive sign-in
  on its own; a profile with no active session shows an explicit
  "not connected" state rather than reading `current(profileId)` as a silent
  empty list. Whether the tree instead triggers `connect()` lazily on first
  expansion (closer to upstream's UX) is **not** decided by this ADR — it is
  a UX call left open for whoever implements 7a's tree provider.
- A browse action during an active run fails visibly and immediately with a
  "session busy" message, rather than hanging for the run's full duration
  with no explanation. The accepted gap: a read issued in the instant before
  a run starts can still lose the race and hang for that run's duration —
  no claim-based guard closes this the way `startSubmission`'s atomic claim
  does for the run path itself, because a read has no equivalent claim to
  take without itself blocking a legitimate run from starting.
- Whether a *second* concurrent `DataAccessApi`-style read (no job involved)
  also serializes the same way a job does remains unprobed — Findings 7.3/7.5/7.6
  covered only the job-blocks-a-read case. Worth a targeted probe at
  implementation time rather than assuming either answer.

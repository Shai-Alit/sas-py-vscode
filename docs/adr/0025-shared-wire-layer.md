# ADR-0025 — Hypermedia link and error-envelope helpers move to a shared `src/wire/` layer

- **Status:** Accepted
- **Date:** 2026-09-09
- **Decides:** where the SAS Content explorer (Phase 6) gets the link-following
  helpers — `readLinks`, `findLink`, `findLinkOfType`, `linkMethod`,
  `resolveHref`, `sasMediaType`, `ForeignLinkError` — and the
  `application/vnd.sas.error+json` reader (`readViyaError`, `describeViyaError`,
  `ViyaError`), given that both currently live under `src/compute/`
- **Constrained by:** [ADR-0010](0010-compute-client-is-hand-written.md)
  (navigate by relation, not by composed path),
  [ADR-0009](0009-coverage-scope.md) (a module stays in the coverage
  denominator unless it imports `vscode`)
- **Executed in:** slice 6a-i

## Context

`src/compute/links.ts` and the error-envelope half of `src/compute/problems.ts`
were written for the Compute service but describe the Viya hypermedia envelope
in general: a `links` array of `{ rel, href, method, type, responseType }`, SAS
vendor media types advertised bare and sent `+json`-suffixed (finding 14), and
an `application/vnd.sas.error+json` body on every failure (finding 17).

Phase 6a introduces `src/content/`, which talks to the **Folders** and **Files**
services. Upstream `vscode-sas-extension`'s Content Navigator
(`connection/rest/RestContentAdapter.ts`) drives both of them through the same
`links[]` envelope — its own `getLink(links, method, rel)` reads
`{ rel, href, method }` entries exactly as `findLink` here does — and reads
failures from the same `application/vnd.sas.error+json` body. Slice 6a-ii
confirms that against the live deployment and records the delegate-folder,
member and error shapes as numbered findings in `docs/phases/phase-6.md`, in
the pull request that first depends on them; this ADR does not rest on those
numbers, only on the envelope being the one `src/wire/` already describes
(findings 13, 14 and 17).

So `src/content/` needs the same helpers. Three ways to give them to it:

1. **`src/content/` imports from `src/compute/`.** A content tree has nothing to
   do with a compute session; the import points the dependency graph the wrong
   way and invites more of the same.
2. **`src/content/` gets its own copy.** This recreates exactly the
   name-collision problem `src/compute/links.ts` was written to kill — upstream
   `vscode-sas-extension` has two functions both called `getLink`, in two files,
   with different arity, and which one a call site gets depends on which it
   imported. A second `findLink` under `src/content/` is that trap rebuilt.
3. **Promote the shared part to a layer both sit on.**

## Decision

Option 3. A new `src/wire/` directory holds the session-agnostic Viya
hypermedia helpers:

- `src/wire/links.ts` — `readLinks`, `findLink`, `findLinkOfType`, `linkMethod`,
  `resolveHref`, `sasMediaType`, `ForeignLinkError`, `Link`. Moved verbatim from
  `src/compute/links.ts`, doc comments rewritten from Compute-first to
  service-general. `computeMediaType` is renamed `sasMediaType` — it appends the
  SAS vendor `+json` suffix and was never Compute-specific.
- `src/wire/viyaError.ts` — `readViyaError`, `describeViyaError`, `ViyaError`,
  `MAX_DETAIL_LENGTH`. Moved from `src/compute/problems.ts`.

`src/compute/problems.ts` keeps the **Compute vocabulary** — the `ComputeProblem`
union and `describeComputeProblem` — and imports `ViyaError` /
`describeViyaError` from `src/wire/`. The per-service problem unions
(`ComputeProblem`, and from 6a-ii `ContentProblem`) stay next to the code that
produces them; only the envelope *reader* is shared, because only it is the same
question for every service.

`src/wire/` imports nothing from `src/compute/`, `src/content/` or `src/auth/`,
and never imports `vscode` — so it stays in the coverage denominator (ADR-0009)
and its existing unit suites move with it
(`test/unit/wire-links.test.ts`, `test/unit/wire-viya-error.test.ts`).

## Alternatives considered

- **Leave it in `src/compute/` and let `src/content/` import across** — rejected
  above (option 1): wrong-way dependency, and it normalises the layering smell.
- **Copy into `src/content/`** — rejected above (option 2): the two-copies
  problem this module exists to prevent.
- **Promote the whole Compute HTTP client too** (`createComputeClient`,
  `ComputeProblem`) into `src/wire/` and have both services build on one client.
  Larger and riskier than 6a needs — it rewrites every `src/compute/` import and
  test for a refactor Phase 6 does not require. `src/content/client.ts` is a
  small, read-scoped link follower re-derived from the Compute client's shape
  (audit, don't transcribe), built on `src/wire/` + `src/auth/transport.ts`. If
  a third service ever wants the same client, that promotion is its own
  decision.

## Consequences

- One more top-level `src/` directory, and one more layer name for a new
  contributor to learn — mitigated by `src/wire/`'s doc comments stating exactly
  what belongs there (session-agnostic Viya wire helpers, no `vscode`, no
  service vocabulary).
- The move touches ~17 files' import lines across `src/compute/`,
  `src/dialects/` and their tests. Zero behaviour change; the moved unit suites
  passing unchanged is the proof.
- `src/content/` (6a-ii) and any future non-Compute Viya service get the link
  layer and the error reader for free, with no second copy to keep in sync.

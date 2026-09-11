# ADR-0030 — "Delete" recycles a recyclable SAS Content item with no prompt; only an unrecyclable one is permanently deleted behind a modal

- **Status:** Accepted
- **Date:** 2026-09-10 (recorded retroactively at the Phase 6→7/8 housekeeping
  checkpoint — see the Context section below for why)
- **Decides:** what the SAS Content tree's "Delete" command does once the
  Recycle Bin exists — an unconditional permanent delete behind a
  confirmation (6c-i's original, only possible design), or a recycle-first
  default that reserves the confirmation for the cases recycling can't cover
- **Constrained by:** [ADR-0026](0026-content-adapter-shape.md) (`src/content/`
  is one concrete adapter, no factory, no model), the 6c-i Runbook entry
  (`docs/phases/phase-6.md`) that shipped the original Delete design, and
  Findings 6.8/6.10/6.14/6.15 (`deleteResource`/`moveItem`/Recycle Bin wire
  behaviour, same file)
- **Executed in:** 6d-ii (`docs/phases/phase-6.md`'s Runbook)

## Context

6c-i shipped "Delete" before the Recycle Bin existed at all: every delete
request showed a warning modal ("Permanently delete \"…\"?" / "This cannot be
undone.") and then called `deleteItem` directly — the only design available
when there was nowhere else for a removed item to go
(`docs/phases/phase-6.md`'s 6c-i Runbook entry: "modal confirm on delete").

6d-ii then built the Recycle Bin as a real Folders-service concept
(`@myRecycleBin`, a `PATCH` to the member's `RecycleResource` relation,
findings 6.8/6.14/6.15) and had to decide what "Delete" would do now that a
reversible alternative existed: keep confirming and permanently deleting
everything, or switch the common case to the reversible path. `phase-6.md`
and `STATUS.md` both record the outcome — "Delete now recycles" — and flag it
explicitly as "a documented-invariant change from 6c-i," the same phrase
this repository's root `CLAUDE.md` uses to gate its mandatory
adversarial-review-before-PR rule. The change went out under that gate at the
time (6d-ii's own adversarial pass and PR review, `phase-6.md`'s Runbook), but
never got an ADR number of its own — the Phase 6→7/8 between-phase
housekeeping checkpoint caught the gap (a decision this size, with a genuinely
plausible rejected alternative, is exactly what [`README.md`](README.md)'s
"when to write one" describes) and this record fills it in after the fact,
rather than leaving an unrecorded invariant change standing.

Upstream `vscode-sas-extension` already draws the same distinction.
`ContentNavigator/index.ts`'s `SAS.content.deleteResource` handler calls
`canRecycleResource(resource)` first: when true, it calls `recycleResource`
directly with no confirmation at all; only when false does it fall to
`showWarningMessage`'s modal before a permanent `deleteResource`. 6d-ii's
`isRecyclableMember` split matches this shape rather than inventing a new one.

## Decision

"Delete" on an ordinary SAS Content folder or file member — anything
`isRecyclableMember` reports `true` for (`type === "child" &&
!inRecycleBin`, `src/content/types.ts`) — moves it to the Recycle Bin
immediately, with **no confirmation dialog**. Restore undoes it, so the
protection a confirmation exists to provide is already satisfied by the
action being reversible.

Anything `isRecyclableMember` reports `false` for — a top-level folder read
directly (no member record for the Folders service's `RecycleResource` PATCH
to act on) or an item already inside the Recycle Bin — has no reversible
path. For those, "Delete" instead shows a blocking modal ("Permanently
delete \"…\"?" / a folder-specific variant naming "everything inside it" /
"This cannot be undone." / a **Delete Permanently** button) and calls
`deleteItem` directly — exactly 6c-i's original, single-path behaviour,
now scoped to only the cases that still need it.

## Alternatives considered

- **Keep 6c-i's original behaviour untouched**: every Delete confirms, then
  always permanently deletes; recycling is only reachable through a separate,
  differently-named command. Rejected: this ships a fully functional Recycle
  Bin that an ordinary "Delete" gesture never populates, so a user has to
  already know a second command exists to get the reversible behaviour —
  worse than either shipping the Bin or not.
- **Confirm every delete, recyclable or not, wording the modal differently
  for each case.** Rejected: a confirmation whose only consequence is
  reversible teaches users to click through it without reading, which
  weakens the one case — an irreversible delete — where the confirmation
  actually matters. Upstream's own choice to skip the modal for the
  recyclable case was adopted rather than second-guessed for want of a
  reason to diverge.
- **Recycle everything, including a top-level folder, by synthesising a
  member record for it first.** Rejected as out of proportion: a top-level
  folder read directly carries no member record for `RecycleResource` to act
  on (finding 6.8's shape), and manufacturing one purely to make a rare
  action (deleting a whole top-level folder) recyclable is a bigger change
  than the UX gap it closes; a confirmation modal is the proportionate guard
  for something this infrequent and this destructive.

## Consequences

- `isRecyclableMember` / `isRestorable` (`src/content/types.ts`) are now
  load-bearing for this UX decision, not only internal bin bookkeeping — a
  future change to what counts as recyclable changes what "Delete" does with
  no prompt, so it needs the same care any other UI-visible behaviour change
  gets, not a types-file edit made in passing.
- `emptyRecycleBin` has no per-item progress or batching (a known, accepted
  tradeoff — `phase-6.md`'s 6d-ii Runbook entry) — worth naming here because
  it is a direct consequence of Delete now populating the bin as its default
  path rather than an edge case: a bin that fills as a matter of course needs
  an empty flow that scales, and this one doesn't yet, deliberately deferred
  rather than solved by this slice.
- An item Viya never recorded a `previousParent` link for (`isRestorable`
  false — finding 81's rare case, `src/content/contentCommands.ts`) can be
  recycled by Delete but not Restored back through this extension; the tree
  says so and points at SAS Studio instead of calling the adapter. This ADR
  does not change that inherited limitation — it is noted here only because
  making Delete's easy path unconditional makes that dead end slightly more
  reachable than it was under 6c-i's always-permanent design.

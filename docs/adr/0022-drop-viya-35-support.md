# ADR-0022 — Viya 3.5 support is dropped

- **Status:** Accepted
- **Supersedes:** [ADR-0008](0008-auth-core-transport-and-security-deltas.md)'s
  "The Viya 3.5 client-id path ships unverified, and says so" section only —
  nothing else in that ADR (the transport port, the five security deltas, the
  certificate-agent amendment) is affected or reconsidered here.
- **Date:** 2026-09-03
- **Decides:** whether this project continues to carry architectural,
  empirically-unverified support for Viya 3.5 (`PRODUCTION_PLAN.md` §1.4), or
  drops it
- **Executed in:** an out-of-band slice, 2026-09-03, combining the code and
  documentation changes in one PR at Sean's explicit direction — not scoped to
  any Phase 5 punch-list item

## Context

The dialect/capability seam ([ADR-0015](0015-the-execution-backend-seam.md),
[ADR-0016](0016-api-contracts-are-checked-yaml.md), PRODUCTION_PLAN.md
§1.4/§2.1/§2.3) was built specifically so Viya 3.5 could be represented
architecturally without a live deployment to verify against — "architectural
first-class support, empirically unverified" — with a permanently-skipped live
test scaffold (5b, `test/live/viya35-connectivity.test.ts`) as the mechanism
for eventually confirming it.

As of today, no Viya 3.5 deployment has ever been reachable by this project,
across every phase from 0 through 5b. The one prospect noted in passing during
5b (`STATUS.md`: "the 3.5 deployment that was deploying as this landed") did
not turn into something this project could reach. Separately, very few Viya
3.5 customers remain in the target audience (Sean's assessment, 2026-09-03) —
3.5 is a frozen, on-prem generation in Standard Support to 2027-10-01, and
PRODUCTION_PLAN.md §1.4 already named it the one deployment kind "None
available," shaping the whole 3.5 strategy around that gap from the start.

Carrying an architecturally-supported-but-never-verified generation has a real
ongoing cost even while it does nothing: every dialect-layer change has to
consider a second, untestable arm; the contracts drift gate (5a) and the live
test scaffold (5b) both carry it as permanent unfinished business; and
`docs/README.md`'s honesty gate has required every release to explicitly
disclaim 3.5 support since the project began.

## Decision

Drop Viya 3.5 as an architecturally-supported generation. `DialectId`
(`src/dialects/dialect.ts`) is `"viya4"` alone; `Deployment`
(`src/auth/clientId.ts`) is `viya4 | unknown`, with no `viya35` member.
`src/dialects/viya35.ts`, `contracts/viya35.yaml`, `test/fixtures/viya35/`, and
the permanently-skipped `test/live/viya35-connectivity.test.ts` scaffold are
removed rather than kept as unreachable code.

The one behavioural change: a deployment that answers stage-1 probing with a
considered absence of `/deploymentData/cadenceVersion` — the one positive
signal 3.5 used to offer, per §2.3's old wording — is no longer read as "this
is Viya 3.5." `deploymentFromSignal` (`src/dialects/resolve.ts`) now resolves
`absent` the same way it resolves `unreadable`: the Viya 4 dialect, assumed
rather than confirmed. This is a strict widening of the fail-soft behaviour
§2.3 already asked for, not a new risk — a deployment that used to get a
confident (if unverified) "Viya 3.5" now gets the same honest "assumed Viya 4"
every other inconclusive probe already produced.

The dialect/capability seam itself ([ADR-0015](0015-the-execution-backend-seam.md))
is not reconsidered. It stays exactly the shape it would need to be in if a
second generation — 3.5 or otherwise — ever needs representing again:
`baseDialect`, the `Dialect` interface, and the two-stage probing design
(`docs/architecture/capability-probing.md`) are all generation-count-agnostic.
Only the one dialect instance, contract, and fixture directory that stood for
Viya 3.5 specifically are removed.

## Alternatives considered

**Keep the architectural seam, but stop probing for it (a `viya35` dialect
that nothing ever resolves to).** Rejected: dead code nothing can exercise is
worse than no code, per `dialect.ts`'s own restraint clause — "a dialect
method with no measured difference behind it is a guess with an interface
around it, and it is worse than no method at all." An unreachable
`createViya35Dialect` is exactly that, forever.

**Wait for the 3.5 deployment noted in passing during 5b, rather than
deciding now.** Considered, since PRODUCTION_PLAN.md's own
architecture-level-change policy asks for deliberation over a quiet patch.
Rejected because that deployment never materialised into something reachable,
"wait and see" has already cost every phase from 0 through 5b, and the
decision rests on the customer-count basis alone regardless of whether a
deployment eventually turns up — a 3.5 deployment becoming reachable later is
a reason to write a new ADR reversing this one, not a reason to defer this one
now.

**Downgrade 3.5 from "architecturally supported" to "explicitly unsupported,
detected and reported"** — keep a code path that recognises a 3.5-shaped
deployment (via the same absent-cadence signal) specifically to tell the user
their deployment is not supported, rather than silently assuming Viya 4.
Considered and rejected for this slice: it re-introduces exactly the
inference this decision removes ("absent means 3.5") on the strength of
documentation this project has never verified, in service of a message rather
than a capability — the same bar §2.3 already declined to clear for building
an actual dialect. Worth revisiting if a support request from a real 3.5
deployment ever needs a clearer failure than "assumed Viya 4, and things did
not work."

## Consequences

**Documentation and the plan needed the same sweep.** `PRODUCTION_PLAN.md`
§1.4 (the "honest position" on Viya versions), §2.1's architecture diagram,
and §6's risk table all named 3.5; `docs/README.md`'s honesty gate,
`docs/architecture/dialects.md` and `capability-probing.md`, and
`docs/dev/live-testing.md`'s 3.5 scaffold note are all updated in the same
change. `STATUS.md` records this as its own entry rather than folding it
silently into Phase 5's punch list, since it is a cross-cutting decision
rather than a Phase 5 deliverable.

**ADR-0008's Viya-3.5-specific sub-decision is superseded, not merely
amended.** Its "Viya 3.5 client-id path ships unverified, and says so" section
described a path that no longer exists; the client-id-required refusal now
only fires for an old Viya 4 release, which was always the other half of
decision 9 and needs no new reasoning.

**Every test asserting `{ kind: "viya35" }` or a `"viya35"` dialect id needed
a home.** Most were deleted outright; a few that exercised generic,
generation-count-agnostic logic (`check-contracts.mjs`'s cross-file rules)
were kept using a fictitious second generation (`viya6`) instead, since that
logic needs at least two generations to exercise properly and should not need
a third real dialect just to stay tested.

**A future second generation — a 3.5 deployment that becomes reachable, or a
genuinely new Viya release needing its own dialect — is unaffected by this
decision's mechanics.** The seam this ADR leaves in place is exactly what
ADR-0015 already built for that day; standing it back up is "a new file," not
a design change, the same property ADR-0015 claimed for a native-runtime swap.

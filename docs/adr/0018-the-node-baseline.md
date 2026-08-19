# ADR-0018 — The Node baseline is derived from `engines.vscode`, not chosen

- **Status:** Accepted
- **Date:** 2026-08-18
- **Decides:** what `engines.node` claims, what the `test` matrix legs are, what
  `esbuild.mjs` targets, and what `.nvmrc` is for now that it is no longer the
  second matrix leg
- **Constrained by:** ADR-0003 (the extension host target — this ADR fixes the
  version of the runtime ADR-0003 chose), ADR-0005 (the supply-chain policy,
  whose one-pinned-job design depends on where the floor sits relative to npm
  12's own floor)
- **Executed in:** the Phase 2 review, 2026-08-18
- **Evidence:** VS Code's release notes for 1.101 (the extension host moved to
  Node 22) and the 1.104 build's embedded Node 22.18.0; the Node release schedule
  (20 end-of-life 2026-04-30, 22 in maintenance to 2027-04-30, 24 in Active LTS
  until Node 26 takes over in late October 2026 and supported to 2028-04-30);
  npm 12's own `engines` field

## Context

`package.json` claimed `"node": ">=20.19.0"`, and the `test` matrix ran two Node
legs — 20.19.0, the floor, and 22, the version in `.nvmrc`. The Phase 2 review
asked what that floor was actually a claim about, and the answer was that it was
not a claim about anything this project controls.

Three facts, none of which were true when the number was first written:

**Node 20 reached end of life on 2026-04-30.** A floor that names an unsupported
runtime is an invitation to run the extension on one, and it puts a leg of CI on
a version that will not receive another security fix. This is the obvious reason
and it is the least interesting one.

**The floor was never independently chosen.** A VS Code extension does not
provide its own Node; it runs inside the extension host, and the host's Node
version is a property of the VS Code build. VS Code moved that host to Node 22 in
**1.101**, and the **1.104** build — which `engines.vscode: "^1.104.0"` already
requires — embeds **Node 22.18.0**. So `>=20.19.0` was not a support commitment
that could be honoured or broken; it described a configuration in which this
extension cannot be loaded at all. Two numbers in `package.json` were free to
contradict each other because nothing derived one from the other.

**The second Node leg was about to stop being informative.** It was written as a
bare `22`, chosen to match `.nvmrc`, and `setup-node` resolves that to the newest
22.x. Once the floor is 22.18.0, "test the floor" and "test what contributors
use" differ only at patch level on the same major, and a matrix that spends half
its legs on that distinction is paying six jobs for three jobs' worth of
information.

There is one place the floor is load-bearing rather than decorative, and it is
worth being explicit about it because it is easy to break by accident. ADR-0005
put the install-script policy in a single pinned `supply-chain` job precisely
because `allowScripts` needs npm 12, and npm 12 requires Node
`^22.22.2 || ^24.15.0 || >=26.0.0` — above the floor. A floor raise is exactly the
kind of change that could invalidate that design without anyone noticing.

## Decision

**`engines.node` is derived from `engines.vscode`, and its value is the Node
version that the floor VS Code build embeds.** Today that makes it `>=22.18.0`.
It is not a judgement about which Node versions are worth supporting; it is a
restatement, in the field that tooling reads, of a constraint `engines.vscode`
already imposes. When `engines.vscode` moves, this number moves with it in the
same pull request, and the reason recorded is the VS Code version, never a Node
release-schedule date.

Four things follow, and they are the whole change:

**The `test` matrix legs become `22.18.0` and `24`.** The first is the floor, on
the standing rule that an untested floor is a guess. The second is the current
Active LTS, and it is there for a different reason than the leg it replaces: it
is a forward-break detector. If a future VS Code raises the host to 24, the leg
that would have caught the break has already been running for months. A leg
tracking `.nvmrc` could never have done that job, because `.nvmrc` follows the
floor rather than leading it.

**`esbuild.mjs` targets `node22`.** It targeted `node20`, which is to say esbuild
was down-levelling syntax for a runtime the extension is never loaded on. The
target is now the same fact as the floor, and the comment in `esbuild.mjs` cites
this record so the next person changing one knows to change the other.

**`.nvmrc` stays at an unpinned `22`, and its job is now explicit.** It is the
contributor's local version, and it is still a tested one: the `verify`, `docs`,
`package` and `supply-chain` jobs all install with `node-version-file: .nvmrc`,
and `verify` runs the whole unit tier. What `.nvmrc`'s Node stopped being is a
*matrix* leg — newest-22.x is no longer exercised on windows or macOS. It is also
the only reason CI clears npm 12's `^22.22.2`: unpinned, it resolves to the
newest 22.x,
which is above 22.22.2. Pinning it to an exact version below 22.22.2 would break
the `supply-chain` job on its `npm install -g` step, for reasons with no visible
connection to the change that pinned it. That fragility predates this ADR and
survives it unchanged.

**ADR-0005's design is re-derived rather than assumed.** 22.18.0 is below
`^22.22.2`, so the policy still cannot run in the ordinary jobs and the single
pinned job is still the only place it runs. ADR-0005's argument survives intact;
one incidental value in it does not, and is amended there — the runners' npm is
no longer uniformly 10.x, because the Node 24 legs ship npm 11.x. Neither version
understands `allowScripts`, so nothing that value was evidence for changes. What
did change is the distance to the revisit trigger, which fires when
`engines.node` reaches 22.22.2: it is now one minor-version bump away rather than
a major-version decision. That is
a fact to know, not an instruction to take — taking it would mean claiming a
floor that no VS Code build justifies, which is the exact error this ADR exists
to close.

## Alternatives considered

**Leave the floor at 20.19.0 and just drop the dead leg.** The smallest possible
change, and it was tempting because nothing is broken. Rejected because it keeps
the actual defect — the floor claims something false — and removes the only thing
that made the claim visible. A wrong number that nothing tests is worse than a
wrong number that one CI leg exercises daily.

**Set the floor to 22.22.2, so the supply-chain policy can move into the normal
jobs.** This is ADR-0005's revisit trigger, and it would be a real simplification:
the pinned job, the explicit `npm install -g npm@12`, and a paragraph of docs all
go away. Rejected because it inverts the rule this ADR is establishing. 22.22.2
is not the Node any supported VS Code embeds, so adopting it would mean the floor
is once again a number chosen for a reason unrelated to what the extension runs
on — this time for CI's convenience rather than by neglect. The trigger is a
prompt to re-examine the policy when the derived floor happens to reach that
version, not a licence to push the floor there.

**Set the floor to 24, the current Active LTS.** Rejected for the same reason and
more sharply: it would claim not to support the VS Code build the project's own
`engines.vscode` names as its floor. The floor follows the editor.

**Keep three matrix legs — 22.18.0, 22 (`.nvmrc`) and 24.** Rejected because the
middle leg tests nothing the other two do not. `.nvmrc`'s newest-22.x resolves to
a version between the floor and 24 on the same major as the floor; the failure it
would catch uniquely is a regression in a 22.x patch release, which is not a class
of failure this project can act on. Nine jobs for that is not a trade.

**Bump `@types/node` in the same change.** The review found that `@types/node` is
pinned to **26.2.0**, which types against Node 26 APIs while the host runs 22 —
so `tsc` will accept a call that does not exist at runtime, which is the one
failure mode a typecheck exists to prevent. It is a real defect and it is
recorded, but it is not this one: fixing it edits `package-lock.json`, and a
lockfile change belongs in a slice where the install is run and reviewed rather
than as a rider on a config sweep.

> **Done 2026-08-19, in its own change.** `@types/node` is `22.18.13`, pinned
> exactly rather than to the `^22` first proposed: `22.18.x` is the line that
> describes Node 22.18.0, so the types now follow the floor by the same
> derivation this ADR gives for `engines.node` instead of floating one minor
> ahead of it. A `.github/dependabot.yml` `ignore` entry holds it there, and it
> is the only guard — `@types/vscode` has `vsce` refusing to package when it
> exceeds `engines.vscode`, and there is no equivalent check for the Node types.

## Consequences

The floor is now a derived value with a named source, so the next `engines.vscode`
bump has an obvious second edit rather than a silent omission. That is the whole
benefit and it is a small one; the honest framing is that this ADR converts a
number nobody could justify into a number with one line of derivation behind it.

The matrix is the same size — six legs, three platforms by two Node versions —
but one of them now tests forward instead of sideways. The cost is that the
project no longer runs any CI on Node 20, which is intended, and no longer runs
the *matrix* on newest-22.x, which is not: a contributor on windows or macOS
whose local 22.x differs from 22.18.0 is on a patch level no cross-platform job
exercises. `verify` still runs the unit tier on `.nvmrc`'s Node, on ubuntu alone.
The bet is that 22.x patch-level differences do not break this codebase, and the
evidence for it is that they never have.

`docs/dev/ci.md`, `docs/dev/building.md`, the `0d-i-a` and `0d-ii-a` entries in
`PRODUCTION_PLAN.md` §3 and the Phase 0 and Phase 1 supply-chain and transport
entries in `RUNBOOK.md` all stated the old floor, and all now
either state the new one or carry a dated amendment pointing here. ADR-0005 and
ADR-0008 are dated records and were amended rather than rewritten: ADR-0008's
argument — that the floor is high enough for `globalThis.fetch` — is one that a
floor raise cannot damage, and ADR-0005's is one that a floor raise *could* have
damaged and did not.

**Revisit trigger.** Whenever `engines.vscode` moves, re-derive this number from
the Node that build embeds, and check ADR-0005's assumption again in the same
pull request. Move the second matrix leg when a new Active LTS lands — Node 26
becomes LTS in October 2026, so the next move is `24` to `26`, and the leg is
worth keeping one release ahead of anything VS Code has shipped.

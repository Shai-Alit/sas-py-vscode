# ADR-0009 — Coverage measures what the unit tier can reach, and the exclusion is a checked rule

- **Status:** Accepted
- **Date:** 2026-08-13
- **Decides:** what population the coverage percentage in `.c8rc.json` is
  measured over, and how the exclusion is kept from becoming a hiding place
- **Executed in:** slice `chore/coverage-denominator`, between 1b-i and 1b-ii

## Context

`docs/dev/testing.md` states the rule that has run this project since slice 0c:
a slice that adds code to `src/` raises the coverage thresholds in the same pull
request, and thresholds go up and never down. That rule has worked because every
slice so far added more pure code than shell code.

Slice 1b-ii inverts that. It is almost entirely VS Code shell: the URI handler,
`env.openExternal`, `SecretStorage`, the input-box fallback. Every one of those
modules imports `vscode`, and a module that imports `vscode` cannot be loaded by
the unit tier at all — the module does not exist outside an extension host. It
therefore scores 0%, not because it is untested but because the instrument
measuring it cannot be pointed at it. The integration tier tests it, in a
separate process that c8 cannot see into.

So 1b-ii would push the aggregate percentage down while *increasing* the amount
of tested code, and the ratchet would have to be lowered to let it through.

A ratchet that gets lowered is not a ratchet. Once the number has been argued
down once, it is a number that can be argued down, and the next argument is
easier than the first. The mechanism has to be fixed before the pressure
arrives, not under it — which is why this is its own slice, measured on a tree
where nothing else moved, rather than a line item inside 1b-ii.

The 1b-i pull request said this in as many words:

> This ratchet is about to work against us … Decide in 1b-ii scoping whether to
> exclude the shell modules from the c8 denominator, run separate thresholds per
> directory, or merge integration coverage in — but decide it before the number
> forces the decision.

## Decision

**The coverage figure measures unit-reachable code.** Modules that import
`vscode` are excluded from the c8 denominator, and `scripts/check-coverage-scope.mjs`
asserts that the exclude list and that rule agree.

The partition is not drawn by hand. It already existed:

```
$ grep -rln 'from "vscode"' src/
src/extension.ts
src/profile/commands.ts
src/profile/problems.ts
src/profile/statusBar.ts
src/profile/store.ts
```

Those are exactly the five modules reading 0.00% in the unit run, and exactly
the five listed in `exclude`. The rule is "excluded if and only if it imports
`vscode`", and the *if and only if* is the whole decision — an exclude list
without a rule is a list of exceptions, and a rule without a check is a
convention.

The check asserts both directions on every run of `npm run verify`:

1. **Every excluded `src/` path really does import `vscode`.** This is the
   direction with teeth. A pure module quietly added to the list would lose its
   coverage floor permanently, and nothing else in the repository would notice.
2. **Every module that imports `vscode` is excluded.** Without this, a new shell
   module lands in the denominator, scores zero, and the next person to see the
   ratchet fail is told a lie about which change broke it.

It also refuses globs in the `src/` portion of the list. `src/**` would satisfy
direction 1 only by leaving nothing to disagree with it.

The import test is TypeScript's own parser, not a regular expression, for two
reasons that both matter. `src/` is full of comments that discuss importing
`vscode` — a text search reports the prose. And `import type { Uri } from
"vscode"` is erased before the code runs, so a module importing only types is
perfectly loadable in the unit tier and must keep its floor.

The thresholds are re-baselined from a measured run on this branch, against the
new denominator. Nothing else changed in that run — no test was added, no source
file was touched — which is what makes the two numbers comparable:

| | statements | branches | functions | lines |
|---|---|---|---|---|
| before | 63.21 | 90.08 | 72.04 | 63.21 |
| after | 79.30 | 91.87 | 77.77 | 79.30 |
| new floor | 77 | 90 | 76 | 77 |

The sixteen points are the measurement changing, not the code. That is the size
of the distortion the old denominator was carrying, and it is why the ratchet was
about to break.

## Alternatives considered

**Leave the denominator alone and lower the ratchet when it hurts.** Rejected:
this is the failure mode, not an alternative to it. It also makes the number
mean two things at once — an aggregate over a pure population and an unreachable
one — so no movement in it can be attributed.

**Per-directory thresholds.** c8 offers `--per-file` but nothing per-directory,
so this needs a custom script over `coverage-summary.json`: new machinery to
express what a list of five paths already expresses. It also does not answer the
question, only relocate it — some directory still has to be marked as the one
where zero is acceptable.

**Merge integration coverage into the same report.** The honest total, with
nothing excluded, and the option to revisit if the shell tier ever grows large
enough to warrant it. Rejected for now on cost: it means instrumenting the
extension-host process, merging V8 output across three operating systems in CI,
and making the ratchet depend on the most fragile tier in the project. That is a
slice of its own, and it would be one taken on to protect a number rather than
to protect the product.

**Exclude by directory (`src/profile/**`) rather than by module.** Simpler to
write and wrong: `src/profile/` holds `import.ts` and `model.ts`, which are pure,
unit-tested at around 98%, and deliberately split out from the shell for exactly
that reason. Excluding them would throw away the payoff of the split.

## Consequences

The percentage in `.c8rc.json` is now **unit-reachable coverage**, and
`docs/dev/testing.md` says so. It is a smaller population and a more meaningful
one: everything in it is code the tier can actually execute, so a drop is always
a real drop.

The number no longer says anything about the shell. That guarantee moves to a
process gate, and the 1b-ii punchlist carries it: **an integration test per shell
module**, because after this change no threshold will notice if one is missing.
This is the cost of the decision and it should be read as one — a check a human
has to remember is weaker than a check a machine performs, and the trade is
accepted only because the alternative was a number that would be argued down.

The remaining drag on the figure is `scripts/*.mjs`, measured at 64.76%, against
`src/` at 99.87 and 98.30. That is ordinary Node code with no host dependency and
it is testable today, so it is now a legitimate target rather than noise in the
aggregate. Most of the uncovered region is each script's `main()` — the part
guarded by `process.argv[1]`, which the unit tier imports past rather than runs.
That is a real gap and worth a slice of its own eventually: `main` is where a
gate decides whether to exit non-zero, which is the behaviour that matters most.

Adding a module that imports `vscode` is now a two-line change: the module, and
its path in `.c8rc.json`. Forgetting the second line fails `npm run verify` with
a message naming the file, which is the intended experience.

`.c8rc.json` is JSON and cannot carry a comment saying why those five paths are
there. The explanation lives here, in the failure message of
`scripts/check-coverage-scope.mjs`, and in `docs/dev/testing.md`.

One standing exemption is contradicted, and this ADR supersedes it rather than
leaving the two to be reconciled later. `docs/dev/testing.md` and decision 6 of
`PRODUCTION_PLAN.md` both named vendored generated OpenAPI clients as the one
sanctioned exclusion — code not authored here and covered by the tests of its
callers. Under this rule the check refuses to exclude such a client, because it
does not import `vscode`. That is the correct default: "the tier physically
cannot load this" is a fact about the world, whereas "this was generated, not
written" is an argument, and arguments belong in an ADR rather than in a list of
five paths.

Both documents are amended in this pull request, and the Phase 2a task in
`RUNBOOK.md` — the one that will actually vendor the client — now carries the
warning, because the failure would otherwise surface as a `check:coverage-scope`
error in the middle of the largest slice in the plan, to someone who had read a
plan of record telling them the exclusion was settled. This ADR's own thesis is
that a mechanism should be fixed before the pressure arrives; deferring this
would have been the same mistake in miniature. When 2a-i comes, the choice is
between keeping the client in the denominator and accepting the number, placing
it outside `src/` so it is not a source file at all, or amending this ADR with a
second rule that argues its case. Not a quiet entry in the list.

## Amendment — 2026-08-16 (slice 2b-i): a module with nothing to execute

The second rule this ADR invited has arrived, and it is not the generated client.

Slice 2b-i adds `src/backend/backend.ts`, the `ExecutionBackend` seam: interfaces
and type aliases, three type-only imports, and no runtime content whatsoever. It
compiles to an empty JavaScript file. c8, running with `all: true`, cannot find a
statement in it and charges all 306 source lines — most of them the doc comments
that carry the seam's contract — to the denominator as uncovered. That is a 2.9
point drop in the aggregate for a file which is, in the only sense the number is
supposed to mean, fully specified: the contract tests drive every clause of it
through a test double.

**The rule becomes: excluded if and only if the unit tier cannot reach it.**
Importing `vscode` is one way to be unreachable. Having nothing to run is
another, and it is unreachable in a stricter sense — there is no line, no
process, no tier in which a test could execute one.

This is a widening of the exclusion, so it is worth being explicit about what
stops it becoming the hiding place the original decision was built against.
`isTypesOnly` in `scripts/check-coverage-scope.mjs` holds only while **every**
top-level statement in the file is erased at compile time: an interface, a type
alias, a type-only import or export, an ambient declaration. One `const`, one
function, one enum — and enums and classes are the interesting cases, because
they look like declarations and both emit — and the file no longer qualifies.
And the check runs in both directions here too, so a types module that grows a
helper does not quietly keep its exemption: the direction-1 failure fires on the
next `npm run verify` and names the file. The predicate is TypeScript's parser
again, for the same reason as before.

The alternative was to invent a runtime export for `backend.ts` — a constant, a
type guard — so that something in it could be executed. That is worse in the way
that matters: it adds code nobody asked for to satisfy an instrument, and the
next reader has no way to tell the difference between API and ballast. Excluding
one line of JSON and arguing for it here costs less and lies less.

The measured effect, on a tree where only this exclusion changed:

| | statements | branches | functions | lines |
|---|---|---|---|---|
| before | 87.55 | 94.37 | 89.00 | 87.55 |
| after | 90.55 | 94.55 | 89.57 | 90.55 |
| new floor | 90 | 94 | 89 | 90 |

The three points are the measurement again, not the code — the same distortion
this ADR was written about, arriving from the other direction.

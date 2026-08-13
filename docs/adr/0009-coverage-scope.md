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
new denominator.

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

The remaining drag on the figure is `scripts/*.mjs`, at roughly 62%. That is
ordinary Node code with no host dependency, and it is testable today — so it is
now a legitimate target rather than noise in the aggregate.

Adding a module that imports `vscode` is now a two-line change: the module, and
its path in `.c8rc.json`. Forgetting the second line fails `npm run verify` with
a message naming the file, which is the intended experience.

`.c8rc.json` is JSON and cannot carry a comment saying why those five paths are
there. The explanation lives here, in the failure message of
`scripts/check-coverage-scope.mjs`, and in `docs/dev/testing.md`.

One standing exemption is now contradicted and has to be revisited when it comes
up. `docs/dev/testing.md` previously named vendored generated OpenAPI clients as
the one sanctioned exclusion — code not authored here and covered by the tests of
its callers. Under this rule the check would refuse to exclude such a client,
because it does not import `vscode`. That is the correct default: an exclusion
that is not "the tier physically cannot load this" needs its own argument. If a
vendored client is ever committed under `src/`, amend this ADR with a second
rule rather than adding a quiet exception to the list.

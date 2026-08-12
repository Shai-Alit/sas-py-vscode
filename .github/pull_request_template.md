## What and why

<!-- What changed, and what problem it solves. Link the slice from
     PRODUCTION_PLAN.md, e.g. "Implements slice 3a." -->

## How it was verified

<!-- Which tests, which tier, and anything you checked by hand. If you probed a
     live Viya, cite the PROBE-FINDINGS.md entry. -->

## Checklist

- [ ] Scoped to a single slice
- [ ] `CHANGELOG.md` updated under `[Unreleased]`
- [ ] Unit tests added for new logic, including every error branch
- [ ] No network access in unit tests; fixtures sanitised of hosts, tokens, and user names
- [ ] No Viya version branching outside `src/dialects/`
- [ ] User-facing strings wrapped in `l10n.t()`
- [ ] No secrets in code, logs, tests, or fixtures
- [ ] Ported files keep the SAS header **and** carry a modified-file notice
- [ ] Docs updated; generated reference regenerated rather than hand-edited
- [ ] ADR added if this settles a design decision

## Notes for reviewers

<!-- Anything deliberately out of scope, known follow-ups, or a decision you'd
     like challenged. -->

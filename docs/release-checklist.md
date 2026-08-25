# Release checklist

Moved out of `RUNBOOK.md` (was Section D) so the maintainer runbook stays
small. Open this only when actually cutting a release.

---

## Section D — Release punch list

☐ **D1.** Finalise `CHANGELOG.md`: `[Unreleased]` → `[0.1.0] - YYYY-MM-DD`.
☐ **D2.** Set `version` in `package.json`.
☐ **D3.** Merge the release PR.
☐ **D4.** Tag from the merge commit on `main`:

```bash
git checkout main && git pull --ff-only && git tag v0.1.0
git push origin v0.1.0
```

☐ **D5.** Watch the release workflow; confirm the `.vsix` publishes to both the
VS Marketplace and Open VSX.
☐ **D6.** Install the published extension from the marketplace in a clean VS Code
profile and run one Python file end to end. Publishing green is not the same as
working.
☐ **D7.** Bump to the next `0.1.1-dev` version and add a fresh empty
`[Unreleased]` section.

> A published marketplace version cannot be reused. If something is wrong, ship a
> patch version — never try to republish the same number.

---


# Release checklist

Moved out of `RUNBOOK.md` (was Section D) so the maintainer runbook stays
small. Open this only when actually cutting a release.

A release is **a `vX.Y.Z` tag on `main`**. Pushing that tag runs
`.github/workflows/release.yml`, which does everything downstream of the tag.
The version bump, the changelog finalise, and the tag itself are manual and
happen first — see [ADR-0023](adr/0023-release-publishing.md) for why the
irreversible step is a deliberate `git tag` rather than a side effect of a
merge.

---

## One-time setup

Done once for the repository, not per release. If a step here is not done, the
matching part of `release.yml` fails on the first real tag.

☐ **S1 — Marketplace trusted-publishing policy.** On the Visual Studio
Marketplace management page for the `shai-alit` publisher, add a trusted
publishing policy for this repository (`Shai-Alit/sas-py-vscode`) and this
workflow file (`.github/workflows/release.yml`). This is what lets
`vsce publish --oidc` exchange a GitHub Actions OIDC token for a short-lived
Marketplace credential with **no stored PAT**. There is no fallback: if the
policy is missing or misscoped, the Marketplace publish step fails outright.

☐ **S2 — Open VSX token.** Create an Open VSX account under the `shai-alit`
namespace owner, generate an access token, and set it as the repository secret
`OVSX_PAT`. Then create the namespace once:

```bash
npx ovsx create-namespace shai-alit --pat "$OVSX_PAT"
```

Creating the namespace does **not** grant exclusive rights immediately — that
comes after the first successful publish and an Eclipse Foundation review.

☐ **S3 — Nothing else.** The GitHub Release step uses the automatic
`GITHUB_TOKEN`; `id-token: write` and `contents: write` are declared in the
workflow. No other secret is needed.

---

## What `release.yml` does

On a `v*` tag push, one `publish` job:

1. Checks out the tag, `npm ci`.
2. Asserts the tag and `package.json` `version` agree — fails loudly if not.
3. Runs `npm run verify` against the tagged tree (the same gate CI runs on
   every PR).
4. Runs `npm run package` — builds `dist/python-on-viya.vsix` and runs
   `check:package` against it.
5. `vsce publish --oidc --packagePath dist/python-on-viya.vsix` → VS Marketplace.
6. `ovsx publish dist/python-on-viya.vsix` → Open VSX. **Best-effort**: a
   failure here is a `::warning::`, not a failed release.
7. Creates a GitHub Release for the tag with the `.vsix` attached and notes
   sliced from the matching `CHANGELOG.md` section.

A `workflow_dispatch` run does steps 1–4 only (its `dry_run` input defaults to
true) — see [Dry run](#dry-run) below.

---

## Section D — Release punch list

☐ **D1.** Finalise `CHANGELOG.md`: `[Unreleased]` → `[X.Y.Z] - YYYY-MM-DD`.
Leave the heading text exactly `## [X.Y.Z] - ...` — the workflow's notes
extractor matches on `## [X.Y.Z]`.

☐ **D2.** Set `version` in `package.json` to `X.Y.Z`. While here, decide
whether this release is a `"preview": true` (marketplace shows a preview badge
and a caveat) — appropriate while the extension is pre-1.0 and evolving.

☐ **D3.** Replace `media/icon.png` if it is still the generated `Py` wordmark
stopgap. A designed 128×128 PNG, no transparency; keep `galleryBanner.color` in
step with it.

☐ **D4.** Open the release PR with D1–D3, get it green, merge it (squash, per
`RUNBOOK.md`).

☐ **D5.** Tag from the merge commit on `main`:

```bash
git checkout main && git pull --ff-only && git tag vX.Y.Z
git push origin vX.Y.Z
```

☐ **D6.** Watch the `Release` workflow run. Confirm:

- the Marketplace publish succeeded (OIDC, no PAT);
- the Open VSX publish succeeded — or, if it warned, re-run
  `npx ovsx publish dist/python-on-viya.vsix --pat "$OVSX_PAT"` by hand once
  Open VSX is healthy;
- the GitHub Release exists with `python-on-viya.vsix` attached and the right
  notes.

☐ **D7.** Install the published extension from the marketplace in a clean VS
Code profile and run the [manual test pass](dev/manual-test-pass.md) against a
real deployment — at least its rich-output section end to end. Publishing green
is not the same as working.

☐ **D8.** Open a follow-up PR bumping `version` to the next `X.Y.(Z+1)-dev` and
adding a fresh empty `[Unreleased]` section to `CHANGELOG.md`.

> A published marketplace version cannot be reused. If something is wrong, ship a
> patch version — never try to republish the same number. The same is true of
> Open VSX and of a Git tag that has already triggered a run.

---

## Dry run

Before the first real release — or after any change to `release.yml`,
`package.json` packaging metadata, or `.vscodeignore` — rehearse without
publishing:

1. GitHub → Actions → **Release** → **Run workflow**, on `main`, leaving
   `dry_run` checked (the default).
2. It runs checkout → `npm ci` → version check → `npm run verify` →
   `npm run package`, then stops. No publish, no GitHub Release.
3. A green run means the build, the gate, and packaging all pass on CI
   infrastructure. It does **not** exercise the OIDC exchange or either
   registry — those only run on a real tag (or a `workflow_dispatch` with
   `dry_run` explicitly unchecked, which really does publish).

`phase-5.md`'s 5c item 5 ("exercise the checklist end to end at least once as a
dry run") is this step, run before the v0.1.0 tag.

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
matching part of `release.yml` fails on the first real tag. None of it can be
done from inside the repo.

☐ **S1 — Marketplace publisher and trusted-publishing policy.**

- The `shai-alit` publisher must exist on the Visual Studio Marketplace. Create
  it at https://marketplace.visualstudio.com/manage if it does not — `vsce
  create-publisher` was removed years ago.
- On that publisher's page, add a **trusted publishing policy** for this
  repository (`Shai-Alit/sas-py-vscode`) and this workflow file
  (`.github/workflows/release.yml`). That is what lets `vsce publish --oidc`
  exchange a GitHub Actions OIDC token for a short-lived Marketplace credential
  with **no stored PAT**. There is no fallback: a missing or misscoped policy
  fails the Marketplace publish outright.
- `--oidc` needs `@vscode/vsce` **>= 3.9.3**. The devDependency is pinned to a
  `3.9.3` prerelease until the stable release ships (ADR-0023); nothing to do
  here, but if the pin is ever moved *back* to 3.9.2 the publish breaks.

☐ **S2 — Open VSX.**

- Create an Eclipse Foundation account, then **sign the Eclipse Foundation Open
  VSX Publisher Agreement** (<https://open-vsx.org> → your profile). Without the
  signed agreement no token can publish anything.
- Generate an Open VSX access token and set it as the repository secret
  `OVSX_PAT`.
- Create the namespace once:

  ```bash
  npx ovsx create-namespace shai-alit --pat "$OVSX_PAT"
  ```

  Creating the namespace does not grant exclusive rights immediately — that
  follows the first successful publish and an Eclipse review.

☐ **S3 — Approval gate and tag ruleset.**

- Settings → Environments → create an environment named **`release`**. Add
  required reviewers to it so each publish needs a human click; the `publish`
  job declares `environment: release` and will wait.
- Add a **tag protection / ruleset** matching `v*` so only maintainers can push
  release tags (branch protection does not cover tags).

☐ **S4 — Nothing else.** The GitHub Release step uses the automatic
`GITHUB_TOKEN`. `id-token: write` and `contents: write` are declared on the
`publish` job in the workflow.

---

## What `release.yml` does

On a `v*` tag push, two jobs:

**`build`** (`contents: read`, no publishing credentials):

1. Checks out the tag, `npm ci`.
2. Asserts the tag and `package.json` `version` agree — fails loudly if not.
3. `npm run verify` — the same gate CI runs on every PR, against the tagged tree.
4. `npm run package` — builds `dist/python-on-viya.vsix` and runs
   `check:package` against it.
5. Uploads the `.vsix` as a workflow artifact.

**`publish`** (`needs: build`, `environment: release`, `id-token: write` +
`contents: write`; **tag pushes only** — a `workflow_dispatch` run stops after
`build`):

6. Downloads the `.vsix` artifact. Does **not** run `npm ci` — it `npx`es the
   two publishing CLIs at the versions `package.json` pins, so the dev tree
   never enters the job that holds the credentials.
7. `vsce publish --oidc --packagePath …` → VS Marketplace.
8. `ovsx publish …` → Open VSX (`OVSX_PAT` from the secret). **Best-effort**: a
   failure here is a `::warning::`, not a failed release.
9. Creates a GitHub Release for the tag with the `.vsix` attached and notes
   sliced from the matching `CHANGELOG.md` section.

A `workflow_dispatch` run executes `build` only and never publishes — see
[Dry run](#dry-run).

---

## Section D — Release punch list

☐ **D1.** Finalise `CHANGELOG.md`: `[Unreleased]` → `[X.Y.Z] - YYYY-MM-DD`.
Leave the heading text exactly `## [X.Y.Z] - ...` — the workflow's notes
extractor matches a line that starts with `## [X.Y.Z]`.

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

☐ **D6.** Watch the `Release` workflow. When `publish` is queued, approve the
`release` environment. Then confirm:

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

1. GitHub → Actions → **Release** → **Run workflow**, on `main`.
2. The `build` job runs: checkout → `npm ci` → tag/version check (reporting
   only, there is no tag) → `npm run verify` → `npm run package` → artifact
   upload. The `publish` job is skipped.
3. A green run means the build, the gate, and packaging all pass on CI
   infrastructure. It does **not** exercise the OIDC exchange, either registry,
   or the `release` environment gate — those only run on a real `v*` tag.

`phase-5.md`'s 5c item 5 ("exercise the checklist end to end at least once as a
dry run") is this step, run before the v0.1.0 tag.

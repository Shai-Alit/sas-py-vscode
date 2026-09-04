# ADR-0023 — Releases publish from a tag, over OIDC, to two registries

- **Status:** Accepted
- **Date:** 2026-09-03
- **Decides:** what triggers a publish, how `release.yml` authenticates to the VS
  Marketplace, whether Open VSX is a target and how hard its failure is, and how
  the built `.vsix` reaches users of GitHub Releases
- **Constrained by:** ADR-0004 (the `docs` build is a gate, not a deploy — the
  site publish is still unbuilt and is not part of this), the `.vscodeignore` /
  `check:package` allow-by-default packaging guard, ADR-0005 (adding a
  publish-time dependency is a supply-chain decision — `ovsx` is now in the dev
  tree and under `check:audit`)
- **Executed in:** slice 5c-iii
- **Evidence:** `microsoft/vscode-vsce` `out/oidc.js` and `out/publish.js` in
  `@vscode/vsce@3.9.3-11` — `--oidc` requests a GitHub Actions OIDC token for the
  `marketplace.visualstudio.com` audience and exchanges it at
  `/_apis/gallery/token` for a short-lived Marketplace credential, and the
  credential resolution runs whether or not `--packagePath` is used (**no PAT
  fallback**); `@vscode/vsce@3.9.2`, the latest stable at the time of writing,
  has **no `--oidc` option** — `grep -ri oidc node_modules/@vscode/vsce` is
  empty and the `publish` command exposes only `--pat` and `--azure-credential`;
  Azure DevOps' announced retirement of the global PATs that classic `vsce
  publish -p` depends on, **2026-12-01**; the Open VSX CLI README (a pre-built
  archive is published by passing its path to `ovsx publish`, auth is the
  `OVSX_PAT` env var, the namespace is created once with `ovsx create-namespace`,
  and a signed Eclipse Foundation Open VSX Publisher Agreement is required before
  any token works)

## Context

`docs/release-checklist.md` (Section D) already described a release, and its D5
step said "watch the release workflow" — a workflow that did not exist.
`package.json` was `"private": true` at `0.0.1` with no marketplace icon. So the
extension could be built (`npm run package` produces a checked `.vsix` on every
PR) but not shipped: nothing published it, and `vsce` refuses a `private`
package.

The publishing landscape in 2026 has one moving part that shaped this. The VS
Marketplace has, for a decade, authenticated `vsce publish` with an Azure DevOps
Personal Access Token. **Those PATs are being retired on 2026-12-01.** In their
place `vsce` is gaining `--oidc`: from a GitHub Actions job with `id-token:
write` and a trusted-publishing policy registered on the Marketplace, it obtains
and exchanges an OIDC token with no stored secret. It is merged and documented
upstream but not yet in a stable release (see the Evidence line and the pin
discussion below). A workflow written today against a PAT would need rewriting
within a quarter regardless.

Open VSX — the vendor-neutral registry that VS Codium, Cursor, Windsurf,
Gitpod and the like install from — is a second, independent channel. It has no
OIDC path; it takes a token. `phase-5.md`'s 5c plan named it as a target.

## Decision

**A release is a `vX.Y.Z` tag push.** `.github/workflows/release.yml` fires on
`v*` tags and does everything downstream of the tag: it does not bump the
version, write the CHANGELOG, or create the tag. Those happen by hand in the
release PR (`docs/release-checklist.md`), so the irreversible act — a version
number that a registry will never let you reuse — is a deliberate `git tag`, not
a side effect of a merge. The workflow's first real step asserts the tag and
`package.json` agree and fails loudly if they do not.

**The Marketplace publish is `vsce publish --oidc`, and there is no PAT
anywhere.** The publish job requests `id-token: write`; the Marketplace side
needs a trusted-publishing policy scoped to this repository and this workflow
file (`release.yml`), configured once by a Marketplace admin against the
`shai-alit` publisher (which must already exist). `--oidc` does not fall back to
a PAT, so a misconfigured policy fails the release rather than silently
degrading — which is the behaviour we want for something that ships under the
publisher's identity.

**`--oidc` shipped after `@vscode/vsce@3.9.2`.** It is merged upstream and
documented in the `main` README, but as of 2026-09-03 the latest stable release
(`3.9.2`) does not carry it — `commander` would reject the flag outright. It is
present in the `3.9.3` prereleases (`out/oidc.js` first appears in the `next`
dist-tag), so the `@vscode/vsce` devDependency is **pinned to `3.9.3-11`** until
`3.9.3` ships stable, at which point Dependabot's normal bump carries it forward.
CI's `package` job runs `vsce package` on every pull request, so a regression in
the prerelease surfaces immediately rather than at release time. This is a
deliberate, temporary deviation from the repo's pin-the-latest-stable rule,
recorded here because it is exactly the kind of fact that gets re-litigated in
three months.

**Open VSX is published too, but its failure is a warning, not a failed
release.** The `ovsx publish` step is `continue-on-error: true` and a failure
emits a `::warning::` telling the maintainer to re-run it by hand. The
Marketplace is the primary channel for the audience this extension targets;
an Open VSX outage on release day should not hold up the Marketplace publish or
force a retag. `ovsx` is a pinned dev dependency so `check:audit` covers it and
`npm run package` / local use resolve the pinned version; the publish job runs
it as `npx ovsx@<the pinned version>` rather than installing it (see the
two-job split below). The Open VSX token (`OVSX_PAT`) and the one-time `ovsx
create-namespace shai-alit` — which itself needs a signed Eclipse Open VSX
Publisher Agreement first — are recorded in the release checklist.

**Two jobs, and the publish job never installs the dev tree.** `build` runs
`npm ci` and `npm run verify` — which execute code from the tagged tree (ESLint,
Mocha) and the whole ~880-package dev dependency tree — so it runs at
`contents: read` with no `id-token`, and hands the `.vsix` to `publish` as an
artifact. `publish` holds the credentials (`id-token: write` for OIDC,
`contents: write` for the GitHub Release) and installs none of that: it checks
out the repo for `package.json` and `CHANGELOG.md`, downloads the artifact, and
`npx`es `@vscode/vsce` and `ovsx` at the exact versions `package.json` pins.
This is ADR-0005's "a compromised dev dependency must not reach the credentials"
applied one level up, and it is why the publish step `npx`es the pinned tools
rather than `npm ci`-ing them despite the general "pin, don't fetch" rule — the
point of the split is that the dev tree is absent from the job that can publish.

**An approval gate and a tag ruleset.** Branch protection does not cover tags,
so on its own any collaborator with write access could push `v9.9.9` at an
arbitrary tree and have it ship under the publisher's identity. `publish`
declares `environment: release`, so configuring required reviewers on that
environment puts a human click in front of every publish; a `v*` tag protection
ruleset is the other half. Both are repository settings, recorded in the
checklist's one-time setup rather than enforceable from the workflow file.

**One archive, three destinations.** `npm run package` builds
`dist/python-on-viya.vsix` and runs `check:package` against it in the `build`
job; that same artifact is what `vsce publish --packagePath` sends to the
Marketplace, what `ovsx publish` sends to Open VSX, and what is attached to the
GitHub Release. The GitHub Release is created from the tag with notes sliced out
of the matching `CHANGELOG.md` section (falling back to GitHub's auto-generated
notes if that section is absent).

**`workflow_dispatch` is a build-only rehearsal.** A manual run executes the
`build` job — checkout, `npm ci`, the tag/version check (reporting only, since
there is no tag), `npm run verify`, `npm run package`, artifact upload — and
`publish` is skipped (`if: github.event_name == 'push'`). There is no input and
no way to make a dispatch publish. This is what `phase-5.md`'s 5c item 5
("exercise the checklist end to end as a dry run") uses; it proves the build,
the gate and packaging on CI infrastructure, but does not exercise the OIDC
exchange or either registry — those run only on a real tag.

**`galleryBanner` and the icon.** `package.json` gains `"private": false`,
`"icon": "media/icon.png"`, `"galleryBanner": { "color": "#0766D1", "theme":
"dark" }` and `"pricing": "Free"`. The icon shipped in this slice is a plain
`Py` wordmark, white on `#0766D1`, generated deterministically — a stopgap that
looks intentional at thumbnail size and is meant to be replaced by a designed
asset before v0.1.0. `check:package`'s `REQUIRED` list now includes
`extension/media/icon.png`, so a future change that drops the icon fails
packaging rather than shipping an extension with a broken manifest reference.
The version bump, the `CHANGELOG` finalise, and the decision on `"preview": true`
belong to the release slice (5c-iv), not here. Flipping `"private"` to `false`
does remove the one thing that would have made a stray `npm publish` fail fast;
that is accepted, since nothing in the repo runs `npm publish`, there is no npm
token in CI, and `vsce` refuses to publish a `private` package so the flip is
not optional.

## Alternatives considered

**A `VSCE_PAT` secret (classic `vsce publish -p`).** The obvious choice, and
genuinely simpler to stand up — no Marketplace-side policy, one secret. Rejected
because the credential type is being retired on 2026-12-01: this would be a
workflow with a built-in expiry date measured in weeks from v0.1.0, plus the
standing chore of rotating a PAT before each expiry. OIDC is where this has to
land; doing it now avoids writing the same workflow twice.

**`--azure-credential` with a workload-identity federation to an Entra app.**
The other tokenless route, and the one Microsoft's docs lead with for Azure
Pipelines. Rejected as heavier for no gain here: it needs an Entra app
registration and a federated credential managed outside this repo, where
`--oidc` needs only a policy on the Marketplace listing itself. If the Entra
route ever becomes necessary (for example, the repo already federates into
Entra for the AI reviewers — see `PRODUCTION_PLAN.md` §7 — and consolidating is
judged worthwhile), it supersedes this paragraph, not the whole ADR.

**Skip Open VSX for v0.1.0.** Smaller blast radius — one fewer secret and
namespace to set up before the first release. Rejected because the marginal cost
once the workflow exists is one best-effort step and one secret, and the
audience that installs from Open VSX (VS Codium, Cursor, Windsurf users) is
exactly the "can't install proprietary Python locally, wants an open toolchain"
profile this extension is built for. Making it best-effort rather than required
keeps the setup cost from blocking a release.

**Make the Open VSX step required.** Rejected: it makes a third party's uptime a
release blocker for a channel that is secondary for this audience, with a retag
as the only recovery. A warning plus a documented manual re-run is the right
weight.

**Re-package inside `vsce publish` / `ovsx publish` instead of `--packagePath`.**
Both tools will build the archive themselves. Rejected because then the artifact
that `check:package` inspected, the artifact on the GitHub Release, and the
artifact in each registry are three separate builds that only happen to match.
Publishing the one archive that was actually checked is worth the `--packagePath`
flag. `--oidc` and `--packagePath` are independent in `vsce`'s source — both are
passed straight to `publish()`, `--oidc` only conflicts with `--pat` and
`--azure-credential`, and the credential resolution runs regardless of
`--packagePath` — so the pairing should work, but it has not been run end to
end against the live Marketplace. The first real exercise is the v0.1.0 tag
(the `workflow_dispatch` rehearsal is build-only and never reaches this step);
if the pairing fails, the fix is to drop `--packagePath` from the Marketplace
step alone and let `vsce` repackage.

**Third-party publish actions (`HaaLeo/publish-vscode-extension` and similar).**
They wrap both registries in one step and are widely used. Rejected on the same
grounds as everything else in this repo's CI: a step that handles publish
credentials should be a command a maintainer can read and run, not a composite
action whose internals move on someone else's schedule. `vsce` and `ovsx` are
first-party CLIs for their respective registries; calling them directly is the
transparent option.

## Consequences

Releasing is now: land the release PR, `git tag vX.Y.Z`, `git push origin
vX.Y.Z`, approve the `release` environment, watch one workflow. The checklist in
`docs/release-checklist.md` is rewritten around that path, including the one-time
setup (the `shai-alit` Marketplace publisher and its trusted-publishing policy,
the Eclipse Open VSX Publisher Agreement and `OVSX_PAT`, `ovsx create-namespace`,
the `release` environment and the `v*` tag ruleset) that a first release depends
on and that nothing in the repo can do for you.

`ovsx` enters the dev dependency tree, so `check:audit` covers it and a future
advisory against it or its dependencies surfaces there like any other — even
though the publish job runs it via `npx` rather than from `node_modules`, the
pin and the audit entry are what make that `npx <name>@<pinned>` deterministic.

The `@vscode/vsce` pin is a prerelease until `3.9.3` ships stable. That is the
one place this slice knowingly steps outside the repo's dependency discipline;
the `package` CI job exercises it every PR, and Dependabot's ordinary bump
retires the exception.

The site deploy is still not done — ADR-0004's "building it is a CI job;
publishing it is a later slice" is unchanged. This ADR is about the extension
artifact, not the documentation site.

**Revisit trigger.** When Azure DevOps completes the PAT retirement, confirm
`--oidc` is still the sole Marketplace path and that no fallback crept back in.
If the repo consolidates its Entra federation (§7), reconsider `--oidc` versus
`--azure-credential`. Revisit the Open VSX "best-effort" stance if that registry
becomes a primary channel for this audience rather than a secondary one.

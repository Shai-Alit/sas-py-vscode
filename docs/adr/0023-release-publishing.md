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
- **Evidence:** `microsoft/vscode-vsce` README on `--oidc` trusted publishing
  (requests a GitHub Actions OIDC token for the `marketplace.visualstudio.com`
  audience and exchanges it for a short-lived Marketplace credential; **no PAT
  fallback**); Azure DevOps' announced retirement of the global PATs that classic
  `vsce publish -p` depends on, **2026-12-01**; the Open VSX CLI README (`ovsx
  publish <file>` for a pre-built archive, `OVSX_PAT` / `--pat`, one-time `ovsx
  create-namespace`)

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
place `vsce` gained `--oidc`: from a GitHub Actions job with `id-token: write`
and a trusted-publishing policy registered on the Marketplace, it obtains and
exchanges an OIDC token with no stored secret. A workflow written today against
a PAT would need rewriting within a quarter.

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
anywhere.** The job requests `id-token: write`; the Marketplace side needs a
trusted-publishing policy scoped to this repository and this workflow file
(`release.yml`), configured once by a Marketplace admin. `--oidc` does not fall
back to a PAT, so a misconfigured policy fails the release rather than silently
degrading — which is the behaviour we want for something that ships under the
publisher's identity.

**Open VSX is published too, but its failure is a warning, not a failed
release.** The `ovsx publish` step is `continue-on-error: true` and a failure
emits a `::warning::` telling the maintainer to re-run it by hand. The
Marketplace is the primary channel for the audience this extension targets;
an Open VSX outage on release day should not hold up the Marketplace publish or
force a retag. `ovsx` is a pinned dev dependency (so `npm ci` installs it and
`check:audit` covers it) rather than an `npx` fetch at publish time — a package
that runs inside the job that holds the publish tokens is exactly the kind of
supply-chain surface ADR-0005 says to pin and audit. The Open VSX token
(`OVSX_PAT`) and the one-time `ovsx create-namespace shai-alit` are recorded in
the release checklist.

**One archive, three destinations.** `npm run package` builds
`dist/python-on-viya.vsix` and runs `check:package` against it; that same file
is what `vsce publish --packagePath` sends to the Marketplace, what `ovsx
publish` sends to Open VSX, and what is attached to the GitHub Release. The
GitHub Release is created from the tag with notes sliced out of the matching
`CHANGELOG.md` section (falling back to GitHub's auto-generated notes if that
section is absent).

**`workflow_dispatch` runs the same pipeline as a rehearsal.** Its `dry_run`
input defaults to **true**: a manual run builds, runs `npm run verify`, packages,
and stops before any publish or release step. This is what `phase-5.md`'s 5c
item 5 ("exercise the checklist end to end as a dry run") uses, and it means the
publish path is exercised on CI infrastructure before a real tag depends on it.

**`galleryBanner` and the icon.** `package.json` gains `"private": false`,
`"icon": "media/icon.png"`, `"galleryBanner": { "color": "#0766D1", "theme":
"dark" }` and `"pricing": "Free"`. The icon shipped in this slice is a plain
`Py` wordmark, white on `#0766D1`, generated deterministically — a stopgap that
looks intentional at thumbnail size and is meant to be replaced by a designed
asset before v0.1.0. `check:package`'s `REQUIRED` list now includes
`extension/media/icon.png`, so a future change that drops the icon fails
packaging rather than shipping an extension with a broken manifest reference.
The version bump, the `CHANGELOG` finalise, and the decision on `"preview": true`
belong to the release slice (5c-iv), not here.

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
flag. The small risk carried: `--oidc` combined with `--packagePath` is a flag
pairing this project has not yet run end to end — the `workflow_dispatch` dry run
in 5c-iv is what confirms it, and if it fails the fix is to drop `--packagePath`
from the Marketplace step alone.

**Third-party publish actions (`HaaLeo/publish-vscode-extension` and similar).**
They wrap both registries in one step and are widely used. Rejected on the same
grounds as everything else in this repo's CI: a step that handles publish
credentials should be a command a maintainer can read and run, not a composite
action whose internals move on someone else's schedule. `vsce` and `ovsx` are
first-party CLIs for their respective registries; calling them directly is the
transparent option.

## Consequences

Releasing is now: land the release PR, `git tag vX.Y.Z`, `git push origin
vX.Y.Z`, watch one workflow. The checklist in `docs/release-checklist.md` is
rewritten around that path, including the one-time setup (the Marketplace
trusted-publishing policy, the `OVSX_PAT` secret, `ovsx create-namespace`) that
a first release depends on and that nothing in the repo can do for you.

`ovsx` enters the dev dependency tree, so `check:audit` now covers it and a
future advisory against it or its dependencies surfaces there like any other.
That is the cost of pinning it rather than fetching it at publish time, and it
is the trade ADR-0005 already argues for.

The site deploy is still not done — ADR-0004's "building it is a CI job;
publishing it is a later slice" is unchanged. This ADR is about the extension
artifact, not the documentation site.

**Revisit trigger.** When Azure DevOps completes the PAT retirement, confirm
`--oidc` is still the sole Marketplace path and that no fallback crept back in.
If the repo consolidates its Entra federation (§7), reconsider `--oidc` versus
`--azure-credential`. Revisit the Open VSX "best-effort" stance if that registry
becomes a primary channel for this audience rather than a secondary one.

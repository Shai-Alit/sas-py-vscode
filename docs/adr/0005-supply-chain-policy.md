# ADR-0005 — Supply chain: no install scripts, advisories reviewed by identifier with an expiry

- **Status:** Accepted
- **Date:** 2026-08-12
- **Decides:** what may run code at install time, and what happens when
  `npm audit` reports something — the dependency-audit half of
  `PRODUCTION_PLAN.md` §4
- **Executed in:** slice 0d-ii-a (`supply-chain` job, `scripts/check-audit.mjs`,
  `scripts/advisory-allowlist.json`, `allowScripts` in `package.json`, `.npmrc`)

## Context

A VS Code extension is a piece of software people install to talk to their
production analytics platform with their own credentials. The dependency tree is
the part of it nobody reads, and there are two distinct exposures in it.

**Install-time code execution.** `npm ci` will run `postinstall` scripts from any
package in the tree, at full user privilege, on a developer's machine and on
every CI runner. This is the cheapest supply-chain attack there is and it does
not require the compromised package to be one anybody imports.

**Advisories.** `npm audit` reports something on most days. The failure mode is
not that the reports are wrong; it is that a gate on the raw number ratchets and
then gets switched off. 0d-i-b is the worked example: adding VitePress took the
count from three to six in a single pull request, none of it reachable by a user,
and a naive gate would have been disabled that afternoon and never re-enabled.

Two facts about this project shape both answers.

**The extension has zero runtime dependencies.** `npm ls --omit=dev` prints an
empty tree. Every advisory to date is dev-only *structurally* rather than by
luck, which makes an asymmetric policy honest rather than a way of excusing
things.

**Every advisory currently reported is unfixable by upgrading.** `mocha` 11.8.0
is the latest release and pins `diff ^7.0.0` and `serialize-javascript ^6.0.2`;
`npm audit fix --force` proposes mocha **11.3.0**, which is a downgrade.
`vitepress` 1.6.4 is the latest 1.x and pins `vite ^5.4.14`, which brings esbuild
0.21.5; only the vitepress 2 alpha escapes it. So "just upgrade" was not
available, and a policy had to exist for the case where it is not.

## Decision

### Nothing in the tree runs code at install time

All five install scripts present — `@vscode/vsce-sign`, `esbuild` at both 0.28.2
and 0.21.5, `keytar`, and `msw` — are **denied**, via the `allowScripts` field in
`package.json`. `.npmrc` sets `strict-allow-scripts=true`, which turns npm's
"install scripts were blocked" warning into `ESTRICTALLOWSCRIPTS` and a non-zero
exit, so a new dependency that wants to run code at install time fails the build
until somebody approves or denies it deliberately.

This is not a guess about what those scripts do. It was proven by installing
clean with all five blocked and then running the real commands: 70 unit tests
pass, `npm run build`, `npm run docs:build` and `npm run package` all succeed.

**esbuild's postinstall is not load-bearing**, which is the finding that made
this a blanket deny rather than a list of exceptions. esbuild ≥0.19 resolves its
platform binary through `optionalDependencies`; `install.js` only validates the
result. Copying a genuine esbuild 0.21.5 binary over the 0.28.2 one — a real
mismatch, not a stub — produced a clear failure at first build from the runtime
guard in `esbuild/lib/main.js`:
`Cannot start service: Host version "0.28.2" does not match binary version "0.21.5"`.
Denying the script moves that failure from install to first build and makes the
message *more* specific, not less.

### The policy lives in `package.json`, not `.npmrc`

npm's own config documentation is explicit that the `.npmrc` `allow-scripts` key
is for one-off and global contexts, and that passing `--allow-scripts` during a
project-scoped `npm ci` is an error. The project-level field is `allowScripts`,
which additionally supports explicit *denials* — and a denial is skipped
silently, where an unlisted package warns on every install forever. Let
`npm install-scripts deny <pkg>` write the entry rather than hand-editing it.

### Advisories: hard on production, reviewed-with-an-expiry on dev

`npm run check:audit` runs two audits and applies two rules.

**Production** (`npm audit --omit=dev`): any advisory, any severity, fails. There
is no allow-list and no severity threshold. This is vacuous today because the
tree is empty; it is the real gate the day a runtime dependency lands, which is
exactly the day nobody will want to be designing one.

**Development**: every advisory must appear in `scripts/advisory-allowlist.json`
with a reason and an unexpired date. An entry matching no current advisory also
fails.

**The allow-list is keyed on the GHSA identifier**, and this is the part that
earns its keep. `npm audit` is organised by package and its headline count is
packages too: on 2026-08-12 it said "6 vulnerabilities" over **7** distinct
advisories, because three separate `vite` advisories collapse into a single line
of human-readable output. One of the three was a **high**-severity
Windows-specific `server.fs.deny` bypass that the summary never named. Keying on
anything coarser would have silenced an advisory nobody had read — and it would
have looked like diligence while doing it.

**Every entry expires.** An allow-list without expiry dates is a mute button.
When one lapses the build fails and somebody re-reads the advisory, which is the
entire mechanism; the initial entries are dated 2026-11-12, three months out.

### It is enforced in one CI job, not everywhere

`allowScripts` is understood only by **npm 12.0.0 and later** — bisected; no 11.x
release has it — and npm 12 requires Node `^22.22.2 || ^24.15.0 || >=26.0.0`.
That is above the **20.19.0** floor `engines.node` claims and that two legs of the
`test` matrix deliberately exercise. The control therefore cannot run everywhere
without moving the project's supported Node floor.

So it runs in one pinned `supply-chain` job, and the floor and the six-leg matrix
are left alone. The honest consequence, stated in `docs/dev/ci.md` as well as
here: **every other job installs with those scripts running**, because the
runners' bundled npm is 10.x. This is a gate on what enters the lockfile, not a
guarantee about how any given machine installed it.

## Alternatives considered

**A severity threshold — fail on high and critical only.** Rejected because
severity is a property of the advisory, not of this project's exposure to it. All
seven current advisories are unreachable by a user regardless of their score, and
the one that mattered most to *notice* was noticed by counting identifiers, not
by reading severities. A threshold also invites the argument about whether a
given "moderate" is really moderate, which is an argument with no end.

**`npm audit fix --force`.** Rejected on evidence: it proposes downgrading mocha
from 11.8.0 to 11.3.0. A "fix" that moves a dev tool backwards past eight minor
releases to silence a low-severity `diff` advisory is a worse tree, not a better
one.

**Upgrading vitepress to 2.x to escape the vite/esbuild chain.** Rejected because
2.x is alpha and the documentation toolchain was settled one slice ago
([ADR-0004](0004-documentation-toolchain.md)). Trading a dev-only advisory for a
pre-release build tool is not a trade.

**An allow-list keyed on package name, or on npm's own advisory numbers.**
Rejected for the reason above: package granularity would have hidden three
advisories behind one line. npm's numeric ids are also not stable across
registries in the way a GHSA identifier is.

**A permanent allow-list with no expiry.** Rejected because it is
indistinguishable in practice from removing the check, with the added cost of
looking like it is still there.

**Allowing esbuild's postinstall as a known-good exception.** This is what an
earlier draft of the runbook assumed, on the plausible theory that a native
binary must need its installer. Rejected once it was tested rather than reasoned
about — see the Decision. A one-exception allow-list would have set the precedent
that "this one obviously needs it" is a sufficient argument, and it was not even
true in the case that motivated it.

**`engine-strict` with an `engines.npm` floor,** to make the npm-version
requirement loud everywhere. Rejected because it would fail every Node 20 leg of
the matrix. It is the right tool once the Node floor moves; it is not a way to
avoid deciding about the floor.

**Setting `strict-allow-scripts=true` and assuming it applies to every job.**
Rejected because it is false in a specific and nasty way: **npm 10 accepts the
key and reports it as `true` while implementing nothing.**
`npm config get strict-allow-scripts` will tell you the control is on. This is
the single most important thing to know about this ADR, because it is a control
that can evaporate while continuing to report itself as enabled — and once you
have been told the answer is `true`, you stop looking.

## Consequences

**Good.** No package in this tree can execute code during `npm ci` on the job
that matters, and a new one that wants to must be approved by a human edit.
Advisories cannot accumulate silently: a new one fails the pull request that
introduces it, and an old one comes back on a date. The production tree has a
gate that is meaningful before there is anything in it to gate. The identifier
keying surfaced a high-severity advisory that the tooling's own summary had
folded away.

**Costs.** Running the policy locally needs npm 12, which needs Node 22.22.2 or
newer — so a contributor on the project's claimed Node floor cannot reproduce the
`supply-chain` job at all, and this is the first place in the toolchain where
"CI runs commands you can run" is not strictly true. Five install scripts denied
means that if one of them ever *does* become load-bearing, the failure appears at
first build rather than at install, one step further from its cause. The
allow-list is maintenance: seven entries come due on 2026-11-12 and somebody has
to re-read seven advisories, which is the deliberate trade but is not free.
`check:audit` needs the network, so it is not part of `npm run verify`.

**Revisit trigger.** Move the whole policy into the normal jobs on the day
`engines.node` moves to 22.22.2 or later, and delete the pinned npm install from
the workflow. Re-examine the production rule the first time a runtime dependency
is added — it has never fired, and a gate that has never fired is a gate nobody
has watched fail. Revisit the vite advisories when vitepress 2 leaves alpha.

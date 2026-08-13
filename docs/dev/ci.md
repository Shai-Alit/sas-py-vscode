# Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on every push to
`main`. Five jobs: `verify`, `test`, `docs`, `package`, and `supply-chain`. Two
separate workflows sit beside it: `.github/workflows/codeql.yml`, which gates a
pull request *and* runs weekly, and `.github/workflows/link-check.yml`, which
runs weekly and is deliberately not part of the gate.

The organising principle is that **CI runs commands you can run**. There is no
step in this workflow that exists only in CI, no environment variable that
changes behaviour there, and no "works locally, fails in CI" surface beyond the
operating system itself. If a job is red, the command in its log is the command
to run on your own machine.

Two jobs bend this, and each says so in its own section below. `supply-chain`
needs a newer npm than the one your machine probably has, and needs the network;
the commands are still real commands, and the section tells you which two to run.
`analyze` — CodeQL — is not a command you can run at all, which is why it is the
one check whose output lives in the Security tab rather than in a log.

## verify

One step: `npm run verify`. That is the whole chain —

```
format:check  →  lint  →  typecheck  →  check:copyright  →  check:secrets  →  build  →  coverage
```

— and it runs on Ubuntu with the Node version in `.nvmrc`.

It could have been six steps, and GitHub would then annotate the exact stage
that failed instead of making you read the log. It is one step because six would
be a *copy* of `verify`, and copies drift: someone adds a step to `package.json`
and CI keeps passing without it. The same reasoning as the test anti-goal in
`PRODUCTION_PLAN.md` §4 — a check that restates the thing it is checking is
mostly checking itself.

The coverage report uploads as an artifact even when the job fails, because a
failing coverage ratchet is precisely when you want to read it.

## test

The unit and integration tiers, across ubuntu / windows / macOS × Node
**20.19.0** and **22**, with `fail-fast: false` so one platform's failure does
not hide the others.

The Node versions are not arbitrary. `22` is what `.nvmrc` pins and what
contributors actually use. `20.19.0` is the exact floor `engines.node` claims,
and an untested floor is a guess — if that leg is ever dropped, the floor in
`package.json` moves with it in the same pull request.

The full matrix runs on pull requests rather than post-merge. Six legs of
downloading VS Code is not free, but this project has already been bitten twice
by platform-specific problems (a `node_modules` tree with the wrong esbuild
binary, and path handling in test discovery), and finding those after merge
costs more than the runner minutes.

On Linux the integration tier runs under `xvfb-run -a`, because VS Code needs a
display and the Ubuntu runner has none. Windows and macOS runners have a real
session and need no wrapper.

## docs

One step, `npm run check:docs`, which is four checks in a row:

```
docs:reference:check  →  docs:samples  →  docs:links:self  →  docs:build
```

**`docs:reference:check`** regenerates the settings and command tables from
`package.json` and fails if the committed files differ. The reference is
generated *and committed* — see [docs/README.md](../README.md) — so this job is
what keeps those two facts from quietly diverging.

**`docs:samples`** extracts every ` ```ts ` block from `docs/` and compiles it.
A sample that imports from the repository declares where it lives
(` ```ts path=test/unit/compute-contexts.test.ts `) and is checked against the
project that owns that directory, so `../helpers/…` resolves and `describe` is
in scope. A block that is a fragment rather than a module says ` ```ts no-check `,
and the run prints how many opted out.

That `path=` mechanism exists because of what the first real sample turned out
to be: a mocha test. Without it, the only sample a checker can verify is one
that imports nothing, which is not a useful class of sample.

It is also the one place in this toolchain where a string written in a document
chooses a filename to write to, so it is validated as untrusted input: a
location must be relative, free of `..`, and not drive-qualified, and the
resolved target is asserted to be inside the repository before the write. The
rule is stated positively rather than as a list of forbidden shapes, because
enumerating the ways out of a directory is a game you lose eventually — the
containment assertion is the actual guarantee, and the syntactic rules exist to
produce an error message that names the flag rather than the symptom.

**`docs:build`** builds the VitePress site. This is a link check wearing a
build's clothes — VitePress fails on dead internal links by default and
`ignoreDeadLinks` is deliberately not set, which is the main reason it was
chosen over the alternatives. The built site uploads as an artifact, because
reviewing a documentation change against the rendered page beats reading a diff
of markdown.

It also compiles every page as a **Vue template**, which produces one failure
mode that has nothing to do with links: an angle-bracket placeholder in prose,
`<pkg>` or `<id>`, is read as an unclosed HTML element and fails the build with
`Element is missing end tag`. A code span protects it — but only if the span
does not wrap across a line. `` `npm install-scripts deny <pkg>` `` split over
two source lines broke this job on 2026-08-12 while rendering as ordinary code
in every other markdown viewer. Keep such a span on one line, or use a fenced
block.

**`docs:links:self`** resolves every link that points back at this repository —
`https://github.com/Shai-Alit/sas-py-vscode/blob/main/…` — against the working
tree, and fails if it names a file that is not there. No network, so it is safe
in front of a pull request.

This exists because of the shape of the documents. VitePress's `srcDir` is
`docs/`, so a relative link that climbs above it — to `PROBE-FINDINGS.md`,
`CONTRIBUTING.md`, `test/fixtures/README.md` — names a file the site cannot
resolve or publish, and those three are written as absolute GitHub URLs
instead. Left there, that would be a quiet downgrade: a link checked on every
pull request by a build that fails becomes a link checked once a week by a
sweep that files an issue.

It was also, less obviously, a link that was being checked *wrongly*. **GitHub
answers 404, not 403, for a private repository**, and this repository was
private when the sweep was written, so every self-link read as broken to an
anonymous client. The first live run reported five broken links and all five
were fine — a report that is mostly false on its first outing, which is
precisely the cry-wolf failure the sweep is designed around.

The repository went public on 2026-08-12 and those fetches would now succeed, so
that argument has expired. The check stays regardless, on the two grounds that
never depended on visibility: it is exact rather than probabilistic, and it runs
early enough to gate the pull request that breaks a link. Visibility is also not
a property to build a checker's correctness on — it is one setting away from
changing back.

Resolving them on disk fixes both at once, and is better than either thing it
replaces: exact rather than probabilistic, and early enough that a rename is
caught by the pull request doing the renaming. GitHub *feature* URLs under the
same repository — `/commits/main`, `/security/advisories/new` — have no file
behind them, so they are skipped and counted as skipped.

Alternatives rejected: symlinking those files into `docs/` (two copies of one
document, and Windows checkouts handle symlinks poorly), and setting
`ignoreDeadLinks` to a pattern (blunting the gate for every link, to fix three).

## Link check (weekly, not a gate)

`link-check.yml` runs `npm run docs:links` every Monday and on demand. It checks
only **external** links; internal ones are the `docs` job's business.

It does not fail a pull request, and that asymmetry is the point. External links
break on somebody else's timetable. A contributor whose merge is blocked because
an unrelated vendor had a bad morning learns to re-run the job without reading
it — and then does not read it on the day it is right. A check that cries wolf
gets ignored exactly when it is correct. So the sweep opens (or comments on) a
single `link-rot` issue instead, which is a thing a human triages.

The classification is worth knowing before you read a report:

- **broken** — a 4xx/5xx, or no response at all, that survived a retry. Only
  this opens an issue.
- **unverified** — 403 or 429. Reported and counted, never escalated. These are
  the answers a *working* link gives when the far end dislikes a datacentre IP,
  and a checker that calls a bot-protection page a dead link teaches you to
  disbelieve the rest of the report.
- **skipped** — loopback addresses, RFC 2606 placeholder domains, and URLs
  containing `<id>`-style template markers, which would 404 by construction.

Transport errors count as broken while 403 does not, which reads backwards until
you ask which one a working link produces: a live site answers, a retired domain
does not resolve. The first draft had this the other way round, and the effect
was that a domain which had vanished entirely was filed under "probably fine".

## package

Builds the `.vsix` and uploads it, so a reviewer can install a branch instead of
building it.

`npm run package` chains `npm run check:package`, which reads the built archive
and asserts what is in it — see below. Packaging that succeeds is not the
interesting property; packaging that ships the right ten files is.

## What `check:package` is for

`.vscodeignore` is **allow-by-default**: every file in the working tree ships
unless a pattern excludes it. For most extensions that is merely untidy. Here
the working tree is expected to contain a `creds.json` holding live Viya bearer
tokens, and a missing pattern does not error — it publishes.

So `scripts/check-package.mjs` opens `dist/python-on-viya.vsix`, reads the zip
central directory, and checks both directions:

- **nothing forbidden**: sources, tests, source maps, planning documents,
  repository metadata, and anything shaped like a credential;
- **everything required**: the manifest, `package.json`, the bundle, the
  licence, `NOTICE`, the readme and the changelog.

The second half is not symmetry for its own sake. A guard that only hunts for
bad entries reports a clean bill of health when it fails to read the archive at
all, and "no violations found" is exactly what a broken reader says.

Two things worth knowing before you edit it:

- **vsce renames files.** `README.md` and `CHANGELOG.md` are lowercased in the
  package and `LICENSE` becomes `LICENSE.txt`. The required-files list was
  written with the repository's names and was wrong; running the checker against
  a real package is what corrected it.
- **Rule order is the message, not the verdict.** First match wins, and every
  rule fails the build, so ordering only changes what the failure is *called*.
  `credential` is first because "source" tells you to tidy an ignore pattern
  while "credential" tells you to rotate a token, and a `scripts/creds.json`
  matches both.
- **The rules check themselves.** The script classifies a fixed list of example
  paths on every run and exits 2 if any of them comes out differently than
  expected. A regex that stops matching does not announce itself — the run just
  goes green, which looks identical to a clean package.

Exit codes are split: **1** means the package is wrong (fix `.vscodeignore`),
**2** means the script or its input is wrong (missing archive, not a zip, or
rules that failed their own examples).

## What `check:secrets` is for

`check:package` guards the archive. `scripts/check-secrets.mjs` guards the thing
that happens earlier and more often: a commit. It is a step in `npm run verify`,
so it runs on your machine before it runs here — a credential-shape check that
lives only in CI is one you meet for the first time when the token is already in
a pushed branch.

**GitHub's secret scanning is on and does not cover this.** It matches *partner
patterns*: vendor-issued formats with a recognisable prefix, registered by a
vendor who can also be told to revoke the credential. A Viya OAuth token is a
plain JWT minted by the customer's own deployment — no prefix, nobody to notify —
so nothing in the partner-pattern set will ever match one. The two run alongside
each other. This script deliberately does not re-implement vendor patterns;
GitHub does that better and can trigger a revocation, and a second copy would add
noise and no coverage. The reasoning is
[ADR-0006](../adr/0006-scanning-posture.md).

Six rules, each statable in a sentence: a JWT, a literal `Authorization: Bearer`
value, a base64 `Basic` credential, a PEM private key banner, a
credential-named field assigned a literal, and a password embedded in a URL.

Three things to know before you read a failure:

- **It scans the tracked working tree, not history and not untracked files.**
  Both exclusions are deliberate. A credential already in history is a rotation
  task, not a build failure, and a gate that fails forever on a commit nobody can
  rewrite is a gate that gets switched off — `git log -S '<fragment>' --all` is
  the tool for that question, and rotation is the answer to it. Untracked files
  are where `creds.json` is *supposed* to live, so scanning them would fail on
  the setup `docs/dev` prescribes. What a commit would publish is the question
  with an actionable answer.
- **Findings are printed redacted** — first three characters and a length. This
  repository is public and its CI logs are public with it, so a scanner that
  quotes what it found has published it more widely than the commit did. That is
  not a hypothetical: the first end-to-end run against a planted token printed
  the whole thing, because redaction had been applied only to rules with a
  capture group and the JWT rule has none. Redaction is now the default and one
  rule — the PEM banner, which contains no secret — opts out.
- **A false positive is silenced in place, with a reason.** Put
  `credential-scan: allow <why>` in a comment on the offending line or the line
  above. The reason is mandatory and a bare marker fails the run, because a
  suppression with no reason records that somebody wanted the red to go away and
  not what they decided. A marker that no longer covers anything is *reported*
  and does not fail — a marker inside a fenced example in this documentation is
  indistinguishable, to a line-based scanner, from one in code.

Before reaching for a marker, check whether the value is a placeholder the script
should have recognised. It already knows `${VAR}`, `$(cmd)`, `%VAR%`,
`{{ template }}`, `process.env.…`, `<your-token-here>`, and an `ALL_CAPS_NAME`,
which is the *name* of an environment variable rather than a value. That last
rule exists because it was the first run's only false positive, in
`test/helpers/live-gate.ts` — a file whose whole purpose is keeping real
credentials out of the repository. Widening the placeholder list is usually the
better fix: a check that is wrong on first contact teaches people to suppress it
rather than read it.

There is no entropy rule, and there should not be one without a new argument.
`package-lock.json` is thousands of 88-character base64 integrity hashes, every
one as random as a token.

Exit codes match the other checkers: **1** the policy was violated, **2** the
script or its input is wrong (`git` missing, tree unreadable). `git ls-files`
runs under a thirty-second timeout, per `CONTRIBUTING.md` — it is a local call,
but a repository on a network share that has stopped answering is still a call
that can hang.

## supply-chain

Two questions about the dependency tree, and nothing else: **what is allowed to
run code at install time**, and **which advisories has somebody actually read**.
The reasoning behind both answers is [ADR-0005](../adr/0005-supply-chain-policy.md);
this section is about the job.

```
npm install -g npm@^12.0.0  →  npm ci  →  npm run check:audit
```

### Why this job is pinned instead of folded into the matrix

The install-script policy is the `allowScripts` field in `package.json`, and
`allowScripts` is understood **only by npm 12 and later**. npm 12 in turn
requires Node `^22.22.2 || ^24.15.0 || >=26.0.0` — above the **20.19.0** floor
that `engines.node` claims and that two legs of `test` deliberately exercise. The
control therefore cannot run everywhere without moving the project's supported
Node floor, and moving a support floor is not something a security slice should
do as a side effect. So it runs in exactly one place, on one pinned npm.

Be clear-eyed about what that buys. Every *other* job in this workflow installs
with those install scripts **running**, because the GitHub runners' bundled npm
is 10.x. This job is a gate on what is allowed to enter the lockfile. It is not a
guarantee about how any particular machine performed its install, and it never
claimed to be.

The npm version is pinned to `^12.0.0` rather than `latest` because a future npm
major could change what `allowScripts` means, and that should arrive as a
decision somebody makes rather than as a Tuesday-morning surprise. No Node
release ships npm 12 — Node 26.7.0 still ships npm 11.19.0 — so it is always a
deliberate install.

The job takes its Node version from `.nvmrc` like every other job, and `.nvmrc`
says `22` rather than an exact version, so it resolves to the newest 22.x and
clears npm 12's `^22.22.2` floor. Pinning `.nvmrc` to an exact 22.x below that
would break this job on its `npm install -g` step, for reasons that would have
nothing to do with the change that pinned it.

### The trap in `strict-allow-scripts`

`.npmrc` sets `strict-allow-scripts=true`, which promotes npm's "install scripts
were blocked" *warning* into `ESTRICTALLOWSCRIPTS` and a non-zero exit. That is
what turns a line of log nobody reads into a failed build.

**npm 10 accepts that key, reports it as `true`, and does nothing with it.**
`npm config get strict-allow-scripts` will happily tell you the control is on. It
is not on; the key simply is not implemented in that version. This is the whole
reason the job installs a specific npm rather than trusting whatever is present —
a control that can silently evaporate while still reporting itself as enabled is
worse than no control, because you stop looking.

### check:audit

`npm run check:audit` (`scripts/check-audit.mjs`) runs two audits and applies two
different rules:

- **Production tree** — `npm audit --omit=dev`. Any advisory at any severity
  fails, and there is no allow-list. The extension has **zero** runtime
  dependencies, so this tree is empty and an advisory appearing in it is news, not
  routine.
- **Dev tree** — every advisory must appear in `scripts/advisory-allowlist.json`
  with a reason and an **unexpired** date. An entry that matches no current
  advisory also fails, because a line that silently allows nothing is either a
  fixed advisory nobody cleaned up or a typo in an identifier, and those are
  indistinguishable from the outside.

It needs the network, which is why it is not part of `npm run verify`.

**The allow-list is keyed on the GHSA identifier**, and that is load-bearing.
`npm audit` is organised by package, and its headline count is packages too: on
2026-08-12 it reported "6 vulnerabilities" covering **7** distinct advisories,
because three separate `vite` advisories collapse into one line of human-readable
output. One of the three was a **high**-severity Windows-specific issue that the
summary never named. An allow-list keyed on anything coarser than the advisory id
would have silenced it.

To add an entry you need the id, a `why` that is reasoning rather than a
restatement, and an `expires`. The expiry is the point: an allow-list without
expiry dates is just a mute button. When one lapses the build fails and somebody
re-reads the advisory, which is the whole mechanism.

As with `check:package`, exit codes are split — **1** means the policy was
violated, **2** means the script or its input is wrong — and the classification
logic checks itself against a fixed set of cases on every run.

**An audit that could not run exits 2, not 0.** This is worth knowing because
`npm audit --json` reports its own failure exactly the way it reports success:
well-formed JSON, on stdout. Aimed at an unreachable registry it prints
`{"message": "… connect ECONNREFUSED …", "error": {…}}` and exits **0**. So
neither obvious signal is usable — the exit code is non-zero when the audit
*worked* and found something, zero when it never ran, and the JSON parses either
way. Without a shape check, that payload reads as an empty `vulnerabilities` map
and the production rule announces a clean tree. Both audits also run under a
two-minute timeout, so a hung registry fails this job rather than holding a
runner open until GitHub reclaims it.

### The deny-list is checked, not trusted

`allowScripts` is written by hand, and `npm run test:unit` fails if it has fallen
behind `package-lock.json` — either a package marked `hasInstallScript` with no
entry, or an entry matching nothing. This runs in the unit tier rather than here
because it needs no network and no npm 12: it is a comparison between two files
in the repository, and a contributor should hit it on their own machine, before
CI. The first version of the list was missing `fsevents`, which is optional and
darwin-only and so invisible on the machine it was written on.

This blocks a pull request where the weekly link sweep does not, and the
difference is repetition. A rotted external link fails every run from now until
someone fixes something they do not control. An advisory fails once, and the
response is a dated line in a file that the contributor can write in the same
pull request.

## CodeQL (a gate *and* a schedule)

`.github/workflows/codeql.yml`, one job named `analyze`, on pull requests, on
pushes to `main`, and weekly. It analyses `javascript-typescript` with the
`security-extended` query suite and uploads its alerts to the repository's
Security tab, which is the entire output — there is nothing to read in the job
log when it passes.

It is the **advanced** setup, meaning a committed workflow, rather than GitHub's
default setup, which is configured on a settings page and appears nowhere in the
tree. Same reason everything else here is a file: a change to the query suite or
the schedule then arrives as a reviewable diff, and a maintainer without
administrator access can still find out what is being scanned.

It is a separate workflow from `ci.yml` because of the schedule. A query pack
updates on GitHub's timetable rather than on a commit, so an unchanged tree can
become newly interesting; folding that into `ci.yml` would mean either putting
the whole of CI on a timer or giving up the timer. The cron is at `:27` rather
than on the hour because GitHub queues scheduled runs across every repository
that asked for the same minute.

Three settings that are decisions rather than boilerplate:

- **`build-mode: none`.** The extractor reads TypeScript directly and there is
  nothing to build for its purposes. Saying so explicitly stops the action
  attempting autobuild, which on a Node project means an install — and therefore
  the install scripts that [ADR-0005](../adr/0005-supply-chain-policy.md) exists
  to deny.
- **`languages: javascript-typescript`.** One extractor covering both, not two
  entries. Adding a language before there is code in it produces a job that
  analyses nothing and reports success.
- **`security-extended`, not `security-and-quality`.** Extended adds the
  lower-precision security queries, which is the right trade for something that
  will handle OAuth tokens. The quality half was rejected because its
  maintainability queries overlap with what ESLint already enforces, and a style
  opinion arriving as a security alert is how a security tab stops being read.

Permissions are least-privilege in the shape GitHub's docs recommend:
`contents: read` at the top of the file, with `security-events: write` granted
only to this job.

Unlike every other job here, this one is not a command you can run locally. The
CodeQL CLI can be installed and pointed at the tree, but that is not the same
build, and nothing in `npm run verify` reproduces it. If `analyze` is red, the
alert in the Security tab is the artefact, not the log.

## What is deliberately not here yet

- **Scanning history for credentials.** `check:secrets` reads the tracked tree.
  History is answered on demand with `git log -S` and, if anything turns up, with
  a rotation — not with a build that fails forever on a commit nobody can
  rewrite.
- **An API reference** — `src/` has no exported surface worth documenting yet,
  so TypeDoc waits for one rather than generating a page of nothing.
- **Deploying the site** — slice 5c. The `docs` job builds it and uploads it;
  nothing publishes it.
- **The live tier** — it needs a real Viya deployment and credentials, and it
  never runs in default CI. See `docs/dev/testing.md`.
- **Caching `.vscode-test`** — the VS Code download is the slowest step in the
  matrix and caching it is tempting. It is not cached because a stale or
  poisoned editor cache produces test results that are wrong in a way nobody
  would think to suspect, and the download is a minute. Revisit if the matrix
  becomes the bottleneck, with a cache key that includes the pinned VS Code
  version.

## Required status checks

Branch protection cannot require a check until it has reported at least once, so
required checks are added after this workflow first runs on `main` — see
`RUNBOOK.md`. Note that they are required **per job name**: adding an OS to the
matrix creates a new check that is not required until someone says so, and
`analyze` lives in a different workflow but is a required check like any other.

The two AI reviewers stay advisory. They comment; they do not block.

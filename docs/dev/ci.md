# Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on every push to
`main`. Four jobs: `verify`, `test`, `docs`, and `package`. A fifth check,
`.github/workflows/link-check.yml`, runs weekly and is deliberately not part of
the gate.

The organising principle is that **CI runs commands you can run**. There is no
step in this workflow that exists only in CI, no environment variable that
changes behaviour there, and no "works locally, fails in CI" surface beyond the
operating system itself. If a job is red, the command in its log is the command
to run on your own machine.

## verify

One step: `npm run verify`. That is the whole chain —

```
format:check  →  lint  →  typecheck  →  check:copyright  →  build  →  coverage
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

**`docs:build`** builds the VitePress site. This is a link check wearing a
build's clothes — VitePress fails on dead internal links by default and
`ignoreDeadLinks` is deliberately not set, which is the main reason it was
chosen over the alternatives. The built site uploads as an artifact, because
reviewing a documentation change against the rendered page beats reading a diff
of markdown.

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

It is also, less obviously, a link that would be checked *wrongly*. **GitHub
answers 404, not 403, for a private repository**, so while this repo is private
every self-link reads as broken to an anonymous client. The first live run of
the weekly sweep reported five broken links and all five were fine — a report
that is mostly false on its first outing, which is precisely the cry-wolf
failure the sweep is designed around.

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

## What is deliberately not here yet

- **Dependency audit, secret scanning, and CodeQL** — slice 0d-ii. The three
  advisories `npm ci` currently reports are all dev-only; they get triaged when
  the gate is designed, not by reflex.
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
matrix creates a new check that is not required until someone says so.

The two AI reviewers stay advisory. They comment; they do not block.

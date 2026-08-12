# Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on every push to
`main`. Three jobs: `verify`, `test`, and `package`.

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
- **Docs checks** — slice 0d-i-b: generating the settings and command reference
  from `package.json`, failing on a diff, link-checking, and type-checking the
  samples in `docs/`.
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

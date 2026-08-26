# Contributing

Thanks for your interest. This document covers how the project is built and the
rules a change has to satisfy before it merges.

Read [PRODUCTION_PLAN.md](PRODUCTION_PLAN.md) first if you want the *why* behind
any of these. This file is the *what*. Participation is also governed by the
[Code of Conduct](CODE_OF_CONDUCT.md) — reviews here are direct about code and
never about people.

## Ground rules

**One slice, one branch, one pull request.** Work is divided into numbered slices
in the plan. A branch is named `phase-<slice>-<slug>`, for example
`phase-3a-proc-python-backend`. Non-phase work uses `fix/`, `docs/`, `chore/`, or
`ci/` prefixes. A pull request that spans two slices will be asked to split.

**Conventional Commits.** `feat`, `fix`, `docs`, `test`, `chore`, `refactor`, or
`ci`, with a scope from `auth`, `compute`, `backend`, `dialects`, `python`,
`content`, `library`, `cas`, `notebook`, `ci`. Pull requests are squash-merged, so
the PR title becomes the commit message — write it accordingly.

**Every pull request updates `CHANGELOG.md`** under `[Unreleased]`.

**Keep `main` releasable.** If a change leaves the extension unusable, it was
scoped wrong.

## The rules that get changes rejected

These come from real defects, most of them in code we are porting. They are
enforced by CI, by two AI reviewers, and by human review.

**Never branch on Viya version outside `src/dialects/`.** If you are writing
`if (version === "3.5")` anywhere else, stop and add a dialect method.

**Never copy the logic under test into a test file.** Mock at the HTTP boundary
instead. The upstream SAS extension does this in its REST tests, with the result
that its REST layer is effectively untested and the copy is free to drift. This is
the single most likely reason for a test to be rejected here.

**Audit ported security code — do not transcribe it.** Upstream's PKCE verifier
uses `Math.random()`, which is not cryptographically secure. Assume there are
others, and read ported code as though it were an untrusted contribution.

**No empty `catch`.** Handle the error meaningfully or rethrow with context. The
one sanctioned exception is capability probing, which is deliberately fail-soft
and must carry a comment saying so.

**Every network call has a timeout and an abort path.** No exceptions.

**No secrets anywhere.** Not in logs, errors, fixtures, the output channel, or
tests. Tokens live in VS Code `SecretStorage`, never in settings or workspace
state. Fixtures are sanitised of hostnames, tokens, user names, and paths before
being committed. Secret scanning runs in CI, but it should never be the thing that
catches you.

The one place this is enforced mechanically today is packaging: `npm run package`
runs `npm run check:package`, which opens the built `.vsix` and fails if anything
shaped like a credential — `creds.json`, a `.env`, a key or certificate — got
swept in. `.vscodeignore` is allow-by-default, so that mistake ships silently
otherwise. See [docs/dev/ci.md](docs/dev/ci.md).

**No `console.log` in shipped code.** Use the output channel.

**All user-facing strings go through `l10n.t()`.**

**Declare any relationship to upstream code in the file header, using one of two
exact phrases.** CI checks this, and the distinction is a licensing one:

- **`Ported from: <upstream path>`** — code was copied or adapted from
  `sassoftware/vscode-sas-extension`. The file must also keep the original SAS
  copyright header *and* carry a modified-file notice. Apache-2.0 §4(b) requires
  the notice; preserving the header alone does not satisfy it.
- **`Structure follows: <upstream path>`** — the code was written here, with an
  upstream file consulted for its shape. No SAS copyright header is added,
  because none was copied. Inventing one would misattribute authorship, which is
  its own kind of licensing error.

A handful of upstream files carry no copyright header at all — `client/test/`
is the notable case — so for those there is nothing to retain even when code
*is* ported. Say so in the header rather than leaving a reviewer to guess; two
independent reviewers read an undeclared file as a §4(b) violation, which is
what prompted this rule.

See [NOTICE](NOTICE) and [docs/adr/0000-repository-licence.md](docs/adr/0000-repository-licence.md).

## Probing before implementing

Where the plan calls for a probe, run it before writing code against the endpoint.
Record what you observe in the **Probe findings** section of the current phase
file (`docs/phases/phase-N.md` — see [STATUS.md](STATUS.md) for which) and cite
the finding number in the pull request. Superseded findings are struck through
with the date and reason rather than deleted — a claim that quietly changed is
worse than one that visibly changed.

Do not document behaviour you have not observed. In particular, no change may
claim Viya 3.5 support while it remains unverified.

## Tests

Three tiers:

```bash
npm run test:unit          # mocked HTTP, no network, no VS Code — the bulk
npm run test:integration   # @vscode/test-electron, real editor, mocked Viya
npm run test:live          # opt-in, env-gated, hits a real Viya — never in default CI
```

New or changed logic needs unit tests, and **every error branch needs a regression
test.** Fixtures live under `test/fixtures/viya4/` and `test/fixtures/viya35/`;
happy paths run once per generation so a dialect regression fails loudly.

Live tests are gated three ways: the opt-in script, per-generation environment
variables, and a separate `PYTHON_ON_VIYA_ALLOW_MUTATION` flag for anything that
writes to a deployment. Mutating tests carry a per-run unique value and clean up
in `finally` — or in a Mocha `after` hook, which is the same promise made in the
one place a failure partway through the test cannot skip it.

The unique value does not have to be the object's name. `test/live/viya4-job.test.ts`
creates a compute session whose name is a constant inside the module under test,
because a test that passed a name of its own would no longer be exercising what
the extension does; the uniqueness lives in the marker it writes to the log and
reads back. Where a name is shared like that, say in the procedure how a run's
own objects are told apart — ids, or a creation timestamp.

## Documentation

Docs ship with the slice, not at the end. A behaviour change with no documentation
change is an incomplete pull request.

The settings and command reference is **generated** from `package.json` by
`npm run docs:reference`. Never hand-edit the generated tables — regenerate and
commit the result, or CI will fail the diff check. (There is no API reference
yet; TypeDoc arrives with the first module that exports something.)

When you settle a design decision, add an ADR under `docs/adr/`. The code records
what; only the ADR records why.

## Reviews

Every pull request is reviewed by two AI reviewers (Claude and Codex, both
comment-only) as well as a human. The bots are advisory and never block a merge,
but a blocking finding from either should be addressed or explicitly argued with
rather than ignored.

To skip both bots on a trivial or meta change, put `[skip-review]` in the head
commit message or add the `no-ai-review` label.

## Reporting security issues

Do not open a public issue. See [SECURITY.md](SECURITY.md).

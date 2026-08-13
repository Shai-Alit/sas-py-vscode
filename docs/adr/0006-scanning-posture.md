# ADR-0006 — Scanning: CodeQL as a committed workflow, and a repo-local scanner for credential shapes

- **Status:** Accepted
- **Date:** 2026-08-12
- **Decides:** what scans this repository for vulnerable code and for leaked
  credentials, and where each of those checks lives — the static-analysis half
  of `PRODUCTION_PLAN.md` §4
- **Executed in:** slice 0d-ii-b (`.github/workflows/codeql.yml`,
  `scripts/check-secrets.mjs`, `test/unit/secret-scan.test.ts`, `check:secrets`
  in `npm run verify`)

## Context

Two questions, and they are only adjacent because both get called "scanning".

**Is the code we write dangerous?** That is CodeQL's question. There is barely
any code yet, which is the argument for adding it now rather than later: the
gate that starts working on its own the day the first HTTP client lands is worth
more than the gate somebody remembers to add afterwards, and the same reasoning
already justified `check-audit.mjs` against an empty production tree.

**Is a credential about to be published?** That is the question GitHub's secret
scanning is supposed to answer, and for this repository it largely does not.
Secret scanning matches *partner patterns*: vendor-issued formats with a
recognisable prefix, registered by the vendor, who can also be notified so the
credential is revoked. The credential this project handles is a SAS Viya OAuth
token — a plain JWT, issued by the customer's own deployment, with no prefix and
no vendor to tell. Nothing in the partner-pattern set will ever match one.

The exposure is not hypothetical. This repository's own documentation tells
contributors to keep a `creds.json` of live Viya tokens in the working tree, and
the probing workflow in `docs/dev` involves pasting real responses around while
reading them. The realistic accident is not a committed `creds.json` — that is
git-ignored and a contributor would have to work at it — but a token that
arrives inside something else: a captured payload turned into a fixture, a curl
command copied into a runbook, an error message pasted into a test to reproduce
a bug.

The repository is public as of 2026-08-12, so the window between committing a
token and noticing is a window in which it has been published.

## Decision

### CodeQL runs from a committed workflow, not from default setup

`.github/workflows/codeql.yml`, analysing `javascript-typescript` with
`build-mode: none` and the `security-extended` query suite, on pull requests, on
pushes to `main`, and weekly.

Default setup would have been fewer moving parts, and it is configured on the
settings page — which means the configuration is invisible in the tree, changes
to it leave no reviewable trace, and a maintainer without administrator access
cannot find out what is being scanned. Every other gate in this repository is a
file for those reasons.

`security-extended` rather than the default suite, because a project that will
handle OAuth tokens can afford the lower-precision security queries.
`security-and-quality` was rejected: its maintainability queries overlap with
what ESLint already enforces here, and a style opinion arriving as a security
alert is how a security tab stops being read.

The weekly schedule is the reason this is not folded into `ci.yml`. Query packs
update on GitHub's timetable rather than on a commit, so an unchanged tree can
become newly interesting.

### A repo-local scanner looks for credential *shapes*, alongside GitHub's

`scripts/check-secrets.mjs`, six rules, each of which can be stated in one
sentence: a JWT, a literal `Authorization: Bearer` value, a base64 `Basic`
credential, a PEM private key banner, a credential-named field assigned a
literal, and a password embedded in a URL.

It deliberately does **not** re-implement vendor patterns. GitHub already does
that, does it better, and can trigger revocation; duplicating them here would
add noise and no coverage. The two run alongside each other, each doing the part
the other cannot.

Four supporting decisions, each of which was a live choice:

**It reads the tracked working tree, not history and not untracked files.**
History is immutable: a credential already committed is a rotation task, not a
build failure, and a gate that fails forever on a commit nobody can rewrite is a
gate that gets switched off. Untracked files are where `creds.json` is
*supposed* to live, so scanning them would fail on the setup the documentation
prescribes. What a commit would publish is the question with an actionable
answer.

**It runs inside `npm run verify`**, next to `check:copyright` and
`check:package`, because it needs no network and no credentials. A check that
exists only in CI is a check contributors meet for the first time when it fails,
and by then the credential is already in a pushed branch.

**False positives are silenced by an inline marker carrying a reason** —
`credential-scan: allow` followed by why — placed in a comment on the line or
the line above. Not a side-car allow-list file: the justification then sits next
to the string, travels with it when the file moves, and cannot drift out of sync
with a list keyed by line number. The reason is mandatory, because a bare
suppression records that somebody wanted the red to go away and not what they
decided.

**There is no entropy detector.** The obvious next rule — flag any long
high-entropy string — was considered and rejected. This tree contains a lockfile
full of 88-character base64 integrity hashes, every one of them exactly as
random as a token. An entropy rule starts life here with hundreds of false
positives, and a check that is wrong the first hundred times is a check people
learn to suppress without reading.

## Alternatives considered

**Default setup for CodeQL.** Rejected as above: invisible configuration, no
reviewable history. The cost of the decision taken is a file to maintain and an
action version to bump.

**`gitleaks` or `detect-secrets` instead of writing one.** Both are mature and
both have far more rules. Rejected for two reasons that are specific to this
project rather than general criticisms. The first is the standing constraint
that this repository adds no dependency it does not need, and a scanner is a
build-tooling dependency that runs on every contributor's machine — the same
argument that produced hand-written `check-package.mjs` and `check-audit.mjs`.
The second is that their value is concentrated in exactly the vendor patterns
GitHub already covers, while the rule that matters here is "a generic JWT", which
is one regular expression. If the rule set ever needs to be large, this decision
should be revisited rather than defended.

**Scanning history as well.** Rejected as above, and the alternative is
documented rather than dropped: `git log -S` on demand, and rotation as the
response.

**Failing the build on a marker that has gone stale**, as `check-audit.mjs` does
for an allow-list entry that matches nothing. Rejected because it cannot be done
without failing on the documentation that explains the mechanism: a marker in a
fenced example is, to a line-based scanner, indistinguishable from a marker in
code. Stale markers are reported and do not fail the run. The honest cost is
that a marker left behind after the string it covered was deleted will sit there
quietly suppressing that line.

## Consequences

`npm run verify` gained a step, and a contributor who pastes a captured Viya
response into a test finds out before pushing rather than after.

The scanner is itself subject to the constraint it imposes, and this is not a
curiosity — it shaped both the code and the tests. Every sample in
`scripts/check-secrets.mjs` and `test/unit/secret-scan.test.ts` is assembled at
run time from fragments, because a literal token in either file would be a
literal token in the tracked tree. The suppression marker is assembled the same
way, after the first run against a tracked copy of the scanner reported the
scanner as carrying a stale marker of its own.

Two defects were found by running it rather than by reasoning about it, and both
are recorded where they happened. The first run against the repository produced
one false positive — `token: "PYTHON_ON_VIYA_TEST_VIYA4_TOKEN"`, where the value
is the *name* of an environment variable — which is why an ALL_CAPS identifier is
now treated as a name rather than a value. The first end-to-end run against a
planted token printed the whole token to the terminal, because redaction had
been applied only to rules with a capture group and the JWT rule has none; on a
public repository that terminal is a public CI log. Redaction is now the default
and one rule opts out of it, which is the safe way round.

What this does not do: it does not look at history, it does not look at
untracked files, and it will not catch a credential that has no recognisable
shape. A password that is an English phrase, assigned to a variable called `p`,
passes every rule here. The mitigation for that is review, and the mitigation
for everything is that a token which reaches a public repository has to be
rotated regardless of who noticed it first.

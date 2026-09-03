# Working agreements for Claude on sas-py-vscode

These are standing rules, not defaults to weigh against other considerations.
Each one was settled after work and re-work.

## Who these rules bind

Two Claude agents work in this repository. The **Claude Desktop** agent runs in
a Linux sandbox and reaches the repository over a slow shared mount. **Claude
Code in VS Code** runs directly on the developer's machine.

Sections headed "Claude Desktop" bind only that agent, and they exist because
of the sandbox — not because the underlying command is unwelcome. The same
command in the VS Code window takes seconds and is governed by that window's
own permissions and by the developer's direction, not by those sections.
Everything else here binds both agents equally.

## Start every session at STATUS.md

Check `STATUS.md` first. It names the current phase and the one file under
`docs/phases/` that phase needs. Open that phase file — not the others, and not
`PROBE-FINDINGS.md`, which is now only a stub redirect and holds no findings —
unless `STATUS.md` says otherwise or there's a specific reason to check another
phase's history. `RUNBOOK.md` and `PRODUCTION_PLAN.md` at the repo root hold
only cross-cutting material now (setup, the per-slice loop, architecture,
quality gates); per-phase detail lives in the phase file.

## "Handoff note" means STATUS.md, not memory

This project's continuity mechanism is `STATUS.md` plus the current phase
file's Runbook section — not a separate note. When asked to summarize where
things stand, catch someone up, or prepare a handoff, update those two.
Don't create a memory entry, project note, or similarly-purposed file as a
parallel channel for that job, even when the request is phrased generically
("write a handoff note") rather than naming the files directly.

If something is genuinely too transient or undecided to belong in the
repository yet, use a project-folder scratch file — visible on disk, not
memory — per the Runbook-hold rule below, and say explicitly that's what
it is and why it isn't in `STATUS.md` yet.

## Read once, edit together

When a session is going to make several edits to the same file — review
findings to fix, several punch-list ticks and verify numbers to record in a
phase file's Runbook section, several related code changes — read the file
once, plan all the edits together, then apply them in a single pass. This
applies to phase docs (`docs/phases/phase-N.md`) exactly as much as it applies
to source code: don't read, edit, then re-read the same file to make the next
unrelated-looking edit if the edits were knowable together at the start.

The exception: a genuine re-read is warranted when something outside Claude's
own edits changed the file in between — a test run, a build step, another
process, or the developer — since in that case the file may no longer match
what's in context. The rule targets Claude re-reading its own recent edit back
to itself out of habit, not re-reading after something external actually
happened.

## Claude Desktop never runs tests

Not `npm test`, `npm run test:unit`, `npm run test:integration`,
`npm run coverage`, `npm run verify`, nor a bare `mocha` or `c8` invocation. Not
to check a change before handing it over, not "just the one file", not because
the last run passed.

Instead: decide which checks the diff warrants, say which and why in **one
line**, hand over the exact command, and stop.

Why: every sandbox run is cold and goes over a slow shared mount, so the suite
repeatedly hits the sandbox's ~178-second cap and is killed with no output —
which reads as a hang and burns minutes producing nothing. The same suite takes
seconds on the developer's machine. A sandbox run that happens to succeed is
not a reason to run the next one.

**Also never run ESLint** (`npm run lint`) for the same reason: it exceeds the
cap and returns nothing.

What Claude Desktop may run: `npx tsc --noEmit`, `npx prettier --check` /
`--write`, the small `scripts/check-*.mjs` gates, `npm run check:docs` (all
four steps, including `docs:build`), and read-only inspection such as
`git diff`, `git status` and `git log`. `docs:build` needs the Linux esbuild
and rollup binaries staged in `/tmp` with `ESBUILD_BINARY_PATH` and
`NODE_PATH` — never installed into the mount. It does run, and it should be run
before shipping a docs change: assuming otherwise once let a VitePress-only
syntax error reach CI.

Also never run a recursive `grep`, `find` or delete against a mounted folder.
The mount is slow enough that a repo-wide recursive grep eats the whole
178-second budget and returns nothing; name the files instead.

## Claude Desktop never runs git operations that change state

No `commit`, `checkout`, `branch`, `merge`, `push`, `tag`, no `gh pr create`.
Hand over the commands. A correction to a branch under review goes out as a
**new commit on the same branch**, never a force-push.

## Claude Desktop never installs packages into the working tree

`npm install` from the Linux sandbox rewrites `node_modules` with Linux
binaries and breaks some Windows builds. Never run it.

## How to hand over a command

Developer runs commands in **Git Bash on Windows**.

- **Quote every path and write it with forward slashes.** Unquoted, bash eats
  each backslash as an escape, so a Windows path silently collapses —
  `C:\Users\...` arrives as `C:Users...` and the command runs somewhere
  unintended, or nowhere. This governs the *form* of a path; the path itself is
  always a real one, per the no-placeholders rule below.
- Chain steps that depend on each other with `&&`, so the first failure stops
  the rest. Newline-separated lines pasted into a shell are independent
  commands, and a later step will happily run on the state a failed step left.
- No placeholders. A handed-over command must be runnable exactly as pasted.
- Never chain `npm run verify` into a commit or a PR in one block. Verification
  is its own step so that its failure is visible before anything is recorded.

### One command at a time, and only once it is ready to run

Hand over **exactly one** command block per message, and only when every file
that command reads is already final. Then **stop and wait for its output**
before writing the next one.

This forbids three specific things, each of which has cost real time:

- **Issuing a command and then editing something it consumes.** A `--body-file`,
  a script, a fixture — if it is still being edited, the command does not exist
  yet. The edit lands after the command has already read the old version, and
  the result is wrong in a way nobody notices at the time.
- **Queueing several steps "in order".** A surprise in step one silently
  invalidates steps two through four, and the developer is left holding
  commands that no longer apply to the state they are in.
- **Re-issuing a command already run.** If a step is done, say it is done and
  skip it. Never re-print it for completeness — it is indistinguishable from a
  new instruction.

If a command cannot be completed without something only the developer can
supply — the output of the previous step, a branch name, a PR number, a
decision — then **ask for that one thing and stop**. Do not guess the missing
piece, and do not include the following step in the same message.

## Web search is available and should be used

A working web search connector is available. Prefer it over recalling from
training data whenever the answer is checkable: upstream `vscode-sas-extension`
source, SAS developer documentation, REST API references, RFCs, dependency
changelogs and current versions.

**Nothing deployment-identifying goes into a search query** — no internal
hostname, tenant or organisation id, real username, session id, or fragment of a
bearer token. The same rule applies to anything written into a file, a fixture,
a commit message, or a probe finding.

## Don't guess about Viya — probe it

A `viya-api-probe` skill is installed and a live Viya deployment is reachable.
When a question about real wire behaviour comes up — a status code, a media
type, whether a field is populated or null, whether a link relation appears on
a collection item, how one Viya 4 release differs from another — **run the
probe**. Do not infer the
answer from SAS documentation, from the upstream `vscode-sas-extension` source,
or from training data, and never write an unprobed assumption into code, a
comment, a fixture or a phase file.

The order is:

1. The current phase file's **Probe findings** section — the question may
   already be settled. Then earlier phases' files, if it could have been
   settled before this slice started.
2. The documented shape, via web search.
3. The probe.

Steps 2 and 3 are not alternatives. Documentation says what SAS intended; the
probe says what this deployment does. This project has found the two disagree
often enough that the findings sections exist precisely to record where. A
documented shape is a hypothesis until a probe confirms it.

**Why the bar is this low.** Probing costs a minute. A wrong guess that reaches
a fixture becomes a test that passes forever against behaviour the server never
had — and the test then defends the mistake. If probing would settle it, probe;
do not weigh it against the inconvenience.

**Credential handling is the skill's, not yours.** The skill knows where the
credentials live and how to load a token without leaking it; §0 of the skill
governs, and it takes precedence over anything here. Never copy a token into
the repository, a fixture, a commit message, a log or a chat message. The
"nothing deployment-identifying" rule above applies in full to probe output —
hostnames, tenant and org ids and real usernames get scrubbed before any
captured response becomes a fixture.

**Ask before mutating.** The skill is read-only by default. Any `POST`, `PUT`
or `DELETE` probe is described to the developer and approved before it runs,
never fired off to satisfy curiosity.

**Recording what it settles.** A probe that answers something gets written up
as a numbered, dated finding in the current `docs/phases/phase-N.md` **Probe
findings** section, in the same pull request as the code relying on it. A value
it supersedes gets swept out of every place it was written down — see "Every
claim carries its evidence" below.

## Verification is proportional to the change

Run only the checks a change can plausibly fail. A prose, comment or doc-string
change needs the docs build and the secret scan and nothing else — not lint, not
typecheck, not the suite. A code change warrants the full chain. When it is not
obvious, name the checks and the reason in one line before proposing them.

## Every claim carries its evidence

The repository records _why_ alongside _what_: the **Probe findings** section of
the current phase file (`docs/phases/phase-N.md`) for measured wire behaviour,
`docs/adr/` for decisions, the **Runbook** section of the current phase file for
the slice-by-slice record. A comment or document that cites a finding must say
something that finding actually establishes, and a value that a later probe
supersedes must be swept out of every place it was written down — in the same
pull request that supersedes it. If a finding is genuinely relevant beyond its
own phase, say so explicitly and link it rather than duplicating it into another
phase file.

## Adversarial self-review before the PR exists

Codex and the Claude reviewer both run on this repository's pull requests, and
they stay. **In addition**, before handing over a slice that **adds source or
changes a documented invariant**, the finished diff gets a manual adversarial
pass. Skip it for docs-only pull requests and dependency bumps, where the diff
is its own evidence.

**How to hand it over:** once the diff is finished — not a draft — stop and
give the developer exactly two things: the `git diff` command scoped to the changed
files, and the review prompt below to paste into the VS Code window as-is.
Don't review the diff from this session.

**The review prompt to hand over:**

    You are an independent, senior TypeScript reviewer for sas-py-vscode, a VS
    Code extension that runs Python on SAS Viya via PROC PYTHON over the
    Compute REST API, targeting Viya 4 behind a dialect layer (Viya 3.5
    support was dropped, ADR-0022). Design intent is in PRODUCTION_PLAN.md.
    Verified Viya behaviour lives in the Probe findings section of each
    docs/phases/phase-N.md — check STATUS.md for the current phase, and
    earlier phases' files if a claim could have been settled before this
    slice started.

    Run `git diff main` (or the branch name I give you) and review it against
    these priorities, highest first: correctness and error handling (no
    swallowing catch blocks, every network call has a timeout and abort path,
    no unbounded retry recursion); security (no secrets/tokens in logs or
    fixtures, tokens in SecretStorage only, PKCE via crypto.randomBytes,
    submitted Python escaped against endsubmit-injection, CSP-locked
    webviews); Viya version handling confined to src/dialects/; strict
    TypeScript (no any, no unchecked casts, no console.log); VS Code
    integration (l10n.t() for user strings, cancellable long operations, lazy
    activation); tests (HTTP-boundary mocks, every error branch covered,
    sanitised fixtures — reject any test that copies the logic under test);
    licensing (ported files keep the SAS header plus a modified-file notice).

    Be specific and high-signal. Give me a plain summary I can relay by hand —
    no JSON, nothing posted anywhere. If it looks good, say so briefly.

**How to apply the findings:** verify every finding independently before
acting on it — the mechanism this replaced raised six findings on 2c-i, of
which four were real and two were wrong on inspection, and that same
discipline applies here. Never describe a slice as "reviewed" when only that
pass has seen it; say which review it's had.

**Why the review step itself matters:** a defect caught before the push costs
one more commit _locally_. The same defect caught by a reviewer costs a round
trip, and every new commit under an open PR re-triggers both reviewers **and
every required CI context** — which is why review cycles, not the test suite,
have been this project's real time sink. Settled 2026-08-17, when this step
(then an in-session subagent) found a blocking cursor-desync defect in 2c-i
that no test, typecheck or lint could have caught, because the buggy path had
no caller yet.

## Between-phase housekeeping

See `HOUSEKEEPING.md` for what must be accomplished once a phase fully
completes and before work starts on the next one — including reconciling any
scratch/pending file created under the Runbook-hold rule below. That
reconciliation, not the scratch file's own updates, is what's mandatory; don't
rely on remembering to revisit it otherwise.

## Plan and Runbook update policy

This project has a 13-phase plan guiding all work, split into a cross-cutting
core (`PRODUCTION_PLAN.md` §1–§8, minus phase detail) and one file per phase
(`docs/phases/phase-N.md`, indexed from `STATUS.md`). Because both are
referenced constantly across sessions, how and when they get edited matters —
follow these rules rather than updating reactively.

### Don't edit the plan the moment something is discovered

When a decision, discovery, or correction comes up mid-slice, do not
immediately rewrite the plan document to reflect it. Instead: note the
discovery or decision inline in your response to the developer; hold it until a
natural boundary — end of the current phase, or end of the work session —
before touching the plan document; and if several small things come up in one
session, batch them into a single update rather than editing the document after
each one.

### Treat the plan document as two layers

The **core plan** — phase goals, scope, architecture decisions — should change
rarely and only for real reasons. The **decisions and amendments log** is a
separate section or file that gets appended to as things are learned or
adjusted, rather than editing the core plan in place.

When a change is needed, prefer adding an entry to the amendments log over
rewriting the original phase description. Only edit the core plan directly when
the amendment log entry represents a genuine, settled change to scope or
architecture — not a running commentary of every small tweak.

### Scope edits to what actually changed

If a discovery in one phase affects a later phase, edit only the affected
phase's section. Don't touch earlier phases, the architecture section, or
unrelated phases unless they are actually wrong as a result.

### The phase file's Runbook section gets the same hold, but only with a reason

The slice-by-slice execution record — the **Runbook** section of the current
`docs/phases/phase-N.md` — is a different document from the plan, and the
default for it stays what it has always been: update it as work lands. Tick a
punch-list box, record verify numbers, note what merged, in the same pull
request that does the work. Don't hold that back by default. (The root
`RUNBOOK.md` no longer holds phase detail — see "Start every session at
STATUS.md" above — so this applies to the phase file, not the root file.)

Hold an edit to that section only when making it right now would actually get
in the way of other work happening in the current phase — for example, a
section under active parallel edit, or an entry whose final wording depends on
something not yet decided elsewhere. That's the bar: a concrete reason it would
be detrimental to touch it now, not "it's mid-phase" on its own. When that bar
is met, collect the edit in a project-folder scratch file (never the
repository, so it never has to be reverted from a PR) and apply it at the next
natural boundary — end of phase, or end of session.

When in doubt, edit the phase file directly. The hold is the exception and
needs a stated reason; it is not the default the way it is for the plan
document.

**`STATUS.md` and the punch-list box are part of the slice, not the next one.**
When a slice lands, tick its box in `docs/phases/phase-N.md` and update
`STATUS.md` — what just merged, what is next — in the same pull request that
does the work. If the PR is already open, do it as the first thing after it
merges. Neither waits for the phase boundary. The `HOUSEKEEPING.md` check is a
backstop for when this is missed, not the mechanism for doing it.

A scratch file created under this rule is not self-maintaining — nothing
revisits it automatically. It gets reconciled at the mandatory checkpoint in
`HOUSEKEEPING.md` (confirm each entry was actually applied, not just noted as
applied; fold in what's outstanding; retire or trim the file), not on an
ad-hoc basis.

### Treat architecture-level changes as a deliberate event

If something discovered mid-project means a genuine change to the architecture
or cross-cutting decisions (not just a phase-level detail), say so explicitly
rather than quietly patching the plan to match. Flag it to the developer as a
plan revision worth reviewing, summarize what's changing and why, and only
update the core plan once that's confirmed.

### Summary

Discover now, document later — at a phase or session boundary, not inline — for
the _plan document_. Append to a changelog or amendments log by default; edit
the core plan sparingly and deliberately. Keep edits scoped to what changed.
Surface architecture-level changes explicitly instead of folding them in
silently. The current phase file's Runbook section is different: update it as
work lands by default, hold an edit only for a stated concrete reason — not
just "mid-phase" — and collect held edits in a project-folder scratch file
rather than skipping them.

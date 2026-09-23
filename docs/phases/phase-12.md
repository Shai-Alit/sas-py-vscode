# Phase 12 — AI-agent integration

Bundled for this phase: plan section, runbook punch list, and probe
findings. See `STATUS.md` for where this fits in the overall project,
and the trimmed `PRODUCTION_PLAN.md` / `RUNBOOK.md` at the repo root
for cross-cutting material (architecture, quality gates, the per-slice
loop, conventions).

---

## Plan

### Phase 12 — AI-agent integration

Created 2026-09-22 (Sean's own call), moved out of Phase 11 the same day —
see [`docs/phases/phase-11.md`](phase-11.md)'s "Phase 11 follow-up decisions,
and AI-agent integration moved to Phase 12" Runbook entry for the full
account of why. Three of this phase's five slices trace to a 2026-09-21
research memo
([`docs/research/ai-integration-2026-09-21.md`](../research/ai-integration-2026-09-21.md))
answering whether the extension can let a user plug an AI agent they already
have — Claude Code above all — into it; the decision that memo fed is
[ADR-0037](../adr/0037-ai-agent-integration-approach.md). The fourth (12d) is
unrelated in topic — CSV formula-injection guard research, carried over from
a Phase 11 (11d) follow-up — but shares the same shape: a real open question
that needs investigation before it can be sized or built, the same reason
12b/12c are spikes rather than builds. **The fifth (12e) was added later the
same day**, at the Phase 11→12 between-phase housekeeping checkpoint — three
already-decided, already-scoped Phase 11 follow-ups that had a "build it"
call but no slice to land in; unlike 12a–12d, none of it traces to the
research memo and none of it is a spike, since nothing about any of the
three is actually undecided.

This phase repurposes a number previously assigned to a different, unstarted
topic ("second execution backend"), renumbered the same day to
[Phase 13](phase-13.md) so it would not collide with this one.

**Sean's explicit call, 2026-09-22: this phase gates v1.0.** Recorded as an
amendment to `PRODUCTION_PLAN.md` §8's "Definition of done — 1.0" — see that
section for the exact wording. This is new, not a reversal of anything
previously said about this phase specifically — the phase did not exist
under this number before today.

1. **12a — Ship an Agent Skill (Option A).** Formerly 11f. A
   `.claude/skills/python-on-viya/SKILL.md` teaching an agent (Claude Code or
   VS Code Copilot agent mode — both read `.claude/skills/` verbatim, per the
   research memo's Finding 14) how this project's execution model actually
   behaves: upload-plus-`infile=` submission rather than inline `endsubmit;`,
   `SYSCC` as a session variable, the interpreter banner/`>>>` markers as
   inherent output rather than a defect (Finding 11.3, `phase-11.md`),
   library/CAS naming, what the environment probe reports, and the existing
   command surface. No production code — a day of writing, per the research
   memo's own estimate.
2. **12b — Spike: an in-process MCP server reachable by an external Claude
   Code session (Option C).** Formerly 11g. Exploratory only, not a
   commitment to build the feature: the narrow question is whether an
   external Claude Code CLI session can actually connect to a loopback HTTP
   MCP server run inside the extension host, with a token handed over out of
   band, and whether the server survives a VS Code window reload — neither is
   promised by any documentation (research memo, "What would have to be
   settled before any code", items 1–2). The spike's own outcome, recorded
   here once run, decides whether a real Option C build gets scoped as a
   later slice or the project falls back to Option B (`languageModelTools`
   over the existing pure adapters), which ADR-0037 holds pending exactly
   this result.
3. **12c — Spike: a Python startup snippet's submission mechanism and
   namespace survival.** Formerly 11h. Investigates, rather than builds, the
   idea (a Phase 11e follow-up) of a profile-level Python startup snippet —
   the Python analogue of 11e's SAS `sasOptions`/`autoExec`. Settles the
   submission path given
   [ADR-0014](../adr/0014-python-is-submitted-as-an-uploaded-file.md) (all Python
   reaches the interpreter as an uploaded file via `infile=`, never
   inlined) — is it its own job run at session-create time, alongside
   `autoExec`'s SAS lines, or something else; whether its effect (imports,
   variables) actually survives into the *first* real `Run File`/notebook-cell
   job the same way it already survives between two ordinary runs in one
   session (probably already implied by existing behaviour, but not
   specifically confirmed for a job submitted before any user code has run);
   and, the harder question, what **`proc python restart;`**
   (`RESTART_STATEMENT`, `src/backend/procPython.ts`) does to it — does
   **Reset Python Interpreter** silently drop it with nothing to tell the
   user their setup is gone, or does a reset need to re-run it automatically.
   Outcome recorded here once run; decides whether the startup-snippet idea
   gets sized into a real slice back in a future phase, or stays parked.
4. **12d — Research: does the CSV formula-injection guard need to cover SAS
   library exports too, and how.** Carried over from Phase 11's 11d
   follow-ups, 2026-09-22 — flagged as needing more research than a
   punch-list item implied, rather than a settled "build it, CAS-only" call.
   The CAS-only scoping (an opt-in setting, default off, prefixing a leading
   `=`/`+`/`-`/`@` character cell in `formatCsvPage`, `src/cas/csvFormat.ts`)
   left "should this also cover SAS library table CSV export?" as an
   explicit open question the original item never answered — the SAS
   library path relays the server's CSV untouched
   ([Finding 7.20](phase-7.md)), so guarding it means re-parsing every page,
   a real cost the CAS-only version doesn't pay. An opt-in setting that only
   protects some of a user's CSV exports risks the same silent-gap shape as
   11e's autoExec-error follow-up. This slice investigates the
   library-export cost/shape before anything is decided for either surface,
   rather than shipping the CAS-only version and leaving the library
   question open again.
5. **12e — Three small, already-decided Phase 11 follow-ups.** Folded in
   from `phase-11.md`'s own punch list at the Phase 11→12 between-phase
   housekeeping checkpoint, 2026-09-22 (see that file's own "Phase 11→12
   housekeeping" Runbook entry) — each already carried a "build it" decision
   from the same day, but no phase or slice to land in:
   - **Large-table CSV-export confirmation for SAS library tables.** Added
     to Phase 11's punch list 2026-09-19, at Sean's request.
     `CsvExportSource.confirmAboveBytes` (11d) already gates a CAS table's
     CSV export above an estimated 100 MB; `LibraryCsvSource` sets no
     threshold, so a SAS library table's export never asks. Needs a
     threshold and a probe of how a large Compute session table actually
     pages ([Finding 7.20](phase-7.md) only measured `SASHELP.CLASS`;
     nothing larger has been exported), then `confirmAboveBytes` set on
     `LibraryCsvSource` and manual-test items mirroring 11.19/11.20.
   - **A `CasProblem` for an oversized CAS response.** Added 2026-09-20,
     from the PR #197 review. `src/cas/client.ts` has no
     `ResponseTooLargeError` case, so a CAS page over the transport's 1 MiB
     cap (a very wide table's export or grid page) surfaces as
     `cas-unreachable` — proxy-troubleshooting advice, with the real cause
     only in the detail. Mirror `content-too-large`
     (`src/content/client.ts`, `problems.ts`, `messages.ts`): a dedicated
     variant carrying the cap, a message saying the table/page is too wide,
     and a test driving a real `ResponseTooLargeError` through `CasClient`.
     Then restore `docs/browsing-cas.md`'s "content too large" wording and
     the two comments in `csvFormat.ts`/`csvExportModel.ts` that 11d left
     pointing at this follow-up. Consider the same for the Compute/library
     client.
   - **Surface the text of an autoExec error.** Added 2026-09-20. A bad
     `autoExec` line leaves the session `idle` with `sessionConditionCode`
     3000 and the `ERROR` only in the session log
     ([Finding 11.7](phase-11.md)) — 11e's own message says only that an
     error occurred, not what it was. Read `/compute/sessions/{id}/log`
     after create when the code is nonzero and write the `ERROR`/`WARNING`
     lines to the output channel.

   Unlike 12a–12d, none of this traces to the AI-agent-integration research
   memo and none of it is a spike — each item is already scoped and decided,
   just never given a slice until this checkpoint. Sequenced last: 12a–12d
   were this phase's original reason for existing, and 12e is Phase 11
   leftover work riding along rather than this phase's own topic.

### Punch list

- [x] **12a — Agent Skill (Option A).** Shipped 2026-09-22, no production
  code, per the plan. See this file's own Runbook entry, below, for what the
  skill covers.
- [x] **12b — Spike: in-process MCP server reachable by an external Claude
  Code session (Option C).** Run 2026-09-22. Both headline questions
  answered — an external Claude Code session connects over loopback HTTP
  with an out-of-band token and completes a real tool call; a killed/
  restarted server is transparent to the CLI only if port and token are
  both stable, and a `headersHelper` is the documented, right-shaped fix for
  the case where the token isn't. Recommendation: viable, go — see this
  file's own Runbook entry for the full account and what's still open before
  a build slice can start.
- [ ] **12c — Spike: Python startup snippet submission/namespace survival.**
  Not started.
- [ ] **12d — Research: CSV formula-injection guard for SAS library
  exports.** Not started.
- [ ] **12e — Three small, already-decided Phase 11 follow-ups.** Not
  started.

---

## Runbook

### Phase 12 created, 2026-09-22

Repurposed from a stub previously numbered Phase 12 ("second execution
backend"), which had no content beyond a three-sentence plan paragraph and
was never started — renumbered to [Phase 13](phase-13.md) the same day, so
this number could hold a real, already-scoped body of work instead of
colliding with it. 12a/12b/12c are 11f/11g/11h, moved here unchanged in
substance (see `phase-11.md`'s own "Phase 11 follow-up decisions, and
AI-agent integration moved to Phase 12" Runbook entry for the full account
of what carried over and why); 12d is the CSV-guard research item, similarly
carried over from 11d's follow-ups. None of the four has started as of this
entry.

### 12e added, 2026-09-22, at the Phase 11→12 between-phase housekeeping checkpoint

The housekeeping checkpoint (`phase-11.md`'s own "Phase 11→12 housekeeping"
Runbook entry) found that Phase 11's three remaining punch-list follow-ups —
large-table CSV confirmation for SAS library tables, a `CasProblem` for an
oversized CAS response, and surfacing autoExec-error text — each already
carried a same-day "build it" decision but no phase or slice to land in. A
first pass at the checkpoint described them as "carried forward as
documented open items," on the model of Phase 8a's own open items; that
comparison didn't hold, since Phase 8a's items are blocked on something
external (a stale credential, a not-yet-existing environment) and these
three are not blocked on anything — just unscheduled. Fixed by giving them a
slice, **12e**, in this phase rather than Phase 11 (which is otherwise
closed) or a new phase of their own — Phase 12 is the next phase starting
regardless, and none of the three needs its own investigation, so there is
no reason to hold them out of it. None of the three has started as of this
entry.

### 12a shipped, 2026-09-22

`.claude/skills/python-on-viya/SKILL.md`, per the Plan section above — no
production code, matching the research memo's own estimate. Covers: the
upload-plus-`infile=` submission mechanism and why an inline-`submit`
escaping hazard doesn't apply here ([ADR-0014](../adr/0014-python-is-submitted-as-an-uploaded-file.md));
`SYSCC` as the real success signal (`0`/`1012`/`3000`) rather than job/run
state; the interpreter banner and `>>>` prompts as inherent `PROC PYTHON`
noise, not a defect (Finding 93, `phase-5.md`; Finding 11.3, `phase-11.md`);
the three-way namespace-lifecycle distinction between Run File's fresh
namespace, Run Selection's namespace-sharing, and Reset Python State's full
interpreter restart; the one-thing-at-a-time execution model and Cancel's
inability to interrupt a step already running inside SAS; reading/writing
SAS library data via `SAS.sd2df`/`SAS.df2sd`/`SAS.submit` and the
never-write-a-credential-as-a-literal rule (`docs/data-access.md`);
connecting to CAS via `swat.CAS()` and FedSQL passthrough, both via their
own insert-snippet commands rather than a hand-written token literal
(`docs/cas-python-connection.md`); the environment probe's read-only scope
and cache behaviour (`docs/python-environment.md`); and the full
`pythonOnViya.*` command surface relevant to writing/running code. Reach is
both Claude Code and VS Code Copilot agent mode, since both read
`.claude/skills/` verbatim (research memo Finding 14).

Classified as a docs-only change per `CLAUDE.md`'s adversarial-review
section — it adds no source and changes no documented invariant, only
documents existing ones — so the mandatory pre-PR adversarial pass does not
apply. Sean asked for a manual review anyway, since the skill ships content
users will act on even though it is not code — see the next entry for what
it found.

### 12a manual review, 2026-09-22 — a distribution gap and two content bugs

Requested by Sean despite 12a's docs-only classification, since the skill's
content is something an agent will act on even though no source changed. Not
run as the project's usual pre-PR pass (that pass's review prompt is written
for TypeScript source and does not fit a skill file); done as a direct,
targeted check of each claim in the new file against its cited source —
ADR-0014, `phase-11.md`'s Finding 11.7, `phase-8.md`'s Finding 8.6, and
`src/backend/logFilter.ts`'s own doc comment. Three findings, all resolved
before this branch's diff was considered final:

1. **Distribution gap (the reason this file — `agent-skill.md` — now
   exists).** The skill has no path to an actual end user. `.vscodeignore`
   excludes `.claude/**` from the packaged `.vsix` outright (with its own
   comment: "None of it has meaning inside a published VSIX"), so installing
   the extension puts nothing in a user's agent. The research memo's own
   Option A text called for "document that users can copy it to
   `~/.claude/skills/`" — that documentation did not exist. Fixed by adding
   [`docs/agent-skill.md`](../agent-skill.md), wired into `.vitepress/config.mjs`'s
   sidebar and `docs/README.md`'s page list, with cross-links added from
   `getting-started.md` and `running-python.md`.
2. **`SYSCC` conflated with `sessionConditionCode` (fixed).** The skill's
   first draft illustrated `SYSCC=3000` with a broken profile-level
   `autoExec` line — but a bad `autoExec` line surfaces as
   `sessionConditionCode` (Finding 11.7, `phase-11.md`), a different,
   session-level field checked once at session creation, not the job-level
   `SYSCC` variable ADR-0014 defines. Would have sent an agent debugging an
   autoExec failure to check the wrong signal. Fixed, with an explicit line
   distinguishing the two added to the skill.
3. **An overstated credential-leak mechanism (fixed at the time; fully
   settled by a live probe the same day — see the next entry).** The first
   draft repeated `docs/data-access.md`'s claim that "the Python cell itself
   is echoed to the job log verbatim, unconditionally" as the reason never to
   write a credential literal. That claim appears to contradict ADR-0014 and
   `src/backend/logFilter.ts`'s own doc comment, both of which state as a
   probed, settled fact (finding 35) that `infile=` — the path every ordinary
   run uses — echoes no source at all; the one *confirmed* instance of this
   leak (Finding 8.6, `phase-8.md`) was through an inline `submit`/
   `endsubmit` block, a different mechanism. Fixed at review time by
   softening the skill's wording to state the actionable rule without
   asserting the disputed broader mechanism. **Left open at review time as a
   question needing a live probe — closed the same day; see Finding 12.1,
   below, and the Runbook entry after this one.**

Verification re-run after the fixes and the new page: `npx prettier --check`
and `node scripts/check-secrets.mjs` (528 files scanned) both clean on every
touched file; `npm run check:docs` (reference check, samples, self-link
check, VitePress build) run in full this time, since `agent-skill.md` sits
inside the VitePress tree — all four steps green, self-link count 14 → 16
(the two new GitHub blob links into `.claude/skills/.../SKILL.md` and
`docs/phases/phase-12.md` both resolve).

### 12a review's open credential-echo question, settled by probe, 2026-09-22

The manual review above (item 3) flagged a contradiction it could not
resolve by reading alone: ADR-0014/`logFilter.ts` say `infile=` echoes no
source; `docs/data-access.md`/`docs/cas-python-connection.md` say the
Python cell is echoed to the job log "verbatim, unconditionally." Settled by
a live probe the same day — Finding 12.1, below. Short version: ADR-0014 was
right about the outer Python cell (never echoed); `data-access.md` was wrong
about that but right about the underlying danger, which turned out to be
worse than its own wording said — `SAS.submit()`'s own argument is echoed,
and the "masks a `password=`" claim did not hold in the one case tested (a
`LIBNAME` statement that failed to parse came back with its password in
full plaintext). `docs/data-access.md` and `docs/cas-python-connection.md`
are corrected in the same commit as this entry, and the skill's own wording
(already softened at review time) is tightened further to state the
confirmed mechanism plainly rather than hedge. No adversarial-review
re-run was needed — this is a probe-driven correction to prose already
covered by the docs-only classification, not new source or a changed
invariant.

### 12b spike run, 2026-09-22 — Option C confirmed viable; go

Per the memo's own framing ("What would have to be settled before any
code"), these are VS Code/Claude Code CLI behaviours, not Viya wire
behaviour, so this is a spike, not a `viya-api-probe` entry, and lives in
the Runbook rather than Probe findings. No production code was written or
touched in `src/` — the spike ran entirely as a standalone Node script
outside the repository, per the phase's own "no production code ships from
the spike itself" scoping.

**Method.** Built a minimal loopback HTTP MCP server (`@modelcontextprotocol/sdk`
v1.30.0's `StreamableHTTPServerTransport`, one read-only tool
`list_libraries` stubbing `LibraryAdapter.listLibraries()`, bound to
`127.0.0.1` only, gated by a bearer-token middleware checking
`Authorization: Bearer TOKEN` before any MCP request is handled) — close
enough to Option C's proposed shape (an in-process server sharing the
extension's own live session and token) to answer the two questions the
memo flagged as genuinely undocumented. Registered it against this
session's own real `claude` CLI (v2.1.245, confirmed present on this
machine) exactly the way an end user would: `claude mcp add --transport
http sas-spike http://127.0.0.1:PORT/mcp --header "Authorization: Bearer
TOKEN"`. Every tool call below ran as a fresh, separate `claude -p
--allowedTools mcp__sas-spike__list_libraries "..."` process — a real
second Claude Code session, not this one, satisfying "external" in the
memo's question 1 literally rather than by analogy.

**Q1 — can an external Claude Code session connect and complete a tool
call? Confirmed, yes, first try.** `claude mcp list` reported
`✔ Connected`; a fresh `claude -p` process called
`mcp__sas-spike__list_libraries` and returned the tool's actual payload
(`["SASHELP","WORK"]`), round-tripped correctly. The server log confirms a
distinct MCP session was initialized per connecting process. A wrong or
missing `Authorization` header was rejected with a clean `401` before any
MCP handshake — the auth gate itself needs no MCP-level design.

**Q2 — does it survive a restart (standing in for a VS Code window
reload, which kills an in-process server the same way killing this spike's
process does), and what does Claude Code do when it doesn't? Answered in
three parts, and the answer changes the design, not just confirms a
gap:**

1. **Same port, same token:** fully transparent. Killed the process,
   restarted it with identical `SPIKE_PORT`/`SPIKE_TOKEN`, and a brand-new
   `claude -p` process reconnected and completed the tool call with no
   `claude mcp` command re-run at all. If a real build pins a stable,
   per-workspace port and keeps the bearer token stable across a reload
   (not tied 1:1 to a rotating Viya token), a window reload is invisible to
   an already-configured external session.
2. **Same port, rotated token, static `--header` (the config `claude mcp
   add --header` actually writes):** restarted the server with a
   different token, config unchanged. `claude mcp list` surfaced a
   specific, actionable error — `Server rejected the configured
   Authorization header (HTTP 401)… OAuth fallback is disabled when
   headers.Authorization is set` — but a fresh `claude -p` session run
   without first checking `mcp list` saw no error at all: the tool was
   silently absent from its toolset (`ToolSearch` reported "no matching
   deferred tools found"), same as if the server had never been
   registered. **This is the real gap**, and it's a UX one, not a
   protocol one: a static header cannot self-heal, and an agent mid-session
   has no signal that a tool it could use a moment ago is now gone — only a
   human running `mcp list` sees why.
3. **`headersHelper`, the documented fix for (2):** per Claude Code's own
   docs (`code.claude.com/docs/en/mcp`, fetched live 2026-09-22, not
   assumed from the memo) a `headersHelper` script re-runs on every
   connect, is retried once automatically on a `401`/`403`, and its output
   overrides a static `headers` entry with the same name — exactly the
   shape a per-connect, freshly-read Viya-scoped token needs. Configuring
   one (`.mcp.json`/`add-json`, `type: "http"`, `headersHelper:
   "SCRIPT_PATH"`) surfaced one more real, previously-undocumented-in-this-
   project behaviour before the live rotation test could run: Claude Code
   requires a one-time **interactive** workspace-trust acceptance before it
   will execute a `headersHelper` command at all — `headersHelper not run —
   this workspace has no persisted trust; accept the trust dialog here once
   interactively, or set projects[...].hasTrustDialogAccepted in
   ~/.claude.json`. This is Claude Code's *own* trust boundary, layered on
   top of and separate from VS Code's workspace trust (ADR-0002) — a real
   user hits this once, interactively, in their own terminal, and accepts
   it, which is unremarkable; it could not be driven further from this
   spike because accepting it means editing this very session's own
   `~/.claude.json`, which the harness correctly refuses as self-
   modification. **Not fully closed the loop live** (the actual
   retry-on-401 was not observed end-to-end, only documented), but the
   mechanism, its trigger conditions, and its one real prerequisite are now
   confirmed from primary sources rather than inferred.

**Also re-checked, no change from the memo:** questions 3–5 (whether
extension-provided MCP definitions are forwarded to VS Code's Agent Host,
whether the in-VS-Code Claude harness sees them, whether
`resolveMcpServerDefinition` re-runs on token expiry) remain undocumented.
A fresh check today (`code.visualstudio.com/docs/agents/reference/mcp-configuration`,
plus `microsoft/vscode-docs#10227`, filed 2026-09-02 and closed 2026-09-17 —
adjacent but about `chat.mcp.autostart` scoping, not this question, and it
doesn't answer it either) found the same gap the memo already recorded: the
docs say VS Code "forwards the servers you configure" and
"eligible server configurations from supported VS Code sources, including
`.vscode/mcp.json`" without ever stating whether an
extension-registered (`contributes.mcpServerDefinitionProviders`)
definition counts as one of those sources. These three remain genuinely
open and would need either a real Extension Development Host prototype or
a direct question to VS Code's team — out of scope for this spike's
few-hours budget, per the memo's own sizing.

**Decision: Option C is viable — go, with one design constraint and one
scope boundary, both carried forward rather than decided here.** The two
questions the memo said actually gate the choice (Q1, Q2) are both
answered, and answered favourably: an external Claude Code session
connects and works over loopback HTTP with an out-of-band token, and the
reload story — the part the memo called "awkward" — turns out to have a
documented, working mechanism (`headersHelper`) rather than being an open
problem, provided the build pins a stable port and treats the bearer token
as something a helper re-fetches per connection rather than something
baked into a static config at registration time. Per ADR-0037's own
consequences section, the actual Option C build is "a separate,
not-yet-scoped slice," not a continuation of this one — this entry
recommends scoping it, but does not scope or start it, and does not touch
`src/`. It also does not relitigate the ADR's own named condition: "a
loopback listener holding a Viya-scoped capability is a named security
review item... not folded into a slice's ordinary pass," which stands
exactly as written and applies in full to whatever slice picks this up.

No verification commands apply — nothing in `src/`, `package.json`, or any
tracked file changed; the spike server, its `node_modules`, and every
`claude mcp` registration it created were run from and cleaned up in the
session scratch directory, never this repository.

---

## Probe findings

### Finding 12.1 — `infile=` echoes no Python source at all; a `SAS.submit()` `LIBNAME` statement is echoed unmasked when it fails to parse

Probed 2026-09-22, via `viya-api-probe`/`creds.json` against `verde`, using a
throwaway compute session (SAS Studio compute context, `id`
`05543858-66ad-4715-b14a-41e0565fb4bd`) created and deleted within the
probe — deletion confirmed by a follow-up `GET` on the session returning
`404`.

**Documented/claimed, in tension:** ADR-0014 (finding 35) and
`src/backend/logFilter.ts`'s own doc comment state that `infile=` "echoes no
source" at all. `docs/data-access.md` and `docs/cas-python-connection.md`
stated the opposite for the *outer* Python cell — "the Python cell itself is
echoed to the job log verbatim, unconditionally, regardless of
`SAS.submit()`" — and that `SAS.submit()` "masks a `password=` value the
same way SAS always does when it echoes a `LIBNAME` statement."

**Method:** Uploaded a fileref (`probe01`) containing:

```python
_outer_secret = "OUTER_FAKE_CRED_9f3a7b21c4"
try:
    SAS.submit('libname _probelib nosuchengine user=probeuser password=INNER_FAKE_CRED_7d2e91ab55;')
except Exception as e:
    print("submit raised:", e)
print("probe done")
```

Ran it the ordinary way (`proc python infile=probe01;` / `run;`, the same
two-statement job `src/backend/procPython.ts` sends), then read the job's
raw log directly (`GET .../jobs/{id}/log`) and searched for both fake
strings. Both credential values are fabricated and were never real
secrets.

**Observed:**

- The outer cell's own line — `_outer_secret = "OUTER_FAKE_CRED_9f3a7b21c4"`
  — **never appears anywhere in the log.** Confirms ADR-0014/finding 35 in
  full: `infile=` echoes no source, for the whole file, not merely the
  wrapping `proc python` statement.
- The `SAS.submit()` argument **is echoed**, as a `source`-typed log line,
  character-for-character: `libname _probelib nosuchengine user=probeuser
  password=INNER_FAKE_CRED_7d2e91ab55;` — **including the password in full
  plaintext, with no masking applied** — immediately followed by SAS's own
  parse error (`ERROR: _probelib is not a valid SAS name.` / `ERROR: Error
  in the LIBNAME statement.`).
- `SYSCC` read `0` afterward — the Python `try`/`except` caught the raised
  exception, and the SAS-side `LIBNAME` error did not propagate to it.

**Verdict:** `data-access.md`/`cas-python-connection.md`'s claim about the
*outer* Python cell being echoed is **refuted — the opposite is true**,
matching ADR-0014. Their claim that `SAS.submit()` masks a `password=`
value is **also refuted, for this statement shape** — the password leaked
in full plaintext, not merely "narrowly masked." Both docs, and the skill
this phase shipped (12a), are corrected in the same commit as this finding.

**Not settled:** whether a `LIBNAME` statement that parses successfully (a
valid libref name, a real engine) is masked differently before failing
later — at authentication, say. This statement failed at the naming/parse
stage, before any engine-specific or password-handling code would run, so
this probe does not establish that a well-formed statement leaks the same
way — only that a malformed one does, and that no masking can be assumed as
a safety net either way.

### Adversarial review of the whole branch, 2026-09-22 — one real defect found and fixed

Requested by Sean before this branch is pushed, covering all three of the
above entries together (the skill, `agent-skill.md`, the probe correction),
not just the original skill file. Same shape as the earlier manual review —
a direct, targeted check of each claim against its cited source, since the
project's standard TypeScript review prompt doesn't fit a docs-only diff.

**One real defect, fixed:** `docs/agent-skill.md` told users that Copilot
reads skills from `.github/skills/`/`~/.copilot/skills/` "in place of the
`.claude/` paths" — implying a second copy was needed for Copilot. That
directly contradicts the research memo's own Finding 14 and ADR-0037's
reason for shipping this as one file rather than two: Copilot reads
`.claude/skills/` and `~/.claude/skills/` **directly**, the same locations
Claude Code does. A user following the original wording would have done
unnecessary duplicate work, or worse, have concluded a `.claude/skills/`-only
copy doesn't reach Copilot at all. Fixed: the page now states one copy
covers both agents, and names `.github/skills/`/`~/.copilot/skills/` only as
locations Copilot *additionally* scans, not a required second destination.

**Also fixed, cosmetic:** an unwrapped, over-long source line in the skill's
CAS section (introduced by an earlier find-and-replace edit), split back
into normal paragraph width. No rendering defect — prettier passed
throughout — just inconsistent with the file's own style.

**Checked and found clean:** the compute-context UUID recorded in Finding
12.1 above, against this project's own scrubbing rule — precedent already
exists (`phase-2a.md`, `phase-2b.md`, `phase-3.md` all record Viya
correlator/session ids, which are equally opaque and non-identifying); no
real hostname, username, or token fragment from the probe session reached
any committed file (checked by grepping the full diff for the actual host,
the account's real email, and a token prefix — all clean); the small
wiring diffs (`docs/README.md`, `getting-started.md`, `running-python.md`,
`.vitepress/config.mjs`) all read correctly; `STATUS.md`'s phase-index row
and narrative paragraph match what actually shipped.

Verification re-run after the fix: `npx prettier --check` on both changed
files and `npm run check:docs` (reference check, samples, self-links,
VitePress build) both clean.

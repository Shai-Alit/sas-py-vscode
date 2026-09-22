# AI-agent integration for `python-on-viya` — research memo

> Checked into the repository 2026-09-22, verbatim from the original
> 2026-09-21 research session (previously an external, project-folder-only
> file). The decision this memo feeds is recorded in
> [ADR-0037](../adr/0037-ai-agent-integration-approach.md); the resulting
> Phase 11 slices (11f, 11g) are in
> [`docs/phases/phase-11.md`](../phases/phase-11.md). Nothing below this line
> was edited for the move — see ADR-0037 for what was actually decided and
> why, since this memo is input to that decision, not the decision itself.

**Date:** 2026-09-21
**Status:** research only. Nothing in the repository was changed. No phase, ADR or
slice has been created. This is input to a decision, not the decision.
**Question asked:** can we add hooks so users can plug their existing AI
subscriptions (Claude Code above all) into the extension, and is it worth it?

---

## The short answer

There is no "hook" in the sense of one extension point that opens the extension
to whatever assistant the user already pays for. The ecosystem is split into two
worlds that cannot see each other, and the split runs exactly through the middle
of what you asked about.

Agents running *inside* VS Code — Copilot agent mode, the Local harness, and the
Codex and Anthropic Claude harnesses — consume `vscode.lm.registerTool` and
`vscode.lm.registerMcpServerDefinitionProvider`. Those are cheap to implement and
this codebase is unusually well shaped for them. But everything registered that
way lives in the extension host's memory, is never written to a file, and is
documented as available, "by default", only "in chats in an editor window where
the extension is running." (The "by default" is VS Code's hedge, not mine, and it
is exactly why question 3 at the end of this memo is worth asking.)

Agents running *outside* VS Code — Claude Code, Codex CLI, Gemini CLI, Copilot
CLI — consume MCP and nothing else, discovered through their own config files.
None of them can see a VS Code extension's registrations, and in Claude Code's
case the feature request to bridge the two is closed.

So the honest framing is: reaching Copilot-in-VS-Code is a small, additive piece
of work. Reaching Claude Code means shipping an MCP server, which is a different
kind of commitment. The interesting part of this memo is that there may be one
build that does both, and that SAS's own MCP server has a hole in exactly the
place this project is strongest.

---

## Findings

Numbered so they can be cited or argued with individually. Sources are at the
end.

### The VS Code side

**1. The Language Model Tool API is stable and the engine floor is already met.**
`contributes.languageModelTools` plus `vscode.lm.registerTool` was finalized in
VS Code 1.95 (October 2024); agent mode began auto-invoking extension tools in
1.99 (March 2025). This repo's `engines.vscode` is `^1.104.0`, so no bump is
needed. `enabledApiProposals` is absent and, per `phase-11.md`, deliberately so —
none of this requires proposed API.

**2. A tool only reaches agent mode if it sets both `canBeReferencedInPrompt:
true` and `toolReferenceName`.** The 1.99 release notes are normative: "Any tool
… which sets `toolReferenceName` and `canBeReferencedInPrompt` … is automatically
available in agent mode", and the contribution-points page makes
`toolReferenceName` required whenever `canBeReferencedInPrompt` is true. The two
are deliberately coupled — microsoft/vscode#246132 is the still-open request to
decouple them, so that a side-effecting tool can be agent-callable without also
being `#`-mentionable. Worth knowing before someone sets one and wonders why the
tool is never invoked.

**3. Extension-contributed tools always show a confirmation dialog.** The docs
are explicit: "A generic confirmation dialog will always be shown for tools from
extensions"; `confirmationMessages` from `prepareInvocation` only upgrades the
generic one to something meaningful. Users can choose "Always Allow" per tool at
session, workspace or application level. Practical consequence: a read-only
`list_libraries` tool is not friction-free in the LM Tools API the way it is in
MCP, where `readOnlyHint` causes VS Code to skip confirmation entirely. That is a
genuine argument for the MCP route even for in-VS-Code consumers.

**4. `prepareInvocation` must be side-effect free and is not guaranteed to be
followed by `invoke`.** Relevant here because the tempting implementation —
"prepare the compute session in `prepareInvocation`" — is forbidden.

**5. The MCP server definition provider is stable since VS Code 1.101** and takes
`McpStdioServerDefinition` or `McpHttpServerDefinition`. The split between
`provideMcpServerDefinitions` (eager, must not prompt or authenticate) and
`resolveMcpServerDefinition` (called at server start, may authenticate
interactively, may mutate `headers`/`env`) is designed for exactly our case: a
Viya bearer token injected at resolve time from `SecretStorage`, never at provide
time. Two caveats: `contributes.mcpServerDefinitionProviders` is **not documented
on the contribution-points reference page at all** — the only normative
description is the API-reference docstring — and the MCP guide's own code sample
is wrong (it uses an object-literal constructor; the real constructors are
positional).

**6. Nothing registered through either API is visible outside VS Code.** There is
no documented mechanism by which an external CLI agent discovers a
provider-registered server. The only documented traffic is one-directional *into*
VS Code (`chat.mcp.discovery.enabled` imports config from Claude Desktop, Copilot
CLI, Cursor, Windsurf) or internal (VS Code forwarding config to its own Agent
Host process). Whether extension-provided definitions are included in even that
internal forwarding is undefined in the docs.

**7. `contributes.chatSkills` would need an engine bump.** It landed in VS Code
1.109 (January 2026); we are pinned to `^1.104.0`, and `@types/vscode` is pinned
to the `engines.vscode` floor on purpose. Worth knowing before anyone reaches for
it as the cheap option — the skill *file* is free, but bundling it through that
contribution point is not.

**8. Chat participants are legacy-but-supported.** Not deprecated, still in
`vscode.d.ts` at 1.138, but `contributes.chatParticipants` has been removed from
the contribution-points reference page. The modern equivalent of a domain persona
is `contributes.chatAgents` (a `.agent.md` file). Do not build a chat participant.

### The Claude Code side

**9. Claude Code reads MCP config from `~/.claude.json` and a project
`.mcp.json`, and from plugins, managed settings and `--mcp-config`. It does not
read `.vscode/mcp.json` and does not consume
`registerMcpServerDefinitionProvider`.** Only `.mcp.json` and a project-scoped
plugin install are team-shareable.

**10. The feature request to bridge this is closed as `not_planned`.**
anthropics/claude-code#47344, opened 2026-04-13, closed 2026-06-25, locked
2026-08-27. All four comments are from `github-actions[bot]`; the only human
action in the timeline is a maintainer (`localden`) reopening it on 2026-05-24
after the first stale-close and removing the `stale` label — after which the bot
re-staled and closed it again. So it was stale-closed twice and explicitly
rescued once, which is a better signal than "nobody cared", but it never got a
substantive response either way. Two near-duplicates (#42740, #45828) are also
closed not-planned and locked. #19054 and #75072 remain open. Read this as "timed
out", not "rejected on the merits" — but it is closed and locked, and planning
around it landing would be a mistake.

**11. The Claude Code VS Code extension exposes no API to third-party
extensions.** No `exports`, no consumed provider, no commands intended for
external invocation. What is documented is two URI handlers —
`vscode://anthropic.claude-code/open?prompt=…&session=…` (pre-fills a prompt,
does not submit) and
`vscode://anthropic.claude-code/install-plugin?plugin=…&marketplace=…`, both
reachable via `vscode.env.openExternal` — plus a `claude-cli://` handler for
terminal sessions. These carry no data and no tools, but they are a real
onboarding affordance: the install-plugin handler in particular means the
extension could offer a one-click "set up Claude Code for Viya".

The other documented piece is more interesting for Option C below: the extension
runs a **built-in IDE MCP server** on `127.0.0.1`, a random port in 10000–65535,
over `ws://`, authenticated by an `X-Claude-Code-Ide-Authorization` header whose
token sits in `~/.claude/ide/<port>.lock` at mode `0600`, exposing
`mcp__ide__getDiagnostics` and `mcp__ide__executeCode`. It is non-configurable
and the CLI discovers it itself, so it is not a hook we can use — but it is
documented precedent for the shape.

**12. Claude Code supports HTTP MCP transport with static `headers`, a dynamic
`headersHelper`, and full OAuth (DCR, CIMD, pre-registered client id, fixed
callback port, scope pinning).** `headersHelper` re-runs on every connect and
automatically re-runs and retries once on a 401/403 — which is the natural shape
for a short-lived Viya token.

**13. Environment-variable expansion in `.mcp.json` has two separate rules, and
only one of them bites us.** In a *remote* server's `url` and `headers`, Claude
Code reads a **fixed named list** of credential variables as empty, silently,
ignoring any `:-default` — that list is `ANTHROPIC_API_KEY`,
`ANTHROPIC_AUTH_TOKEN`, `AWS_BEARER_TOKEN_BEDROCK`, `HTTPS_PROXY` and
`NPM_TOKEN`, and the docs say plainly that a name outside the set expands as
written. So `${SAS_VIYA_TOKEN}` in `headers` would work fine. The rule that does
bite is the other one: a `headersHelper` supplied by a project `.mcp.json` or by
a plugin runs with **every** variable whose name contains `TOKEN`, `SECRET`,
`PASSWORD`, `KEY` or `AUTH`, in either case, stripped from its environment — so
`SAS_VIYA_TOKEN` would not reach a helper script. The documented route for a
plugin is a `userConfig` entry with `sensitive: true` substituted as
`${user_config.KEY}` directly into `headers`. Note what `sensitive: true`
actually means on Sean's platform: it uses the macOS Keychain on macOS, and falls
back to a plaintext `~/.claude/.credentials.json` on Windows and Linux. There is
also a shared ~2 KB budget, which a long Viya JWT is worth measuring against.

**14. Agent Skills are the one artifact that is genuinely portable today.** A
`SKILL.md` under `.claude/skills/<name>/` is read by Claude Code *and* by VS
Code/Copilot, which loads skills from `.claude/skills/` and `~/.claude/skills/`
verbatim (alongside `.github/skills/` and `~/.copilot/skills/`) and states that
"Agent Skills is an open standard that enables portability across different AI
agents". This is the highest ratio of reach to effort in this entire memo.

**15. `AGENTS.md` is honoured by Claude Code since v2.1.277, but by default only
when no `CLAUDE.md` exists at or above the working directory.** Precisely: only a
project-level `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` suppresses
it — `~/.claude/CLAUDE.md`, a managed `CLAUDE.md` and `.claude/rules/` do not
count — and a `claude-md-and-agents-md` project-instructions setting loads both
together. Even so, generating an instruction file into a user's repo is hazardous
in both directions: an `AGENTS.md` written into a repo that has a `CLAUDE.md` is
silently ignored, and a `CLAUDE.md` written into a repo that relies on
`AGENTS.md` silently suppresses it. If we ship prose guidance, ship it as a
skill, not as a root instruction file.

**16. Hooks are the wrong mechanism.** They are event-triggered side effects, not
a way to expose capability. Distribution is not the obstacle — they can ride in a
skill's or a subagent's frontmatter as well as in settings files and plugins, so
Option A's skill could carry one. The obstacles are that they do not expose
capability to a model at all, and that an enterprise can switch them off wholesale
(`disableAllHooks`, `allowManagedHooksOnly`).

### The SAS side — this is the part that changes the calculus

**17. SAS already ships an official Viya MCP server: `sassoftware/sas-mcp-server`,
Apache-2.0, 92 tools across 10 selectable tiers, with its own product page and a
named mention in the SAS Innovate 2026 press release.** It is a self-hosted
Python 3.12 FastMCP application — not a service inside Viya — runnable as HTTP,
stdio, Docker, or a Helm deployment alongside Viya. Current release v1.15.0,
published 2026-09-15 (its own `CHANGELOG.md` heads that version 2026-09-13 —
upstream's inconsistency, not a typo here). Support is GitHub-issues only; a
scoped search found no documentation.sas.com docset for it, though that is a
negative I cannot prove exhaustively.

**18. Its bundled login helper authenticates against the built-in `vscode` Viya
OAuth client** — the same client this project uses. stdio mode has two auth
paths: the SAS Viya CLI's `sas-viya auth loginCode` (writing
`~/.sas/credentials.json`), or `uv run sas-mcp-login`, described in their own
docs as a "zero-prereq helper using the built-in vscode client"; the server reads
whichever it finds. Their `TROUBLESHOOTING.md` records the same redirect-URI trap
Phase 1 hit here independently — "the built-in `vscode` client on many Viya
deployments has no registered redirect URI at all."

**19. It has no Python execution. At all.** Verified against the full source tree,
not inferred: `src/sas_mcp_server/tools/compute.py` contains exactly three tools
(`execute_sas_code`, `list_compute_contexts`, `reset_compute_session`);
`execute_sas_code` takes a `sas_code` string with no language parameter;
`workbench.py` re-registers the same tool. A repo-wide grep for `proc python`,
`run_python`, `execute_python`, `python_code` and `submit_python` returns zero
matches in `*.py`, `*.md` and `*.html`.

**20. Python execution is not planned, and an adjacent proposal was rejected.**
PR #36 (Tier 9, SAS RAG Assistant) and PR #53 (Tier 10, Code Assistance) were
both closed unmerged. PR #53 described `generate_sas_code` against
`/genAiGateway/v1/copilotRequest` "defaulting to SAS with python and r also
accepted" — and even that was code *generation*, never execution; its own body
says "the tier deliberately ships no execution tool." Tier 9 in the current
README is Business Glossary, so neither landed.

The two closures are not the same event, and the difference matters if the
"contribute upstream" route is ever considered. #36 was authored by a SAS
collaborator on a branch inside the `sassoftware` repo itself — an internal
proposal the team withdrew. #53 came from an outside fork, and was closed ten
hours after opening with zero comments, zero review comments, and a conflicted
merge state. That is a weaker signal about how outside contributions fare than
"they close feature PRs unmerged" would suggest; it is really one withdrawn
internal branch and one unreviewed drive-by.

**21. The overlap with our tree-browsing features is near-total; the overlap with
our execution path is zero.** Their tiers already cover compute contexts and
libraries, CAS servers/caslibs/tables, files, FedSQL `query_data`, batch jobs and
logs, reports, decisions, ML and glossary. What they do not have is anything that
knows Python is a thing: no upload-and-`infile=` submission, no `SYSCC`
interpretation, no endsubmit escaping, no traceback mapping, no interpreter
banner handling, no environment probe. That is precisely the set of hard-won
things this repo has spent Phases 2–3 and 10 building.

**22. The live server on this session is ≤ v1.14.2, not current.** The connected
tool list has 91 tools and lacks `get_compute_table_data`, which v1.15.0's
changelog adds to take the count 91 → 92.

**23. There is a second, different SAS MCP server** — `sassoftware/sas-score-mcp-serverjs`
(npm, Node ≥22, scoring-focused, default OAuth client id `vscodemcp`). Not the
one we are connected to. Worth not conflating in any future phase file.

### The upstream side

**24. `vscode-sas-extension` ships no AI integration of any kind, and none has
been requested.** Its complete `contributes` block at v1.21.0 (changelog dated
2026-09-18; the tag commit is 2026-09-21, and the repo publishes no GitHub
Release object) has
none of `languageModelTools`, `mcpServerDefinitionProviders`, `chatParticipants`,
`chatSkills`, `chatInstructions` or `languageModelChatProviders`. Its
`engines.vscode` is `^1.89.0`, below the floor for any of them. A GitHub
issue/PR title search returns zero results for `copilot`, `mcp`, `"language
model"` and `chat`; the only `agent` hits are about SSH agents. `CHANGELOG.md`
has one match across all those terms, and it is `ssh agent auth`.

**Consequence:** anything done here is net-new, not parity. That cuts both ways —
there is no upstream design to follow and no upstream pressure to match, so this
is a place where this project could be ahead rather than catching up.

### This codebase

**25. The architecture is already the right shape for this, which is the
pleasant surprise.** Of 138 files in `src/`, **87 have no runtime `vscode`
import** (82 never mention `vscode` at all; five more import it type-only, which
is erased at compile time), and 81 sit in the unit-coverage denominator. The
boundary is machine-enforced by `scripts/check-coverage-scope.mjs` against
`.c8rc.json`, in both directions, on three exclusion reasons — imports `vscode`,
types-only, or under `src/webview/`. Every read/browse capability's real logic is
on the pure side:
`LibraryAdapter` (`src/data/adapter.ts`), `CasAdapter` (`src/cas/adapter.ts`),
`ContentAdapter` (`src/content/adapter.ts`), the job-log readers
(`src/compute/job.ts`, `src/compute/logStream.ts`), and the environment probe
(`src/backend/environment.ts`).

**26. `ExecutionBackend` (`src/backend/backend.ts`, ADR-0015) is a real seam and
`ProcPythonBackend` takes narrow structural ports, not VS Code objects.** It is
constructed in exactly one place (`src/run/backendCache.ts:131`) from a
`ComputeClient`, `ComputeSession`, `Dialect`, a three-method `SubmissionGuard`
port onto `ComputeSessionManager`, and a `(reason: string) => void` callback. Its
only `vscode` contact is `import type { Uri }` in `ProgramOrigin`, which is
type-only and erased. That is a favourable shape for a non-VS-Code host to
satisfy — better than this project had any particular reason to expect.

**27. Two places hold real logic on the `vscode` side and would resist being
called from an agent:** `ComputeSessionManager` (`src/compute/sessionManager.ts`,
1252 lines — connection and reclaim policy) and `src/run/commands.ts` (1245 lines
— run orchestration, progress, cancel tokens, target choice). Any tool surface
that submits code has to go through or around these.

**28. Nothing in Phase 11 or Phase 12 collides.** `phase-12.md` is a stub — three
sentences of plan ("Second execution backend. Only if warranted.") and two
placeholder sections. In Phase 11, 11e is code-complete and reviewed but not yet
PR'd; what remains unticked is five follow-ups, three from 11d and two from 11e.
One of those — a Python startup snippet — is the real adjacency here, because it
touches session startup, which is exactly what an agent-owned session would also
touch. The nearest backlog adjacency is F1 (a SQL-passthrough bridge for Python
queries against SAS libnames), recorded in `phase-11.md` as "flagged, not scoped"
and reading as "an architecture-level candidate that may warrant its own phase".

---

## What the options actually are

### Option A — ship a skill, and nothing else

Write a `SKILL.md` that teaches an agent how this extension and `PROC PYTHON`
actually behave: that submission is upload-plus-`infile=` and not inline
`endsubmit;`, that `SYSCC` is a session variable, that the interpreter banner and
`>>>` markers are inherent output and not a bug, how library and CAS naming work,
what the environment probe reports, which commands exist. Ship it at
`.claude/skills/python-on-viya/SKILL.md`, and document that users can copy it to
`~/.claude/skills/`.

Cost is a day of writing and no code. Reach is Claude Code *and* Copilot in VS
Code, because both read that path (Finding 14). It adds no attack surface, no
token handling, no release train, and nothing to maintain except prose that goes
stale. It does not let an agent *do* anything — it only makes an agent better at
telling the user what to do, and better at writing Python that will actually run
on Viya.

This is the floor. It is worth doing whether or not anything else is.

### Option B — `languageModelTools` over the existing pure adapters

Register a handful of read-only tools: list libraries, list tables, describe a
table's columns, list CAS caslibs and tables, list the remote Python package set,
read the last run's log. Each is a thin wrapper over an adapter method that is
already pure and already unit-tested at ~96% coverage.

Cost is genuinely small — call it one slice. Reach is Copilot agent mode in a VS
Code window where the extension is running, and nothing else (Findings 1, 6).
Friction is Finding 3: every call shows a confirmation dialog until the user
clicks "Always Allow", which is irritating for read-only tools.

Value proposition: an agent that can answer "what's in `SASHELP`?" or "does Viya
have `polars` installed?" without the user leaving chat. That is real but modest.

### Option C — an in-process MCP server, registered to VS Code and reachable by Claude Code

This is the option worth thinking hardest about, and it is a design proposal
rather than a documented pattern, so treat it accordingly.

Run a loopback-bound HTTP MCP server inside the extension host, over the live
compute session the user already connected. Register it with VS Code via
`registerMcpServerDefinitionProvider` so in-editor agents get it with zero
config. *Also* expose its URL and bearer token so Claude Code can be pointed at
it with `claude mcp add --transport http`, since Claude Code supports HTTP
transport (Finding 12) and does not care that the server happens to live in a VS
Code process.

The attraction is that it is one implementation serving both worlds, and that it
shares the extension's session — so what the agent sees is what the user sees in
their editor, with no second Viya session and no state divergence. MCP's
`readOnlyHint` also removes the confirmation friction of Option B for the read
tools while keeping it for submission.

There is partial precedent for the shape: Claude Code's own VS Code extension runs
a loopback MCP server on a random high port, authenticated by a header token
written to `~/.claude/ide/<port>.lock` at mode `0600` (Finding 11). So the
port-instability and authentication problems have a worked answer we would not be
inventing. Two differences to keep honest, though: that server speaks `ws://`
rather than Streamable HTTP, and the CLI discovers it by scanning
`~/.claude/ide/` — behaviour built into Claude Code for its own `ide` server, not
something a third-party extension can opt into. Pointing Claude Code at ours
would still be a manual `claude mcp add --transport http`, or an
`install-plugin` URI that sets it up.

The costs are real and should not be soft-pedalled. It puts a network listener
holding a Viya-scoped capability inside the extension host, which is a security
review item and not a small one — loopback binding, per-session token, no token
in any log, and an explicit decision about what happens when a workspace is
untrusted. It needs a spike to confirm the Claude-Code-points-at-it half actually
works, because no documentation promises it. And the lifetime story is awkward:
the server exists only while VS Code is open and connected, which is fine for the
"I'm working in my editor and also have Claude Code open in a terminal" case and
useless for anything headless.

### Option D — a standalone MCP server

A separate npm-published stdio or HTTP MCP server with its own auth and its own
compute session, optionally wrapped as a Claude Code plugin with `userConfig` for
the Viya host and token (Finding 13).

Reach is everything: Claude Code, Codex CLI, Gemini CLI, Copilot CLI, Cursor,
with only the registration snippet differing. Cost is a second product — its own
release train, its own auth implementation, its own session lifecycle, its own
support surface — and it duplicates roughly the whole of Phases 1 and 2. It also
competes directly with `sassoftware/sas-mcp-server` on the 80% of surface area
where SAS already has 92 tools and we would have six.

I do not think this is the right first move, but it is the right *eventual* move
if the Python-execution gap (Findings 19–21) turns out to matter to anyone but
us.

### Option E — consume a model inside the extension

Out of scope per your answer, and I think correctly. Briefly, for the record: it
is technically available (`lm.selectChatModels` borrows the user's Copilot or
BYOK access after a consent dialog), but it puts this project in the model
business — quota it does not control, a BYOK policy an org admin can switch off,
per-extension consent friction, and a prompt-engineering maintenance burden that
has nothing to do with running Python on Viya. The whole appeal of Options A–D is
that the user's subscription stays the user's problem.

---

## Recommendation

Do Option A now, regardless of what else happens. It is a day's work, it costs
nothing to maintain beyond keeping prose honest, and it reaches both Claude Code
and Copilot through one file. It also has a side benefit that matters given where
this project is headed: a good `SKILL.md` is a compact, legible artifact to put
in front of someone at SAS, because it documents what the extension knows that
their MCP server does not.

Then spike Option C before committing to it — specifically the half that no
documentation promises. The spike question is narrow: can a Claude Code session
in a terminal actually talk to a loopback HTTP MCP server run by a VS Code
extension, with a token handed over out of band, and does it survive a VS Code
window reload. That is a few hours' work and it decides whether C is one build
for two worlds or just a more expensive Option B.

Hold Option B unless the spike says C is not viable. B and C substantially
overlap in what they expose and in the wiring they need; doing B first and C
later means writing the tool surface twice. If the spike fails, fall back to B as
the in-editor answer and revisit D separately.

Do not plan around #47344 landing (Finding 10), do not ship a generated
`CLAUDE.md` or `AGENTS.md` into users' repositories (Finding 15), and do not
build a chat participant (Finding 8).

## The strategic point, which outranks all of the above

The most important finding in this memo is not an API. It is that SAS shipped an
official Viya MCP server with 92 tools, gave it a product page and a press
release, and it cannot run Python — and that the two PRs that came nearest to
that territory were both closed unmerged (Findings 19, 20).

Set against the context that actually governs this project — a side project
aiming at a working beta to show SAS — that is a sharper argument than any
feature on the parity list. "Your MCP server exposes the whole analytics
lifecycle to agents and has no way to execute Python; this extension is the part
that knows how" is a more compelling sentence than "this extension has a CAS tree
too."

That suggests the AI work is worth doing mainly for what it *demonstrates*, which
argues for the cheap end of the ladder done well rather than the expensive end
done at all. A skill plus a small, sharp set of tools that includes one that
actually submits Python is a better demo than a forty-tool MCP server that
re-implements SAS's.

Two things worth deciding separately, and not by me:

Whether to approach SAS about contributing Python execution to
`sassoftware/sas-mcp-server` rather than building alongside it. The upside is
obvious. The risk is less about their PR record than I first thought — Finding
20's two closures turn out to be one withdrawn internal branch and one unreviewed
drive-by, not a pattern of rejecting outside work — and more about sequencing:
whether contributing this project's hardest-won knowledge into a SAS repo *before*
the conversation about the extension itself weakens your position or strengthens
it. That is a judgement about the relationship, not about software.

Whether any of this belongs in the plan at all right now. Phase 11 has 11e
awaiting a PR plus five follow-ups, Phase 12 is a stub, and nothing here is on
the 1.0 gate list. If it proceeds, it is a new phase, not an amendment to an
existing one.

---

## What would have to be settled before any code

None of these are `viya-api-probe` questions — they are VS Code and Claude Code
behaviours, so they need a spike, not a Viya probe. Recording them here so
nothing gets written into a phase file as an assumption.

1. Can an external Claude Code session connect to a loopback HTTP MCP server run
   by the extension host, and what does the handshake and token hand-off look
   like in practice? (Decides Option C.)
2. Does the server survive a VS Code window reload, and what does Claude Code do
   when it does not?
3. Are extension-provided MCP definitions forwarded to VS Code's Agent Host, or
   only file-configured ones? The docs say "servers you configure in VS Code" and
   never define it.
4. Does the Anthropic Claude harness inside VS Code see extension-provided tools?
   The harness exists and is documented (it is listed alongside Local, Copilot and
   Codex, with its own `github.copilot.chat.claudeAgent.enabled` setting) — what
   the documentation does not say is which tool sources it sees.
5. Does `resolveMcpServerDefinition` get re-invoked when a token expires and the
   server restarts? Undocumented, and it determines the token-refresh design.
6. Workspace trust. This is more settled than it looks and mostly needs writing
   down: ADR-0002 requires trust for establishing a connection and for reading
   tokens from `SecretStorage`, not merely for execution, and it explicitly
   rejected the "allow connections, block only execution" alternative — "the token
   boundary is the right place to draw the line, not the execution boundary." So
   an agent tool surface needs trust before it can connect at all, let alone
   submit. State it; don't re-litigate it.
7. Security review scope for a loopback listener holding a Viya capability — this
   needs to be named as its own review, not folded into a slice's normal pass.

---

## Sources

VS Code:
[AI extensibility overview](https://code.visualstudio.com/api/extension-guides/ai/ai-extensibility-overview) ·
[Language Model Tool API](https://code.visualstudio.com/api/extension-guides/ai/tools) ·
[MCP developer guide](https://code.visualstudio.com/api/extension-guides/ai/mcp) ·
[Language Model API](https://code.visualstudio.com/api/extension-guides/ai/language-model) ·
[Contribution points](https://code.visualstudio.com/api/references/contribution-points) ·
[VS Code API reference](https://code.visualstudio.com/api/references/vscode-api) ·
[Agent Host](https://code.visualstudio.com/docs/agents/concepts/agent-host) ·
[Agent harnesses](https://code.visualstudio.com/docs/agents/run/agent-harnesses) ·
[Add and manage MCP servers](https://code.visualstudio.com/docs/agent-customization/mcp-servers) ·
[MCP configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration) ·
[Agent Skills in VS Code](https://code.visualstudio.com/docs/agent-customization/agent-skills) ·
[Custom instructions](https://code.visualstudio.com/docs/agent-customization/custom-instructions) ·
[v1.95](https://code.visualstudio.com/updates/v1_95) ·
[v1.99](https://code.visualstudio.com/updates/v1_99) ·
[v1.101](https://code.visualstudio.com/updates/v1_101) ·
[v1.109](https://code.visualstudio.com/updates/v1_109) ·
[microsoft/vscode#246132](https://github.com/microsoft/vscode/issues/246132)

Claude Code:
[MCP](https://code.claude.com/docs/en/mcp) ·
[MCP quickstart](https://code.claude.com/docs/en/mcp-quickstart) ·
[Settings reference](https://code.claude.com/docs/en/settings-reference) ·
[Plugins reference](https://code.claude.com/docs/en/plugins-reference) ·
[Skills](https://code.claude.com/docs/en/skills) ·
[Hooks](https://code.claude.com/docs/en/hooks) ·
[VS Code extension](https://code.claude.com/docs/en/vs-code) ·
[Memory / AGENTS.md](https://code.claude.com/docs/en/memory) ·
[anthropics/claude-code#47344](https://github.com/anthropics/claude-code/issues/47344) ·
[agents.md](https://agents.md/) ·
[agentskills.io](https://agentskills.io/)

SAS:
[sassoftware/sas-mcp-server](https://github.com/sassoftware/sas-mcp-server) ·
[SAS Viya MCP Server product page](https://www.sas.com/en_us/software/viya/mcp-server.html) ·
[Connecting GitHub Copilot to SAS Viya](https://communities.sas.com/t5/SAS-Communities-Library/Connecting-GitHub-Copilot-to-SAS-Viya-with-the-SAS-Viya-MCP/ta-p/987191) ·
[Connecting Claude Code CLI to SAS Viya](https://communities.sas.com/t5/SAS-Communities-Library/Connecting-Claude-Code-CLI-to-SAS-Viya/ta-p/988775) ·
[From REST APIs to AI Agents](https://communities.sas.com/t5/SAS-Communities-Library/From-REST-APIs-to-AI-Agents-Why-the-SAS-Viya-MCP-Server-Matters/ta-p/992010) ·
[sassoftware/vscode-sas-extension](https://github.com/sassoftware/vscode-sas-extension)

---

## Verification note

Every claim above was re-checked by two independent adversarial passes on
2026-09-21 — one over the VS Code and Claude Code findings against live
documentation, one over the SAS MCP server and this codebase against the actual
source. Corrections from both are folded in. Three things remain unproven and are
flagged as such where they appear: that there is no documentation.sas.com docset
for the SAS MCP server (an unprovable negative), the exact version of the live
SAS MCP server on this session (the 91-tool list confirms pre-1.15.0 and nothing
narrows it further), and the three `communities.sas.com` article links, which
return HTTP 403 to automated fetch because of bot protection and should be opened
in a browser rather than trusted from here.

Two findings changed materially under checking and are worth knowing about if you
read an earlier draft: the "no human ever triaged #47344" claim was wrong (a
maintainer reopened it once), and the file-purity count in Finding 25 was wrong
(87 of 138, not 83).

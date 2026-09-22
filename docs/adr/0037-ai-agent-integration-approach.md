# ADR-0037 — AI-agent integration: ship an Agent Skill now, spike an in-process MCP server before committing further

- **Status:** Accepted
- **Date:** 2026-09-22
- **Decides:** which of the AI-agent-integration options surveyed in
  [`docs/research/ai-integration-2026-09-21.md`](../research/ai-integration-2026-09-21.md)
  to pursue, in what order, and what to explicitly hold, defer, or decline
  rather than leave unstated
- **Constrained by:** [ADR-0002](0002-workspace-trust-posture.md) (workspace
  trust gates the token, not merely execution — a spiked agent tool surface
  inherits this without re-litigating it)
- **Executed in:** Phase 11 slices 11f (Option A) and 11g (the Option C spike) —
  see `docs/phases/phase-11.md`

## Context

Sean asked whether the extension could let a user plug in an AI agent they
already pay for — Claude Code above all — and a 2026-09-21 research session
(the memo this ADR sits next to) answered it. The short version: VS Code's
in-editor agents (Copilot agent mode, and the Local/Codex/Claude harnesses) and
external CLI agents (Claude Code, Codex CLI, Gemini CLI) are two worlds that
cannot see each other. `vscode.lm.registerTool` and
`vscode.lm.registerMcpServerDefinitionProvider` reach only the first; nothing
documented lets a provider-registered server reach the second, and the specific
feature request to bridge Claude Code to it is closed `not_planned` (memo
Finding 10).

The finding that actually changes the calculus is on the SAS side, not the VS
Code side: `sassoftware/sas-mcp-server` is SAS's own official Viya MCP server —
92 tools, a product page, a SAS Innovate 2026 press-release mention — and it has
no Python execution at all, verified against its full source tree (memo
Findings 17, 19). Two PRs that came nearest to that territory were both closed
unmerged, for reasons that read as "never seriously reviewed" rather than
"rejected on the merits" (Finding 20). Meanwhile this codebase's read/browse
logic already sits almost entirely on the `vscode`-free side (87 of 138 `src/`
files, Finding 25), and `ExecutionBackend` is a real seam with only a type-only
`vscode` import (Finding 26) — a favourable shape for exposing capability to an
agent that this project did not build for that purpose but gets almost for
free.

The memo's own recommendation was that if any of this proceeds, it is a new
phase rather than an amendment to Phase 11, since Phase 11 is scoped to parity
gaps and this is net-new surface (memo, "The strategic point"). Sean's explicit
call, 2026-09-22, was to fold it into Phase 11 instead, as two new slices — this
ADR records the technical decision; the phase-placement decision is Sean's and
is not re-argued here.

## Decision

**Do Option A now: ship an Agent Skill, no code.** A `SKILL.md` at
`.claude/skills/python-on-viya/` teaching an agent how this project's execution
model actually behaves — upload-plus-`infile=` submission rather than inline
`endsubmit;`, `SYSCC` as a session variable, the interpreter banner and `>>>`
markers as inherent output rather than a defect, library/CAS naming, what the
environment probe reports, and the existing command surface. Reach is both
Claude Code and VS Code Copilot agent mode, because both read
`.claude/skills/` verbatim (memo Finding 14) — the single highest ratio of
reach to effort surveyed. Scoped as **11f**.

**Then spike Option C — an in-process MCP server, registered to VS Code and
also reachable by an external Claude Code session — before committing to build
it.** The spike is narrow and exploratory: can a Claude Code CLI session
actually connect to a loopback HTTP MCP server run inside the extension host,
with a token handed over out of band, and does it survive a VS Code window
reload (memo's "before any code" questions 1–2). No production code ships from
the spike itself; its outcome is a go/no-go recorded in `phase-11.md`'s
Runbook. Scoped as **11g**.

**Hold Option B — registering `languageModelTools` over the existing pure
adapters — unless the spike says C is not viable.** B and C overlap almost
entirely in what they expose and in the wiring needed to expose it; building B
first and C later would mean writing the same tool surface twice. If 11g's
spike fails, B becomes the fallback in-editor answer and gets scoped as its own
slice at that point — not now, and not preemptively.

**Defer Option D — a standalone, general-purpose MCP server** with its own auth
and session lifecycle. Right *eventually* only if the Python-execution gap in
SAS's own server turns out to matter to users beyond this project; today it
would duplicate roughly the whole of Phases 1–2 and compete with
`sas-mcp-server` on the 80% of surface area where SAS already has 92 tools.

**Decline Option E — consuming a model inside the extension**
(`lm.selectChatModels`). It puts this project in the model-quota and BYOK-policy
business for reasons that have nothing to do with running Python on Viya, which
is the opposite of what Options A–D preserve: the user's own subscription stays
the user's problem.

**Do not build a chat participant.** `contributes.chatParticipants` is
legacy-but-supported and has been removed from the contribution-points
reference page; the modern shape for a domain persona is `contributes.chatAgents`
(a `.agent.md` file), and nothing here calls for one regardless.

**Do not plan around `anthropics/claude-code#47344`** (the VS Code-to-Claude-Code
bridge request) landing — it is closed and locked, not merely stale.

**Do not ship a generated `CLAUDE.md` or `AGENTS.md` into a user's repository.**
Doing so is hazardous in both directions — a written `AGENTS.md` is silently
ignored wherever a `CLAUDE.md` already exists, and the reverse silently
suppresses a repo that relies on `AGENTS.md` (memo Finding 15). Any prose
guidance this project ships goes into the skill, which has no such collision.

## Alternatives considered

- **Option B first, or B and C together.** Rejected for now: the two overlap
  enough in tool surface and wiring that building both is double work, and B's
  own friction (memo Finding 3 — every extension-contributed tool call shows a
  confirmation dialog until "Always Allow" is clicked) is exactly what MCP's
  `readOnlyHint` avoids, which is part of why C is worth spiking before settling
  for B.
- **Option D now, aiming for every external agent at once.** Rejected: it
  duplicates this project's own auth and session-lifecycle work (Phases 1–2)
  as a second product with its own release train and support surface, for reach
  that Option A/C already cover for the two agents that matter most (Claude
  Code, Copilot), and it competes head-on with SAS's own 92-tool server on
  territory this project would be recreating rather than filling a gap in.
- **Option E, consuming a model in-extension.** Rejected per Sean's own answer
  and the reasoning above — out of scope, not merely lower priority.
- **Contributing Python execution upstream into `sassoftware/sas-mcp-server`
  instead of building anything here.** Not decided by this ADR. The memo frames
  it correctly as a relationship/sequencing judgement — whether contributing
  this project's hardest-won execution knowledge into a SAS repository before a
  conversation about the extension itself helps or weakens that conversation —
  not a technical one, and it stays open for Sean to weigh separately.
- **Scoping this as a new phase (Phase 13) rather than Phase 11 slices.** This
  was the memo's own recommendation. Overridden by Sean's explicit 2026-09-22
  call to fold it into Phase 11 as 11f/11g instead; recorded here as a
  deliberate departure from the memo's advice, not an oversight.

## Consequences

- Phase 11 gains two slices with no prior Plan-section design: 11f (ship the
  skill) and 11g (the Option C spike). Neither was part of the phase's original
  2026-09-16/17 scoping session; both are recorded as their own dated addition
  in `phase-11.md`'s Runbook.
- 11g's deliverable is a decision, not a shipped feature. If it succeeds, the
  actual Option C build — the loopback server, its token handling, its
  lifecycle story — is a **separate, not-yet-scoped slice**, because a spike
  answering "can this work" is not the same undertaking as building it
  production-ready. If it fails, 11g's own Runbook entry records why, and a
  future slice picks up Option B instead.
- **A loopback listener holding a Viya-scoped capability is a named security
  review item, not something folded into a slice's ordinary pre-PR pass**, the
  moment any code beyond the spike is written. This ADR does not authorize that
  review to be skipped or abbreviated.
- Workspace trust needs no new decision: ADR-0002 already requires a trusted
  workspace before a connection is established or a token is read from
  `SecretStorage`, which covers an agent-facing tool surface the same way it
  covers everything else this extension does. State it in 11g's own design
  notes; do not re-argue it.
- No engine bump is needed for anything decided here — Options A/B/C all sit
  within the existing `^1.104.0` floor (memo Findings 1, 5); `contributes.chatSkills`
  (Finding 7) is explicitly not being reached for.
- Whether to approach SAS about upstreaming Python execution into
  `sas-mcp-server` remains open, tracked here as a standing question rather
  than resolved one way or the other.

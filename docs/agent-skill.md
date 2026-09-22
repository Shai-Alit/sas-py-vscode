# AI agent skill

If you use Claude Code or VS Code's Copilot agent mode to write or debug the
Python you run on Viya, this extension ships a plain-text **Agent Skill** that
teaches it the parts of this project's execution model a generic Python agent
gets wrong by default — that submission is a file upload, not an inline
`SUBMIT` block; that `SYSCC` (not the run's own "finished" state) is what
success actually means; that the interpreter banner and `>>>` prompts in a
run's output are inherent noise, not a bug to fix; and how to read and write
SAS library and CAS data from Python without leaking a credential into the
job log.

## Where it lives, and why you have to copy it

The skill is a single file,
[`.claude/skills/python-on-viya/SKILL.md`](https://github.com/Shai-Alit/sas-py-vscode/blob/main/.claude/skills/python-on-viya/SKILL.md),
committed in this extension's own GitHub repository. **It does not ship
inside the installed VS Code extension** — `.claude/` is deliberately
excluded from the packaged `.vsix`, the same as this project's own internal
contributor tooling, so installing "Python on Viya" from the Marketplace does
not put anything in your agent's hands by itself.

To use it, copy that one file into either location Claude Code already
scans:

- **`<your-project>/.claude/skills/python-on-viya/SKILL.md`** — applies only
  to that project. Commit it if you want teammates working in the same repo
  to get it too.
- **`~/.claude/skills/python-on-viya/SKILL.md`** — applies to every project
  you open with Claude Code, on this machine.

**One copy covers both agents.** VS Code's Copilot agent mode reads the same
two `.claude/skills/` locations directly — that shared reach is the entire
reason this shipped as a single file rather than two (see
[ADR-0037](adr/0037-ai-agent-integration-approach.md)). Copilot separately
scans `.github/skills/` (project) and `~/.copilot/skills/` (every project)
too, if you already keep skills there for other tools, but you do not need a
second copy in either of those for Copilot to see this one.

Either way, keep the folder name (`python-on-viya`) and the file name
(`SKILL.md`) — that is the shape both tools look for.

## Keeping it current

There is no update mechanism. A newer copy ships in a later commit to this
repository the same way the first one did; re-copy the file if you want the
update. Nothing in this extension checks a running agent's copy against what
is currently in the repository.

## What it does not do

The skill only makes an agent better informed — it does not give an agent any
way to *run* Python on Viya for you, or connect it to your session directly.
That is a separate, larger question, one this project is only spiking rather
than committing to (see [ADR-0037](adr/0037-ai-agent-integration-approach.md)
and its follow-up slices in
[`docs/phases/phase-12.md`](https://github.com/Shai-Alit/sas-py-vscode/blob/main/docs/phases/phase-12.md)),
not something this file does.

## Where the details are

- [Running Python](running-python.md), [Python and SAS
  libraries](data-access.md), and [Connecting to CAS from
  Python](cas-python-connection.md) — the actual behaviour the skill
  summarizes; read these yourself if you are writing code by hand rather than
  through an agent.
- [ADR-0037](adr/0037-ai-agent-integration-approach.md) — why an Agent Skill
  was the first thing built, and what is deliberately not built yet.

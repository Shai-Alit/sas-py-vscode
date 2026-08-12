# Architecture decision records

Short documents recording decisions that were not obvious, together with the
reasoning and the alternatives that were rejected. The code says *what* the system
does; these say *why* it does it that way, which is the part that gets lost.

## When to write one

When you settle an open decision from `PRODUCTION_PLAN.md` §6, when you choose
between approaches and the losing option was genuinely plausible, or when you
discover a constraint that forecloses an option someone would otherwise try again
later. Negative results count — "we tried X, here is why it doesn't work" saves
the next person the same week.

Not every decision needs one. If the answer is obvious to anyone who reads the
code, skip it.

## How

Copy the structure of an existing record: a status, a date, what it decides,
context, the decision, alternatives considered with the reason each was rejected,
and consequences — including the costs, not just the benefits. Number them
sequentially: `NNNN-short-slug.md`.

Records are **immutable once accepted**. If a decision is reversed, write a new
ADR that supersedes it and update the old one's status to `Superseded by ADR-NNNN`.
Editing history to look wiser than you were defeats the purpose.

## Index

| ADR | Title | Status |
|---|---|---|
| [0000](0000-repository-licence.md) | Repository licence: Apache-2.0 | Accepted |
| [0001](0001-extension-identity-and-configuration-namespace.md) | Extension identity and configuration namespace | Accepted |
| [0002](0002-workspace-trust-posture.md) | Workspace trust posture: limited | Accepted |
| [0003](0003-extension-host-target.md) | Extension host target: Node-only for now | Accepted |

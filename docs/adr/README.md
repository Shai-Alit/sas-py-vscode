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

If only *part* of an older record is reversed — one paragraph out of several
independent decisions the same ADR made — the new ADR should say so precisely
(`Supersedes: ADR-NNNN's "..." paragraph only`) rather than implying the whole
record is void, and the old ADR's status in the index below should name the
same scope rather than the blanket `Superseded by ADR-NNNN` phrasing. The old
paragraph itself is still never edited — only annotated with a pointer to
what replaced it, same as a full supersession. [ADR-0011](0011-choosing-where-python-runs.md)
and [ADR-0020](0020-run-target-defaults-to-local.md) are the first example of this.

## Index

| ADR | Title | Status |
|---|---|---|
| [0000](0000-repository-licence.md) | Repository licence: Apache-2.0 | Accepted |
| [0001](0001-extension-identity-and-configuration-namespace.md) | Extension identity and configuration namespace | Accepted |
| [0002](0002-workspace-trust-posture.md) | Workspace trust posture: limited | Accepted |
| [0003](0003-extension-host-target.md) | Extension host target: Node-only for now | Accepted |
| [0004](0004-documentation-toolchain.md) | Documentation toolchain: VitePress, external links swept not gated | Accepted |
| [0005](0005-supply-chain-policy.md) | Supply chain: no install scripts, advisories reviewed by identifier with an expiry | Accepted |
| [0006](0006-scanning-posture.md) | Scanning: CodeQL as a committed workflow, and a repo-local scanner for credential shapes | Accepted |
| [0007](0007-connection-profile-storage.md) | Connection profiles: separate storage, a versioned schema, and no secret in settings | Accepted |
| [0008](0008-auth-core-transport-and-security-deltas.md) | Auth core: a `fetch`-shaped transport port, and the security deltas from upstream `auth.ts` | Accepted — its "Viya 3.5 client-id path" section is superseded by [ADR-0022](0022-drop-viya-35-support.md) |
| [0009](0009-coverage-scope.md) | Coverage measures what the unit tier can reach, and the exclusion is a checked rule | Accepted |
| [0010](0010-compute-client-is-hand-written.md) | The Compute client is hand-written against the observed wire shape, not a vendored generated client | Accepted |
| [0011](0011-choosing-where-python-runs.md) | Where Python runs is a visible per-workspace target, not a reinterpretation of the run button | Accepted — its "Default: Viya" paragraph is superseded by [ADR-0020](0020-run-target-defaults-to-local.md) |
| [0012](0012-compute-session-lifetime-and-storage.md) | A compute session belongs to a workspace and a profile, and its id is a hint | Accepted |
| [0013](0013-signing-in-opens-a-session.md) | Signing in opens a compute session, and only from the command | Accepted |
| [0014](0014-python-is-submitted-as-an-uploaded-file.md) | Python is submitted as an uploaded file and run with `infile=`, not inlined in a `SUBMIT` block | Accepted |
| [0015](0015-the-execution-backend-seam.md) | The execution backend seam takes opaque bytes and returns a streaming handle | Accepted |
| [0016](0016-api-contracts-are-checked-yaml.md) | API contracts are hand-written YAML, not shipped, and checked against the code in both directions | Accepted |
| [0017](0017-the-log-stream-is-a-self-driving-pump.md) | The log stream is a self-driving pump, driven by the log's own long poll | Accepted |
| [0018](0018-the-node-baseline.md) | The Node baseline is derived from `engines.vscode`, not chosen | Accepted |
| [0019](0019-rich-output-is-captured-by-diffing-the-working-directory.md) | Rich output is captured by diffing the session's working directory | Accepted |
| [0020](0020-run-target-defaults-to-local.md) | The run target defaults to Local, not Viya | Accepted |
| [0021](0021-result-panel-webview.md) | The result panel: a singleton CSP-locked `WebviewPanel`, a buffered message protocol, and a ported DOM layer | Accepted |
| [0022](0022-drop-viya-35-support.md) | Viya 3.5 support is dropped | Accepted |
| [0023](0023-release-publishing.md) | Releases publish from a tag, over OIDC, to the VS Marketplace and Open VSX | Accepted |

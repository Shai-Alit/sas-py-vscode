# ADR-0003 — Extension host target: Node-only for now

- **Status:** Accepted
- **Date:** 2026-08-12
- **Decides:** Open decision #4 in `PRODUCTION_PLAN.md` §6
- **Executed in:** slice 0b (bundler configuration and `package.json` `main`)

## Context

VS Code extensions can target the Node extension host (desktop), the web extension
host (`vscode.dev`, `github.dev`, Codespaces in a browser), or both. The web host
forbids Node built-ins entirely — no `fs`, `net`, `tls`, `child_process`, no
native modules — and a dual-target extension must therefore either avoid those
APIs or maintain two implementations behind a shared interface.

The argument for going dual from the start is real and worth stating properly.
An extension whose entire value is *remote* execution is unusually well suited to
a browser: there is no local runtime to install, which is the same argument the
project itself makes about not requiring local Python. Retrofitting web support is
also known to be painful, because Node APIs leak into a codebase gradually and
each one is cheap to add and expensive to remove.

Three things in the plan cut the other way. The OAuth2 flow uses a **loopback
redirect listener**, which needs a local socket the web host cannot provide and
must be replaced by a different redirect strategy in a browser. `CAHelper.ts`,
which we intend to port, uses `fs` and `tls` to handle self-signed certificates —
a scenario that barely exists in a browser context anyway. And the test harness
would need a second `@vscode/test-web` tier from slice 0c onward, doubling the
matrix through the exact phases where the design is least settled.

## Decision

**Target the Node extension host only, through v0.1.0.** Do not declare
`browser` in `package.json`.

Treat this as deferred, not refused. Revisit as a Phase 6+ item, once
authentication and the compute layer have stabilised and the real cost of a web
port can be measured rather than guessed.

Two cheap hedges apply meanwhile, and are review checkpoints rather than aspirations:
Node built-ins stay confined to the auth and certificate modules rather than being
used casually across the codebase, and HTTP goes through one client module rather
than scattered `fetch` calls, so a future web build has a single seam to swap.

## Alternatives considered

**Dual-target from slice 0b.** Genuinely attractive for a remote-execution
extension, and cheapest to do at the start. Rejected because it would force
web-compatible choices into Phase 1 authentication before we have confirmed how
the OAuth flow behaves against a real deployment at all — constraining a design
against a hypothetical second host while the first one is still unproven. It also
doubles the test matrix through Phases 1–5, which is where the plan already
carries the most risk.

**Web-only.** Not seriously considered. It would exclude desktop users, who are
the overwhelming majority, and forfeit the self-signed-certificate handling that
enterprise Viya deployments in practice need.

**Declare `browser` but ship a stub that reports "desktop only".** Rejected as
user-hostile: it appears in web marketplace searches and then fails, which is
worse than not appearing at all.

## Consequences

**Good.** One bundle, one test tier, one set of APIs through the phases where the
architecture is still moving. Free use of `fs`, `tls`, and the loopback listener,
which materially simplifies Phase 1.

**Costs.** No `vscode.dev` or browser-Codespaces support in v0.1.0 — a real
limitation for an extension that otherwise requires nothing local, and it must be
stated plainly in the README rather than left for users to discover. The longer we
wait, the more Node assumptions accumulate; the two hedges above reduce that but
do not eliminate it.

**Revisit trigger.** Reconsider when Phase 5 closes, or sooner if browser-based
Codespaces usage turns out to be a common request.

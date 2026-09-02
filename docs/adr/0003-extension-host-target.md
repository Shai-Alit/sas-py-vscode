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

> **Amended 2026-08-18.** The second hedge was both misstated — there is no
> certificate module — and unenforced, and it had already been broken. It is an
> ESLint rule with a three-file allow-list now. See the amendment at the end of
> this record; the sentence above is left as written because what it *failed* to
> constrain is the part worth remembering.

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

## Amendment — 2026-08-18 (Phase 2 review): the second hedge is a lint rule now

The Decision section called both hedges "review checkpoints rather than
aspirations". The Phase 2 review found that the second one — *Node built-ins stay
confined to the auth and certificate modules* — was neither. It was wrong in one
direction and unenforced in the other.

**Wrong:** there is no certificate module. `CAHelper.ts` was deliberately not
ported — `PRODUCTION_PLAN.md`'s 1c-ii entry says why — and system trust is
configured inside `src/auth/transport.ts` (ADR-0008), so one of the two homes
this ADR named has never existed in the tree.

**Unenforced:** by the close of Phase 2 the confinement had already been broken.
`src/profile/commands.ts` imports `randomUUID` from `node:crypto` to mint a
profile id — a reasonable line to write, which is the point. Nothing failed,
because nothing was checking. A checkpoint that no gate runs is the aspiration
this ADR said it was not.

**The hedge as it now stands.** `eslint.config.mjs` restricts `node:*` imports
across `src/**/*.ts` with an allow-list of exactly three files —
`src/auth/pkce.ts` (`node:crypto`), `src/auth/transport.ts` (`node:http`,
`node:https`) and `src/profile/commands.ts` (`node:crypto`). No globs, so a
fourth module is a visible diff to the config and an answerable question in
review. The first hedge — HTTP through one client module — is already structural:
`transport.ts` is that module, and it is on the list.

**What this deliberately does not do.** Two of the three uses have browser
equivalents: the global `crypto.randomUUID()` would remove `src/profile/commands.ts`
from the list outright, and `crypto.getRandomValues`/`crypto.subtle` would cover
most of `pkce.ts`. Neither change is made here. Swapping a working PKCE
implementation on the strength of a docs review is how security code acquires
defects, and the profile change is not worth a slice on its own. Both are
recorded as the cheapest first step whenever the revisit trigger in
**Consequences** fires.

The revisit trigger is unchanged, and this amendment does not reopen the
Node-only decision — it only makes the cost of reversing it measurable, which was
the hedge's whole purpose.

## Amendment — 2026-09-02 (slice 5d-i): the certificate module now exists

The 2026-08-18 amendment noted that one of the two homes this ADR named for Node
built-ins — a certificate module — "has never existed in the tree", because
`CAHelper.ts` was deliberately not ported.

Slice 5d-i ports the *scoped* version of that job (the long-deferred 1c-ii; see
[ADR-0008](0008-auth-core-transport-and-security-deltas.md)'s 2026-09-02
amendment). `src/auth/caAgent.ts` reads the paths in
`pythonOnViya.userProvidedCertificates` and builds one dedicated `https.Agent`
trusting them. It uses `node:fs`, `node:https` and `node:tls` — the same three
built-ins upstream's `CAHelper.ts` used — and is the **fourth** entry on
`eslint.config.mjs`'s allow-list. `src/extension.ts` reads the setting through
the `vscode` API and calls `buildCaAgent` with no file reader, so it stays free
of Node built-ins; the module owns the `node:fs` read behind an injectable
parameter its tests substitute.

This is the module the hedge always named. It does not widen the Node surface
beyond what this ADR anticipated — a browser build has no custom-CA-trust story
to port anyway (the web host forbids `tls` outright), so `caAgent.ts` is a file
a future web build omits rather than reimplements.

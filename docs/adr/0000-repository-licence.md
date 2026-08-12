# ADR-0000 — Repository licence: Apache-2.0

- **Status:** Accepted
- **Date:** 2026-08-11
- **Decides:** Open decision #0 in `PRODUCTION_PLAN.md` §6
- **Supersedes:** the initial MIT licence committed with the empty repository

## Context

The repository was created under the **MIT** licence. The implementation plan,
however, depends substantially on porting code from
[`sassoftware/vscode-sas-extension`](https://github.com/sassoftware/vscode-sas-extension),
which is licensed **Apache-2.0**. The connection profile model, the OAuth2/PKCE
flow, the Compute service REST client, and the session lifecycle are all
prior art we intend to reuse rather than reinvent — that reuse is the single
largest head start available to this project.

Apache-2.0 is permissive, so redistributing derived code is allowed. But it
attaches obligations that MIT does not carry, and a bare MIT licence on a bundle
containing Apache-2.0-derived code silently drops them:

- **§4(a)** — the licence must accompany the derived work.
- **§4(b)** — modified files must carry a prominent notice stating they changed.
- **§4(d)** — a `NOTICE` file, where one exists upstream, must be propagated.
- **§3** — an express patent grant from contributors, with a termination clause
  triggered by patent litigation.

MIT has no patent language at all. Shipping Apache-2.0-derived code under MIT
would also misrepresent to *our* users what rights they are receiving, which is
the more serious problem: they would reasonably read the MIT licence as the whole
story.

## Decision

**Relicense the repository to Apache License 2.0**, matching upstream.

Additionally:

1. Add a `NOTICE` file recording SAS Institute attribution, identifying which
   areas of the codebase are derived, and stating plainly that this is not an
   official SAS product.
2. Every ported file **preserves its original SAS copyright header and gains a
   modified-file notice** — preservation alone does not satisfy §4(b).
3. CI enforces both requirements via the copyright-header check introduced in
   slice 0b, so this cannot regress silently.

## Alternatives considered

**Stay MIT and dual-track the ported files.** Legally workable and reasonably
common: our original code stays MIT, ported files keep Apache-2.0 headers, and
`NOTICE` lists them. Rejected because it makes every contributor responsible for
knowing which licence governs which file before they edit it, and because the
boundary blurs the moment a file mixes ported and original logic — which is
exactly what happens when you adapt a REST client rather than copy it verbatim.
The ongoing cost is small but permanent, and it is paid by people who joined
later and weren't part of this decision.

**Stay MIT and port nothing.** Cleanest legally, and it preserves maximum
downstream flexibility. Rejected because it discards the head start the plan
depends on and adds substantial work to Phases 1 and 2 — reimplementing an
OAuth2/PKCE flow and a HATEOAS REST client from scratch, with no benefit to users,
purely to avoid a licence change that costs us nothing we value.

**Adopt a copyleft licence (MPL-2.0, LGPL).** Not seriously considered. It would
be incompatible with the goal of sitting alongside a commercial vendor's tooling
in enterprise environments, where legal review of copyleft dependencies is often
slow and sometimes simply a "no."

## Consequences

**Good.** No licence conflict anywhere in the bundle. Our users get an explicit
patent grant, which is worth having for software that interoperates with a
commercial vendor's product. Ported files need no special handling beyond the
header discipline we wanted regardless. Contribution terms match the upstream
project most contributors will already have read.

**Costs.** Apache-2.0 is longer and more legalistic than MIT, which very
occasionally deters casual contributors. The §4(b) modified-file notice is a real
ongoing obligation and is easy to forget — mitigated by the CI check, which is
why that check is not optional.

**Irreversible in practice.** Relicensing again later would require the consent of
every contributor by then. Doing it now, while the repository is empty, costs
nothing; doing it in six months would not.

# ADR-0001 — Extension identity and configuration namespace

- **Status:** Accepted
- **Date:** 2026-08-12
- **Decides:** Open decisions #1 and #2 in `PRODUCTION_PLAN.md` §6
- **Executed in:** slice 0b (`package.json`)

## Context

Two questions that look cosmetic but are expensive to reverse. The marketplace
identifier appears in install URLs, `extensionDependencies` in other people's
manifests, and every blog post that ever links to us. The configuration namespace
prefixes every setting key, and changing it later means shipping a migration that
reads the old keys, writes the new ones, and warns — code that then lives forever.

Both are constrained by the same fact: **this is not a SAS product.** It reuses
Apache-2.0 code from `sassoftware/vscode-sas-extension` and says so in `NOTICE`,
but it is an independent project with no SAS endorsement. A name that implies
otherwise misleads users about who supports it and who to complain to.

The namespace has a second constraint. It must not collide with the SAS
extension's `SAS.*`, because the two are explicitly designed to be installed side
by side (§ "Explicitly out of scope": we do not author SAS code; that is their
job). The plan used `SASPY.*` provisionally for exactly this reason.

That provisional choice turned out to be wrong for a reason we missed initially:
**`saspy` is the name of SAS's own official Python-to-SAS package.** A settings
prefix of `SASPY.*` would collide with a real, actively maintained SAS product in
search results and in users' heads — a worse confusion than the `SAS.*` overlap it
was picked to avoid, and one that also reintroduces the false-provenance problem.

## Decision

**Display name "Python on Viya"; identifier `python-on-viya`; configuration
namespace `pythonOnViya.*`.**

Settings therefore read `pythonOnViya.connectionProfiles`,
`pythonOnViya.defaultProfile`, and so on. The namespace matches the identifier,
which is the VS Code convention and means there is exactly one name to learn.

The name describes the function — running Python on Viya — rather than leading
with a vendor trademark. "Viya" is still a SAS trademark and appears descriptively;
`NOTICE` and the marketplace description both state plainly that this is not an
official SAS product.

## Alternatives considered

**"SAS Python" / `sas-python` / `sasPython.*`.** By far the most discoverable:
users searching the marketplace for "SAS" would find it next to the official
extension. Rejected because that discoverability is borrowed under false pretences.
Leading with the vendor's mark reads as first-party, which contradicts `NOTICE`
and would send support requests to SAS for software they did not write.

**"Viya Python" / `viya-python`.** A close call, and shorter to type. Rejected
narrowly: it sorts well but reads as "a Python distribution for Viya" rather than
"run your Python on Viya," and the latter is what the extension actually does. The
difference matters on a marketplace listing where the name is most of what a user
reads.

**Keep `SASPY.*` for settings while renaming the extension.** Rejected — it would
leave the `saspy` collision in place in the one location users type by hand, and
split the vocabulary between what you install and what you configure.

**A short prefix such as `pov.*` or `pyviya.*`.** Terser in `settings.json`.
Rejected because short prefixes are exactly the ones that collide with a future
unrelated extension, and terseness in a file people edit a few times a year is not
worth the risk.

## Consequences

**Good.** No trademark ambiguity and no `saspy` collision. One vocabulary across
identifier, namespace, and display name. Coexists cleanly with `SAS.*`.

**Costs.** Materially worse marketplace discoverability than a "SAS"-prefixed name
— users looking for this will mostly arrive via a link rather than a search. We
accept that; the README and description carry the SAS and Viya keywords, which
recovers some of it honestly. `pythonOnViya.` is also 13 characters of prefix on
every setting key, which is verbose in `settings.json`.

**Reversible only at a price.** The identifier cannot change after first publish
without abandoning install counts and ratings. The namespace can change, but only
behind a migration shim that would then be permanent.

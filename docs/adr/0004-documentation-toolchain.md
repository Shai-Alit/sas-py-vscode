# ADR-0004 — Documentation toolchain: VitePress, with external links swept rather than gated

- **Status:** Accepted
- **Date:** 2026-08-12
- **Decides:** how documentation is built, checked, and generated — the CI
  enforcement promised in `PRODUCTION_PLAN.md` §4.1
- **Executed in:** slice 0d-i-b (`docs` job, `link-check.yml`, `scripts/generate-reference.mjs`, `scripts/check-docs-samples.mjs`, `scripts/check-links.mjs`)

## Context

§4.1 committed to four documentation properties being enforced by CI: the site
builds without warnings, links resolve, the generated reference matches source,
and code samples that claim to run are type-checked. It did not say with what,
and each of those four turns out to pull in a different direction.

Three sub-decisions had to be made together, because the choice of site
generator changes what the other two cost.

**Link checking splits in half.** Internal links break because *this* repository
changed — a renamed page, a moved anchor — and the pull request that broke them
is sitting right there. External links break because somebody else's server,
domain, or CDN changed, on a timetable unrelated to any pull request. Treating
them as one problem means either gating on both (and failing merges for other
people's outages) or gating on neither.

**An API reference has nothing to document.** `src/` is a single activation file
with no exported surface. TypeDoc against it produces an empty page, and §4.1
also says the generated reference is committed and diff-checked — so that empty
page would sit under a gate, churning on every early change while documenting
nothing.

## Decision

**VitePress**, not Docusaurus, even though upstream `vscode-sas-extension` runs
Docusaurus. Two reasons. It is markdown-first, so `docs/` needed no
restructuring — the existing tree became the site. And **its build fails on dead
internal links natively**, so `ignoreDeadLinks` is deliberately left unset and
the internal-link gate is a property of a build we wanted anyway, rather than a
second tool taught the same rewrites and anchors that would then find ways to
disagree with the first.

**External links are swept weekly and never gate a pull request.**
`link-check.yml` runs Mondays, and files or comments on a single `link-rot`
issue. A broken external link becomes a thing a human triages, not a thing
standing between somebody and a merge.

**Links back into this repository are resolved against the working tree, not
fetched.** VitePress's `srcDir` is `docs/`, so a relative link that climbs above
it — to `PROBE-FINDINGS.md`, `CONTRIBUTING.md`, `test/fixtures/README.md` —
names a file the site can neither resolve nor publish, and those are written as
absolute `github.com/…/blob/main/…` URLs instead. `npm run docs:links:self`
strips the URL back to a repository-relative path and checks that the file
exists, so those links stay gated on every pull request, offline, without a
third category of tool.

That is the *correct* check, not merely a convenient one. **GitHub answers 404,
not 403, for a private repository**, so while this repository is private an
anonymous fetch reports every self-link as broken — the first live run of the
weekly sweep reported five broken links and all five were fine. A network check
of a self-link is not weak here; it is wrong. GitHub *feature* URLs under the
same repository (`/commits/main`, `/security/advisories/new`) have no file
behind them and are skipped.

**TypeDoc is deferred** until a module exports an API worth documenting —
realistically the `ExecutionBackend` seam in Phase 3. Until then, no document
may imply an API reference exists; several did, and were corrected in this
slice.

**The generated settings and command reference is committed**, not git-ignored.
Settled in 0d-i-a and executed here, recorded in this ADR so the documentation
decisions have one home: a pull request that renames a command then shows the
reviewer that rename, instead of hiding it behind a build step nobody runs
during review, and the tables stay readable on GitHub without building the site.

## Alternatives considered

**Docusaurus, matching upstream.** The strongest argument here is boring
familiarity: a contributor who has worked on the SAS extension already knows it,
and matching upstream is the default this project takes elsewhere. Rejected
because the docs are plain markdown with no React, no versioned docs, and no
i18n — none of what Docusaurus is good at — and its dead-link handling would
have to be configured rather than inherited. Matching upstream is a tiebreaker,
not a reason on its own.

**A dedicated link checker (lychee, markdown-link-check) covering both kinds.**
Rejected because it duplicates the internal-link knowledge the site build
already has, and because the two failure modes want different responses. One
tool producing one verdict forces the same response on both.

**Gating pull requests on external links.** Rejected for a specific dynamic
rather than general dislike of flakiness: a contributor whose merge is blocked
by an unrelated vendor outage learns to re-run the job without reading it, and
then does not read it on the day it is right. The check that cries wolf is
worse than no check, because it also consumes the attention a real one would
have had.

**Generating the API reference now and letting it be empty.** Rejected as a
gate over a vacuum — it would fail builds for churn in a document nobody reads.

**Leaving the outside-`docs/` links to the weekly sweep.** This is what the
first draft did, and it was the reviewable-looking option: they are `https://`
URLs, the sweep checks `https://` URLs. Rejected once the sweep ran, for two
reasons that arrived together — it reports them as broken while the repository
is private, and even against a public repository it would catch a rename days
after the pull request that made it, rather than in it.

**Symlinking those files into `docs/`, or adding them to `ignoreDeadLinks`.**
Rejected respectively because a symlink makes two apparent copies of one
document and Windows checkouts handle symlinks poorly, and because an
`ignoreDeadLinks` pattern blunts the gate for every link in order to fix three.

## Consequences

**Good.** One tool builds the site and enforces internal links. Contributors
write plain markdown. Every link a pull request can break — internal, or
absolute back into this repository — fails that pull request, and none of them
needs the network to say so. External rot is still *found*, on a schedule, with
the report shaped for a human. The settings and command tables cannot drift from
`package.json` without CI noticing.

**Costs.** Three links that point outside `docs/` had to become absolute GitHub
URLs, so they read as external in the source even though they are checked as
local files — a reader who does not know about `docs:links:self` will assume
they are only swept weekly. `scripts/check-links.mjs` therefore carries two
modes, and the repository slug it derives from `package.json` is a piece of
configuration that can silently go missing (an undefined slug means no
self-links, checked by a unit test, rather than every GitHub link). External rot
goes unnoticed for up to a week by construction, which is the trade being made.
VitePress is a second build toolchain (Vite) alongside esbuild; both are
devDependencies and neither ships.

**Revisit trigger.** Reconsider the site generator if versioned documentation or
translation becomes a requirement, which is where Docusaurus earns its weight.
If the repository is ever made public, the self-link check stays — the 404 was
the trigger, but resolving on disk is the better check regardless. Add TypeDoc
in the slice that first exports a public API.

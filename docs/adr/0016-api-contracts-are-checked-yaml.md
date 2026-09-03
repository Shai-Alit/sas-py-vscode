# ADR-0016 — API contracts are hand-written YAML, not shipped, and checked against the code in both directions

- **Status:** Accepted
- **Date:** 2026-08-17
- **Decides:** what a contract file is, what format it is written in, and what the
  build is entitled to fail on because of it
- **Constrained by:** ADR-0010 (the Compute client is hand-written and navigates
  by link relation), ADR-0015 (a dialect owns the name of its contract file),
  ADR-0005 (supply-chain policy — every new dependency is a decision)
- **Executed in:** slice `2b-ii`
- **Amended by [ADR-0022](0022-drop-viya-35-support.md), 2026-09-03:** this
  record's Context and Decision describe a world with two contracts,
  `viya4.yaml` and `viya35.yaml`. ADR-0022 drops Viya 3.5, so `viya35.yaml` no
  longer exists and only `viya4.yaml` does today — the mechanism this ADR
  decided (hand-written YAML, checked both ways) is unaffected and still
  governs whatever contracts exist.

## Context

ADR-0010 rejected a generated client, and the reason it could be rejected without
much regret is that the service hands us its URLs. What that decision does *not*
give us is a written record of the REST footprint this extension actually depends
on. A generated client is a bad client and an excellent inventory; hand-writing
the client keeps the first problem away and takes the second one on.

The inventory matters here more than it would elsewhere, because this project
supports two generations of a product and has only ever run against one of them.
"Viya 3.5 does not have this endpoint" is a claim the code makes — stage-1 probing
turns the absence of `/deploymentData/cadenceVersion` into a version verdict — and
until this slice, the only place that claim was written down was a branch. A
branch is a bad place to keep a claim about somebody else's server: it cannot say
when it was measured, or against what, or by whom, and nothing notices when it
stops being true.

So the question is not whether to write the footprint down. It is what to write it
down *in*, and what the build is allowed to do about it.

## Decision

**A contract is one YAML file per generation under `contracts/`, and it is
documentation that fails the build when it stops being true.**

`contracts/viya4.yaml` and `contracts/viya35.yaml` exist today.
`scripts/check-contracts.mjs` is a step in `npm run verify`, before `build`.

### The format is YAML, and the parser is a devDependency

`js-yaml` is added to `devDependencies` and to nothing else. The extension has
zero runtime dependencies and this does not change that: nothing under `src/`
imports the parser, no contract is read at run time, and `contracts/**` is named
in `.vscodeignore` so the directory does not reach a user's extension folder.

The format choice is entirely about **comments**. Better than half of each
contract file is prose — which probe found this, which media type is required and
why, which field is deliberately *not* read. Look at the `cadence_version` entry:
the note saying `cadenceRelease` is a build stamp and must not be ordered is the
most useful line in the file, and it is the line JSON cannot hold. A format whose
comments have to live in a sibling document is a format whose comments go stale
separately from the thing they annotate.

Weigh that against ADR-0005, which treats every dependency as a decision rather
than a convenience. The answer is that a dev-tree parser used by one gate script
is close to the cheapest form a dependency takes here: it is not in the production
audit tree, it is not in the VSIX, it has no install script, and if it ever became
a liability the contracts could be re-expressed as JSON with the prose moved into
a `note` field, badly, in an afternoon.

### Three agreements, asserted in both directions

The script checks that a contract, the dialect layer and the fixtures still agree:

1. **Contract ↔ dialect.** Every contract's `generation` is a `DialectId`, **and**
   every `DialectId` has a contract.
2. **Contract ↔ code.** Every contract's `dialect` names a factory function
   actually exported from `src/dialects/`.
3. **Contract ↔ fixtures.** Every contract's `fixtures` names a real directory
   under `test/fixtures/`.

The second half of rule 1 is the one that earns the phrase "both directions". A
one-way check catches a contract that names a generation nobody supports, which is
a mistake somebody makes while deleting things. It does not catch the mistake
people actually make: adding a generation to the union and never writing its
contract. That failure is invisible by construction — the evidence for it is a
file that was never created — so the check has to go looking for the absence.

The same reasoning shapes the `absent` list. A generation records what it *lacks*
by id, and every such id must appear as an endpoint in some other contract.
Without that rule the list decays into notes about endpoints that no longer exist
anywhere, which read as authoritative and are not.

### `generation` must be canonical, though the code accepts aliases

`resolveDialectId()` takes `Viya 4`, `v3.5` and a bare cadence release, because
the strings it is handed come from settings people type and from answers servers
choose. A contract file is neither. It is written by a maintainer, in this
repository, under review — so the checker requires the exact `DialectId`, which is
strictly stronger than requiring it to resolve, and keeps one spelling in the one
place a reader goes looking for the canonical one.

### Every endpoint declares `path` **or** `via`, never both

ADR-0010 makes the deployment origin the only base and navigates by link relation.
An endpoint composed against the origin declares a `path`; one followed from a
relation declares a `via` naming the relation, the endpoint it is read from, and
the media type that disambiguates it. Declaring both is refused, because "both" is
how a link-navigated endpoint acquires a hard-coded path that somebody uses later.
The observed target is recorded as `observed_href`, which is named for the reader
rather than for the client.

Declaring neither is refused too — it is the same mistake with the evidence
missing.

### The union is parsed out of the source, not imported

`DialectId` is a TypeScript type and a type does not survive to run time.
Importing it would make this check depend on a build, and it deliberately runs
*before* `build` in the verify chain, because a check that needs its subject to
compile first cannot report the interesting failures. So the union is read out of
`src/dialects/dialect.ts` with TypeScript's own parser, exactly as
`check-coverage-scope.mjs` reads imports, and for the same reason: this
repository's doc comments discuss the types they sit above, and a regular
expression reads the prose as a declaration.

### Unknown keys are an error

A mistyped `fixture` for `fixtures` would leave the fixtures rule with nothing to
check and the file still passing. Every silent-failure mode of a
configuration-shaped document comes back to a key nobody validated, so the key
sets are closed and adding a field is a change to the checker as well as to the
file.

## Alternatives considered

**A TypeScript module — `contracts/viya4.ts` exporting a typed object.** The
obvious answer, and it is genuinely better on two counts: the compiler checks the
shape for free, so most of `check-contracts.mjs` would not exist, and there is no
new dependency at all. Rejected because it puts the inventory inside the thing
being inventoried. A contract is a record of what somebody else's server does; the
moment it is importable from `src/`, someone imports it, and then the version
branch the dialect layer exists to contain has a data file to read from. The
directory being unimportable — a different language, outside the tsconfig, ignored
by the bundler — is a structural guarantee that no lint rule can give.

The second objection is subtler and turned out to matter more while writing the
files: a typed object cannot carry a comment where the comment belongs. TSDoc
attaches to declarations, and half these notes attach to a *value* — to
`application/json` rather than to `accept`.

**JSON.** No new dependency, and `JSON.parse` is in the runtime. Rejected on
comments alone. The `_comment` key convention exists precisely because this
problem is unsolved, and a document whose annotations are load-bearing should not
be written in a format that has to smuggle them.

**JSON Schema, or an OpenAPI document.** Both are real formats for this real
problem, and either would let a general-purpose validator do the work.
Rejected as premature by some distance: OpenAPI describes an API you own or intend
to call exhaustively, and this file describes the eleven-line subset of Viya this
extension touches, annotated with why. Adopting OpenAPI would mean either
describing far more surface than we use or shipping a knowingly partial document
that tooling would read as complete. Revisit if the footprint ever grows past what
one person can hold in mind.

**Recorded fixtures and nothing else.** `test/fixtures/` already holds real
payloads, and a fixture is stronger evidence than a sentence — it is the wire
shape rather than a description of it. Rejected because a fixture cannot express
an absence, and this slice's central claim *is* an absence. There is no payload
that means "Viya 3.5 has no cadence endpoint". The two are complements, which is
why rule 3 ties each contract to a fixture directory rather than replacing one
with the other.

**No contracts at all — let the probe and its tests be the record.** Cheapest, and
defensible while the footprint is two endpoints. Rejected for what happens at
slice 3a, when the footprint grows filerefs, jobs, log pages and session
variables, and the only inventory is a set of test names. The point of writing it
down now is that the habit has to exist before the surface does.

## Consequences

`npm run verify` gains a step, and `docs/dev/ci.md` gains a paragraph. The step is
fast — two file reads and a parse — and it sits before `build` deliberately.

**A new dependency in the dev tree**, which the supply-chain gate will now audit
and which `allowScripts` must account for. `js-yaml` has no install script, so it
takes no entry, and the unit tier's deny-list check enforces that going forward.

**A new top-level directory**, which is exactly the shape of the two gaps the
RUNBOOK warned this slice would inherit. Both are closed here: `contracts/` joins
the SCAN list in `scripts/check-copyright.mjs`, whose header extractor now
understands `#` comments as well as `//`, and `contracts/**` is named in
`.vscodeignore`, which is allow-by-default and would otherwise have shipped the
directory inside the VSIX.

**A contract must be updated in the same pull request as the code and the fixtures
it describes.** That is a process obligation this record deliberately creates, and
it is the whole point: a document updated afterwards is a document nobody was
checking. The mechanism is the gate, and the gate only covers structure — nothing
here can tell that a `response_fields` list has quietly stopped matching what the
service returns. Fixtures and probes are what cover that, and the honest statement
of this ADR's limit is that it makes the inventory *present and consistent*, not
*true*.

**`viya35.yaml` is almost entirely empty, and says so at length.** That is not a
placeholder to be filled in later out of the vendor documentation. Nothing in this
project has ever been run against a Viya 3.5 deployment, and a contract populated
from a manual would read exactly like one populated from a probe. Endpoints arrive
there when something has talked to a 3.5, and not before.

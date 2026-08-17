# API contracts

`contracts/` holds one file per Viya generation recording the REST footprint this
extension depends on. It is documentation, and `npm run check:contracts` is what
stops it from becoming documentation that used to be true.

The reasoning behind the format, and the alternatives that lost, are
[ADR-0016](../adr/0016-api-contracts-are-checked-yaml.md). This page is about what
is in the files and how to change one.

## Why an inventory exists at all

[ADR-0010](../adr/0010-compute-client-is-hand-written.md) rejected a generated
client. That was the right call for the client and it left a gap: a generated
client is a poor client and an excellent inventory, and hand-writing one keeps the
first problem away while taking the second one on.

The gap matters more here than it would elsewhere, because this project supports
two generations of a product and has only ever been run against one. "Viya 3.5
does not have this endpoint" is a claim the code makes — the whole of stage-1
probing is that claim — and a claim about somebody else's server needs somewhere
to say when it was measured and against what. A branch cannot say either.

## What a file looks like

Two files exist:
[`contracts/viya4.yaml`](https://github.com/Shai-Alit/sas-py-vscode/blob/main/contracts/viya4.yaml)
and
[`contracts/viya35.yaml`](https://github.com/Shai-Alit/sas-py-vscode/blob/main/contracts/viya35.yaml).
Each opens with four keys that tie it to the rest of the repository:

```yaml
generation: viya4                # a DialectId, spelled canonically
dialect: createViya4Dialect      # a factory exported from src/dialects/
fixtures: viya4                  # a directory under test/fixtures/
reference: https://developer.sas.com/rest-apis
```

Then a list of endpoints, each of which says **how it is reached** — and this is
the part with a rule attached:

```yaml
endpoints:
  - id: deployment_data_root
    method: GET
    path: /deploymentData
    accept: application/vnd.sas.api+json
    response_fields: [links]
    item_fields: [rel, href, type]

  - id: cadence_version
    method: GET
    via:
      from: deployment_data_root
      relation: cadenceVersion
      type: application/vnd.sas.deployment.data.cadence.version
    observed_href: /deploymentData/cadenceVersion
    accept: application/json
    response_fields: [cadenceVersion, cadenceDisplayName]
```

`path` means composed against the deployment origin — a URL we build, and
therefore a URL that breaks when the service moves. `via` means followed from a
link relation in a response we already fetch, which is how the service expects to
be navigated and cannot break on a path change. Declaring **both is refused**,
because "both" is how a link-navigated endpoint acquires a hard-coded path that
someone reaches for later; the observed target goes in `observed_href`, which is
named for the reader rather than for the client. Declaring neither is the same
mistake with the evidence missing.

`method` is not redundant with the link document. Probe finding 44 records that
`method` is `null` on every link under `/deploymentData`, so the verb has to come
from somewhere, and this is that somewhere. `type` on a `via` is not decoration
either: the same finding records that `cadenceVersion` appears **twice** in that
document, distinguished only by media type, so a `rel`-only lookup gets whichever
came first and works today by luck.

## Writing an absence down

`viya35.yaml` has no endpoints and an `absent` list instead:

```yaml
endpoints: []

absent:
  - id: cadence_version
    reason: >
      `/deploymentData` is a Viya 4 service. Viya 3.5 has no cadence versioning
      at all — releases are named, not dated.
    detected_as: absent-link-relation-or-viya-404
```

This is the file's whole content, and the emptiness is the point. Stage-1 probing
identifies a deployment as 3.5 by *not* finding something, so the thing that is
not found has to be written down — otherwise the only record of what 3.5 lacks is
a branch, which is what `src/dialects/` exists to prevent.

An absence is only a signal relative to a presence, so every id under `absent`
must appear as an endpoint in some **other** contract, and the checker enforces
it. Without that rule the list decays into notes about endpoints that no longer
exist anywhere, which read as authoritative and are not.

Nothing in `viya35.yaml` has been observed. This project has never had a Viya 3.5
deployment to run against. Endpoints arrive there when something has talked to a
3.5, not when a manual describes one — a contract populated from documentation
reads exactly like one populated from a probe, and the difference is the only
thing these files are for.

## What the check actually asserts

`scripts/check-contracts.mjs` runs in `npm run verify`, before `build`. It
asserts three agreements, **in both directions**:

| | forward | reverse |
|---|---|---|
| **dialect** | every `generation` is a `DialectId` | every `DialectId` has a contract |
| **code** | every `dialect` names an exported factory | — |
| **fixtures** | every `fixtures` names a real directory | — |

The reverse half of the first row is the one that earns the phrase. A one-way
check catches a contract naming a generation nobody supports, which is a mistake
people make while deleting things. It does not catch the mistake people actually
make: adding a generation to the union and never writing its contract. That
failure is invisible by construction — its evidence is a file nobody created — so
the check has to go looking for the absence.

Two more rules are worth knowing before a failure surprises you.

**`generation` must be canonical.** `resolveDialectId()` accepts `Viya 4`, `v3.5`
and a bare cadence release, because the strings it is handed come from settings
people type and answers servers choose. A contract file is neither — it is written
here, under review — so the exact `DialectId` is required. The file name must
match it too.

**Unknown keys are an error, not something ignored.** A mistyped `fixture` for
`fixtures` would leave the fixtures rule with nothing to check and the file still
green. The key sets are closed, so adding a field means changing the checker as
well as the file, which is the intended amount of friction.

The union of generations is read out of `src/dialects/dialect.ts` with
TypeScript's own parser rather than imported, because the check runs *before*
`build` on purpose: a check that needs its subject to compile first cannot report
the interesting failures. A regular expression was not an option — this
repository's doc comments discuss the types they sit above, and a text match reads
the prose as a declaration.

## Changing one

Change the contract in the **same pull request** as the code and the fixtures. A
contract updated afterwards is a contract nobody was checking, and the gate cannot
help with that part — it checks structure, not truth. Nothing in
`check-contracts.mjs` can tell that a `response_fields` list has quietly stopped
matching what the service returns; fixtures and probes cover that, and this gate
covers whether the inventory is present and internally consistent.

Two properties of the directory are deliberate and easy to undo by accident:

- **`contracts/` is not shipped.** It is named in `.vscodeignore`, which is
  allow-by-default. Nothing under `src/` imports the parser and no contract is
  read at run time.
- **The parser is a devDependency.** That is what buys the comments, which are
  better than half of each file and the reason the format is YAML rather than
  JSON or a TypeScript module.

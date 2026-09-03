// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Keeps `contracts/` honest.
 *
 * A contract file records the REST footprint one Viya generation offers us. That
 * is documentation, and documentation rots — so this script makes each claim in
 * it something the build can fail on. Three things have to agree, and the
 * agreement is asserted in **both** directions so neither side can drift away
 * from the other quietly:
 *
 *   1. **Contract ↔ dialect.** Every contract's `generation` is a `DialectId`,
 *      and every `DialectId` has exactly one contract. Without the second half,
 *      a generation added to the union gets no contract and nobody notices until
 *      someone goes looking for the file that was never written.
 *   2. **Contract ↔ code.** Every contract's `dialect` names a function actually
 *      exported from `src/dialects/`. A renamed factory otherwise leaves a
 *      contract pointing at nothing, which reads as authoritative and is not.
 *   3. **Contract ↔ fixtures.** Every contract's `fixtures` names a directory
 *      under `test/fixtures/` that holds something — recorded payloads, or at
 *      least a README. An empty directory (dotfiles like `.gitkeep` do not
 *      count) satisfies "names a directory" while recording nothing, and gets
 *      its own message, distinct from a directory that is not there at all.
 *      The reverse half catches one shape of leftover: a `test/fixtures/<id>/`
 *      whose name is a `DialectId` while that generation's contract points its
 *      `fixtures` at a *different* directory — payloads stranded on disk,
 *      checked by nothing. A leftover renamed away from a generation's name
 *      keeps no toehold and is not caught.
 *
 * ## Why `generation` must be canonical rather than merely resolvable
 *
 * `resolveDialectId` in `src/dialects/resolve.ts` accepts aliases — `Viya 4`,
 * `v3.5`, a bare cadence release — because the strings it is given come from
 * profile settings people type and from probe answers the server chooses. A
 * contract file is neither: it is written by a maintainer, in this repository,
 * with review. So this check requires the **exact** `DialectId`, which is
 * strictly stronger than requiring it to resolve (every id resolves to itself)
 * and keeps one spelling in the one place a reader will go looking for the
 * canonical one.
 *
 * ## Why the union is parsed rather than imported
 *
 * The single source of truth for `DialectId` is a TypeScript type, and a type
 * does not survive to run time. Importing it would mean depending on a build
 * step, and this check runs before `build` in `npm run verify` — deliberately,
 * because a check that needs the thing it is checking to compile first cannot
 * report the interesting failures. So the union is read out of the source with
 * TypeScript's own parser, the same way `check-coverage-scope.mjs` reads
 * imports, and for the same reason: a regular expression over the text finds the
 * doc comments that discuss the type.
 *
 * ## The `path` / `via` rule
 *
 * ADR-0010 makes the deployment origin the only base and navigates by link
 * relation. An endpoint here therefore declares either a `path` composed against
 * that origin, or a `via` naming the relation it is followed from — and never
 * both, because "both" is how a link-navigated endpoint acquires a hard-coded
 * path that someone later uses. Declaring neither is the same mistake with the
 * evidence missing.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// js-yaml 5 is ESM with named exports and **no default export**, so a default
// import fails at load time with "does not provide an export named 'default'".
// The namespace form works on both 4.x and 5.x; do not "tidy" it back.
import * as yaml from "js-yaml";
import ts from "typescript";

const CONTRACT_DIR = "contracts";
const DIALECT_DIR = "src/dialects";
const FIXTURE_DIR = "test/fixtures";

/** The file the `DialectId` union is declared in, and the name to look for. */
const DIALECT_ID_SOURCE = `${DIALECT_DIR}/dialect.ts`;
const DIALECT_ID_TYPE = "DialectId";

/**
 * Top-level keys a contract may carry. Unknown keys are an error rather than
 * being ignored, because the failure they cause is silent: a mistyped `fixture`
 * would leave the real `fixtures` check with nothing to run against and the file
 * still passing.
 */
const CONTRACT_KEYS = new Set([
  "generation",
  "dialect",
  "fixtures",
  "reference",
  "endpoints",
  "absent",
]);

const ENDPOINT_KEYS = new Set([
  "id",
  "method",
  "path",
  "via",
  "observed_href",
  "accept",
  "response_fields",
  "item_fields",
]);

const VIA_KEYS = new Set(["from", "relation", "type"]);
const ABSENT_KEYS = new Set(["id", "reason", "detected_as"]);

/**
 * Reads the members of a string-literal union type out of TypeScript source.
 *
 * Returns `undefined` when the type is not found at all, which is a different
 * failure from finding it empty and is reported differently.
 */
export function unionMembers(source, typeName, fileName = "input.ts") {
  const parsed = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.ES2022,
    /* setParentNodes */ false,
    ts.ScriptKind.TS,
  );

  const literalText = (node) =>
    ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)
      ? node.literal.text
      : undefined;

  for (const statement of parsed.statements) {
    if (
      !ts.isTypeAliasDeclaration(statement) ||
      statement.name.text !== typeName
    ) {
      continue;
    }
    const type = statement.type;
    const nodes = ts.isUnionTypeNode(type) ? type.types : [type];
    const members = nodes.map(literalText);
    // A non-literal member means the union has grown something this reader
    // cannot enumerate, and silently dropping it would under-report direction 1.
    return members.includes(undefined) ? [] : members;
  }

  return undefined;
}

/** The names a module exports as functions. */
export function exportedFunctions(source, fileName = "input.ts") {
  const parsed = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.ES2022,
    /* setParentNodes */ false,
    ts.ScriptKind.TS,
  );

  const isExported = (node) =>
    ts
      .getModifiers(node)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
    false;

  const names = [];
  for (const statement of parsed.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name !== undefined &&
      isExported(statement)
    ) {
      names.push(statement.name.text);
    }
  }
  return names;
}

function unknownKeys(object, allowed) {
  return Object.keys(object).filter((key) => !allowed.has(key));
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Checks one already-parsed contract in isolation.
 *
 * Cross-file rules — the union covering every contract, an `absent` id being
 * present somewhere — need the whole set and live in {@link check}.
 */
function checkOne({
  name,
  contract,
  dialectIds,
  factories,
  fixtureDirs,
  emptyFixtureDirs,
}) {
  const problems = [];
  const say = (message) => problems.push(`${name}\n    ${message}`);

  if (!isPlainObject(contract)) {
    say(
      "is not a YAML mapping. A contract is a document of keys; an empty file or a bare list is not one.",
    );
    return problems;
  }

  for (const key of unknownKeys(contract, CONTRACT_KEYS)) {
    say(
      `has an unknown top-level key "${key}". Contract keys are ${[...CONTRACT_KEYS].join(", ")}. Unknown keys are refused rather than ignored, because a mistyped one leaves the check it was meant to feed with nothing to do and the file still passing.`,
    );
  }

  const stem = name
    .replace(/\.ya?ml$/, "")
    .split("/")
    .pop();

  if (typeof contract.generation !== "string") {
    say(
      'has no "generation". It names which Viya generation this file speaks for.',
    );
  } else if (!dialectIds.includes(contract.generation)) {
    say(
      `has generation "${contract.generation}", which is not a ${DIALECT_ID_TYPE}. The union in ${DIALECT_ID_SOURCE} allows ${dialectIds.map((id) => `"${id}"`).join(" | ")}. Aliases are accepted from profiles and probes, not from a file written by hand here — use the canonical id.`,
    );
  } else if (contract.generation !== stem) {
    say(
      `declares generation "${contract.generation}" but is named "${stem}". The dialect layer resolves a contract by its id, so the file name is not decoration — rename one to match the other.`,
    );
  }

  if (typeof contract.dialect !== "string") {
    say(
      'has no "dialect". It names the factory function that builds this dialect.',
    );
  } else if (!factories.includes(contract.dialect)) {
    say(
      `names dialect factory "${contract.dialect}", which no module under ${DIALECT_DIR}/ exports. Either the factory was renamed and this file was not, or the contract is for a dialect that has not been written yet.`,
    );
  }

  if (typeof contract.fixtures !== "string") {
    say(
      'has no "fixtures". It names the directory the recorded wire shape lives in.',
    );
  } else if (emptyFixtureDirs.includes(contract.fixtures)) {
    say(
      `names fixture directory "${contract.fixtures}", which exists under ${FIXTURE_DIR}/ but has nothing in it. The recorded wire shape is what a contract is checked against, and there is none here — add this generation's payloads, or a README recording that there is nothing there yet.`,
    );
  } else if (!fixtureDirs.includes(contract.fixtures)) {
    say(
      `names fixture directory "${contract.fixtures}", which does not exist under ${FIXTURE_DIR}/. Create it — a README recording that there is nothing in it yet is a real answer — or point at the one that holds this generation's payloads.`,
    );
  }

  if (typeof contract.reference !== "string" || contract.reference === "") {
    say(
      'has no "reference". Record the vendor documentation this footprint was read against, so the next person can check a claim without guessing which manual it came from.',
    );
  }

  const endpoints = contract.endpoints ?? [];
  if (!Array.isArray(endpoints)) {
    say(
      '"endpoints" is not a list. Use `endpoints: []` for a generation that has none yet.',
    );
    return problems;
  }

  const seen = new Set();
  const ids = new Set(
    endpoints.filter(isPlainObject).map((endpoint) => endpoint.id),
  );

  for (const [index, endpoint] of endpoints.entries()) {
    const where = `endpoint ${String(index)}`;
    if (!isPlainObject(endpoint)) {
      say(`${where} is not a mapping.`);
      continue;
    }
    const at =
      typeof endpoint.id === "string" ? `endpoint "${endpoint.id}"` : where;

    for (const key of unknownKeys(endpoint, ENDPOINT_KEYS)) {
      say(`${at} has an unknown key "${key}".`);
    }

    if (typeof endpoint.id !== "string" || endpoint.id === "") {
      say(
        `${where} has no "id". Ids are how another contract records that this endpoint is absent from it.`,
      );
    } else if (seen.has(endpoint.id)) {
      say(`${at} is declared twice. An id names one endpoint.`);
    } else {
      seen.add(endpoint.id);
    }

    if (typeof endpoint.method !== "string") {
      say(
        `${at} has no "method". The link documents carry a null method (finding 44), so the verb has to come from here.`,
      );
    }
    // `accept` is the header the client actually sends, and on some endpoints it
    // sends none. `acceptFor` in `src/compute/client.ts` uses the link's
    // `responseType` when there is one and falls back to `type` **only on a
    // GET** — because on a POST or PUT `type` describes the body going out — so a
    // `PUT` or `DELETE` link carrying neither goes out with no `Accept` at all.
    // A media type written here for one of those is a claim about the wire that
    // the wire does not make.
    //
    // Same two-part shape as `via.type` below, for the same reason: `null` is the
    // claim "nothing is sent", a missing key is silence, and only the claim
    // passes.
    if (!Object.hasOwn(endpoint, "accept")) {
      say(
        `${at} has no "accept". Viya is media-type driven and the envelope changes with the header, so the header is part of the contract — and where the client sends no \`Accept\` at all (a PUT or DELETE whose link carries no "responseType") write it as \`accept: null\` rather than leaving the line out.`,
      );
    } else if (
      endpoint.accept !== null &&
      typeof endpoint.accept !== "string"
    ) {
      say(`${at} has an "accept" that is neither a media type nor null.`);
    }

    const hasPath = endpoint.path !== undefined;
    const hasVia = endpoint.via !== undefined;

    if (hasPath && hasVia) {
      say(
        `${at} declares both "path" and "via". ADR-0010 navigates by link relation and composes only against the deployment origin; an endpoint that carries both acquires a hard-coded path for someone to use later. Keep the "via" and move the observed path to "observed_href".`,
      );
    } else if (!hasPath && !hasVia) {
      say(
        `${at} declares neither "path" nor "via", so nothing here says how it is reached. Composed against the origin is "path"; followed from a relation is "via".`,
      );
    }

    if (
      hasPath &&
      (typeof endpoint.path !== "string" || !endpoint.path.startsWith("/"))
    ) {
      say(
        `${at} has a "path" that is not root-relative. Paths are resolved against the deployment origin and nothing else.`,
      );
    }

    if (hasVia) {
      if (!isPlainObject(endpoint.via)) {
        say(`${at} has a "via" that is not a mapping of from/relation/type.`);
      } else {
        for (const key of unknownKeys(endpoint.via, VIA_KEYS)) {
          say(`${at} has an unknown "via" key "${key}".`);
        }
        for (const key of ["from", "relation"]) {
          if (typeof endpoint.via[key] !== "string") {
            say(`${at} has a "via" with no "${key}".`);
          }
        }
        // `type` is the one `via` key that may legitimately have no value, and
        // the two halves of this check are doing different jobs.
        //
        // Some relations involve no representation at all: a `DELETE`, or a
        // `PUT` whose entire payload is in its query string. Viya says so in two
        // different ways — a session's `cancel` and `delete` links **omit** the
        // key, while a job's set it to **`null`** (findings 21 and 46) — so a
        // checker demanding a string here cannot describe those endpoints, and
        // for a while nothing noticed because no contract had needed to name one.
        //
        // But the key still has to be *written*, because an author who forgot a
        // media type and an endpoint that genuinely has none are indistinguishable
        // once the line is missing — and forgetting is by far the likelier of the
        // two. `type: null` is a claim; no `type:` line is a silence. Only the
        // claim passes.
        if (!Object.hasOwn(endpoint.via, "type")) {
          say(
            `${at} has a "via" with no "type" key. Viya is media-type driven, so the type is part of the contract — and where a relation genuinely involves no representation (a DELETE, or a PUT carrying its payload in the query) write it as \`type: null\` rather than leaving the line out. An omitted key reads the same as an author who forgot one.`,
          );
        } else if (
          endpoint.via.type !== null &&
          typeof endpoint.via.type !== "string"
        ) {
          say(
            `${at} has a "via" whose "type" is neither a media type nor null.`,
          );
        }
        if (
          typeof endpoint.via.from === "string" &&
          !ids.has(endpoint.via.from)
        ) {
          say(
            `${at} is followed from "${endpoint.via.from}", which is not an endpoint in this contract. A relation has to be read out of a response we already declared we fetch.`,
          );
        }
      }
    }

    if (
      endpoint.response_fields !== undefined &&
      !Array.isArray(endpoint.response_fields)
    ) {
      say(`${at} has a "response_fields" that is not a list.`);
    }
    if (
      endpoint.item_fields !== undefined &&
      !Array.isArray(endpoint.item_fields)
    ) {
      say(`${at} has an "item_fields" that is not a list.`);
    }
  }

  const absent = contract.absent ?? [];
  if (!Array.isArray(absent)) {
    say('"absent" is not a list.');
    return problems;
  }
  for (const [index, entry] of absent.entries()) {
    if (!isPlainObject(entry)) {
      say(`absent ${String(index)} is not a mapping.`);
      continue;
    }
    for (const key of unknownKeys(entry, ABSENT_KEYS)) {
      say(`absent "${String(entry.id)}" has an unknown key "${key}".`);
    }
    if (typeof entry.id !== "string" || entry.id === "") {
      say(`absent ${String(index)} has no "id".`);
    }
    if (typeof entry.reason !== "string" || entry.reason === "") {
      say(
        `absent "${String(entry.id)}" has no "reason". An absence with no explanation is indistinguishable from an endpoint nobody got round to adding.`,
      );
    }
  }

  return problems;
}

/**
 * The whole rule, over an already-read set of contracts.
 *
 * Pure, so the unit tier can state the interesting failures as cases rather than
 * arranging them on disk.
 */
export function check({
  contracts,
  dialectIds,
  factories,
  fixtureDirs,
  emptyFixtureDirs = [],
}) {
  const problems = [];

  if (dialectIds === undefined) {
    problems.push(
      `${DIALECT_ID_SOURCE}\n    declares no ${DIALECT_ID_TYPE}. This check reads the union out of that file as the single source of truth for which generations exist; without it there is nothing to check contracts against.`,
    );
    return problems;
  }
  if (dialectIds.length === 0) {
    problems.push(
      `${DIALECT_ID_SOURCE}\n    declares a ${DIALECT_ID_TYPE} whose members are not all string literals, so they cannot be enumerated. If the union has grown a computed member, this check needs teaching about it rather than working around it.`,
    );
    return problems;
  }

  for (const { name, contract } of contracts) {
    problems.push(
      ...checkOne({
        name,
        contract,
        dialectIds,
        factories,
        fixtureDirs,
        emptyFixtureDirs,
      }),
    );
  }

  // Direction 2. Without this, adding a generation to the union silently leaves
  // it with no recorded footprint at all.
  const declared = new Set(
    contracts
      .map(({ contract }) => isPlainObject(contract) && contract.generation)
      .filter((generation) => typeof generation === "string"),
  );
  for (const id of dialectIds) {
    if (!declared.has(id)) {
      problems.push(
        `${CONTRACT_DIR}/${id}.yaml\n    does not exist, but "${id}" is a ${DIALECT_ID_TYPE}. Every generation the code can resolve has a recorded footprint, even when that footprint is empty — an empty contract that says why is the answer, not a missing file.`,
      );
    }
  }

  // Direction 3, reverse. The forward half in `checkOne` catches a contract
  // naming a fixtures directory that is missing or empty. This half catches the
  // leftover a renamed `fixtures:` key leaves behind: `contracts/viya4.yaml`
  // repointed to `viya4-recorded/` while `test/fixtures/viya4/` stays on disk,
  // still full of recorded payloads and checked by nothing.
  //
  // Scoped narrow on purpose, and each narrowing matters:
  //   - only a directory whose name is a `DialectId` — `harness/`,
  //     `submission-corpus/`, `rich-output/` are fixtures with no contract by
  //     design, and cannot be held to a reverse rule;
  //   - only when a contract *for that generation* exists and points its
  //     `fixtures` at another directory *that itself exists* — a contract with
  //     no `fixtures`, or one pointing at a directory that is missing or empty,
  //     is `checkOne`'s single, correctly-worded complaint, and this check
  //     firing too would just add misleading advice ("move its payloads into
  //     <the typo>") for the same root cause;
  //   - and so a leftover renamed *away from* a generation's name
  //     (`viya4-old/`) keeps no toehold and goes uncaught. Accepted: the
  //     generation name is the only signal this check has.
  const declaredFixturesFor = new Map();
  for (const { contract } of contracts) {
    if (isPlainObject(contract) && typeof contract.generation === "string") {
      declaredFixturesFor.set(contract.generation, contract.fixtures);
    }
  }
  for (const dir of fixtureDirs) {
    if (!dialectIds.includes(dir)) continue;
    const declared = declaredFixturesFor.get(dir);
    if (
      typeof declared === "string" &&
      declared !== dir &&
      fixtureDirs.includes(declared)
    ) {
      problems.push(
        `${FIXTURE_DIR}/${dir}/\n    is named for the "${dir}" generation, but ${CONTRACT_DIR}/${dir}.yaml points its "fixtures" at "${declared}". This directory is the leftover from that rename — move its payloads into "${declared}" or delete it.`,
      );
    }
  }

  // An absence is only a signal relative to a presence.
  const present = new Map();
  for (const { name, contract } of contracts) {
    if (!isPlainObject(contract) || !Array.isArray(contract.endpoints))
      continue;
    for (const endpoint of contract.endpoints) {
      if (isPlainObject(endpoint) && typeof endpoint.id === "string") {
        present.set(endpoint.id, name);
      }
    }
  }
  for (const { name, contract } of contracts) {
    if (!isPlainObject(contract) || !Array.isArray(contract.absent)) continue;
    for (const entry of contract.absent) {
      if (!isPlainObject(entry) || typeof entry.id !== "string") continue;
      const found = present.get(entry.id);
      if (found === undefined) {
        problems.push(
          `${name}\n    records "${entry.id}" as absent, but no contract declares it as an endpoint. Either the endpoint was removed everywhere — in which case delete this entry, because an absence relative to nothing says nothing — or the id is misspelled.`,
        );
      } else if (found === name) {
        problems.push(
          `${name}\n    records "${entry.id}" as absent and also declares it as an endpoint. One of the two is wrong.`,
        );
      }
    }
  }

  return problems;
}

/**
 * The directory names under `test/fixtures/`, and which of them hold nothing
 * that counts as recorded wire shape.
 *
 * A dotfile does not count as content — a lone `.gitkeep` is how an empty
 * directory gets committed at all — so a directory holding only dotfiles is
 * "empty" here. It is shallow past that: a directory whose one entry is an
 * empty subdirectory reads as non-empty, which is a degenerate enough shape to
 * leave alone.
 *
 * Every read is guarded. A directory that vanishes between the listing and the
 * stat, or one this process cannot enter, drops out of both lists rather than
 * throwing a stack trace out of the gate — `check-contracts` states its
 * problems in sentences, and a gate whose failure mode is a stack trace gets
 * read as a broken gate.
 */
function listFixtureDirs(root) {
  let entries;
  try {
    entries = readdirSync(join(root, FIXTURE_DIR));
  } catch {
    return { all: [], empty: [] };
  }
  const all = [];
  const empty = [];
  for (const entry of entries) {
    const full = join(root, FIXTURE_DIR, entry);
    try {
      if (!statSync(full).isDirectory()) continue;
      // Read the contents before recording the directory as present, so a
      // directory that vanishes or turns unreadable between the listing and
      // now drops out of *both* lists rather than landing in `all` with the
      // failure swallowed underneath it.
      const content = readdirSync(full).filter((name) => !name.startsWith("."));
      all.push(entry);
      if (content.length === 0) empty.push(entry);
    } catch {
      // Vanished or unreadable between the listing and now: leave it out.
    }
  }
  return { all, empty };
}

/** Reads a real working tree into the shape `check` wants. */
function readScope(root) {
  const contractNames = readdirSync(join(root, CONTRACT_DIR))
    .filter((entry) => entry.endsWith(".yaml") || entry.endsWith(".yml"))
    .sort();

  const contracts = contractNames.map((entry) => ({
    name: `${CONTRACT_DIR}/${entry}`,
    contract: yaml.load(readFileSync(join(root, CONTRACT_DIR, entry), "utf8")),
  }));

  const dialectFiles = readdirSync(join(root, DIALECT_DIR)).filter((entry) =>
    entry.endsWith(".ts"),
  );
  const factories = dialectFiles.flatMap((entry) =>
    exportedFunctions(
      readFileSync(join(root, DIALECT_DIR, entry), "utf8"),
      `${DIALECT_DIR}/${entry}`,
    ),
  );

  const fixtures = listFixtureDirs(root);

  return {
    contracts,
    dialectIds: unionMembers(
      readFileSync(join(root, DIALECT_ID_SOURCE), "utf8"),
      DIALECT_ID_TYPE,
      DIALECT_ID_SOURCE,
    ),
    factories,
    fixtureDirs: fixtures.all,
    emptyFixtureDirs: fixtures.empty,
  };
}

/**
 * Runs the check against a real working tree.
 *
 * Separate from `main` for the same reason `check-coverage-scope.mjs` splits
 * them: the gate runs once per CI run, and the unit tier runs on three operating
 * systems and names the file rather than the pipeline stage.
 */
export function checkRepository(root) {
  return check(readScope(root));
}

function main() {
  const scope = readScope(process.cwd());
  const problems = check(scope);

  if (problems.length > 0) {
    console.error(`\ncheck-contracts: ${problems.length} problem(s) found.\n`);
    for (const problem of problems) console.error(`  ${problem}\n`);
    console.error(
      "A contract records what one Viya generation offers us. It is checked\n" +
        "against the dialect layer and the fixtures in both directions, so that\n" +
        "neither can drift away from it quietly. See docs/architecture/contracts.md.\n",
    );
    process.exit(1);
  }

  const endpoints = scope.contracts.reduce(
    (total, { contract }) =>
      total +
      (Array.isArray(contract?.endpoints) ? contract.endpoints.length : 0),
    0,
  );
  console.log(
    `check-contracts: OK — ${String(scope.contracts.length)} contract(s), ${String(endpoints)} endpoint(s), against ${String(scope.dialectIds?.length ?? 0)} generation(s).`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

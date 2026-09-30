// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The dependency-licence gate.
 *
 * Every package in `package-lock.json` must either carry a licence expression
 * that `license-allowlist.json`'s `allowed` list satisfies, or be named in its
 * `exceptions` with a reason. Anything else fails the run.
 *
 * ## Why the whole lockfile, and not only what ships
 *
 * `package.json` declares no `dependencies` at all: the packages that do reach
 * a user (React, AG Grid and the rest that esbuild inlines into the bundles —
 * `NOTICE` lists them) are `devDependencies` like every build tool. npm's
 * dev/production flag therefore cannot say what ships, and neither can this
 * script. So the rule is written the other way round. `allowed` holds only
 * licences that are fine for a package that *does* ship, and a package under
 * anything else needs an exception whose `why` is the argument that it never
 * reaches a bundle. A new bundled dependency under a copyleft or unusual
 * licence therefore fails here until somebody reasons about it, rather than
 * passing because its licence was once accepted for a build tool.
 *
 * Keeping `NOTICE`'s list current is a separate job this gate does not do: the
 * set of bundled packages is only knowable from esbuild's metafile
 * (`docs/phases/phase-12.md`, "12i done").
 *
 * ## What counts as satisfied
 *
 * The lockfile's `license` field is an SPDX expression. `A OR B` passes when
 * either side does, `A AND B` only when both do, and a bare identifier when it
 * is in `allowed`. A `WITH` exception clause, a `+` suffix, or anything that is
 * not an SPDX expression at all (`SEE LICENSE IN LICENSE.txt`, a missing field)
 * never passes on the list alone: those are decisions, so they go in
 * `exceptions`.
 *
 * ## Exceptions are keyed on the package and its licence
 *
 * An exception names both, so a package that changes licence falls out of its
 * exception and fails as unreviewed; its old entry then matches nothing and is
 * reported as stale, as `check-audit.mjs` reports an allow-list line that
 * silently allows nothing. An exception for a package `allowed` already
 * accepts is stale too: it would outlive the reason it was written.
 *
 * It reads only the lockfile, so it needs no install and no network.
 *
 * ## Exit codes
 *
 * **1** — the policy was violated (an unreviewed licence or a stale exception).
 * **2** — this script or its input is wrong (unreadable lockfile, malformed
 * policy file). Kept distinct for the same reason as `check-audit.mjs`.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const POLICY = join(HERE, "license-allowlist.json");
const LOCKFILE = join(HERE, "..", "package-lock.json");

/**
 * Splits an SPDX expression into identifiers, operators and parentheses, or
 * `undefined` for an empty string. Whether the tokens form an expression is
 * the parser's question, not this one's.
 */
function tokenize(expression) {
  const tokens = expression
    .replace(/\(/g, " ( ")
    .replace(/\)/g, " ) ")
    .trim()
    .split(/\s+/);
  return tokens[0] === "" ? undefined : tokens;
}

/**
 * Whether an SPDX licence expression is satisfied by `allowed`.
 *
 * Recursive descent over `or := and ("OR" and)*`, `and := atom ("AND"
 * atom)*`, `atom := "(" or ")" | identifier`, with AND binding tighter than
 * OR, as the SPDX specification (Annex D) defines. Anything the grammar does
 * not accept — including `WITH` and a `+` suffix, which this project has no
 * package using — is `false`, never a guess.
 */
export function licenseSatisfied(expression, allowed) {
  if (typeof expression !== "string") return false;
  const tokens = tokenize(expression);
  if (tokens === undefined) return false;

  let position = 0;
  const peek = () => tokens[position];
  const isIdentifier = (token) =>
    token !== undefined && /^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(token);

  // Each returns a boolean, or `undefined` for a syntax error.
  function parseOr() {
    let result = parseAnd();
    while (result !== undefined && peek() === "OR") {
      position += 1;
      const right = parseAnd();
      result = right === undefined ? undefined : result || right;
    }
    return result;
  }
  function parseAnd() {
    let result = parseAtom();
    while (result !== undefined && peek() === "AND") {
      position += 1;
      const right = parseAtom();
      result = right === undefined ? undefined : result && right;
    }
    return result;
  }
  function parseAtom() {
    const token = peek();
    if (token === "(") {
      position += 1;
      const inner = parseOr();
      if (inner === undefined || peek() !== ")") return undefined;
      position += 1;
      return inner;
    }
    if (!isIdentifier(token) || ["AND", "OR", "WITH"].includes(token)) {
      return undefined;
    }
    position += 1;
    return allowed.has(token);
  }

  const result = parseOr();
  // Trailing tokens (`SEE LICENSE IN …` parses `SEE` and stops) are a syntax
  // error, not a pass on the first identifier.
  return result === true && position === tokens.length;
}

/**
 * One entry per distinct package name and licence in a lockfile's `packages`
 * map, with every path it is installed at. A package installed at several
 * versions under one licence is one decision, so it is one entry.
 */
export function collectPackages(lockfile) {
  const packages = lockfile?.packages;
  if (packages === null || typeof packages !== "object") {
    throw new Error("lockfile has no `packages` map (lockfileVersion 2+)");
  }

  const byKey = new Map();
  for (const [path, meta] of Object.entries(packages)) {
    // "" is the project itself; a `link` is a workspace, not a download.
    if (path === "" || meta?.link === true) continue;
    // The innermost `node_modules/` segment names the package. A path with
    // none (a workspace's own source folder) keeps the whole path, rather than
    // a slice from index -1 + 13.
    const nested = path.lastIndexOf("node_modules/");
    const name =
      typeof meta?.name === "string"
        ? meta.name
        : nested === -1
          ? path
          : path.slice(nested + "node_modules/".length);
    const license =
      typeof meta?.license === "string" ? meta.license : "(no licence field)";
    const key = `${name}\u0000${license}`;
    const found = byKey.get(key);
    if (found === undefined) {
      byKey.set(key, { name, license, paths: [path] });
    } else {
      found.paths.push(path);
    }
  }
  return [...byKey.values()];
}

/**
 * Validates the policy file before trusting it. Every exception needs a `why`
 * for the same reason `check-audit.mjs`'s entries do: a file that records a
 * decision without its reasoning is the failure this repository is written
 * against.
 */
export function parsePolicy(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`licence policy is not valid JSON: ${error.message}`, {
      cause: error,
    });
  }

  if (
    !Array.isArray(raw?.allowed) ||
    raw.allowed.length === 0 ||
    !raw.allowed.every((id) => typeof id === "string" && id.trim() !== "")
  ) {
    throw new Error(
      "licence policy must have a non-empty `allowed` array of SPDX identifiers",
    );
  }
  if (!Array.isArray(raw.exceptions)) {
    throw new Error("licence policy must have an `exceptions` array");
  }

  const seen = new Set();
  const exceptions = raw.exceptions.map((entry, index) => {
    const where = `exceptions[${index}]`;
    for (const field of ["package", "license", "why"]) {
      if (typeof entry?.[field] !== "string" || entry[field].trim() === "") {
        throw new Error(`${where}.${field} must be a non-empty string`);
      }
    }
    const key = `${entry.package}\u0000${entry.license}`;
    if (seen.has(key)) {
      throw new Error(
        `${where} repeats ${entry.package} (${entry.license}); one entry per package and licence`,
      );
    }
    seen.add(key);
    return {
      package: entry.package,
      license: entry.license,
      why: entry.why,
    };
  });

  return { allowed: new Set(raw.allowed), exceptions };
}

/**
 * Sorts every package into accepted or `unreviewed`, and every exception into
 * used or `stale`. Pure, so each branch is testable without a lockfile.
 */
export function classify(packages, policy) {
  const exceptionFor = new Map(
    policy.exceptions.map((entry) => [
      `${entry.package}\u0000${entry.license}`,
      entry,
    ]),
  );
  const used = new Set();
  const unreviewed = [];

  for (const pkg of packages) {
    const key = `${pkg.name}\u0000${pkg.license}`;
    if (licenseSatisfied(pkg.license, policy.allowed)) continue;
    if (exceptionFor.has(key)) {
      used.add(key);
      continue;
    }
    unreviewed.push(pkg);
  }

  // Matches nothing (the package left, changed licence, or the name is a typo),
  // or matches only a package the allow-list already accepts.
  const stale = policy.exceptions.filter(
    (entry) => !used.has(`${entry.package}\u0000${entry.license}`),
  );

  return { unreviewed, stale };
}

/**
 * The gate's own logic, checked against known answers before it is trusted
 * with the lockfile. Runs on every invocation for the same reason as
 * `check-audit.mjs`'s: the failure it guards against is an edit to this file
 * that nobody tested.
 */
function selfCheck() {
  const allowed = new Set(["MIT", "Apache-2.0", "Zlib"]);
  const policy = {
    allowed,
    exceptions: [{ package: "tool", license: "EPL-2.0", why: "w" }],
  };
  const pkg = (name, license) => ({ name, license, paths: [name] });

  const cases = [
    ["bare allowed", licenseSatisfied("MIT", allowed), true],
    ["bare not allowed", licenseSatisfied("GPL-3.0-only", allowed), false],
    ["or, one side", licenseSatisfied("(MIT OR GPL-3.0-only)", allowed), true],
    ["and, both", licenseSatisfied("(MIT AND Zlib)", allowed), true],
    [
      "and, one side",
      licenseSatisfied("(MIT AND GPL-3.0-only)", allowed),
      false,
    ],
    [
      "and binds tighter",
      licenseSatisfied("GPL-3.0-only OR MIT AND Zlib", allowed),
      true,
    ],
    ["with clause", licenseSatisfied("MIT WITH X-exception", allowed), false],
    [
      "not spdx",
      licenseSatisfied("SEE LICENSE IN LICENSE.txt", allowed),
      false,
    ],
    ["unbalanced", licenseSatisfied("(MIT OR Zlib", allowed), false],
    ["missing", licenseSatisfied(undefined, allowed), false],
    [
      "exception used",
      classify([pkg("tool", "EPL-2.0")], policy).unreviewed.length,
      0,
    ],
    [
      "unreviewed",
      classify([pkg("other", "EPL-2.0")], policy).unreviewed.length,
      1,
    ],
    ["stale exception", classify([], policy).stale.length, 1],
    [
      "exception no longer needed",
      classify([pkg("tool", "MIT")], policy).stale.length,
      1,
    ],
  ];

  const broken = cases.filter(([, actual, expected]) => actual !== expected);
  if (broken.length > 0) {
    for (const [name, actual, expected] of broken) {
      console.error(
        `check-licenses: self-check "${name}" expected ${String(expected)}, got ${String(actual)}`,
      );
    }
    process.exit(2);
  }
}

function report(label, items, render) {
  console.error(`\ncheck-licenses: ${label}`);
  for (const item of items) console.error(`  ${render(item)}`);
}

function main() {
  selfCheck();

  let policy;
  let packages;
  try {
    policy = parsePolicy(readFileSync(POLICY, "utf8"));
    packages = collectPackages(JSON.parse(readFileSync(LOCKFILE, "utf8")));
  } catch (error) {
    console.error(`check-licenses: ${error.message}`);
    process.exit(2);
  }

  const { unreviewed, stale } = classify(packages, policy);
  let failed = false;

  if (unreviewed.length > 0) {
    report(
      `${unreviewed.length} package(s) under a licence the allow-list does not accept. If the package can never reach a bundle, add it to scripts/license-allowlist.json's exceptions with the reason; if it can, it needs a different package or a deliberate policy change.`,
      unreviewed,
      (p) => `${p.name} — ${p.license}\n    at ${p.paths.join(", ")}`,
    );
    failed = true;
  }

  if (stale.length > 0) {
    report(
      `${stale.length} exception(s) match no package that needs one. Delete the entry, or fix its package name or licence.`,
      stale,
      (e) => `${e.package} — ${e.license}: ${e.why}`,
    );
    failed = true;
  }

  if (failed) process.exit(1);

  console.log(
    `check-licenses: OK — ${packages.length} package/licence pair(s), ${policy.exceptions.length} by named exception.`,
  );
}

// Importable for tests without running the gate, as `check-audit.mjs` is.
if (process.argv[1] === fileURLToPath(import.meta.url)) main();

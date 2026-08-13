// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Keeps the coverage denominator honest.
 *
 * `.c8rc.json` excludes the modules that import `vscode` from the unit-tier
 * coverage figure, because a module that imports `vscode` cannot be loaded
 * outside an extension host at all: it scores zero not because it is untested
 * but because the tier measuring it cannot reach it. Leaving those modules in
 * the denominator makes the ratchet punish shell code for existing, and a
 * ratchet that has to be lowered is not a ratchet. ADR-0009 has the argument.
 *
 * The obvious objection to any exclude list is that it becomes a place to hide
 * code you did not want to test. This script is the answer to that objection.
 * It asserts the rule in **both** directions:
 *
 *   1. Every `src/` path in the exclude list really does import `vscode`.
 *      This is the direction with teeth. A pure module added to the list would
 *      otherwise lose its coverage floor permanently and silently.
 *   2. Every module that imports `vscode` is in the list. Without this, a new
 *      shell module lands in the denominator, scores zero, and the next person
 *      to see the ratchet fail is told a lie about which change broke it.
 *
 * It also refuses globs in the `src/` part of the list, because a glob cannot
 * be checked against direction 1 — `src/**` would satisfy "everything excluded
 * imports vscode" only in the sense that nothing is left to disagree with it.
 *
 * The import test is TypeScript's own parser rather than a regular expression.
 * That is not fussiness: `src/` is full of doc comments that discuss importing
 * `vscode`, and this file is one of them. A regex over the text reports the
 * prose. The parser also gets the case that matters most and would be hardest
 * to pattern-match — `import type { ... } from "vscode"` is erased before the
 * code runs, so a module that only imports types is still perfectly loadable in
 * the unit tier and must stay in the denominator.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const CONFIG = ".c8rc.json";
const SOURCE_DIR = "src";

/** The module specifier that makes a file extension-host-only. */
const HOST_ONLY = "vscode";

function walk(root, dir) {
  const found = [];
  for (const entry of readdirSync(join(root, dir))) {
    const full = join(root, dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...walk(root, join(dir, entry)));
    } else if (entry.endsWith(".ts")) {
      found.push(relative(root, full).split(sep).join("/"));
    }
  }
  return found;
}

/**
 * Does this import declaration survive compilation?
 *
 * `import type { X } from "vscode"` and `import { type X } from "vscode"` are
 * both erased — with `verbatimModuleSyntax: false`, an import whose every
 * binding is type-only emits nothing at all. A bare `import "vscode"` has no
 * clause and is a side-effect import, which very much does survive.
 */
function isRuntimeImport(clause) {
  if (clause === undefined) return true; // side-effect import
  if (clause.isTypeOnly) return false;
  if (clause.name !== undefined) return true; // default binding

  const bindings = clause.namedBindings;
  if (bindings === undefined) return true;
  if (ts.isNamespaceImport(bindings)) return true;
  return bindings.elements.some((element) => !element.isTypeOnly);
}

/**
 * True if loading this file at run time would load `vscode`.
 *
 * Exported for the unit test, which feeds it source text rather than paths so
 * the awkward forms can be stated as cases instead of arranged on disk.
 */
export function importsHostModule(source, fileName = "input.ts") {
  const parsed = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.ES2022,
    /* setParentNodes */ false,
    ts.ScriptKind.TS,
  );

  let found = false;

  const isHostSpecifier = (node) =>
    node !== undefined && ts.isStringLiteral(node) && node.text === HOST_ONLY;

  const visit = (node) => {
    if (found) return;

    if (ts.isImportDeclaration(node) && isHostSpecifier(node.moduleSpecifier)) {
      if (isRuntimeImport(node.importClause)) found = true;
    } else if (
      // `export { window } from "vscode"` re-exports at run time, and a module
      // that re-exports the host module is as unloadable as one that imports it.
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      isHostSpecifier(node.moduleSpecifier)
    ) {
      found = true;
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      isHostSpecifier(node.moduleReference.expression)
    ) {
      found = true;
    } else if (ts.isCallExpression(node)) {
      // `await import("vscode")` and `require("vscode")`. Both are deferred,
      // so a module using them is loadable until the call runs — but the call
      // is the whole reason the module exists, and treating it as pure would
      // put an unreachable branch back in the denominator.
      const callee = node.expression;
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === "require";
      if (
        (isDynamicImport || isRequire) &&
        isHostSpecifier(node.arguments[0])
      ) {
        found = true;
      }
    }

    if (!found) ts.forEachChild(node, visit);
  };

  visit(parsed);
  return found;
}

/**
 * The `src/` entries of the c8 exclude list, which is the list this script
 * exists to police. `test/**` and `out/test/**` are a different rule — the test
 * tier is not code under measurement — and are none of its business.
 */
export function sourceExcludes(exclude) {
  return exclude.filter((pattern) => pattern.startsWith(`${SOURCE_DIR}/`));
}

export function check({ excludes, sources, read }) {
  const problems = [];
  const excluded = new Set(excludes);

  for (const pattern of excludes) {
    if (/[*?[\]{}]/.test(pattern)) {
      problems.push(
        `${pattern}\n    is a glob. Coverage exclusions under ${SOURCE_DIR}/ have to name one file each, so that this check can confirm every one of them is extension-host-only. A glob cannot be confirmed — it just makes the disagreement unobservable.`,
      );
      continue;
    }
    if (!sources.includes(pattern)) {
      problems.push(
        `${pattern}\n    is excluded from coverage but does not exist. If it was renamed, rename it here too; if it was deleted, delete this line — a stale exclusion is an exclusion nobody is reading.`,
      );
      continue;
    }
    if (!importsHostModule(read(pattern), pattern)) {
      problems.push(
        `${pattern}\n    is excluded from coverage but does not import "${HOST_ONLY}", so the unit tier can reach it. Remove it from "exclude" in ${CONFIG} and write tests for it. Exclusions exist for code the tier physically cannot load, not for code that is inconvenient to test.`,
      );
    }
  }

  for (const file of sources) {
    if (excluded.has(file)) continue;
    if (importsHostModule(read(file), file)) {
      problems.push(
        `${file}\n    imports "${HOST_ONLY}" but is not in the "exclude" list in ${CONFIG}, so it sits in the coverage denominator scoring zero and drags the ratchet down with it. Add it — and add an integration test, because after you do, no number will notice if you don't.`,
      );
    }
  }

  return problems;
}

/** Reads a real working tree into the shape `check` wants. */
function readScope(root) {
  const config = JSON.parse(readFileSync(join(root, CONFIG), "utf8"));
  return {
    excludes: sourceExcludes(config.exclude ?? []),
    sources: walk(root, SOURCE_DIR),
    read: (file) => readFileSync(join(root, file), "utf8"),
  };
}

/**
 * Runs the check against a real working tree.
 *
 * Separate from `main` so the unit tier can assert the invariant on this
 * repository as well as on synthetic input. The gate runs once per CI run; the
 * unit tier runs on three operating systems, and the failure it produces names
 * the file rather than the pipeline stage.
 */
export function checkRepository(root) {
  return check(readScope(root));
}

function main() {
  const scope = readScope(process.cwd());
  const { excludes, sources } = scope;
  const problems = check(scope);

  if (problems.length > 0) {
    console.error(
      `\ncheck-coverage-scope: ${problems.length} problem(s) found.\n`,
    );
    for (const problem of problems) console.error(`  ${problem}\n`);
    console.error(
      "The rule: a module is excluded from unit coverage if and only if it\n" +
        'imports "vscode". See docs/adr/0009-coverage-scope.md.\n',
    );
    process.exit(1);
  }

  console.log(
    `check-coverage-scope: OK — ${String(sources.length)} source file(s), ${String(excludes.length)} extension-host-only.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

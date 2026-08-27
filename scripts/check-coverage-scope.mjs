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
 *   1. Every `src/` path in the exclude list really is out of the tier's reach.
 *      This is the direction with teeth. A pure module added to the list would
 *      otherwise lose its coverage floor permanently and silently.
 *   2. Every module out of reach is in the list. Without this, a new shell
 *      module lands in the denominator, scores zero, and the next person to see
 *      the ratchet fail is told a lie about which change broke it.
 *
 * It also refuses globs in the `src/` part of the list, because a glob cannot
 * be checked against direction 1 — `src/**` would satisfy "everything excluded
 * imports vscode" only in the sense that nothing is left to disagree with it.
 *
 * A second kind of unreachable module joined the rule on 2026-08-16, by
 * amendment to ADR-0009: a file of nothing but types. It emits an empty
 * JavaScript file, so there is no line for a test to execute, and c8 charges its
 * whole source — doc comments and all — to the denominator. Both directions
 * apply to it too, which is what stops the second rule from becoming a way to
 * park code: a module qualifies only while *every* top-level statement in it is
 * erased at compile time, and the day someone adds a function to it the check
 * says so.
 *
 * A third kind joined on 2026-08-26, by ADR-0021: `src/webview/` holds this
 * repository's first browser-target code — bundled by its own esbuild context
 * for a `WebviewPanel`, never for the extension host, and referencing globals
 * (`document`, `acquireVsCodeApi`) that plainly do not exist under the unit
 * tier's Node process. That is unreachable in the same *kind* of way a module
 * importing `vscode` is unreachable — not "untested", but "this tier cannot
 * load it, full stop" — so it is checked the same way, in both directions, by
 * path rather than by import analysis: every file under `src/webview/` must be
 * excluded, and every exclusion claiming this reason must actually live there.
 * ADR-0021 also records the discipline that keeps this from becoming the
 * hiding place the other two rules already guard against: almost everything
 * `src/webview/` needs is written as ordinary, DOM-free, unit-tested logic
 * living *outside* that directory, injected into a small port a fake can stand
 * in for. What actually lives under `src/webview/` is meant to stay a thin,
 * branch-free bootstrap for exactly that reason.
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
 * Is every statement in this file erased by the compiler?
 *
 * The second exclusion rule, added by the 2026-08-16 amendment to ADR-0009. A
 * module of nothing but interfaces and type aliases emits an empty JavaScript
 * file, so no test can execute a line of it — and c8's `all` mode then counts
 * every line of its source, doc comments included, as uncovered. The unit tier
 * cannot reach it for the same kind of reason a `vscode` module cannot be
 * reached: not because it is untested, but because there is nothing there to
 * run.
 *
 * Top-level statements only, deliberately. A nested type declaration cannot be
 * the whole of a file, and anything that *contains* one — a function, a class,
 * a namespace with a value in it — is runtime content and disqualifies the file
 * at the top level anyway. So the shallow test is the exact test.
 *
 * Exported for the unit test, which feeds it source text rather than paths.
 */
export function isTypesOnly(source, fileName = "input.ts") {
  const parsed = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.ES2022,
    /* setParentNodes */ false,
    ts.ScriptKind.TS,
  );

  const isDeclared = (node) =>
    ts.canHaveModifiers(node) &&
    (ts
      .getModifiers(node)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword) ??
      false);

  const isErased = (node) => {
    if (ts.isInterfaceDeclaration(node)) return true;
    if (ts.isTypeAliasDeclaration(node)) return true;
    if (ts.isImportDeclaration(node))
      return !isRuntimeImport(node.importClause);
    if (ts.isExportDeclaration(node)) {
      if (node.isTypeOnly) return true;
      const clause = node.exportClause;
      // `export { type A, type B };` emits an empty object; `export *` and any
      // value specifier emit a live re-export.
      return (
        clause !== undefined &&
        ts.isNamedExports(clause) &&
        clause.elements.every((element) => element.isTypeOnly)
      );
    }
    // `declare const x: number` describes something that already exists rather
    // than creating it, and emits nothing. Enums, classes and functions without
    // it all emit.
    return isDeclared(node);
  };

  return parsed.statements.every(isErased);
}

/**
 * The `src/` entries of the c8 exclude list, which is the list this script
 * exists to police. `test/**` and `out/test/**` are a different rule — the test
 * tier is not code under measurement — and are none of its business.
 */
export function sourceExcludes(exclude) {
  return exclude.filter((pattern) => pattern.startsWith(`${SOURCE_DIR}/`));
}

/** The directory whose whole contents run only inside a webview's browser
 * context (ADR-0021) — never under the extension host, and so never under the
 * unit tier either. Checked by path, not by content: unlike the other two
 * reasons, "runs in a browser" is a fact about where a file is built and
 * loaded, not something an import or a statement list can reveal on its own. */
const BROWSER_ONLY_DIR = `${SOURCE_DIR}/webview/`;

/** True for exactly the files this repository's build treats as browser-target
 * (ADR-0021), and only those — a bare directory-name match, deliberately, so
 * that `src/webviewFoo.ts` (not a real path in this repository, but not what
 * this predicate is for either) does not slip in on a substring match. */
export function isBrowserOnly(file) {
  return file.startsWith(BROWSER_ONLY_DIR);
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
    const source = read(pattern);
    if (
      !importsHostModule(source, pattern) &&
      !isTypesOnly(source, pattern) &&
      !isBrowserOnly(pattern)
    ) {
      problems.push(
        `${pattern}\n    is excluded from coverage but does not import "${HOST_ONLY}", is not types only, and is not under "${BROWSER_ONLY_DIR}" — so it has code to run and the unit tier can reach it. Remove it from "exclude" in ${CONFIG} and write tests for it. Exclusions exist for code the tier physically cannot load, not for code that is inconvenient to test.`,
      );
    }
  }

  for (const file of sources) {
    if (excluded.has(file)) continue;
    const source = read(file);
    if (importsHostModule(source, file)) {
      problems.push(
        `${file}\n    imports "${HOST_ONLY}" but is not in the "exclude" list in ${CONFIG}, so it sits in the coverage denominator scoring zero and drags the ratchet down with it. Add it — and add an integration test, because after you do, no number will notice if you don't.`,
      );
    } else if (isTypesOnly(source, file)) {
      problems.push(
        `${file}\n    is types only, so it compiles to an empty file and no test can execute a line of it — but c8 counts every line of the source, comments included, as uncovered. Add it to "exclude" in ${CONFIG}. If that is a surprise, the file has lost its runtime content: put the code back rather than the exclusion.`,
      );
    } else if (isBrowserOnly(file)) {
      problems.push(
        `${file}\n    is under "${BROWSER_ONLY_DIR}", which only ever runs inside a webview's browser context (ADR-0021) and can never load under the unit tier's Node process. Add it to "exclude" in ${CONFIG}. If most of the file's actual logic can be tested, prefer moving that logic out to an ordinary, ported module and keeping this one a thin bootstrap — that is what keeps this exclusion from growing.`,
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
      "The rule: a module is excluded from unit coverage if and only if the\n" +
        'unit tier cannot reach it — because it imports "vscode", because it is\n' +
        "types only and compiles to nothing, or because it lives under\n" +
        `"${BROWSER_ONLY_DIR}" and only runs inside a webview. See\n` +
        "docs/adr/0009-coverage-scope.md and docs/adr/0021-result-panel-webview.md.\n",
    );
    process.exit(1);
  }

  console.log(
    `check-coverage-scope: OK — ${String(sources.length)} source file(s), ${String(excludes.length)} unreachable from the unit tier.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

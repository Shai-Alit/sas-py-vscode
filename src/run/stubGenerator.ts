// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Generates a minimal Pylance stub tree for a Viya profile's installed
 * packages — 10b (`docs/phases/phase-10.md`'s Plan section), the "central
 * technical finding": a directory of `<import-name>/__init__.pyi` catch-alls
 * pointed to by `python.analysis.stubPath` turns an import Pylance would
 * otherwise flag as fully missing (`reportMissingImports`, an error) into,
 * at worst, a suppressible `reportMissingModuleSource` (a warning) — Finding
 * 10.1 (Probe findings, `phase-10.md`) confirms the mechanism itself.
 *
 * **This module must never import `vscode`.** Pure over an already-filtered
 * package list — same discipline as `environmentDiff.ts`/`localPackages.ts`.
 * It does not decide *which* packages to stub; that is the caller's job
 * (`pylanceStubSync.ts`), because the answer depends on 10a's diff (Finding
 * 10.2, below) — this module only turns a given list into file contents.
 *
 * ## Why only the caller's given list, never "every remote package"
 *
 * Finding 10.2 (`phase-10.md`'s Probe findings) found, by direct test, that a
 * generated stub takes precedence over a same-named package that already
 * resolves locally with real source — silently suppressing real
 * type-checking for it. So the caller must pass only 10a's `remoteOnly` diff
 * bucket (or every remote package, when the local environment itself is
 * unknown and there is nothing local to shadow) — never a package that
 * already resolves locally. This module has no way to enforce that itself
 * (it does not see the diff), so it trusts its input; the enforcement lives
 * at the one call site, `pylanceStubSync.ts`.
 *
 * ## Why one path segment, not the dotted import name in full
 *
 * A top-level import name can be dotted for a namespace package (`google`
 * providing `google.protobuf`), but a catch-all `__init__.pyi` for `google`
 * alone does not make `import google.protobuf` resolve as a submodule — that
 * would need a real, separately-generated stub per nested segment, which
 * this project's probe payload (a flat `(name, version, importNames)` list,
 * never a real module tree) has no way to derive. Stubbing only the first
 * segment is a smaller, honest claim consistent with this phase's own
 * stated non-goal: "the catch-all's job is only to stop lying about
 * existence, not to simulate IntelliSense Viya's own interpreter never
 * offered to begin with." A namespace package's own top-level name still
 * stops being reported as fully missing; its submodules are unaffected
 * either way, exactly as they were before this feature existed.
 */

/** One package to generate a stub for — the minimal shape this module needs,
 * restated so it needs no import from `../backend/backend`'s `PythonPackage`
 * (the same restatement discipline `environmentDiff.ts`/`environmentDocument.ts`
 * already follow for the same type). */
export interface StubbablePackage {
  readonly name: string;
  readonly version: string;
  readonly importNames: readonly string[];
}

/** One generated file, as a path relative to the stub tree's own root (e.g.
 * `numpy/__init__.pyi`) and its full text content. */
export interface GeneratedStubFile {
  readonly relativePath: string;
  readonly content: string;
}

/** A legal Python identifier — the same shape a top-level package/module name
 * must have to be `import`-able at all, so an import name that fails this
 * (an empty string, a stray non-identifier character) is skipped rather than
 * written as a directory name no `import` statement could ever reach anyway. */
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The first dotted segment of an import name — see this module's own doc
 * comment, "Why one path segment, not the dotted import name in full". */
function topLevelSegment(importName: string): string {
  const dotIndex = importName.indexOf(".");
  return dotIndex === -1 ? importName : importName.slice(0, dotIndex);
}

/** Strips a value the Viya probe reported (`pkg.name`/`pkg.version` —
 * `importlib.metadata`'s own record, never validated against any character
 * set) before it goes into a `#` comment line. Without this, a newline in
 * either value would let attacker-controlled text become literal (non-comment)
 * content in a file this feature writes into the user's workspace — not code
 * execution (Pylance only parses a `.pyi` for type information, never runs
 * it), but a real gap against this project's general posture toward
 * untrusted Viya-sourced strings (the same reasoning behind escaping
 * submitted Python against `endsubmit` injection). */
function sanitiseForComment(value: string): string {
  // Deliberately matching C0 controls (CR/LF included), not a typo for `\s`.
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x1f\x7f]/g, " ");
}

function stubFileContent(pkg: StubbablePackage): string {
  const name = sanitiseForComment(pkg.name);
  const version = sanitiseForComment(pkg.version);
  return [
    `# Generated by Python on Viya — represents ${name} ${version} installed on this SAS Viya profile.`,
    "# This stub only asserts that the module exists; it carries no real type",
    '# information. Regenerated on every "Refresh Environment Info" — edits here',
    "# do not persist.",
    "from typing import Any",
    "",
    "def __getattr__(name: str) -> Any: ...",
    "",
  ].join("\n");
}

/**
 * Builds the stub tree's file list for the given packages — one
 * `<import-name>/__init__.pyi` per distinct top-level import name, sorted by
 * path for a deterministic write order.
 *
 * Packages are processed in the order given after being sorted by
 * {@link StubbablePackage.name}, so that if two packages happen to claim the
 * same top-level import name (rare, but not impossible — two distributions
 * can both ship a same-named compatibility shim), which one's version
 * populates the generated comment is at least deterministic rather than
 * input-order-dependent.
 */
export function generateStubTree(
  packages: readonly StubbablePackage[],
): readonly GeneratedStubFile[] {
  const byTopLevelName = new Map<string, StubbablePackage>();

  const sorted = [...packages].sort((a, b) => a.name.localeCompare(b.name));
  for (const pkg of sorted) {
    for (const importName of pkg.importNames) {
      const segment = topLevelSegment(importName);
      if (!IDENTIFIER_PATTERN.test(segment)) continue;
      if (!byTopLevelName.has(segment)) byTopLevelName.set(segment, pkg);
    }
  }

  const files = [...byTopLevelName.entries()].map(([segment, pkg]) => ({
    relativePath: `${segment}/__init__.pyi`,
    content: stubFileContent(pkg),
  }));
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

/** The top-level directory name each entry in {@link GeneratedStubFile}
 * belongs to — what {@link planStubTreeSync} prunes by, and what
 * {@link excludeWorkspaceOwnedNames} shadow-checks by. Every path this
 * module generates is exactly `<segment>/__init__.pyi` (never a bare
 * filename with no directory), so no fallback for a missing `/` is needed —
 * one would be unreachable dead code, not defensiveness. */
export function topDirectory(relativePath: string): string {
  return relativePath.slice(0, relativePath.indexOf("/"));
}

/**
 * Drops any generated stub whose top-level name is already a real directory
 * or `.py` file at the workspace root — the half of Finding 10.2's shadowing
 * hazard the `remoteOnly`-only scoping above does not cover. Pyright's
 * documented import-resolution order puts `stubPath` *before* workspace
 * source (`microsoft/pyright`'s own import-resolution docs, cited in
 * `phase-10.md`'s Probe findings), so a generated `tests/__init__.pyi` — a
 * top-level name a Viya-only distribution's `top_level.txt` can plausibly
 * claim (`tests`, `utils`, and similar generic names are common) — would
 * shadow the user's own `tests/` package, not just a same-named installed
 * distribution. `pylanceStubSync.ts` is the one caller that can list a real
 * workspace root; this function only applies the exclusion once it has.
 */
export function excludeWorkspaceOwnedNames(
  files: readonly GeneratedStubFile[],
  workspaceRootNames: readonly string[],
): readonly GeneratedStubFile[] {
  const owned = new Set(workspaceRootNames);
  return files.filter((file) => !owned.has(topDirectory(file.relativePath)));
}

/** What {@link planStubTreeSync} says to do to bring a stub tree's on-disk
 * state in line with a freshly generated one. */
export interface StubTreeSyncPlan {
  /** Every file to (re)write — always the full desired set, never a partial
   * diff: content is cheap and deterministic to regenerate, so there is no
   * reason to track what changed rather than just rewriting it. */
  readonly toWrite: readonly GeneratedStubFile[];
  /** Top-level directory names present on disk but absent from the desired
   * set — a package that was `remoteOnly` on a previous refresh and no
   * longer is (removed from Viya, or now resolves locally too) must not
   * leave its stale stub behind to keep shadowing or falsely claiming
   * existence. */
  readonly toDelete: readonly string[];
  /**
   * Whether carrying out this plan actually changes the stub tree's
   * top-level directory listing — a deletion, or a desired name not already
   * present on disk. Deliberately *not* "did any file's content change":
   * `toWrite` above is always the full desired set regardless, so a
   * version-only bump inside an already-present directory does not count.
   * `pylanceStubSync.ts` uses this (not `toWrite.length > 0`, which is true
   * on every sync with anything to stub) to decide whether a fresh probe's
   * own sync is worth a "reload the window" notice — before this field
   * existed, that notice fired on every non-empty sync regardless of
   * whether anything actually changed, nagging on every "Refresh
   * Environment Info" against an already-synced profile (adversarial
   * review, pre-push, before this phase's PR was opened).
   */
  readonly changed: boolean;
}

/**
 * Diffs a stub tree's current top-level directory listing against a freshly
 * generated file set. Pure — `pylanceStubSync.ts` is the one caller that
 * supplies the real listing and carries out the plan.
 */
export function planStubTreeSync(
  existingTopLevelNames: readonly string[],
  desired: readonly GeneratedStubFile[],
): StubTreeSyncPlan {
  const desiredNames = new Set(
    desired.map((file) => topDirectory(file.relativePath)),
  );
  const existingNames = new Set(existingTopLevelNames);
  const toDelete = existingTopLevelNames.filter(
    (name) => !desiredNames.has(name),
  );
  const changed =
    toDelete.length > 0 ||
    [...desiredNames].some((name) => !existingNames.has(name));
  return { toWrite: desired, toDelete, changed };
}

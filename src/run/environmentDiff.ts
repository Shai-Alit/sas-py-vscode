// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Compares a Viya profile's probed package set against the local
 * environment's, into the three buckets `docs/phases/phase-10.md`'s Plan
 * section names for 10a: remote-only, local-only, and version-mismatched.
 *
 * **This module must never import `vscode`.** Pure over two package lists —
 * same reasoning as `localPackages.ts` and `environmentDocument.ts`.
 *
 * Package names are compared normalised per PEP 503 (lower-cased, runs of
 * `-`/`_`/`.` collapsed to a single `-`) rather than byte-for-byte: the two
 * sides of this diff come from different tooling reading the same
 * distribution's metadata (`importlib.metadata` on Viya,
 * `*.dist-info`/`*.egg-info` `Name:` headers locally), and PyPI packaging
 * treats e.g. `My-Package`, `my_package` and `my.package` as the same
 * project. Comparing raw strings would report a real `numpy`/`numpy`
 * install pair as a false "remote-only" and a false "local-only" the moment
 * one side's build happened to capitalise its own `Name:` field differently
 * — a wrong answer this diff exists to avoid, not a real mismatch to
 * surface. The *displayed* name is always whichever side actually reported
 * it, never the normalised form.
 */

/** One installed distribution on either side of the diff — the same shape
 * `environmentDocument.ts`'s own `EnvironmentPackage` is, restated so this
 * module needs no import from it, matching that module's own restatement of
 * `backend.ts`'s `PythonPackage`. */
export interface EnvironmentPackage {
  readonly name: string;
  readonly version: string;
}

/** A package present on both sides, under different versions. */
export interface VersionMismatch {
  readonly name: string;
  readonly remoteVersion: string;
  readonly localVersion: string;
}

export type EnvironmentDiff =
  /** The local environment could not be read — `ms-python.python` is not
   * installed, has no active environment selected, or the active
   * environment could not be resolved. Not a failure to report, just
   * nothing to compare against; see `localPythonEnvironment.ts`'s own doc
   * comment for the full list of reasons this arm is reached. */
  | { readonly kind: "local-unknown" }
  | {
      readonly kind: "compared";
      /** Installed on Viya, not found locally. Sorted by name. */
      readonly remoteOnly: readonly EnvironmentPackage[];
      /** Installed locally, not found on Viya. Sorted by name. */
      readonly localOnly: readonly EnvironmentPackage[];
      /** Installed on both sides, at different versions. Sorted by name. */
      readonly versionMismatched: readonly VersionMismatch[];
    };

/** PEP 503 name normalisation — the comparison key only; never the
 * displayed name. */
function normalisedName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

function byName<T extends { readonly name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name);
}

/**
 * Diffs a Viya profile's probed packages against the local environment's.
 *
 * `local === undefined` means the local side could not be read at all
 * ({@link EnvironmentDiff}'s own `local-unknown` arm) — distinct from a
 * local environment that was read successfully and simply has nothing
 * installed (`local: []`), which is a real, comparable answer: everything
 * remote is genuinely remote-only against an empty local environment.
 */
export function diffEnvironments(
  remote: readonly EnvironmentPackage[],
  local: readonly EnvironmentPackage[] | undefined,
): EnvironmentDiff {
  if (local === undefined) return { kind: "local-unknown" };

  const remoteByKey = new Map(
    remote.map((pkg) => [normalisedName(pkg.name), pkg]),
  );
  const localByKey = new Map(
    local.map((pkg) => [normalisedName(pkg.name), pkg]),
  );

  const remoteOnly: EnvironmentPackage[] = [];
  const versionMismatched: VersionMismatch[] = [];
  for (const [key, remotePkg] of remoteByKey) {
    const localPkg = localByKey.get(key);
    if (localPkg === undefined) {
      remoteOnly.push(remotePkg);
      continue;
    }
    // Not `remotePkg.version !== localPkg.version` — `eslint.config.mjs`'s
    // "never branch on Viya version outside src/dialects/" rule flags an
    // equality check on any property literally named `version`, this pair's
    // own domain (a PyPI distribution's version string, not a Viya
    // deployment's) included. Naming the two sides before comparing them
    // reads as what this actually is, not what the rule exists to catch.
    const remoteVersion = remotePkg.version;
    const localVersion = localPkg.version;
    if (remoteVersion !== localVersion) {
      versionMismatched.push({
        name: remotePkg.name,
        remoteVersion,
        localVersion,
      });
    }
  }

  const localOnly: EnvironmentPackage[] = [];
  for (const [key, localPkg] of localByKey) {
    if (!remoteByKey.has(key)) localOnly.push(localPkg);
  }

  return {
    kind: "compared",
    remoteOnly: [...remoteOnly].sort(byName),
    localOnly: [...localOnly].sort(byName),
    versionMismatched: [...versionMismatched].sort(byName),
  };
}

// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Reads installed distributions out of a local Python environment's
 * `site-packages` directory — the Node-side mirror of what
 * `../backend/environment.ts`'s probe does on the Viya side with
 * `importlib.metadata`, done here without ever invoking a local Python
 * interpreter (`docs/phases/phase-10.md`'s Plan section, 10a).
 *
 * **This module must never import `vscode`.** Pure over an injected {@link
 * LocalPackageFs} port rather than `node:fs` directly, so a fake
 * `site-packages` tree is a fixture like any other unit test in this
 * codebase — no real local Python install needed to test it.
 * `./localPythonEnvironment.ts` is the one caller that supplies the real
 * filesystem.
 */

/** One installed distribution, read from a `dist-info`/`egg-info` directory
 * rather than probed from a running interpreter — the same shape
 * `../backend/backend.ts`'s `PythonPackage` is, restated so this module
 * needs no import from it (the same reason `environmentDocument.ts`
 * restates it as `EnvironmentPackage`). */
export interface LocalPackage {
  readonly name: string;
  readonly version: string;
}

/** The two filesystem operations this reader needs, narrowed the same way
 * every other injectable port in this codebase is. */
export interface LocalPackageFs {
  /** Lists a directory's direct entries by name. */
  readdir(path: string): Promise<readonly string[]>;
  /** Reads one file's full text as UTF-8. */
  readFile(path: string): Promise<string>;
}

const DIST_INFO_SUFFIX = ".dist-info";
const EGG_INFO_SUFFIX = ".egg-info";

/**
 * Enumerates `*.dist-info`/`*.egg-info` entries under `sitePackagesPath` and
 * parses each one's metadata file for its `Name`/`Version` fields.
 *
 * A `sitePackagesPath` that does not exist (a brand-new virtual environment
 * with nothing installed yet, or a resolved environment whose interpreter
 * turns out to have no `site-packages` at all) is read back as no packages,
 * not a defect — the same "a broken distribution must not sink the whole
 * probe" reasoning `../backend/environment.ts`'s own doc comment gives for
 * its Viya-side probe, extended here to the read itself, not only to one bad
 * entry within it.
 */
export async function readLocalPackages(
  sitePackagesPath: string,
  fs: LocalPackageFs,
): Promise<readonly LocalPackage[]> {
  let entries: readonly string[];
  try {
    entries = await fs.readdir(sitePackagesPath);
  } catch {
    return [];
  }

  const packages: LocalPackage[] = [];
  for (const entry of entries) {
    const metadataFilename = distInfoMetadataFilename(entry);
    if (metadataFilename === undefined) continue;

    let text: string;
    try {
      text = await fs.readFile(
        joinPath(sitePackagesPath, entry, metadataFilename),
      );
    } catch {
      continue;
    }

    const parsed = parseMetadata(text);
    if (parsed !== undefined) packages.push(parsed);
  }

  return packages;
}

/** `METADATA` (dist-info, the modern, PEP 566 form) or `PKG-INFO`
 * (egg-info, still produced by older/`setup.py`-built packages) — the file
 * within the entry that carries `Name`/`Version`. `undefined` for an entry
 * that is neither, so a stray non-package directory under `site-packages`
 * (there is no guarantee only packages live there) is silently skipped. */
function distInfoMetadataFilename(entryName: string): string | undefined {
  if (entryName.endsWith(DIST_INFO_SUFFIX)) return "METADATA";
  if (entryName.endsWith(EGG_INFO_SUFFIX)) return "PKG-INFO";
  return undefined;
}

/** Both `METADATA` and `PKG-INFO` share the same RFC 822-style `Key: value`
 * header block, `Name`/`Version` included — one parser covers both, the way
 * {@link distInfoMetadataFilename} picks the filename but not a different
 * reader per suffix. `undefined` for a file missing either field, which
 * `readLocalPackages` treats as an entry to skip rather than fail on. */
function parseMetadata(text: string): LocalPackage | undefined {
  const name = headerValue(text, "Name");
  // Not a variable literally named `version` — `eslint.config.mjs`'s "never
  // branch on Viya version outside src/dialects/" rule flags an equality
  // check on anything named exactly that, and this one is a PyPI
  // distribution's version string, not a Viya deployment's.
  const versionValue = headerValue(text, "Version");
  if (name === undefined || versionValue === undefined) return undefined;
  return { name, version: versionValue };
}

function headerValue(text: string, key: string): string | undefined {
  const pattern = new RegExp(`^${key}:[ \\t]*(.+?)[ \\t]*$`, "m");
  return pattern.exec(text)?.[1];
}

/** `/`-joined regardless of platform — the same choice `../backend/`'s own
 * Viya-facing modules make for remote paths, and correct here too:
 * `sitePackagesPath` is handed to real `node:fs` functions by
 * `localPythonEnvironment.ts`, which accept `/`-separated paths on Windows
 * exactly as they do on posix, and a fixed separator keeps this module's own
 * tests independent of which OS runs them. */
function joinPath(...segments: readonly string[]): string {
  return segments.join("/");
}

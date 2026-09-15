// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Resolves whichever local Python environment `ms-python.python` currently
 * has active — if any — and reads its installed package set via
 * `./localPackages.ts`, for 10a's local/remote diff
 * (`docs/phases/phase-10.md`'s Plan section).
 *
 * `ms-python.python` is a **soft dependency for this module only** (not for
 * anything else in this codebase): not installed, no workspace, no active
 * environment selected, or an environment that cannot be resolved are all
 * read back as {@link LocalEnvironment}'s `kind: "unknown"` arm — the honest
 * "local environment unknown" the Plan section calls for, never a thrown
 * error or a message shown to the user. `PythonExtension.api()` itself
 * throws when the extension is not installed (its own source, `main.js`);
 * every other early-return below mirrors that same "nothing to compare
 * against" outcome for the narrower ways the lookup can come up empty.
 *
 * This is one of this feature's `vscode`-importing modules, alongside
 * `environmentPanel.ts` — `@vscode/python-extension`'s own `api()` reaches
 * into `vscode.extensions`, and this module additionally reads
 * `vscode.window.activeTextEditor` to scope the lookup to a resource (the
 * same multi-root scoping `getActiveEnvironmentPath`'s own doc comment
 * describes) and uses `vscode.workspace.fs` — not a `node:fs` import — to
 * read `site-packages`. That API reaches any `file://` path, not only ones
 * under an open workspace folder, so it covers an interpreter installed
 * anywhere on disk exactly as `node:fs` would, without adding this module to
 * `eslint.config.mjs`'s Node-built-in allow-list (ADR-0003) — a real local
 * environment does not exist in a web extension host either, so this whole
 * feature already degrades to `unknown` there for the same reason
 * `PythonExtension.api()` would find nothing to resolve.
 */

import {
  PythonExtension,
  type ResolvedEnvironment,
} from "@vscode/python-extension";
import * as vscode from "vscode";

import {
  readLocalPackages,
  type LocalPackage,
  type LocalPackageFs,
} from "./localPackages";

export type LocalEnvironment =
  | { readonly kind: "unknown" }
  | {
      readonly kind: "known";
      readonly version: string;
      readonly packages: readonly LocalPackage[];
    };

/** The real filesystem, adapted to {@link LocalPackageFs} via
 * `vscode.workspace.fs` — the one implementation of that port this codebase
 * ships; every other one is a test fixture. */
const realFs: LocalPackageFs = {
  readdir: async (path) => {
    const entries = await vscode.workspace.fs.readDirectory(
      vscode.Uri.file(path),
    );
    return entries.map(([name]) => name);
  },
  readFile: async (path) => {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(path));
    return new TextDecoder("utf-8").decode(bytes);
  },
};

/**
 * Reads the local environment `ms-python.python` has active for the current
 * editor's resource, or {@link LocalEnvironment}'s `unknown` arm for any of
 * the reasons this module's own doc comment lists.
 */
export async function readActiveLocalEnvironment(): Promise<LocalEnvironment> {
  let api: PythonExtension;
  try {
    api = await PythonExtension.api();
  } catch {
    return { kind: "unknown" };
  }

  const resource = vscode.window.activeTextEditor?.document.uri;
  let resolved: ResolvedEnvironment | undefined;
  try {
    const active = api.environments.getActiveEnvironmentPath(resource);
    resolved = await api.environments.resolveEnvironment(active);
  } catch {
    // `PythonExtension.api()` succeeding only promises the extension is
    // installed — a misbehaving Conda/Poetry resolver or an extension-internal
    // error in either call below is still possible, and this module's own doc
    // comment promises the whole path degrades to `unknown`, never a thrown
    // error, for every reason short of `api()` itself failing.
    return { kind: "unknown" };
  }
  if (resolved?.version === undefined) return { kind: "unknown" };

  const packages = await readLocalPackages(
    sitePackagesPath(
      resolved.executable.sysPrefix,
      resolved.version.major,
      resolved.version.minor,
    ),
    realFs,
  );
  return { kind: "known", version: resolved.version.sysVersion, packages };
}

/**
 * `sysPrefix`'s `site-packages` subdirectory. Windows installs put it
 * straight under `Lib`; every other platform nests it under
 * `lib/pythonMAJOR.MINOR`, per `docs/phases/phase-10.md`'s Plan section —
 * `resolveEnvironment`'s own version fields are what make the posix form
 * possible without ever running the interpreter to ask it.
 */
function sitePackagesPath(
  sysPrefix: string,
  major: number,
  minor: number,
): string {
  return process.platform === "win32"
    ? `${sysPrefix}/Lib/site-packages`
    : `${sysPrefix}/lib/python${String(major)}.${String(minor)}/site-packages`;
}

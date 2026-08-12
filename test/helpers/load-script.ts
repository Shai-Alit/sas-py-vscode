// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import * as path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Imports one of the repository's `scripts/*.mjs` build tools.
 *
 * Three awkward details, all of them forced:
 *
 *   1. The tests compile to CommonJS under `out/`, so a static
 *      `import "../../scripts/x.mjs"` would be emitted verbatim and resolved
 *      relative to `out/test/unit/` at runtime — against a `scripts/` directory
 *      that does not exist there. The specifier has to be built from the real
 *      repository root.
 *   2. A dynamic import needs a `file://` URL, not a path. On Windows a bare
 *      `C:\…` specifier is read as a URL with the scheme `c:`.
 *   3. The result is `any`, because the scripts have no type declarations. The
 *      caller supplies the shape it expects, which is a claim the test then
 *      exercises — an import that has quietly stopped exporting something fails
 *      on the assertion rather than at the boundary.
 *
 * Each script guards its entry point on `process.argv[1]`, so importing one
 * here loads its functions without running it.
 */
export async function loadScript<T>(fileName: string): Promise<T> {
  // `out/test/helpers/` → repository root.
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  const specifier = pathToFileURL(
    path.join(repoRoot, "scripts", fileName),
  ).href;
  return (await import(specifier)) as T;
}

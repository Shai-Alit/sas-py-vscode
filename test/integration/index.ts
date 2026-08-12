// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0
//
// Structure follows: client/test/index.ts in sassoftware/vscode-sas-extension
// (Apache-2.0). No code was copied — file discovery uses Node's own recursive
// `readdir` rather than a `glob` dependency, and an empty result is treated as
// a failure rather than a pass.
//
// No SAS copyright line is added here, and none was dropped: the upstream file
// carries no copyright header at all. Adding one would misattribute authorship.
// See CONTRIBUTING.md, "Declare any relationship to upstream code".

import { readdirSync } from "node:fs";
import * as path from "node:path";

import Mocha from "mocha";

/**
 * The inner half of the integration tier. VS Code calls this after the window
 * is up, so `require("vscode")` resolves here and does not in `runTest.ts`.
 *
 * Mocha is driven through its API rather than its CLI because there is no CLI
 * inside the extension host — the process was started by VS Code, not by us.
 */
/**
 * Finds every compiled integration test under `root`, at any depth, as paths
 * relative to `root`.
 *
 * `readdirSync`'s `recursive` option really does walk the tree — it landed in
 * Node 20.1, and `engines.node` here is `>=20.19.0`, so it cannot be reached by
 * a runtime without it. This is worth stating because it is not universally
 * known: the option has been reported twice as a no-op that silently skips
 * nested suites. `test/unit/integration-discovery.test.ts` proves otherwise
 * against real nested directories, which is the only form of that argument
 * worth having.
 *
 * Exported for that test. It does not import `vscode`, so the unit tier can
 * load it; the rest of this module cannot be tested outside a real editor.
 */
export function discoverTestFiles(root: string): string[] {
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".test.js"))
    .sort();
}

export async function run(): Promise<void> {
  const testsRoot = __dirname;

  const files = discoverTestFiles(testsRoot);

  // The unit tier gets this from Mocha's `--fail-zero`; the API has no such
  // flag, and a runner that finds nothing must not report success.
  if (files.length === 0) {
    throw new Error(
      `No integration tests found under ${testsRoot}. Either the compile step did not run, or the discovery pattern no longer matches the file layout.`,
    );
  }

  const mocha = new Mocha({
    ui: "bdd",
    color: true,

    // Far longer than the unit tier's two seconds, and for a reason that does
    // not apply there: the first assertion may be waiting on extension
    // activation and on a window that is still painting.
    timeout: 20_000,
  });

  for (const file of files) {
    mocha.addFile(path.resolve(testsRoot, file));
  }

  const failures = await new Promise<number>((resolve) => {
    mocha.run(resolve);
  });

  if (failures > 0) {
    throw new Error(`${String(failures)} integration test(s) failed.`);
  }
}

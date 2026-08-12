// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0
//
// Modified from the original: the structure of this runner follows
// `client/test/index.ts` in sassoftware/vscode-sas-extension (Apache-2.0). File
// discovery uses Node's own recursive `readdir` rather than a `glob`
// dependency, and an empty result is treated as a failure rather than a pass.

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
export async function run(): Promise<void> {
  const testsRoot = __dirname;

  const files = readdirSync(testsRoot, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".test.js"))
    .sort();

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

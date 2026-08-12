// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import * as path from "node:path";

/**
 * The extension's marketplace identity, read from `package.json` rather than
 * written down here.
 *
 * VS Code addresses extensions as `<publisher>.<name>`, and the publisher id is
 * still provisional (see the note in `package.json`). A hard-coded string would
 * pass today and fail the day it is confirmed, with a failure message pointing
 * at the test rather than at the rename.
 */
export function extensionId(): string {
  const manifestPath = path.resolve(__dirname, "../../../package.json");
  const manifest: unknown = JSON.parse(
    readFileSync(manifestPath, "utf8"),
  ) as unknown;

  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("publisher" in manifest) ||
    !("name" in manifest) ||
    typeof manifest.publisher !== "string" ||
    typeof manifest.name !== "string"
  ) {
    throw new Error(
      `${manifestPath} has no string "publisher" and "name" — the extension has no identity to test against.`,
    );
  }

  return `${manifest.publisher}.${manifest.name}`;
}

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

/**
 * The JSON-schema `pattern` the settings editor applies to a profile endpoint.
 *
 * Navigated rather than hard-coded, and loudly broken if the manifest is
 * restructured: a test that silently stops finding the thing it guards is worse
 * than no test, because it keeps reporting success.
 */
export function endpointSchemaPattern(): RegExp {
  const manifestPath = path.resolve(__dirname, "../../../package.json");
  const manifest: unknown = JSON.parse(
    readFileSync(manifestPath, "utf8"),
  ) as unknown;

  const path_ = [
    "contributes",
    "configuration",
    "properties",
    "pythonOnViya.connectionProfiles",
    "additionalProperties",
    "properties",
    "endpoint",
    "pattern",
  ];

  let cursor: unknown = manifest;
  for (const key of path_) {
    if (typeof cursor !== "object" || cursor === null) {
      cursor = undefined;
      break;
    }
    cursor = (cursor as Record<string, unknown>)[key];
  }
  const pattern = cursor;

  if (typeof pattern !== "string") {
    throw new Error(
      `${manifestPath} no longer has contributes.configuration.properties["pythonOnViya.connectionProfiles"].additionalProperties.properties.endpoint.pattern — ` +
        `the schema moved, and this test can no longer prove it agrees with normaliseEndpoint.`,
    );
  }

  return new RegExp(pattern);
}

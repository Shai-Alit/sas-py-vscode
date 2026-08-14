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
 * The manifest's declared activation events.
 *
 * Read rather than assumed, and thrown on if the key is missing entirely: an
 * absent `activationEvents` is exactly the state this is here to catch, so
 * defaulting it to `[]` would turn the failure into a pass.
 */
export function activationEvents(): readonly string[] {
  const manifestPath = path.resolve(__dirname, "../../../package.json");
  const manifest: unknown = JSON.parse(
    readFileSync(manifestPath, "utf8"),
  ) as unknown;

  const events =
    typeof manifest === "object" && manifest !== null
      ? (manifest as Record<string, unknown>).activationEvents
      : undefined;

  if (!Array.isArray(events) || events.some((e) => typeof e !== "string")) {
    throw new Error(
      `${manifestPath} has no "activationEvents" array of strings — a reloaded window would never activate the extension, and no signed-in account would come back.`,
    );
  }

  return events as readonly string[];
}

/**
 * The Node version range the manifest says this extension needs.
 *
 * Read rather than repeated, so a test comparing it against the runtime cannot
 * quietly go on passing after the declared floor moves.
 */
export function declaredNodeEngine(): string {
  const manifestPath = path.resolve(__dirname, "../../../package.json");
  const manifest: unknown = JSON.parse(
    readFileSync(manifestPath, "utf8"),
  ) as unknown;

  const engines =
    typeof manifest === "object" && manifest !== null
      ? (manifest as Record<string, unknown>).engines
      : undefined;
  const node =
    typeof engines === "object" && engines !== null
      ? (engines as Record<string, unknown>).node
      : undefined;

  if (typeof node !== "string") {
    throw new Error(
      `${manifestPath} has no "engines.node" string — nothing records which runtime the code in src/ is allowed to assume.`,
    );
  }

  return node;
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

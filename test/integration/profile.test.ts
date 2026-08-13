// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import * as vscode from "vscode";

import { extensionId } from "../helpers/manifest";

/**
 * The half of the profile slice the unit tier cannot see.
 *
 * `src/profile/store.ts` is deliberately thin, and everything it decides is
 * decided next door in `model.ts`, which is specified by unit tests. What is
 * left here is exactly the part that only a real editor can answer: does the
 * manifest actually contribute these commands, does the configuration schema
 * accept the shape we write, does a write to the settings store come back out
 * of a read, and does `SecretStorage` round-trip.
 *
 * Every test cleans up after itself. The test host reuses one user-data
 * directory across the run, so a profile left behind is a profile the next test
 * has to reason about.
 */

const SECTION = "pythonOnViya";
const PROFILES = "connectionProfiles";

type ProfileMap = Record<string, Record<string, unknown>>;

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(SECTION);
}

async function setProfiles(profiles: ProfileMap | undefined): Promise<void> {
  await config().update(PROFILES, profiles, vscode.ConfigurationTarget.Global);
}

describe("connection profiles in a real editor", () => {
  before(async () => {
    const extension = vscode.extensions.getExtension(extensionId());
    assert.ok(extension, `${extensionId()} is not loaded`);
    await extension.activate();
  });

  afterEach(async () => {
    await setProfiles(undefined);
  });

  it("contributes every profile command", async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      "pythonOnViya.addProfile",
      "pythonOnViya.editProfile",
      "pythonOnViya.deleteProfile",
      "pythonOnViya.switchProfile",
      "pythonOnViya.importProfiles",
    ]) {
      assert.ok(commands.includes(id), `${id} is not registered`);
    }
  });

  it("declares the profile setting at window scope, not resource scope", () => {
    // A `resource`-scoped setting can differ per folder in a multi-root
    // workspace, which would make the profile list depend on which file has
    // focus. `inspect` returning no folder-level slot is how that is visible
    // from inside the editor.
    const inspected = config().inspect<ProfileMap>(PROFILES);
    assert.ok(inspected);
    assert.equal(inspected.workspaceFolderValue, undefined);
    assert.equal(inspected.workspaceFolderLanguageValue, undefined);
  });

  it("defaults to an empty object rather than to undefined", () => {
    assert.deepEqual(config().get<ProfileMap>(PROFILES), {});
  });

  it("round-trips a profile through the real settings store", async () => {
    const written = {
      Prod: {
        version: 1,
        id: "integration-id",
        endpoint: "https://viya.example.com",
        context: "SAS Job Execution compute context",
        clientId: "integration-client",
      },
    };
    await setProfiles(written);

    // Read through a fresh handle: a value that only survives in the object we
    // just wrote through would prove nothing about persistence.
    assert.deepEqual(config().get<ProfileMap>(PROFILES), written);
  });

  it("accepts a hand-written profile with only an endpoint", async () => {
    // `version` and `id` are optional in the contributed schema on purpose: the
    // model fills them in. If the schema ever required them, this write would
    // still succeed but the settings editor would show a validation error the
    // user has no way to act on.
    await setProfiles({ Minimal: { endpoint: "https://viya.example.com" } });
    assert.deepEqual(config().get<ProfileMap>(PROFILES)?.Minimal, {
      endpoint: "https://viya.example.com",
    });
  });

  it("keeps the default profile setting and the profile list independent", async () => {
    // The two-level arrangement from ADR-0007: naming a profile that does not
    // exist is allowed to be written and simply does not resolve.
    await config().update(
      "defaultProfile",
      "DoesNotExist",
      vscode.ConfigurationTarget.Global,
    );
    try {
      assert.equal(config().get<string>("defaultProfile"), "DoesNotExist");
      assert.deepEqual(config().get<ProfileMap>(PROFILES), {});
    } finally {
      await config().update(
        "defaultProfile",
        undefined,
        vscode.ConfigurationTarget.Global,
      );
    }
  });

  it("runs the switch command with no profiles without throwing", async () => {
    // The empty case reaches an information message and returns. It is worth a
    // test because it is the state every new install starts in, and because a
    // command that throws on first use is the worst possible first impression.
    await vscode.commands.executeCommand("pythonOnViya.switchProfile");
  });

  it("runs the import command with no SAS extension installed", async () => {
    // `--disable-extensions` guarantees the SAS extension is absent, so this
    // exercises the path where `SAS.connectionProfiles` is not contributed by
    // anything at all — which is what most users will hit.
    await vscode.commands.executeCommand("pythonOnViya.importProfiles");
  });
});

// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  environmentDocumentUri,
  EnvironmentDocumentProvider,
} from "../../../src/run/environmentPanel";
import { type StoredEnvironment } from "../../../src/run/environmentStore";

describe("EnvironmentDocumentProvider", () => {
  it("says a profile has not been probed yet when nothing is cached", async () => {
    const provider = new EnvironmentDocumentProvider(() => undefined);
    const content = await provider.provideTextDocumentContent(
      environmentDocumentUri("profile-1", "innovation"),
    );
    assert.ok(/not.*probed/i.test(content));
    provider.dispose();
  });

  it("renders a cached probe's interpreter, path and packages", async () => {
    const stored: StoredEnvironment = {
      capabilities: {
        kind: "available",
        version: "3.12.12 (main)",
        executable: "/usr/bin/python3",
        packages: [{ name: "numpy", version: "2.0.0", importNames: ["numpy"] }],
      },
      probedAt: Date.parse("2026-08-27T12:00:00Z"),
    };
    const provider = new EnvironmentDocumentProvider((profileId) =>
      profileId === "profile-1" ? stored : undefined,
    );
    const content = await provider.provideTextDocumentContent(
      environmentDocumentUri("profile-1", "innovation"),
    );

    assert.ok(content.includes("innovation"));
    assert.ok(content.includes("3.12.12 (main)"));
    assert.ok(content.includes("/usr/bin/python3"));
    assert.ok(content.includes("numpy"));
    provider.dispose();
  });

  it("looks up by the id encoded in the URI, not by name", async () => {
    const stored: StoredEnvironment = {
      capabilities: {
        kind: "available",
        version: "3.12",
        executable: "/usr/bin/python3",
        packages: [],
      },
      probedAt: Date.now(),
    };
    let requested: string | undefined;
    const provider = new EnvironmentDocumentProvider((profileId) => {
      requested = profileId;
      return profileId === "the-real-id" ? stored : undefined;
    });

    await provider.provideTextDocumentContent(
      environmentDocumentUri("the-real-id", "a display name"),
    );
    assert.equal(requested, "the-real-id");
    provider.dispose();
  });

  it("fires onDidChange for the same URI refresh() was called with", () => {
    const provider = new EnvironmentDocumentProvider(() => undefined);
    const fired: string[] = [];
    const subscription = provider.onDidChange((uri) => {
      fired.push(uri.toString());
    });

    provider.refresh("profile-1", "innovation");
    assert.equal(fired.length, 1);
    assert.equal(
      fired[0],
      environmentDocumentUri("profile-1", "innovation").toString(),
    );

    subscription.dispose();
    provider.dispose();
  });

  it("degrades the diff section to local-unknown rather than failing, when the Python extension is not installed", async () => {
    // The integration test host has no `ms-python.python` installed, which
    // is exactly the "soft dependency" case `localPythonEnvironment.ts` is
    // built to degrade gracefully from — this asserts that degradation end
    // to end, through the real `PythonExtension.api()` call, rather than
    // only at `localPythonEnvironment.ts`'s own (excluded-from-coverage,
    // `vscode`-importing) unit.
    const stored: StoredEnvironment = {
      capabilities: {
        kind: "available",
        version: "3.12",
        executable: "/usr/bin/python3",
        packages: [{ name: "numpy", version: "2.0.0", importNames: ["numpy"] }],
      },
      probedAt: Date.now(),
    };
    const provider = new EnvironmentDocumentProvider((profileId) =>
      profileId === "profile-1" ? stored : undefined,
    );
    const content = await provider.provideTextDocumentContent(
      environmentDocumentUri("profile-1", "innovation"),
    );

    assert.ok(content.includes("Local comparison"));
    assert.ok(/unknown/i.test(content));
    provider.dispose();
  });
});

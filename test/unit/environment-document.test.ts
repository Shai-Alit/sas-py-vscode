// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  renderEnvironmentDocument,
  type EnvironmentDocumentLabels,
} from "../../src/run/environmentDocument";
import { type EnvironmentDiff } from "../../src/run/environmentDiff";

const labels: EnvironmentDocumentLabels = {
  title: "Python on Viya — environment",
  profileLabel: "Profile",
  probedLabel: "Probed",
  interpreterLabel: "Interpreter",
  executableLabel: "Executable",
  packagesHeading: (count) => `${String(count)} installed packages:`,
  noPackages: "No packages were reported.",
  diff: {
    heading: "Local comparison",
    localUnknown: "The local Python environment is unknown.",
    remoteOnlyHeading: (count) => `${String(count)} only on Viya:`,
    localOnlyHeading: (count) => `${String(count)} only local:`,
    versionMismatchedHeading: (count) => `${String(count)} different versions:`,
    noneInBucket: "(none)",
  },
};

const localUnknownDiff: EnvironmentDiff = { kind: "local-unknown" };

describe("environmentDocument.ts — the Show environment document body", () => {
  it("names the profile, when it was probed, the interpreter and its path", () => {
    const text = renderEnvironmentDocument(
      "innovation",
      "27 Aug 2026, 11:30",
      {
        version: "3.12.12 (main)",
        executable: "/opt/sas/viya/home/sas-pyconfig/default_py/bin/python3",
        packages: [{ name: "numpy", version: "2.0.0" }],
      },
      localUnknownDiff,
      labels,
    );

    assert.ok(text.includes("Profile: innovation"));
    assert.ok(text.includes("Probed: 27 Aug 2026, 11:30"));
    assert.ok(text.includes("Interpreter: 3.12.12 (main)"));
    assert.ok(
      text.includes(
        "Executable: /opt/sas/viya/home/sas-pyconfig/default_py/bin/python3",
      ),
    );
  });

  it("counts packages in the heading and lists each one", () => {
    const text = renderEnvironmentDocument(
      "innovation",
      "27 Aug 2026, 11:30",
      {
        version: "3.12",
        executable: "/usr/bin/python3",
        packages: [
          { name: "numpy", version: "2.0.0" },
          { name: "pandas", version: "3.0.0" },
        ],
      },
      localUnknownDiff,
      labels,
    );

    assert.ok(text.includes("2 installed packages:"));
    assert.ok(/numpy\s+2\.0\.0/.test(text));
    assert.ok(/pandas\s+3\.0\.0/.test(text));
  });

  it("uses the no-packages label for an empty list, not a blank section", () => {
    const text = renderEnvironmentDocument(
      "innovation",
      "27 Aug 2026, 11:30",
      { version: "3.12", executable: "/usr/bin/python3", packages: [] },
      localUnknownDiff,
      labels,
    );

    assert.ok(text.includes("0 installed packages:"));
    assert.ok(text.includes("No packages were reported."));
  });

  it("aligns package names to the longest one in the list", () => {
    const text = renderEnvironmentDocument(
      "innovation",
      "27 Aug 2026, 11:30",
      {
        version: "3.12",
        executable: "/usr/bin/python3",
        packages: [
          { name: "a", version: "1.0" },
          { name: "a-much-longer-package-name", version: "2.0" },
        ],
      },
      localUnknownDiff,
      labels,
    );

    const shortLine = text
      .split("\n")
      .find((line) => line.trimStart().startsWith("a "));
    const longLine = text
      .split("\n")
      .find((line) => line.includes("a-much-longer-package-name"));
    assert.ok(shortLine !== undefined && longLine !== undefined);
    // Each version starts at the same column within its own line — both
    // names are padded out to the longest name's width.
    assert.equal(shortLine.indexOf("1.0"), longLine.indexOf("2.0"));
  });

  it("shows the local-unknown label instead of the three buckets when the local side was never read", () => {
    const text = renderEnvironmentDocument(
      "innovation",
      "27 Aug 2026, 11:30",
      { version: "3.12", executable: "/usr/bin/python3", packages: [] },
      localUnknownDiff,
      labels,
    );

    assert.ok(text.includes("Local comparison"));
    assert.ok(text.includes("The local Python environment is unknown."));
    assert.ok(!text.includes("only on Viya"));
  });

  it("renders all three diff buckets, with each empty bucket showing the none label", () => {
    const text = renderEnvironmentDocument(
      "innovation",
      "27 Aug 2026, 11:30",
      { version: "3.12", executable: "/usr/bin/python3", packages: [] },
      {
        kind: "compared",
        remoteOnly: [{ name: "sas-kernel", version: "1.0.0" }],
        localOnly: [],
        versionMismatched: [
          { name: "pandas", remoteVersion: "3.0.0", localVersion: "2.1.0" },
        ],
      },
      labels,
    );

    assert.ok(text.includes("1 only on Viya:"));
    assert.ok(/sas-kernel\s+1\.0\.0/.test(text));
    assert.ok(text.includes("0 only local:"));
    assert.ok(text.includes("1 different versions:"));
    assert.ok(/pandas\s+3\.0\.0 → 2\.1\.0/.test(text));

    const bucketLines = text
      .split("\n")
      .filter((line) => line.trim() === "(none)");
    assert.equal(bucketLines.length, 1);
  });

  it("shows the none label for the version-mismatched bucket too, when it is the only one empty", () => {
    const text = renderEnvironmentDocument(
      "innovation",
      "27 Aug 2026, 11:30",
      { version: "3.12", executable: "/usr/bin/python3", packages: [] },
      {
        kind: "compared",
        remoteOnly: [],
        localOnly: [],
        versionMismatched: [],
      },
      labels,
    );

    assert.ok(text.includes("0 different versions:"));
    const bucketLines = text
      .split("\n")
      .filter((line) => line.trim() === "(none)");
    assert.equal(bucketLines.length, 3);
  });
});

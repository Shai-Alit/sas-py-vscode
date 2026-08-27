// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  renderEnvironmentDocument,
  type EnvironmentDocumentLabels,
} from "../../src/run/environmentDocument";

const labels: EnvironmentDocumentLabels = {
  title: "Python on Viya — environment",
  profileLabel: "Profile",
  probedLabel: "Probed",
  interpreterLabel: "Interpreter",
  executableLabel: "Executable",
  packagesHeading: (count) => `${String(count)} installed packages:`,
  noPackages: "No packages were reported.",
};

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
});

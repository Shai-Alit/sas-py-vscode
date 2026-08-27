// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Renders a successful stage-2 probe as the plain-text content of the
 * `Python on Viya: Show environment` virtual document.
 *
 * **This module must never import `vscode`.** Same l10n-boundary discipline
 * `resultPanelDom.ts` and `render.ts` follow: every English word a person
 * reads arrives already translated, as a label the caller (`commands.ts`,
 * which does import `vscode`) supplies — this module only arranges them and
 * the data around them.
 *
 * Plain text, not Markdown: this slice's own design discussion (`STATUS.md`,
 * 3e's Runbook entry) settled on a read-only virtual document specifically
 * for its editor affordances — search, split view — over a webview's extra
 * polish and cost, and Markdown buys nothing further on top of that choice: a
 * package list is a list, not prose, and an evenly columned plain-text table
 * is easier to scan than bullet syntax would be.
 */

/** One installed distribution — the same shape `backend.ts`'s
 * `PythonPackage` is, restated so this module needs no import from it. */
export interface EnvironmentPackage {
  readonly name: string;
  readonly version: string;
}

/** What {@link renderEnvironmentDocument} needs to have run — the successful
 * arm of `RuntimeCapabilities`, restated the same way {@link
 * EnvironmentPackage} is. */
export interface EnvironmentSnapshot {
  readonly version: string;
  readonly executable: string;
  readonly packages: readonly EnvironmentPackage[];
}

/** Every English string this module needs, already translated by the caller. */
export interface EnvironmentDocumentLabels {
  readonly title: string;
  readonly profileLabel: string;
  readonly probedLabel: string;
  readonly interpreterLabel: string;
  readonly executableLabel: string;
  /** `count` is the number of packages, already known to the caller — this
   * function does not count them itself, so a label like "{0} installed
   * packages" only has to be built once. */
  readonly packagesHeading: (count: number) => string;
  readonly noPackages: string;
}

/**
 * Builds the document's full text.
 *
 * `probedAtDisplay` is a caller-formatted date/time string, not a timestamp —
 * `Intl.DateTimeFormat` needs `vscode.env.language` to match the rest of the
 * UI (the same reasoning `resultPanel.ts` gives for reading it rather than
 * hard-coding a locale), which this module cannot do without importing
 * `vscode`.
 */
export function renderEnvironmentDocument(
  profileName: string,
  probedAtDisplay: string,
  snapshot: EnvironmentSnapshot,
  labels: EnvironmentDocumentLabels,
): string {
  const lines: string[] = [
    labels.title,
    "=".repeat(labels.title.length),
    "",
    `${labels.profileLabel}: ${profileName}`,
    `${labels.probedLabel}: ${probedAtDisplay}`,
    "",
    `${labels.interpreterLabel}: ${snapshot.version}`,
    `${labels.executableLabel}: ${snapshot.executable}`,
    "",
    labels.packagesHeading(snapshot.packages.length),
    "",
  ];

  if (snapshot.packages.length === 0) {
    lines.push(labels.noPackages);
  } else {
    const nameWidth = Math.max(
      ...snapshot.packages.map((pkg) => pkg.name.length),
    );
    for (const pkg of snapshot.packages) {
      lines.push(`  ${pkg.name.padEnd(nameWidth + 2)}${pkg.version}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

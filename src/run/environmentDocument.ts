// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Renders a successful stage-2 probe — plus, since Phase 10's 10a slice, a
 * diff against the local Python environment — as the plain-text content of
 * the `Python on Viya: Show environment` virtual document.
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
 * is easier to scan than bullet syntax would be. `docs/phases/phase-10.md`'s
 * Plan section reaffirms that reasoning for 10a's own addition rather than
 * reopening it — the diff below is one more list, appended as its own
 * section, not a reason to switch documents.
 */

import { type EnvironmentDiff } from "./environmentDiff";

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
  /** 10a's diff section, appended below the package list. */
  readonly diff: EnvironmentDiffLabels;
}

/** Every English string {@link renderEnvironmentDocument}'s diff section
 * needs, already translated by the caller — same discipline as the rest of
 * {@link EnvironmentDocumentLabels}. */
export interface EnvironmentDiffLabels {
  readonly heading: string;
  /** Shown in place of the three buckets below when
   * `EnvironmentDiff.kind === "local-unknown"` — `ms-python.python` is not
   * installed, has no active environment, or it could not be resolved. */
  readonly localUnknown: string;
  readonly remoteOnlyHeading: (count: number) => string;
  readonly localOnlyHeading: (count: number) => string;
  readonly versionMismatchedHeading: (count: number) => string;
  /** Shown for a bucket with nothing in it, in place of an empty list. */
  readonly noneInBucket: string;
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
  diff: EnvironmentDiff,
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

  lines.push("", labels.diff.heading, "");
  lines.push(...renderDiffSection(diff, labels.diff));

  lines.push("");
  return lines.join("\n");
}

function renderDiffSection(
  diff: EnvironmentDiff,
  labels: EnvironmentDiffLabels,
): readonly string[] {
  if (diff.kind === "local-unknown") return [labels.localUnknown];

  return [
    ...renderDiffBucket(
      labels.remoteOnlyHeading(diff.remoteOnly.length),
      diff.remoteOnly,
      labels.noneInBucket,
    ),
    "",
    ...renderDiffBucket(
      labels.localOnlyHeading(diff.localOnly.length),
      diff.localOnly,
      labels.noneInBucket,
    ),
    "",
    ...renderVersionMismatchBucket(diff, labels),
  ];
}

function renderDiffBucket(
  heading: string,
  packages: readonly EnvironmentPackage[],
  noneInBucket: string,
): readonly string[] {
  if (packages.length === 0) return [heading, `  ${noneInBucket}`];

  const nameWidth = Math.max(...packages.map((pkg) => pkg.name.length));
  return [
    heading,
    ...packages.map(
      (pkg) => `  ${pkg.name.padEnd(nameWidth + 2)}${pkg.version}`,
    ),
  ];
}

function renderVersionMismatchBucket(
  diff: Extract<EnvironmentDiff, { readonly kind: "compared" }>,
  labels: EnvironmentDiffLabels,
): readonly string[] {
  const heading = labels.versionMismatchedHeading(
    diff.versionMismatched.length,
  );
  if (diff.versionMismatched.length === 0) {
    return [heading, `  ${labels.noneInBucket}`];
  }

  const nameWidth = Math.max(
    ...diff.versionMismatched.map((pkg) => pkg.name.length),
  );
  return [
    heading,
    ...diff.versionMismatched.map(
      (pkg) =>
        `  ${pkg.name.padEnd(nameWidth + 2)}${pkg.remoteVersion} → ${pkg.localVersion}`,
    ),
  ];
}

// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Pure formatting helpers for 7c-ii's table properties panel — HTML-escaping
 * and the handful of "format this optional field, or render nothing" rules
 * `src/data/tablePropertiesPanel.ts` needs when it assembles the panel's
 * static HTML.
 *
 * **This module must never import `vscode`.** Split out for the same reason
 * `dataViewerModel.ts` is: `tablePropertiesPanel.ts` imports `vscode`
 * (`.c8rc.json` excludes it from unit coverage for exactly that reason,
 * verified instead at the integration tier), so any logic worth unit-testing
 * directly has to live somewhere that doesn't.
 */

/** Escapes the five characters that matter inside HTML text content and
 * double-quoted attribute values. Needed because this panel — unlike
 * `resultPanel.ts`'s DOM-port webview or `dataViewerPanel.ts`'s React tree,
 * neither of which ever concatenates untrusted text into an HTML string
 * directly — builds its markup by string interpolation, and a column's own
 * `label`/`format`/`informat` (Finding 7.1) is free text a site's own data
 * steward chose, not a value this project can assume is HTML-safe. The
 * panel's CSP (`default-src 'none'`, no `script-src`) already stops an
 * injected `<script>` from running, but an unescaped `<`/`>` could still
 * inject arbitrary markup (a fake control, hidden content) into the panel —
 * this closes that regardless of what the CSP allows. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Renders a table's `creationTimeStamp`/`modifiedTimeStamp` for display.
 *
 * **Finding 7.19** (`docs/phases/phase-7.md`, `verde`, 2026-09-10) confirmed
 * both fields are ISO-8601 strings (`"2026-03-04T20:36:21.880Z"`) on a real
 * deployment — `new Date(value)` parses them directly, every time this
 * project has actually observed. The raw-SAS-epoch-seconds fallback below
 * (`(numeric - 315619200) * 1000`, ported from upstream
 * `vscode-sas-extension`'s `TablePropertiesViewer.ts`) is kept only as
 * defensive parity with that code for a value shape this deployment has never
 * sent — **not confirmed reachable here**. If a value parses as neither an
 * ISO date nor a plain number, the original string is returned unchanged
 * rather than a formatting function silently hiding a value it could not
 * make sense of.
 */
export function formatTimestamp(value: string): string {
  const asDate = new Date(value);
  if (!isNaN(asDate.getTime())) return asDate.toLocaleString();

  const asNumber = Number(value);
  if (!isNaN(asNumber)) {
    // SAS datetime is seconds since 1960-01-01; 315619200 is the offset (in
    // seconds) to 1970-01-01, and *1000 converts to the milliseconds
    // JavaScript's Date expects.
    const fromEpoch = new Date((asNumber - 315619200) * 1000);
    if (!isNaN(fromEpoch.getTime())) return fromEpoch.toLocaleString();
  }

  return value;
}

/** An optional numeric field, locale-formatted, or an empty string when
 * absent. */
export function formatOptionalNumber(value: number | undefined): string {
  return value === undefined ? "" : value.toLocaleString();
}

/** A byte count as a human-scale string (`"12.3 MB"`) — decimal (1000-based)
 * units, matching how VS Code's own file-size UI and most desktop file
 * managers report sizes, rather than the binary (1024-based) KiB/MiB/GiB a
 * reader would otherwise have to mentally convert. Moved here from
 * `messages.ts` in 13k so the CAS properties panel's source file size shares
 * it. */
export function formatBytes(bytes: number): string {
  const units = ["bytes", "KB", "MB", "GB", "TB"] as const;
  let value = bytes;
  let unitIndex = 0;
  // Compare the value as it will be shown, not as it is: 999,950 bytes is
  // 999.95 KB, which shows as "1000.0 KB" unless the rounding steps it up.
  const shown = (v: number, index: number): number =>
    Number(v.toFixed(index === 0 ? 0 : 1));
  while (shown(value, unitIndex) >= 1000 && unitIndex < units.length - 1) {
    value /= 1000;
    unitIndex += 1;
  }
  // `unitIndex` never leaves `[0, units.length - 1]` — the loop guard above
  // keeps it there — so this is always a real element, not the `undefined`
  // a bare index type would otherwise carry.
  const unit: string = units[unitIndex] ?? "bytes";
  const precision = unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${unit}`;
}

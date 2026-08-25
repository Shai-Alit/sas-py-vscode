// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The rich-output capture decision logic — ADR-0019's diff, whitelist, order,
 * cap and decode steps, given a proper home.
 *
 * **This module must never import `vscode`.**
 *
 * `src/compute/files.ts` owns the wire mechanics (list a directory, fetch a
 * file, delete a file); this module owns the policy of what those mechanics
 * are for. That split is the same one `logFilter.ts` draws against
 * `procPython.ts`'s job/log plumbing, and for the same reason: this is exactly
 * the kind of decision — which candidates count, in which order, up to what
 * size — that wants fixture-tested coverage independent of a real Compute
 * client.
 *
 * ## The algorithm, and where each piece of it comes from
 *
 * 1. **Diff by name and size** ({@link selectRichOutputCandidates}). A
 *    candidate is a file present after a run that is either absent before, or
 *    present before with a different size. Same-name-same-size is not a
 *    candidate, even if the content changed without changing length —
 *    indistinguishable from "unchanged" with what a bare listing carries
 *    (finding 67), and ADR-0019 accepts that rather than spend a second
 *    listing call per file to resolve it.
 * 2. **Filter to a closed whitelist by extension**
 *    ({@link richOutputMimeForName}): `.png` → `image/png`, `.html`/`.htm` →
 *    `text/html`. Nothing else, on purpose — those are the only two arms
 *    {@link RichOutput} has today, and recognising a third extension here
 *    would capture bytes the seam has nowhere to put.
 * 3. **Order by filename, ascending.** A directory listing carries no
 *    ordering signal this project can rely on (finding 61/67's evidence is
 *    silent on it), so filename is the one ordering a user actually controls.
 * 4. **Cap at 10 MiB** ({@link exceedsCaptureCap}, {@link MAX_CAPTURE_BYTES}).
 *    Roughly forty times the largest real figure finding 66 measured
 *    (262,591 bytes) — generous headroom, not a measured ceiling; ADR-0019
 *    is explicit that no probe evidence motivates 10 MiB specifically. Checked
 *    against the size the *listing* already reported, before any content
 *    fetch — the same reason size, not an `ETag`, is the diff key: it costs
 *    nothing beyond the listing request every run already makes.
 * 5. **Decode** ({@link decodeRichOutput}): base64 for `image/png` (per
 *    {@link RichOutput}'s own contract), UTF-8 text for `text/html`.
 *
 * ## What this module does not decide
 *
 * Whether a run's outcome was `cancelled` (ADR-0019: no capture at all on a
 * cancelled run), and what to do when a fetch or a delete actually fails
 * against the deployment, are `procPython.ts`'s calls — this module has no
 * `ComputeClient` and performs no I/O, so it cannot make them. It only
 * supplies {@link skippedCaptureOutput} as the shared wording for "this one
 * did not make it", so the message a cap-exceeded candidate and a candidate
 * that failed to fetch produce is written in one place rather than twice.
 */

import { type RichOutput } from "./backend";

import { type SessionFile } from "../compute/files";

/**
 * The size, in bytes, above which a candidate is skipped rather than fetched.
 *
 * A **stated, changeable choice**, not a measured limit — see this module's
 * own doc comment and ADR-0019's "Alternatives considered". Exported so
 * `procPython.ts` and this module's tests read the same number rather than
 * two copies that could drift apart.
 */
export const MAX_CAPTURE_BYTES = 10 * 1024 * 1024;

/** One extension this slice recognises, and the {@link RichOutput} arm it
 * fills. Nothing else — see this module's own doc comment on why the
 * whitelist is closed. */
export type RichOutputMime = "image/png" | "text/html";

/** A file the diff identified as worth capturing, and which arm of
 * {@link RichOutput} its content will become. */
export interface RichOutputCandidate {
  readonly file: SessionFile;
  readonly mime: RichOutputMime;
}

/**
 * The extension-to-mime whitelist, ADR-0019 point 5.
 *
 * Case-insensitive: nothing about a session's filesystem promises a Python
 * script names its own output in any particular case, and there is no probe
 * evidence either way. `undefined` for anything else, including every
 * extension a plausible future slice might add (`.jpg`, `.svg`, `.csv`) —
 * they are not {@link RichOutput} arms yet, and recognising one here would be
 * this module quietly deciding a question ADR-0019 assigns to whichever slice
 * adds the arm.
 */
export function richOutputMimeForName(
  name: string,
): RichOutputMime | undefined {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
  return undefined;
}

/**
 * Diffs two directory snapshots and returns the whitelisted candidates, in
 * filename order.
 *
 * `before` and `after` are the same directory, listed immediately before
 * `createJob` and immediately after the job settles (ADR-0019 point 1/3) —
 * this function does not care when they were taken, only what they say. A
 * file present in `after` is a candidate if it is absent from `before`, or
 * present with a different `size` (point 4); it is then dropped unless
 * {@link richOutputMimeForName} recognises its extension (point 5); survivors
 * are sorted by name, ascending, with a plain ordinal comparison rather than
 * `localeCompare` — deterministic across hosts and ICU versions, which
 * matters more here than alphabetising the way any particular locale would.
 */
export function selectRichOutputCandidates(
  before: readonly SessionFile[],
  after: readonly SessionFile[],
): readonly RichOutputCandidate[] {
  const beforeByName = new Map(before.map((file) => [file.name, file]));

  const candidates: RichOutputCandidate[] = [];
  for (const file of after) {
    const prior = beforeByName.get(file.name);
    const changed = prior === undefined || prior.size !== file.size;
    if (!changed) continue;

    const mime = richOutputMimeForName(file.name);
    if (mime === undefined) continue;

    candidates.push({ file, mime });
  }

  return candidates
    .slice()
    .sort((a, b) => ordinalCompare(a.file.name, b.file.name));
}

/**
 * Whether a candidate's reported size rules out fetching it at all (ADR-0019
 * point 7).
 *
 * An `undefined` size — `SessionFile.size`'s defensive arm, for a listing
 * item that carried none — is treated the same as exceeding the cap, not as
 * passing it: finding 67 measured `size` present on every real listing item
 * this project has seen, so `undefined` here means this module cannot confirm
 * the one thing ADR-0019's cap depends on, and the safe reading of "cannot
 * confirm" is the same as "too large", not "assume it is small".
 */
export function exceedsCaptureCap(file: SessionFile): boolean {
  return file.size === undefined || file.size > MAX_CAPTURE_BYTES;
}

/**
 * Turns a fetched candidate's bytes into the {@link RichOutput} its mime
 * arm requires.
 *
 * `image/png`: base64, no data-URI prefix — {@link RichOutput}'s own
 * contract. `text/html`: UTF-8 decoded, the same lenient decode
 * (`Buffer.toString("utf8")`) every text-bearing response in this codebase
 * already uses; `pandas.DataFrame.to_html()` output is text by construction,
 * so there is no lossy-binary concern here the way there is for `image/png`'s
 * *input* bytes (see `client.ts`'s `rawBody` doc comment for that one).
 */
export function decodeRichOutput(
  mime: RichOutputMime,
  bytes: Uint8Array,
): RichOutput {
  if (mime === "image/png") {
    return { mime: "image/png", data: Buffer.from(bytes).toString("base64") };
  }
  return { mime: "text/html", data: Buffer.from(bytes).toString("utf8") };
}

/**
 * The shared wording for a candidate that did not make it into the run's
 * output — too large to fetch (ADR-0019 point 7) or a genuine fetch failure
 * (point 8). `procPython.ts` supplies `reason`; this function only fixes the
 * shape, so the two call sites cannot drift into different phrasing for the
 * same idea.
 *
 * **Known l10n gap**, same as `logFilter.ts`'s dropped-lines marker and
 * `procPython.ts`'s own fallback strings — see `backend.ts`'s `RichOutput`
 * doc comment for the full list and why none of them go through `l10n.t()`.
 */
export function skippedCaptureOutput(name: string, reason: string): RichOutput {
  return {
    mime: "text/plain",
    data: `[could not retrieve rich output file "${name}": ${reason}]\n`,
  };
}

/** Deterministic ascending order, independent of locale or ICU version. */
function ordinalCompare(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Reading connection profiles out of the SAS extension's settings.
 *
 * **This module must never import `vscode`**, for the same reason as `model.ts`:
 * the interesting part is the filtering, and the filtering should be specified by
 * unit tests rather than driven through an extension host.
 *
 * The contract of this file is that it is *read-only and total*. It is handed
 * whatever `SAS.connectionProfiles` happens to contain — a shape this project
 * does not own, written by an extension that ships on its own schedule — and it
 * must come back with an answer for every entry, never throw, and never write
 * anything anywhere. A profile it cannot make sense of is skipped with a reason
 * the user can read; that is the whole error strategy, and it is deliberate. If
 * upstream changes their schema, the failure mode is "nothing to import" rather
 * than a broken command.
 *
 * Structure follows: the `SAS.connectionProfiles` schema in
 * sassoftware/vscode-sas-extension `package.json:153-459` (Apache-2.0). No code
 * was copied; what is reproduced here is the reading of their field names.
 * See docs/adr/0007-connection-profile-storage.md.
 */

import {
  CURRENT_PROFILE_VERSION,
  MAX_PROFILE_NAME_LENGTH,
  normaliseEndpoint,
  type ViyaProfile,
} from "./model";

/** The SAS extension's settings key. Read, never written. */
export const SAS_PROFILES_SETTING = "SAS.connectionProfiles";

/**
 * The one connection type that means Viya.
 *
 * The other three upstream values — `ssh`, `com`, `iom` — are SAS 9 transports,
 * which this project does not support and cannot run Python on.
 */
const REST = "rest";

/** A SAS profile that can become one of ours. */
export interface ImportCandidate {
  /** The name it will be stored under here, already free of collisions. */
  name: string;
  /** The name it has in the SAS extension, shown when the two differ. */
  originalName: string;
  /** The profile as it would be stored, minus any secret. */
  profile: ViyaProfile;
  /**
   * Whether the source profile carried a `clientSecret`.
   *
   * The value is deliberately not read, not copied and not returned — only the
   * fact of it, so the command can tell the user they will be asked for the
   * secret once rather than letting them discover it at the first sign-in.
   */
  hadClientSecret: boolean;
}

/** A SAS profile that cannot become one of ours, and why. */
export interface ImportSkip {
  name: string;
  reason: string;
}

export interface ImportScan {
  candidates: ImportCandidate[];
  skipped: ImportSkip[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

/**
 * Works out what kind of connection a SAS profile describes.
 *
 * Upstream's own migration defaults a profile with no `connectionType` to
 * `"rest"` unconditionally (`client/src/components/profile.ts:206-225`), which
 * is wrong for the SAS 9 profiles that predate the field — an old SSH profile has
 * `host` and `saspath` and no endpoint, and calling it `rest` produces a Viya
 * connection to nowhere. Inferring from the fields that are actually present is
 * both more accurate and, importantly, non-destructive: we are reading a file we
 * do not own, so guessing wrong must cost a skipped row and nothing else.
 */
function connectionTypeOf(raw: Record<string, unknown>): string | undefined {
  const declared = readString(raw.connectionType);
  if (declared !== undefined) return declared.toLowerCase();
  if (readString(raw.endpoint) !== undefined) return REST;
  if (readString(raw.host) !== undefined) return "ssh/com/iom";
  return undefined;
}

/**
 * Makes a name that does not collide with one already in use.
 *
 * The suffix names its origin rather than counting — `Prod (SAS)` says why a
 * second profile exists, where `Prod 2` leaves the user to work it out. Counting
 * only starts if that collides too.
 */
function uniqueName(desired: string, taken: Set<string>): string {
  const isFree = (candidate: string): boolean =>
    !taken.has(candidate.toLowerCase()) &&
    candidate.length <= MAX_PROFILE_NAME_LENGTH;

  if (isFree(desired)) return desired;

  const base = desired.slice(0, MAX_PROFILE_NAME_LENGTH - " (SAS 99)".length);
  const suffixed = `${base} (SAS)`;
  if (isFree(suffixed)) return suffixed;

  for (let n = 2; n < 100; n++) {
    const numbered = `${base} (SAS ${String(n)})`;
    if (isFree(numbered)) return numbered;
  }

  // Ninety-nine profiles of the same name is not a real state; falling back to a
  // name that certainly collides would be worse than one that certainly does not.
  return `${base} (SAS ${String(Date.now())})`;
}

/**
 * Scans the SAS extension's setting for profiles worth importing.
 *
 * `makeId` is injected rather than called for the same reason `createProfile`
 * takes an id: this module stays free of imports and of randomness, so the tests
 * can assert on whole objects instead of matching them against patterns.
 *
 * Nothing here mutates its input, and nothing here is written to disk — the
 * caller decides which candidates the user actually accepted.
 */
export function scanSasProfiles(
  raw: unknown,
  options: {
    makeId: (name: string) => string;
    existingNames?: readonly string[];
  },
): ImportScan {
  const candidates: ImportCandidate[] = [];
  const skipped: ImportSkip[] = [];

  if (!isRecord(raw)) return { candidates, skipped };

  // Their setting is a wrapper object holding `activeProfile` and `profiles`.
  // Accept a bare dictionary too, so that a hand-copied fragment still imports.
  const container = isRecord(raw.profiles) ? raw.profiles : raw;

  const taken = new Set(
    (options.existingNames ?? []).map((name) => name.toLowerCase()),
  );

  for (const [originalName, value] of Object.entries(container)) {
    if (originalName === "activeProfile") continue;

    if (!isRecord(value)) {
      skipped.push({ name: originalName, reason: "it is not a profile" });
      continue;
    }

    const type = connectionTypeOf(value);
    if (type === undefined) {
      skipped.push({
        name: originalName,
        reason: "it has no connection type and no endpoint",
      });
      continue;
    }
    if (type !== REST) {
      skipped.push({
        name: originalName,
        reason: `it connects to SAS 9 over ${type}, which Python on Viya does not support`,
      });
      continue;
    }

    const endpoint = normaliseEndpoint(value.endpoint);
    if (!endpoint.ok) {
      skipped.push({ name: originalName, reason: endpoint.reason });
      continue;
    }

    const name = uniqueName(originalName, taken);
    taken.add(name.toLowerCase());

    const profile: ViyaProfile = {
      version: CURRENT_PROFILE_VERSION,
      // A fresh id, not their profile name: an imported profile is a new profile
      // here, and giving it an id of its own is what lets it be renamed later
      // without losing whatever secret has since been stored against it.
      id: options.makeId(name),
      endpoint: endpoint.value,
    };

    const context = readString(value.context);
    if (context !== undefined) profile.context = context;

    const clientId = readString(value.clientId);
    if (clientId !== undefined) profile.clientId = clientId;

    candidates.push({
      name,
      originalName,
      profile,
      hadClientSecret: readString(value.clientSecret) !== undefined,
    });
  }

  return { candidates, skipped };
}

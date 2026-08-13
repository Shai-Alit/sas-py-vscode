// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The connection profile model: what a profile is, and what makes one invalid.
 *
 * **This module must never import `vscode`.** That is the whole reason it is a
 * separate file. The unit tier runs in plain Node, outside an extension host, so
 * anything reaching for the `vscode` module is invisible to it and can only be
 * covered by the much slower editor tier. Keeping the rules here — validation,
 * normalisation, version handling, precedence — means the specification of a
 * profile is the unit tests, and the shell around it stays thin enough to read.
 *
 * Structure follows: client/src/components/profile.ts in
 * sassoftware/vscode-sas-extension (Apache-2.0). No code was copied; that file
 * mixes the model, the settings I/O and the input prompts into one class, which
 * is exactly the arrangement this split exists to avoid. Several of its
 * behaviours are deliberately *not* reproduced, and each is noted where the
 * difference lives. See docs/adr/0007-connection-profile-storage.md.
 */

/**
 * The shape version carried by every profile.
 *
 * It is `1` and it does nothing today, which is the point: a version field is
 * worthless unless it predates the first change it has to describe. Upstream has
 * none and migrates by sniffing for absent fields, which resolves exactly one
 * change unambiguously — the second one cannot tell an old profile from a
 * malformed new one.
 */
export const CURRENT_PROFILE_VERSION = 1;

/** Longest accepted profile name. Long enough for a sentence, short enough for the status bar. */
export const MAX_PROFILE_NAME_LENGTH = 64;

/**
 * A SAS Viya connection profile, as stored under
 * `pythonOnViya.connectionProfiles`. The profile's *name* is the key it is
 * stored under, not a field.
 *
 * There is no `clientSecret`, and its absence is load-bearing rather than an
 * omission: the secret lives in `SecretStorage`, keyed by {@link secretKey}.
 * Upstream keeps it as a plain string property in `settings.json`, which puts a
 * credential in a file people commit and screen-share.
 */
export interface ViyaProfile {
  /** Shape version. See {@link CURRENT_PROFILE_VERSION}. */
  version: number;
  /**
   * Stable identity, independent of the name.
   *
   * Secrets are keyed on this rather than on the profile name so that renaming a
   * profile keeps its stored token. Upstream keys its `SASAuth` entries by
   * profile name, so a rename silently orphans the credential and the user is
   * asked to sign in again with no explanation.
   */
  id: string;
  /** Absolute URL of the Viya deployment, normalised by {@link normaliseEndpoint}. */
  endpoint: string;
  /** Compute context name. Optional here; it acquires meaning in Phase 2. */
  context?: string;
  /**
   * OAuth client id. Optional, and nothing reads it yet.
   *
   * What an *empty* value means is decided in Phase 1b, not here — this slice
   * stores the field and prompts for it, and no authentication code exists to
   * consume it. Upstream leaves it blank on Viya 4 2022.11 and later and falls
   * back to a built-in client id, `vscode`, registered in the deployment for
   * *its* extension; on Viya 3.5 and Viya 4 2022.10 and earlier it requires an
   * explicit id and secret. That is documented behaviour, not something this
   * project has probed, and whether a fallback of ours should reuse another
   * product's client id or ask deployments to register `python-on-viya` is an
   * open question. See PRODUCTION_PLAN.md §1b.
   */
  clientId?: string;
}

/** A profile the user asked for but that could not be stored as given. */
export interface ProfileProblem {
  /** The profile name, or `""` when the container itself is the problem. */
  name: string;
  /** Why it was rejected, phrased for someone who has to fix it. */
  reason: string;
}

export interface ReadProfilesResult {
  /** Every profile that survived validation, keyed by name. */
  profiles: Record<string, ViyaProfile>;
  /**
   * Every profile that did not, and why.
   *
   * Rejection is per profile, never wholesale. One hand-edited entry with a
   * typo in it must not hide the four beside it that are fine — a settings file
   * that stops working entirely because of one bad line is a settings file
   * nobody can debug.
   */
  rejected: ProfileProblem[];
}

/** A success/failure pair, so callers handle the failure rather than catching it. */
export type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T>(reason: string): Result<T> => ({ ok: false, reason });

/** Hosts for which cleartext HTTP is accepted, because there is no network to sniff. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The `SecretStorage` key for a profile's secrets.
 *
 * Keyed on the profile's stable `id`, never on its name. A single accessor
 * exists so that the two callers — the store and its tests — cannot drift.
 */
export function secretKey(profile: Pick<ViyaProfile, "id">): string {
  return `pythonOnViya.profile.${profile.id}`;
}

/**
 * Turns whatever the user typed into an endpoint we are willing to store.
 *
 * Forgiving about form, strict about safety. A bare `viya.example.com` gains a
 * scheme, because that is what people type and refusing it teaches nothing. The
 * three rejections all describe ways an endpoint could leak a credential or
 * silently connect somewhere else:
 *
 *   - **Cleartext HTTP**, except to loopback. Every request this extension makes
 *     carries a bearer token in a header; over `http:` that token is readable by
 *     anything on the path. Upstream accepts `http:` without comment.
 *     credential-scan: allow the illustration below is the shape this rule refuses
 *   - **Credentials in the URL** (`https://user:pass@host`). That is a password
 *     written into `settings.json` by another route, and the repository's own
 *     `check:secrets` gate treats the shape as a finding.
 *   - **A query or fragment**, which is never part of a deployment's address and
 *     usually means a whole browser URL was pasted in.
 *
 * A trailing slash is stripped, as upstream does — it has to be, because
 * `${endpoint}/compute` would otherwise produce a double slash that some
 * reverse proxies answer differently.
 */
export function normaliseEndpoint(raw: unknown): Result<string> {
  if (typeof raw !== "string") {
    return fail("the endpoint must be text");
  }

  const trimmed = raw.trim();
  if (trimmed === "") {
    return fail("the endpoint is required");
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return fail(`"${trimmed}" is not a URL`);
  }

  if (url.username !== "" || url.password !== "") {
    return fail(
      "the endpoint must not contain a username or password — credentials belong in the sign-in prompt, not in a setting",
    );
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return fail(
      `the endpoint must use https, not ${url.protocol.replace(":", "")}`,
    );
  }

  if (url.protocol === "http:" && !LOOPBACK_HOSTS.has(url.hostname)) {
    return fail(
      "the endpoint must use https — an access token sent over http can be read by anything between here and the server",
    );
  }

  if (url.search !== "" || url.hash !== "") {
    return fail(
      "the endpoint must not contain a query string or fragment — use just the address of the deployment",
    );
  }

  const path = url.pathname.replace(/\/+$/, "");
  return ok(`${url.origin}${path}`);
}

/**
 * Validates a profile name against the names already in use.
 *
 * Duplicates are compared case-insensitively even though the underlying JSON
 * object is case-sensitive and would happily hold both. `Prod` and `prod` in one
 * status bar is a mistake waiting to be made at the worst possible moment, and
 * the cost of forbidding it is a clearer error message.
 */
export function validateProfileName(
  raw: unknown,
  existingNames: Iterable<string> = [],
  options: { allow?: string | undefined } = {},
): Result<string> {
  if (typeof raw !== "string") {
    return fail("the profile name must be text");
  }

  const name = raw.trim();
  if (name === "") {
    return fail("the profile name is required");
  }
  if (name.length > MAX_PROFILE_NAME_LENGTH) {
    return fail(
      `the profile name must be ${String(MAX_PROFILE_NAME_LENGTH)} characters or fewer`,
    );
  }
  // eslint-disable-next-line no-control-regex -- the point of the rule is to reject control characters, which cannot be matched without naming them.
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    return fail("the profile name must not contain control characters");
  }

  const allowed = options.allow?.toLowerCase();
  for (const existing of existingNames) {
    if (existing.toLowerCase() !== name.toLowerCase()) continue;
    if (allowed !== undefined && existing.toLowerCase() === allowed) continue;
    return fail(`a profile named "${existing}" already exists`);
  }

  return ok(name);
}

/**
 * Reads one profile out of whatever the settings file contained.
 *
 * Unknown properties are dropped rather than preserved. Round-tripping them
 * would be the more generous choice, but a profile from a future build is
 * refused outright by the version check above, so anything unknown reaching here
 * is either a typo or a hand-edit — and silently carrying a misspelt key back to
 * disk is how a typo becomes permanent.
 */
function readProfile(name: string, raw: unknown): Result<ViyaProfile> {
  if (!isRecord(raw)) {
    return fail("the profile must be an object");
  }

  const version = readVersion(raw.version);
  if (!version.ok) return version;

  const endpoint = normaliseEndpoint(raw.endpoint);
  if (!endpoint.ok) return endpoint;

  const profile: ViyaProfile = {
    version: version.value,
    // A hand-written profile has no id, and falling back to the name is the
    // behaviour that makes such a profile work identically to a generated one
    // until somebody renames it.
    id: typeof raw.id === "string" && raw.id.trim() !== "" ? raw.id : name,
    endpoint: endpoint.value,
  };

  if (typeof raw.context === "string" && raw.context.trim() !== "") {
    profile.context = raw.context.trim();
  }
  if (typeof raw.clientId === "string" && raw.clientId.trim() !== "") {
    profile.clientId = raw.clientId.trim();
  }

  return ok(profile);
}

/**
 * A profile from a newer build is refused, not read.
 *
 * The tempting alternative is to read what we recognise and ignore the rest,
 * which fails in the one way that matters: a future field that *restricts*
 * something — a required certificate, a narrowed scope — would be dropped, and
 * the connection would then be made on terms the user did not agree to.
 * Refusing is louder and correct.
 *
 * An absent version means "the first shipped shape", because that shape had no
 * version field to omit at the time it was written by hand.
 */
function readVersion(raw: unknown): Result<number> {
  if (raw === undefined) return ok(CURRENT_PROFILE_VERSION);
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) {
    return fail("the profile version must be a whole number of at least 1");
  }
  if (raw > CURRENT_PROFILE_VERSION) {
    return fail(
      `the profile was written by a newer version of Python on Viya (profile version ${String(raw)}; this build understands up to ${String(CURRENT_PROFILE_VERSION)}) — update the extension to use it`,
    );
  }
  return ok(raw);
}

/**
 * Reads the whole `pythonOnViya.connectionProfiles` object.
 *
 * Note what this does *not* do: it does not write. Upstream's equivalent repairs
 * the setting from inside its getters, so merely reading the configuration can
 * rewrite the user's `settings.json` — including on a machine where the user
 * only ever opened the settings UI to look.
 */
export function readProfiles(raw: unknown): ReadProfilesResult {
  if (raw === undefined || raw === null) {
    return { profiles: {}, rejected: [] };
  }
  if (!isRecord(raw)) {
    return {
      profiles: {},
      rejected: [
        {
          name: "",
          reason:
            "pythonOnViya.connectionProfiles must be an object mapping profile names to profiles",
        },
      ],
    };
  }

  const profiles: Record<string, ViyaProfile> = {};
  const rejected: ProfileProblem[] = [];

  for (const [name, value] of Object.entries(raw)) {
    const result = readProfile(name, value);
    if (result.ok) {
      profiles[name] = result.value;
    } else {
      rejected.push({ name, reason: result.reason });
    }
  }

  return { profiles, rejected };
}

/**
 * Which profile a window should be using.
 *
 * Three sources, in falling order of how specifically the user asked for it:
 *
 *   1. **This window's choice**, held in `workspaceState`. Switching profile is
 *      a per-window act, so one window can sit on a development deployment while
 *      another runs against production. Upstream keeps a single global
 *      `activeProfile` string, so switching in one window switches all of them.
 *   2. **`pythonOnViya.defaultProfile`**, a setting, which is what a machine
 *      setup script or a checked-in workspace file can reach.
 *   3. **The only profile there is.** Having exactly one profile and no active
 *      connection is a state with nothing to decide, and asking anyway is a
 *      question with one possible answer.
 *
 * A stale choice — a name that no longer exists — falls through rather than
 * resolving to nothing, which is what makes deleting a profile behave sensibly
 * in a window that was pointed at it.
 */
export function resolveActiveProfile(input: {
  profileNames: readonly string[];
  windowChoice?: string | undefined;
  defaultProfile?: string | undefined;
}): string | undefined {
  const known = new Set(input.profileNames);

  if (input.windowChoice !== undefined && known.has(input.windowChoice)) {
    return input.windowChoice;
  }
  if (input.defaultProfile !== undefined && known.has(input.defaultProfile)) {
    return input.defaultProfile;
  }
  if (input.profileNames.length === 1) {
    return input.profileNames[0];
  }
  return undefined;
}

/**
 * Builds a profile from validated parts.
 *
 * `id` is supplied by the caller rather than generated here, so that this module
 * stays free of both randomness and imports. The shell passes
 * `randomUUID()`; the tests pass a counter and can therefore assert on the
 * result instead of matching it against a pattern.
 */
export function createProfile(input: {
  id: string;
  endpoint: string;
  context?: string | undefined;
  clientId?: string | undefined;
}): ViyaProfile {
  const profile: ViyaProfile = {
    version: CURRENT_PROFILE_VERSION,
    id: input.id,
    endpoint: input.endpoint,
  };
  if (input.context !== undefined && input.context.trim() !== "") {
    profile.context = input.context.trim();
  }
  if (input.clientId !== undefined && input.clientId.trim() !== "") {
    profile.clientId = input.clientId.trim();
  }
  return profile;
}

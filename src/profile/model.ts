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
   * Sign-in is Phase 1b; this slice only stores the field. When 1b lands, an
   * empty value falls back to the built-in `vscode` client that Viya 4 2022.11
   * and later register (PRODUCTION_PLAN.md decision 9). Viya 4 2022.10 and
   * earlier has no such client and needs an explicit id and secret — that
   * branch must say so plainly rather than surfacing the generic OAuth
   * rejection an absent client produces. Documented SAS behaviour, not yet
   * probed here.
   */
  clientId?: string;
}

/** A profile the user asked for but that could not be stored as given. */
export interface ProfileProblem {
  /** The profile name, or `""` when the container itself is the problem. */
  name: string;
  /**
   * Why it was rejected, phrased for someone who has to fix it.
   *
   * English, and only ever written to the output channel. Anything shown in the
   * UI goes through {@link ValidationProblem} instead.
   */
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

/**
 * Why a value the user typed was refused, as data rather than as prose.
 *
 * This module cannot import `vscode`, so it cannot call `l10n.t()` — but the
 * strings it produces are shown under an input box, which makes them
 * user-facing, and CONTRIBUTING.md requires those to be localisable. A code plus
 * its parameters is the seam that satisfies both: the model still decides *what*
 * is wrong, and `src/profile/problems.ts` decides how to say it in the user's
 * language. Adding a member here is a compile error there until it is handled.
 */
export type ValidationProblem =
  | { code: "endpoint-not-text" }
  | { code: "endpoint-required" }
  | { code: "endpoint-not-a-url"; value: string }
  | { code: "endpoint-has-credentials" }
  | { code: "endpoint-unsupported-scheme"; scheme: string }
  | { code: "endpoint-cleartext" }
  | { code: "endpoint-has-query-or-fragment" }
  | { code: "name-not-text" }
  | { code: "name-required" }
  | { code: "name-too-long"; max: number }
  | { code: "name-has-control-characters" }
  | { code: "name-duplicate"; existing: string };

/**
 * The English rendering of a problem.
 *
 * Used for the output channel and for tests, never for the UI — the log is a
 * thing people paste into issues, and a diagnostic that changes language with
 * the editor's locale is harder to search, not easier to read. The UI path goes
 * through `localiseProblem` instead.
 */
export function describeProblem(problem: ValidationProblem): string {
  switch (problem.code) {
    case "endpoint-not-text":
      return "the endpoint must be text";
    case "endpoint-required":
      return "the endpoint is required";
    case "endpoint-not-a-url":
      return `"${problem.value}" is not a URL`;
    case "endpoint-has-credentials":
      return "the endpoint must not contain a username or password — credentials belong in the sign-in prompt, not in a setting";
    case "endpoint-unsupported-scheme":
      return `the endpoint must use https, not ${problem.scheme}`;
    case "endpoint-cleartext":
      return "the endpoint must use https — an access token sent over http can be read by anything between here and the server";
    case "endpoint-has-query-or-fragment":
      return "the endpoint must not contain a query string or fragment — use just the address of the deployment";
    case "name-not-text":
      return "the profile name must be text";
    case "name-required":
      return "the profile name is required";
    case "name-too-long":
      return `the profile name must be ${String(problem.max)} characters or fewer`;
    case "name-has-control-characters":
      return "the profile name must not contain control characters";
    case "name-duplicate":
      return `a profile named "${problem.existing}" already exists`;
  }
}

/** A success/failure pair, so callers handle the failure rather than catching it. */
export type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

/**
 * A {@link Result} whose failure also carries a {@link ValidationProblem}.
 *
 * Returned by the two functions whose rejections reach an input box. It is
 * assignable to `Result<T>`, so the readers that only log can keep passing these
 * results straight through.
 */
export type Validated<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; problem: ValidationProblem };

/** Succeeds. The literal type is assignable to both {@link Result} and {@link Validated}. */
const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });

/**
 * Fails with a structured problem. Use this wherever the reason can reach the
 * user; `reason` is filled in from the same problem so log callers are unchanged.
 */
const invalid = <T>(problem: ValidationProblem): Validated<T> => ({
  ok: false,
  problem,
  reason: describeProblem(problem),
});

/**
 * Fails with prose and no code, for reasons that only ever reach the log.
 *
 * Deliberate, not an oversight: these describe a malformed settings file, are
 * written for whoever has to edit that file, and are never rendered in the UI.
 * If one of them ever becomes user-facing it needs a code first.
 */
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
 * The profile ids recorded as having a client with no secret, after `id` is
 * added to or removed from them.
 *
 * "This client has no secret" is a real answer to the sign-in prompt and has to
 * be remembered, or the user is asked the same question before every sign-in and
 * the prompt's own promise is broken. It is *not* a credential, so it does not go
 * in `SecretStorage` — see the note on `ProfileStore.setSecret` for why storing
 * an empty string there is not the shortcut it appears to be.
 *
 * Pure, and separate from the store, because the two rules worth pinning are
 * rules rather than plumbing: the list is a set, so answering twice does not
 * grow it, and supplying a real secret retracts the claim that there is none.
 * Order is preserved so the stored value does not churn.
 */
export function withSecretlessId(
  current: readonly string[],
  id: string,
  secretless: boolean,
): string[] {
  const without = current.filter((known) => known !== id);
  return secretless ? [...without, id] : without;
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
export function normaliseEndpoint(raw: unknown): Validated<string> {
  if (typeof raw !== "string") {
    return invalid({ code: "endpoint-not-text" });
  }

  const trimmed = raw.trim();
  if (trimmed === "") {
    return invalid({ code: "endpoint-required" });
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return invalid({ code: "endpoint-not-a-url", value: trimmed });
  }

  if (url.username !== "" || url.password !== "") {
    return invalid({ code: "endpoint-has-credentials" });
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return invalid({
      code: "endpoint-unsupported-scheme",
      scheme: url.protocol.replace(":", ""),
    });
  }

  if (url.protocol === "http:" && !LOOPBACK_HOSTS.has(url.hostname)) {
    return invalid({ code: "endpoint-cleartext" });
  }

  if (url.search !== "" || url.hash !== "") {
    return invalid({ code: "endpoint-has-query-or-fragment" });
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
): Validated<string> {
  if (typeof raw !== "string") {
    return invalid({ code: "name-not-text" });
  }

  const name = raw.trim();
  if (name === "") {
    return invalid({ code: "name-required" });
  }
  if (name.length > MAX_PROFILE_NAME_LENGTH) {
    return invalid({ code: "name-too-long", max: MAX_PROFILE_NAME_LENGTH });
  }
  // eslint-disable-next-line no-control-regex -- the point of the rule is to reject control characters, which cannot be matched without naming them.
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    return invalid({ code: "name-has-control-characters" });
  }

  const allowed = options.allow?.toLowerCase();
  for (const existing of existingNames) {
    if (existing.toLowerCase() !== name.toLowerCase()) continue;
    if (allowed !== undefined && existing.toLowerCase() === allowed) continue;
    return invalid({ code: "name-duplicate", existing });
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

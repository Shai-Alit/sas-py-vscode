// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Server paths for the SAS Server view: where its tree starts, how a path
 * becomes a compute session's files URL, and the `pythonOnViyaServer:` URI an
 * editor opens.
 *
 * **This module must never import `vscode`.**
 *
 * Structure follows: `getNavigationRoot`, `getCreationPath` and
 * `homeDirectoryName` in `RestServerAdapter.ts` and
 * `ContentNavigator/utils.ts` of sassoftware/vscode-sas-extension
 * (Apache-2.0). Read for what they do; no code was copied.
 *
 * ## The one composed URL
 *
 * {@link serverFilesHref} is the only place the view builds a URL
 * ([ADR-0047](../../docs/adr/0047-sas-server-view-composes-file-paths.md)).
 * No link leads from a session to `/` or to a custom root, and a file's own
 * links name the session they were read from, so an open editor has to find
 * its file again by path after a reconnect (Finding 13.20). It is used for the
 * tree's root and for an editor's file; everything else follows links.
 *
 * The encoding is the server's own (Findings 13.22 and 13.28): each segment's
 * `~` becomes `~~` and `;` becomes `~sc~` (in that order, so the `~` of
 * `~sc~` is not doubled), then the segment is percent-encoded, and segments
 * are joined with `~fs~`. `/` alone is `~fs~`. For `x;y~z#q.txt` and
 * `a b é.py` that gives exactly the href the server returned.
 */

/** The `FileSystemProvider` scheme for a file opened from the SAS Server
 * view. Starts with `pythonOnViya`, never `sas` (ADR-0040): the SAS extension
 * registers `sasServer`. */
export const SERVER_SCHEME = "pythonOnViyaServer";

/** The scheme for a folder's `TreeItem.resourceUri`: identity only, never
 * opened and never registered, for the same reason
 * `src/content/uri.ts`'s `CONTENT_FOLDER_SCHEME` exists. */
export const SERVER_FOLDER_SCHEME = "pythonOnViyaServerFolder";

/** Where the tree starts, as upstream's `fileNavigationRoot` names it. */
export type FileNavigationRoot = "USER" | "SYSTEM" | "CUSTOM";

/** The values {@link FileNavigationRoot} may take, for validation. */
export const FILE_NAVIGATION_ROOTS: readonly FileNavigationRoot[] = [
  "USER",
  "SYSTEM",
  "CUSTOM",
];

/** A root setting and who set it. */
export interface NavigationSetting {
  readonly root: FileNavigationRoot;
  /** Read only when {@link root} is `CUSTOM`. */
  readonly customPath?: string | undefined;
  /** `context` when the compute context's attributes set it, which wins
   * over the profile (upstream's `fileNavigationSetByAdmin`). */
  readonly setBy: "profile" | "context";
}

/** The folder the tree starts from. */
export interface NavigationRoot {
  /** An absolute server path. */
  readonly path: string;
  /** What the tree shows for it. */
  readonly label: string;
  readonly setBy: NavigationSetting["setBy"];
  /** Whether the path came from a `CUSTOM` setting: a `404` on it is then
   * the setting's fault, not the server's. */
  readonly custom: boolean;
}

/** The label upstream gives the root unless a custom path names it. */
export const HOME_LABEL = "Home";

/**
 * The root folder a setting names.
 *
 * `USER` and `SYSTEM` both start at `/`, as upstream's REST adapter does: on
 * the probed deployment the session's `HOME` is `/`, so the two are the same
 * folder (Finding 13.21). `CUSTOM` starts at its path, normalised by
 * {@link normaliseServerPath}; an empty one is `/`, as upstream treats it.
 */
export function navigationRoot(setting: NavigationSetting): NavigationRoot {
  if (setting.root !== "CUSTOM") {
    return {
      path: "/",
      label: HOME_LABEL,
      setBy: setting.setBy,
      custom: false,
    };
  }
  const path = normaliseServerPath(setting.customPath ?? "");
  const name = baseName(path);
  return {
    path,
    label: name === "" ? HOME_LABEL : name,
    setBy: setting.setBy,
    custom: true,
  };
}

/**
 * Which setting applies: the compute context's attributes when they name a
 * root or a custom path, otherwise the profile's, otherwise `USER`.
 *
 * Mirrors upstream's `establishConnection`: either attribute being set makes
 * the context's pair win, with a missing root read as `USER`. An attribute
 * that is not one of the three roots is ignored rather than trusted.
 */
export function chooseNavigationSetting(
  profile: {
    readonly root?: FileNavigationRoot | undefined;
    readonly customPath?: string | undefined;
  },
  contextAttributes: Readonly<Record<string, unknown>> | undefined,
): NavigationSetting {
  const contextRoot = contextAttributes?.fileNavigationRoot;
  const contextPath = contextAttributes?.fileNavigationCustomRootPath;
  const root = isFileNavigationRoot(contextRoot) ? contextRoot : undefined;
  const customPath =
    typeof contextPath === "string" && contextPath !== ""
      ? contextPath
      : undefined;
  if (root !== undefined || customPath !== undefined) {
    return { root: root ?? "USER", customPath, setBy: "context" };
  }
  return {
    root: profile.root ?? "USER",
    customPath: profile.customPath,
    setBy: "profile",
  };
}

/** Whether a value is one of the three roots, exactly as upstream spells
 * them. */
export function isFileNavigationRoot(
  value: unknown,
): value is FileNavigationRoot {
  return (
    typeof value === "string" &&
    (FILE_NAVIGATION_ROOTS as readonly string[]).includes(value)
  );
}

/**
 * An absolute path with no trailing `/`, no empty segments and no `.`
 * segments. A relative one is read from `/`, so `tmp/x` is `/tmp/x`.
 *
 * `..` is kept and sent as written. What the server does with it is not
 * probed, and collapsing it here would be a guess about the server's paths.
 */
export function normaliseServerPath(raw: string): string {
  const segments = raw
    .trim()
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".");
  return `/${segments.join("/")}`;
}

/** A path's child: `/` and `a` give `/a`; `/x` and `a` give `/x/a`. */
export function joinServerPath(parent: string, name: string): string {
  return parent === "/" ? `/${name}` : `${parent}/${name}`;
}

/** A path's parent: `/x/a` gives `/x`; `/a` and `/` give `/`. */
export function parentServerPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

/** Whether `path` is `ancestor` or below it: `/a/b` is within `/a` and
 * `/a`, not within `/ab`. Every path is within `/`. */
export function isWithinServerPath(path: string, ancestor: string): boolean {
  if (ancestor === "/") return true;
  return path === ancestor || path.startsWith(`${ancestor}/`);
}

/** A path's last segment, or `""` for `/`. */
export function baseName(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}

/** A path as the files API writes it after `/files/` (see this module's doc
 * comment). */
export function encodeServerPath(path: string): string {
  const normalised = normaliseServerPath(path);
  if (normalised === "/") return "~fs~";
  return normalised
    .split("/")
    .map((segment) =>
      encodeURIComponent(segment.replace(/~/g, "~~").replace(/;/g, "~sc~")),
    )
    .join("~fs~");
}

/**
 * The files URL for a path, built on a session's own `self` href:
 * `{self}/files/{encoded}`. See ADR-0047.
 *
 * `sessionHref` is the session's `self` link, not an id, so the one thing
 * composed here is the part no link offers.
 */
export function serverFilesHref(sessionHref: string, path: string): string {
  return `${sessionHref.replace(/\/+$/, "")}/files/${encodeServerPath(path)}`;
}

/** What a `pythonOnViyaServer:` URI carries. */
export interface ServerUriParts {
  /** The profile whose session serves the file. Sessions are kept per
   * profile (`ComputeSessionManager`). */
  readonly profileId: string;
  /** The file's absolute server path. */
  readonly path: string;
}

/**
 * The `pythonOnViyaServer:` URI string for a file, or with
 * {@link SERVER_FOLDER_SCHEME} a folder's identity URI.
 *
 * The URI's path is cosmetic: it gives the tab its title and the file its
 * extension. `%`, `#` and `?` in it are escaped, `%` first, as
 * `src/content/uri.ts` does.
 *
 * The query carries what is read back, each value **base64url-encoded**.
 * `vscode.Uri` percent-decodes a query before `uri.query` returns it, so a
 * percent-encoded value would come back with a file name's `&` or `+` bare,
 * and split or turn into a space. A base64url value has neither, and a
 * hand-written profile's id (its name) can hold anything.
 */
export function serverUriString(
  parts: ServerUriParts,
  scheme: string = SERVER_SCHEME,
): string {
  const safeName = baseName(parts.path)
    .replace(/%/g, "%25")
    .replace(/#/g, "%23")
    .replace(/\?/g, "%3F");
  return `${scheme}:/${safeName}?p=${toBase64Url(parts.profileId)}&path=${toBase64Url(parts.path)}`;
}

/** The parts a `pythonOnViyaServer:` URI's query carries, or `undefined`
 * when it is not one this extension wrote. */
export function parseServerUri(query: string): ServerUriParts | undefined {
  const params = new URLSearchParams(query);
  const profileId = fromBase64Url(params.get("p"));
  const path = fromBase64Url(params.get("path"));
  if (profileId === undefined || path === undefined) return undefined;
  return { profileId, path: normaliseServerPath(path) };
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

/** The decoded value, or `undefined` for one that is absent, empty, or not
 * base64url. */
function fromBase64Url(value: string | null): string | undefined {
  if (value === null || !/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  const decoded = Buffer.from(value, "base64url").toString("utf8");
  return decoded === "" ? undefined : decoded;
}

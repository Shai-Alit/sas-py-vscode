// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Reads and changes the compute server's files for the SAS Server view: the
 * root, a folder's members, one file's properties and bytes, a save, and
 * (13p-ii) create, rename, move, delete, upload and download.
 *
 * **This module must never import `vscode`.**
 *
 * Structure follows: `RestServerAdapter.ts` in sassoftware/vscode-sas-extension
 * (Apache-2.0), read for what it does and audited rather than transcribed.
 * Where this differs, the 13o probes are why
 * ([ADR-0047](../../docs/adr/0047-sas-server-view-composes-file-paths.md)):
 *
 * - **It borrows the profile's session** from `ComputeSessionManager`, as
 *   `src/data/adapter.ts` does (ADR-0027), and never starts one. Upstream's
 *   `setup()` connects. Unlike the Library adapter there is no busy guard: a
 *   listing and a save both answer at once during a run (Findings 13.23 and
 *   13.27).
 * - **Only the root and an editor's file are reached by a composed URL**
 *   (`serverFilesHref`). A folder is listed by following its own
 *   `getDirectoryMembers` link, and a file's bytes by its `getFile` and
 *   `createFile` links. Upstream composes all of them.
 * - **A save sends the `ETag` the editor's read returned.** Upstream sends
 *   `If-Match: ""`, which turns the server's check off (Finding 13.26).
 * - **A `404` is read by asking the session** (`classifyNotFound`), because a
 *   missing path and a gone session are both `404` (Finding 13.29).
 * - **Every rename, move and delete sends the item's current `ETag`**, read
 *   from its `self` link just before. Upstream sends `If-Match: ""` there too.
 *   The read narrows the window rather than closing it, and the server
 *   requires a tag (`428` without one, Finding 13.26). A folder's tag changes
 *   when a member is added but not when a member's bytes change (Finding
 *   13.33), so a folder delete's confirmation, not its tag, guards what is in
 *   it.
 * - **A rename or move is read from its body, not its status.** A missing or
 *   stale `If-Match` answers `200` with an error as the body (Findings 13.25
 *   and 13.32), and the reply must name the item at its new path.
 * - **A rename always sends `path`.** Without it the server moves the item
 *   into the session's working directory (Finding 13.32).
 *
 * ## The context's root wins over the profile's
 *
 * An administrator can set `fileNavigationRoot` and
 * `fileNavigationCustomRootPath` as compute context attributes, and they then
 * replace the profile's. Upstream reads them on every connect. Here they are
 * read once per session, through `resolveContext` and the context's own
 * `self` link (a context summary has no `attributes`; its detail does), and
 * kept in a {@link ContextAttributeCache} the registrar owns, since an
 * adapter is rebuilt on every call.
 */

import {
  type ComputeClient,
  type ComputeFailure,
  type ComputeRequest,
  type ComputeResponse,
} from "../compute/client";
import { resolveContext } from "../compute/contexts";
import { readSessionState, type ComputeSession } from "../compute/session";
import { findLink, readLinks } from "../wire/links";
import { readViyaError, type ViyaError } from "../wire/viyaError";
import { isValidServerName, serverMoveObjection } from "./move";
import {
  chooseNavigationSetting,
  joinServerPath,
  navigationRoot,
  parentServerPath,
  serverFilesHref,
  type FileNavigationRoot,
  type NavigationRoot,
} from "./path";
import { type ServerProblem } from "./problems";
import {
  CREATE_CHILD_FILE_REL,
  DELETE_DIRECTORY_REL,
  DELETE_FILE_REL,
  DIRECTORY_MEMBERS_REL,
  FILE_CONTENT_REL,
  FILE_WRITE_REL,
  MAKE_DIRECTORY_REL,
  NEXT_REL,
  readServerItem,
  RENAME_DIRECTORY_REL,
  RENAME_FILE_REL,
  SELF_REL,
  sortServerItems,
  type ServerItem,
} from "./types";

/** The media type of one file or folder's properties (Finding 13.20). */
export const FILE_PROPERTIES_TYPE =
  "application/vnd.sas.compute.file.properties";

/** What a save sends: raw bytes, as Finding 13.24 measured. The file's
 * `createFile` link advertises `text/plain`, which was not probed with
 * binary content. */
export const FILE_CONTENT_TYPE = "application/octet-stream";

/** The largest file an editor opens: the cap SAS Content's editor uses
 * (`src/content/adapter.ts`'s `MAX_FILE_CONTENT_BYTES`). */
export const MAX_SERVER_FILE_BYTES = 10 * 1024 * 1024;

/**
 * The largest file an upload or a download moves: 100 MiB, SAS Content's
 * `MAX_TRANSFER_BYTES`, so both views refuse at the same size. It is this
 * extension's limit, not the server's: the compute server took a 110 MiB
 * write and read it back intact (Finding 13.34). Each file is held in memory
 * whole, so the cap bounds that.
 */
export const MAX_SERVER_TRANSFER_BYTES = 100 * 1024 * 1024;

/** The timeout for an upload's or a download's bytes. 110 MiB took about four
 * seconds each way on `verde` (Finding 13.34); SAS Content allows five
 * minutes, and so does this. */
export const SERVER_TRANSFER_TIMEOUT_MS = 300_000;

/** The timeout for deleting an upload's empty file after its bytes failed.
 * It runs after the caller's signal may already have fired, so it is not
 * given that signal. */
export const DISCARD_TIMEOUT_MS = 15_000;

/** Entries asked for per listing page. `500` answered on the probed
 * deployment (Finding 13.22's `showAll` check). */
export const MEMBERS_PAGE_LIMIT = 500;

/** Pages followed before a listing stops, against a `next` that never
 * ends — the guard `src/data/adapter.ts`'s `MAX_DATA_PAGES` carries. */
export const MAX_MEMBER_PAGES = 100;

export interface ServerFailure {
  ok: false;
  reason: string;
  problem: ServerProblem;
}

export type ServerResult<T> = { ok: true; value: T } | ServerFailure;

/** What the adapter reads out of a `ComputeConnection`, which satisfies it
 * structurally. */
export interface ConnectedSession {
  readonly client: ComputeClient;
  readonly session: ComputeSession;
  /** The compute context's name, for its attributes. */
  readonly context: string;
}

/** What the adapter needs from `ComputeSessionManager`. */
export interface ServerSessionSource {
  current(profileId: string): ConnectedSession | undefined;
}

/** The profile's own root setting. */
export interface ProfileNavigation {
  readonly root?: FileNavigationRoot | undefined;
  readonly customPath?: string | undefined;
}

export interface ServerAdapterOptions {
  readonly navigation: ProfileNavigation;
  /** Lists names starting with `.` (upstream's `showHiddenItems`). */
  readonly showHidden: boolean;
  /** Shared across adapters; see this module's doc comment. */
  readonly attributes: ContextAttributeCache;
}

/** A context's attributes, read once per session id. `null` means the
 * context had none, or was not found. */
export class ContextAttributeCache {
  private readonly bySession = new Map<
    string,
    Readonly<Record<string, unknown>> | null
  >();

  get(sessionId: string): Readonly<Record<string, unknown>> | null | undefined {
    return this.bySession.get(sessionId);
  }

  set(
    sessionId: string,
    attributes: Readonly<Record<string, unknown>> | null,
  ): void {
    this.bySession.set(sessionId, attributes);
  }

  clear(): void {
    this.bySession.clear();
  }
}

/** A folder's members, and whether the listing stopped at
 * {@link MAX_MEMBER_PAGES} with more still to read. */
export interface MemberListing {
  readonly items: readonly ServerItem[];
  readonly truncated: boolean;
}

/** The root folder, the setting that named it, and whether the context lets
 * the user download. */
export interface RootListing {
  readonly root: NavigationRoot;
  readonly item: ServerItem;
  /** `false` only when the compute context's `allowDownload` attribute says
   * `false`, as upstream reads it. */
  readonly allowDownload: boolean;
}

/** A file's bytes, and the `ETag` a save of them must send. */
export interface FileContent {
  readonly bytes: Uint8Array;
  readonly etag: string | undefined;
}

export interface CallOptions {
  readonly signal?: AbortSignal | undefined;
}

export class ServerAdapter {
  constructor(
    private readonly sessions: ServerSessionSource,
    readonly profileId: string,
    private readonly options: ServerAdapterOptions,
  ) {}

  /** The tree's root: which folder, and its properties. A `404` on it names
   * the setting that chose it. */
  async getRoot(options?: CallOptions): Promise<ServerResult<RootListing>> {
    const connection = this.require();
    if (!connection.ok) return connection;
    const attributes = await this.contextAttributes(connection.value, options);
    if (!attributes.ok) return attributes;
    const root = navigationRoot(
      chooseNavigationSetting(
        this.options.navigation,
        attributes.value ?? undefined,
      ),
    );
    const item = await this.properties(connection.value, root.path, options, {
      setBy: root.setBy,
      custom: root.custom,
    });
    if (!item.ok) return item;
    if (!item.value.item.isDirectory) {
      return wrongKind(root.path, "folder");
    }
    return {
      ok: true,
      value: {
        root,
        item: item.value.item,
        allowDownload: readAllowDownload(attributes.value),
      },
    };
  }

  /**
   * A folder's members, folders first, each by name. Every page is asked for
   * with the first link's media type (Finding 7.9's rule) and with `showAll`,
   * which the server's own `next` link drops (Finding 13.22). A listing that
   * reaches {@link MAX_MEMBER_PAGES} with a `next` still to follow returns
   * what it has, marked `truncated`, for the tree to say so.
   */
  async getChildren(
    folder: ServerItem,
    options?: CallOptions,
  ): Promise<ServerResult<MemberListing>> {
    const connection = this.require();
    if (!connection.ok) return connection;
    const { client } = connection.value;
    const link = findLink(folder.links, DIRECTORY_MEMBERS_REL);
    if (link === undefined) {
      return linkMissing(`folder "${folder.path}"`, DIRECTORY_MEMBERS_REL);
    }

    const items: ServerItem[] = [];
    let href: string | undefined = withQuery(link.href, [
      `limit=${String(MEMBERS_PAGE_LIMIT)}`,
    ]);
    for (let page = 0; href !== undefined && page < MAX_MEMBER_PAGES; page++) {
      const result = await client.send({
        link: { ...link, href: this.withShowAll(href) },
        ...withSignal(options?.signal),
      });
      if (!result.ok) {
        return await this.classifyNotFound(
          connection.value,
          result,
          folder.path,
          options?.signal,
        );
      }
      const body = readItems(result.value);
      if (body === undefined) {
        return malformed(result.value, 'a listing with no "items" array');
      }
      for (const raw of body) {
        // An entry the reader cannot place is dropped rather than failing
        // the listing, as `src/compute/files.ts` does.
        const item = readServerItem(raw);
        if (item !== undefined) items.push(item);
      }
      href = findLink(readLinks(result.value.body), NEXT_REL)?.href;
    }
    return {
      ok: true,
      value: { items: sortServerItems(items), truncated: href !== undefined },
    };
  }

  /** One path's properties, for an editor's `stat`. */
  async stat(
    path: string,
    options?: CallOptions,
  ): Promise<ServerResult<ServerItem>> {
    const connection = this.require();
    if (!connection.ok) return connection;
    const result = await this.properties(connection.value, path, options);
    return result.ok ? { ok: true, value: result.value.item } : result;
  }

  /** A file's bytes and its `ETag`, refused when it is a folder or over
   * {@link MAX_SERVER_FILE_BYTES}. */
  async readFile(
    path: string,
    options?: CallOptions,
  ): Promise<ServerResult<FileContent>> {
    const connection = this.require();
    if (!connection.ok) return connection;
    const found = await this.properties(connection.value, path, options);
    if (!found.ok) return found;
    const { item, etag } = found.value;
    if (item.isDirectory) return wrongKind(path, "file");
    if (item.size !== undefined && item.size > MAX_SERVER_FILE_BYTES) {
      return tooLarge(path, item.size);
    }
    const link = findLink(item.links, FILE_CONTENT_REL);
    if (link === undefined) {
      return linkMissing(`file "${path}"`, FILE_CONTENT_REL);
    }
    // Asked for as octet-stream, as Finding 13.24 measured, rather than as
    // the link's own `text/plain`.
    const result = await connection.value.client.send({
      link: { ...link, responseType: FILE_CONTENT_TYPE },
      maxBodyBytes: MAX_SERVER_FILE_BYTES,
      ...withSignal(options?.signal),
    });
    if (!result.ok) {
      if (result.problem.code === "compute-response-too-large") {
        return tooLarge(path, item.size ?? MAX_SERVER_FILE_BYTES + 1);
      }
      return await this.classifyNotFound(
        connection.value,
        result,
        path,
        options?.signal,
      );
    }
    if (result.value.rawBody === undefined) {
      return malformed(result.value, "a file's content with no raw bytes");
    }
    return {
      ok: true,
      value: { bytes: result.value.rawBody, etag: result.value.etag ?? etag },
    };
  }

  /**
   * Writes a file's bytes with `If-Match: etag`, the tag of the version the
   * editor read. A `412` is `changed-on-server`. Returns the new `ETag`.
   */
  async writeFile(
    path: string,
    bytes: Uint8Array,
    etag: string,
    options?: CallOptions,
  ): Promise<ServerResult<string | undefined>> {
    const connection = this.require();
    if (!connection.ok) return connection;
    const found = await this.properties(connection.value, path, options);
    if (!found.ok) return found;
    if (found.value.item.isDirectory) return wrongKind(path, "file");
    return await this.writeBytes(
      connection.value,
      found.value.item,
      bytes,
      etag,
      options,
    );
  }

  /** Creates a folder in `parent` (Finding 13.24). */
  async createFolder(
    parent: ServerItem,
    name: string,
    options?: CallOptions,
  ): Promise<ServerResult<ServerItem>> {
    const connection = this.require();
    if (!connection.ok) return connection;
    const created = await this.create(
      connection.value,
      parent,
      name,
      true,
      options,
    );
    return created.ok ? { ok: true, value: created.value.item } : created;
  }

  /**
   * Creates a file in `parent`, empty, or holding `bytes`. The bytes are a
   * second call, a `PUT` with the create's own `ETag` (Finding 13.34). If
   * that fails, the empty file is deleted again with the same tag, so only
   * the file this call made is removed; if that fails too, the result is
   * `left-empty`.
   */
  async createFile(
    parent: ServerItem,
    name: string,
    bytes?: Uint8Array,
    options?: CallOptions,
  ): Promise<ServerResult<ServerItem>> {
    const connection = this.require();
    if (!connection.ok) return connection;
    const created = await this.create(
      connection.value,
      parent,
      name,
      false,
      options,
    );
    if (!created.ok) return created;
    const { item, etag } = created.value;
    if (bytes === undefined) return { ok: true, value: item };

    const written = await this.writeBytes(
      connection.value,
      item,
      bytes,
      etag,
      options,
      SERVER_TRANSFER_TIMEOUT_MS,
    );
    if (written.ok) return { ok: true, value: item };
    if (await this.discard(connection.value, item, etag)) return written;
    return {
      ok: false,
      reason: `${written.reason}; an empty "${item.path}" was left on the SAS server`,
      problem: { code: "left-empty", path: item.path, cause: written.problem },
    };
  }

  /** Renames an item where it is: one `PUT`, with its folder as `path`. */
  async rename(
    item: ServerItem,
    name: string,
    options?: CallOptions,
  ): Promise<ServerResult<ServerItem>> {
    return await this.update(item, name, parentServerPath(item.path), options);
  }

  /** Moves an item into `target`, keeping its name: one `PUT` with the new
   * `path` (Finding 13.25). A folder moves with everything in it (Finding
   * 13.31). Refused before sending when {@link serverMoveObjection} objects. */
  async move(
    item: ServerItem,
    target: ServerItem,
    options?: CallOptions,
  ): Promise<ServerResult<ServerItem>> {
    const objection = serverMoveObjection(item, target);
    if (objection === "target-not-a-folder") {
      return wrongKind(target.path, "folder");
    }
    if (objection !== undefined) {
      return {
        ok: false,
        reason: `"${item.path}" cannot be moved into "${target.path}" (${objection})`,
        problem: { code: "invalid-move", path: item.path, target: target.path },
      };
    }
    return await this.update(item, item.name, target.path, options);
  }

  /** Deletes a file, or a folder and everything in it (Finding 13.33), with
   * the item's current `ETag`. Nothing goes to a recycle bin. */
  async delete(
    item: ServerItem,
    options?: CallOptions,
  ): Promise<ServerResult<void>> {
    const connection = this.require();
    if (!connection.ok) return connection;
    const current = await this.current(connection.value, item, options);
    if (!current.ok) return current;
    const { item: fresh, etag } = current.value;
    if (etag === undefined) return noVersion(item.path);
    const rel = fresh.isDirectory ? DELETE_DIRECTORY_REL : DELETE_FILE_REL;
    const link = findLink(fresh.links, rel);
    if (link === undefined) return linkMissing(`item "${item.path}"`, rel);
    const result = await connection.value.client.send({
      link,
      etag,
      ...withSignal(options?.signal),
    });
    if (!result.ok) {
      return await this.writeFailure(
        connection.value,
        result,
        item.path,
        item.path,
        options,
      );
    }
    return { ok: true, value: undefined };
  }

  /** A file's bytes for a download, by its own `getFile` link, capped at
   * {@link MAX_SERVER_TRANSFER_BYTES}. */
  async downloadFile(
    item: ServerItem,
    options?: CallOptions,
  ): Promise<ServerResult<Uint8Array>> {
    const connection = this.require();
    if (!connection.ok) return connection;
    if (item.isDirectory) return wrongKind(item.path, "file");
    if (item.size !== undefined && item.size > MAX_SERVER_TRANSFER_BYTES) {
      return tooLarge(item.path, item.size, MAX_SERVER_TRANSFER_BYTES);
    }
    const link = findLink(item.links, FILE_CONTENT_REL);
    if (link === undefined) {
      return linkMissing(`file "${item.path}"`, FILE_CONTENT_REL);
    }
    const result = await connection.value.client.send({
      link: { ...link, responseType: FILE_CONTENT_TYPE },
      maxBodyBytes: MAX_SERVER_TRANSFER_BYTES,
      timeoutMs: SERVER_TRANSFER_TIMEOUT_MS,
      ...withSignal(options?.signal),
    });
    if (!result.ok) {
      if (result.problem.code === "compute-response-too-large") {
        return tooLarge(
          item.path,
          item.size ?? MAX_SERVER_TRANSFER_BYTES + 1,
          MAX_SERVER_TRANSFER_BYTES,
        );
      }
      return await this.classifyNotFound(
        connection.value,
        result,
        item.path,
        options?.signal,
      );
    }
    if (result.value.rawBody === undefined) {
      return malformed(result.value, "a file's content with no raw bytes");
    }
    return { ok: true, value: result.value.rawBody };
  }

  /** `POST` `{name, isDirectory}` to the parent's create link. */
  private async create(
    connection: ConnectedSession,
    parent: ServerItem,
    name: string,
    isDirectory: boolean,
    options: CallOptions | undefined,
  ): Promise<ServerResult<{ item: ServerItem; etag: string | undefined }>> {
    if (!isValidServerName(name)) return invalidName(name);
    if (!parent.isDirectory) return wrongKind(parent.path, "folder");
    const rel = isDirectory ? MAKE_DIRECTORY_REL : CREATE_CHILD_FILE_REL;
    const link = findLink(parent.links, rel);
    if (link === undefined) return linkMissing(`folder "${parent.path}"`, rel);
    const path = joinServerPath(parent.path, name);
    const result = await connection.client.send({
      link: {
        ...link,
        type: FILE_PROPERTIES_TYPE,
        responseType: FILE_PROPERTIES_TYPE,
      },
      body: { name, isDirectory },
      ...withSignal(options?.signal),
    });
    if (!result.ok) {
      return await this.writeFailure(
        connection,
        result,
        path,
        parent.path,
        options,
      );
    }
    const item = readServerItem(result.value.body);
    if (item?.path !== path) {
      return malformed(result.value, "the new item's properties");
    }
    return { ok: true, value: { item, etag: result.value.etag } };
  }

  /** The rename-and-move `PUT`: `{name, path}`, always both (Finding 13.32),
   * with the item's current `ETag`, and the reply's body checked. */
  private async update(
    item: ServerItem,
    name: string,
    parentPath: string,
    options: CallOptions | undefined,
  ): Promise<ServerResult<ServerItem>> {
    if (!isValidServerName(name)) return invalidName(name);
    const connection = this.require();
    if (!connection.ok) return connection;
    const current = await this.current(connection.value, item, options);
    if (!current.ok) return current;
    const { item: fresh, etag } = current.value;
    if (etag === undefined) return noVersion(item.path);
    const rel = fresh.isDirectory ? RENAME_DIRECTORY_REL : RENAME_FILE_REL;
    const link = findLink(fresh.links, rel);
    if (link === undefined) return linkMissing(`item "${item.path}"`, rel);
    const target = joinServerPath(parentPath, name);
    const result = await connection.value.client.send({
      link: {
        ...link,
        type: FILE_PROPERTIES_TYPE,
        responseType: FILE_PROPERTIES_TYPE,
      },
      body: { name, path: parentPath },
      etag,
      ...withSignal(options?.signal),
    });
    if (!result.ok) {
      return await this.writeFailure(
        connection.value,
        result,
        target,
        item.path,
        options,
      );
    }
    const embedded = embeddedError(result.value);
    if (embedded !== undefined) {
      return statusFailure(embedded, target, item.path);
    }
    const moved = readServerItem(result.value.body);
    if (moved?.path !== target) {
      return malformed(result.value, "the renamed item's properties");
    }
    return { ok: true, value: moved };
  }

  /** An item's properties and `ETag` now, by its own `self` link. */
  private async current(
    connection: ConnectedSession,
    item: ServerItem,
    options: CallOptions | undefined,
  ): Promise<ServerResult<{ item: ServerItem; etag: string | undefined }>> {
    const self = findLink(item.links, SELF_REL);
    if (self === undefined) return linkMissing(`item "${item.path}"`, SELF_REL);
    const result = await connection.client.send({
      link: { ...self, method: "GET", type: FILE_PROPERTIES_TYPE },
      ...withSignal(options?.signal),
    });
    if (!result.ok) {
      return await this.classifyNotFound(
        connection,
        result,
        item.path,
        options?.signal,
      );
    }
    const fresh = readServerItem(result.value.body, item.path);
    if (fresh === undefined) {
      return malformed(result.value, "a file or folder's properties");
    }
    return { ok: true, value: { item: fresh, etag: result.value.etag } };
  }

  /** `PUT` a file's bytes by its `createFile` link with `If-Match: etag`. */
  private async writeBytes(
    connection: ConnectedSession,
    item: ServerItem,
    bytes: Uint8Array,
    etag: string | undefined,
    options: CallOptions | undefined,
    timeoutMs?: number,
  ): Promise<ServerResult<string | undefined>> {
    if (etag === undefined) return noVersion(item.path);
    const link = findLink(item.links, FILE_WRITE_REL);
    if (link === undefined) {
      return linkMissing(`file "${item.path}"`, FILE_WRITE_REL);
    }
    const result = await connection.client.send({
      link: { ...link, type: FILE_CONTENT_TYPE },
      rawBody: bytes,
      etag,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...withSignal(options?.signal),
    });
    if (!result.ok) {
      return await this.writeFailure(
        connection,
        result,
        item.path,
        item.path,
        options,
      );
    }
    return { ok: true, value: result.value.etag };
  }

  /** Deletes an upload's empty file with the create's `ETag`, under its own
   * timeout. Whether it is gone. */
  private async discard(
    connection: ConnectedSession,
    item: ServerItem,
    etag: string | undefined,
  ): Promise<boolean> {
    const link = findLink(item.links, DELETE_FILE_REL);
    if (link === undefined || etag === undefined) return false;
    const result = await connection.client.send({
      link,
      etag,
      timeoutMs: DISCARD_TIMEOUT_MS,
    });
    return result.ok;
  }

  /**
   * A failed write: `409` is `name-taken` at `target`, `412` is
   * `changed-on-server` at `path`, and anything else is read as
   * {@link classifyNotFound} reads it, at `path`. A move into a missing
   * folder is also a `404` (Finding 13.31); it is reported at the item's own
   * path, since the status does not say which was missing, and the log's
   * detail names the folder.
   */
  private async writeFailure(
    connection: ConnectedSession,
    failure: ComputeFailure,
    target: string,
    path: string,
    options: CallOptions | undefined,
  ): Promise<ServerFailure> {
    const { problem } = failure;
    if (
      problem.code === "compute-rejected" &&
      (problem.error.status === 409 || problem.error.status === 412)
    ) {
      return statusFailure(problem.error, target, path);
    }
    return await this.classifyNotFound(
      connection,
      failure,
      path,
      options?.signal,
    );
  }

  /** The profile's session, or `not-connected`. */
  private require(): ServerResult<ConnectedSession> {
    const connection = this.sessions.current(this.profileId);
    if (connection === undefined) {
      return {
        ok: false,
        reason: "no active SAS Viya session for browsing the SAS server",
        problem: { code: "not-connected" },
      };
    }
    return { ok: true, value: connection };
  }

  /** `GET` a path's properties through the one composed URL (ADR-0047). */
  private async properties(
    connection: ConnectedSession,
    path: string,
    options: CallOptions | undefined,
    root?: { setBy: NavigationRoot["setBy"]; custom: boolean },
  ): Promise<ServerResult<{ item: ServerItem; etag: string | undefined }>> {
    const self = findLink(connection.session.links, SELF_REL);
    if (self === undefined) {
      return linkMissing(
        `compute session "${connection.session.id}"`,
        SELF_REL,
      );
    }
    const request: ComputeRequest = {
      link: {
        rel: SELF_REL,
        method: "GET",
        href: serverFilesHref(self.href, path),
        type: FILE_PROPERTIES_TYPE,
      },
      ...withSignal(options?.signal),
    };
    const result = await connection.client.send(request);
    if (!result.ok) {
      return await this.classifyNotFound(
        connection,
        result,
        path,
        options?.signal,
        root?.custom === true ? { setBy: root.setBy } : undefined,
      );
    }
    const item = readServerItem(result.value.body, path);
    if (item === undefined) {
      return malformed(result.value, "a file or folder's properties");
    }
    return { ok: true, value: { item, etag: result.value.etag } };
  }

  /**
   * A failure, with a `404` read by asking the session whether it is still
   * there (Finding 13.29): `session-gone` if not, `path-not-found` if so.
   * Any other failure passes through as a `compute` problem.
   */
  private async classifyNotFound(
    connection: ConnectedSession,
    failure: ComputeFailure,
    path: string,
    signal: AbortSignal | undefined,
    root?: { readonly setBy: NavigationRoot["setBy"] },
  ): Promise<ServerFailure> {
    const { problem } = failure;
    if (problem.code !== "compute-rejected" || problem.error.status !== 404) {
      return asServerFailure(failure);
    }
    const state = await readSessionState(
      connection.client,
      connection.session,
      { waitSeconds: 0, signal },
    );
    if (!state.ok) return asServerFailure(state);
    return {
      ok: false,
      reason: `"${path}" is not available on the SAS server`,
      problem: { code: "path-not-found", path, error: problem.error, root },
    };
  }

  /** The context's attributes for this session, read once. */
  private async contextAttributes(
    connection: ConnectedSession,
    options: CallOptions | undefined,
  ): Promise<ServerResult<Readonly<Record<string, unknown>> | null>> {
    const cached = this.options.attributes.get(connection.session.id);
    if (cached !== undefined) return { ok: true, value: cached };

    const found = await resolveContext(
      connection.client,
      connection.context,
      options,
    );
    if (!found.ok) return asServerFailure(found);
    let attributes: Readonly<Record<string, unknown>> | null = null;
    if (found.value !== undefined) {
      const self = findLink(found.value.links, SELF_REL);
      if (self === undefined) {
        return linkMissing(`compute context "${found.value.name}"`, SELF_REL);
      }
      const detail = await connection.client.send({
        link: self,
        ...withSignal(options?.signal),
      });
      if (!detail.ok) return asServerFailure(detail);
      attributes = readAttributes(detail.value.body);
    }
    this.options.attributes.set(connection.session.id, attributes);
    return { ok: true, value: attributes };
  }

  private withShowAll(href: string): string {
    return /[?&]showAll=/.test(href)
      ? href
      : withQuery(href, [`showAll=${String(this.options.showHidden)}`]);
  }
}

/** Whether the context lets the user download: `false` only for an
 * `allowDownload` of `false`, or `"false"` in any case, as upstream reads it. */
function readAllowDownload(
  attributes: Readonly<Record<string, unknown>> | null,
): boolean {
  const value = attributes?.allowDownload;
  if (value === false) return false;
  return !(typeof value === "string" && value.toLowerCase() === "false");
}

/**
 * The error a `200` carries as its body, or `undefined` when the body is not
 * one. A rename with a missing or stale `If-Match` answers this way, with the
 * outer `httpStatusCode` `0` and the real one inside `errors[0]` (Findings
 * 13.25 and 13.32). The returned `status` is that inner one, since the wire's
 * `200` says nothing.
 */
function embeddedError(response: ComputeResponse): ViyaError | undefined {
  const body: unknown = response.body;
  if (typeof body !== "object" || body === null) return undefined;
  const envelope = body as Record<string, unknown>;
  if (typeof envelope.errorCode !== "number") return undefined;
  const errors: unknown = envelope.errors;
  const first: unknown = Array.isArray(errors)
    ? (errors as readonly unknown[])[0]
    : undefined;
  const inner: unknown =
    typeof first === "object" && first !== null
      ? (first as Record<string, unknown>).httpStatusCode
      : undefined;
  const outer: unknown = envelope.httpStatusCode;
  const status =
    typeof inner === "number" && inner > 0
      ? inner
      : typeof outer === "number" && outer > 0
        ? outer
        : response.status;
  return readViyaError(status, response.text);
}

/** A write refused with `error`: `409` as `name-taken` at `target`, `412` as
 * `changed-on-server` at `path`, anything else as `compute-rejected`. */
function statusFailure(
  error: ViyaError,
  target: string,
  path: string,
): ServerFailure {
  if (error.status === 409) {
    return {
      ok: false,
      reason: `"${target}" already exists on the SAS server`,
      problem: { code: "name-taken", path: target, error },
    };
  }
  if (error.status === 412) {
    return {
      ok: false,
      reason: `"${path}" changed on the SAS server since it was read`,
      problem: { code: "changed-on-server", path, error },
    };
  }
  return {
    ok: false,
    reason: `the SAS server refused the change to "${path}" (HTTP ${String(error.status)})`,
    problem: {
      code: "compute",
      problem: { code: "compute-rejected", error },
    },
  };
}

function invalidName(name: string): ServerFailure {
  return {
    ok: false,
    reason: `"${name}" is not a name a file or folder can have`,
    problem: { code: "invalid-name", name },
  };
}

function noVersion(path: string): ServerFailure {
  return {
    ok: false,
    reason: `"${path}" has no version tag to change it against`,
    problem: { code: "no-version", path },
  };
}

/** A context detail's `attributes`, or `null` when it has none. */
function readAttributes(
  body: unknown,
): Readonly<Record<string, unknown>> | null {
  if (typeof body !== "object" || body === null) return null;
  const attributes: unknown = (body as { attributes?: unknown }).attributes;
  return typeof attributes === "object" &&
    attributes !== null &&
    !Array.isArray(attributes)
    ? (attributes as Readonly<Record<string, unknown>>)
    : null;
}

function readItems(response: ComputeResponse): readonly unknown[] | undefined {
  const body: unknown = response.body;
  if (typeof body !== "object" || body === null) return undefined;
  const items: unknown = (body as { items?: unknown }).items;
  return Array.isArray(items) ? (items as readonly unknown[]) : undefined;
}

function withQuery(href: string, parameters: readonly string[]): string {
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}${parameters.join("&")}`;
}

function withSignal(signal: AbortSignal | undefined): {
  signal?: AbortSignal;
} {
  return signal === undefined ? {} : { signal };
}

function asServerFailure(failure: ComputeFailure): ServerFailure {
  return {
    ok: false,
    reason: failure.reason,
    problem: { code: "compute", problem: failure.problem },
  };
}

function linkMissing(resource: string, rel: string): ServerFailure {
  return {
    ok: false,
    reason: `the ${resource} carried no "${rel}" link in the response this account read`,
    problem: {
      code: "compute",
      problem: { code: "link-missing", rel, resource },
    },
  };
}

function malformed(response: ComputeResponse, what: string): ServerFailure {
  return {
    ok: false,
    reason:
      "the compute service did not answer with what the SAS Server view expected",
    problem: {
      code: "compute",
      problem: {
        code: "response-malformed",
        detail: `a SAS server files request answered HTTP ${String(response.status)} as ${response.contentType ?? "an unknown type"}, not ${what}`,
      },
    },
  };
}

function wrongKind(path: string, expected: "file" | "folder"): ServerFailure {
  return {
    ok: false,
    reason: `"${path}" is not a ${expected}`,
    problem: { code: "wrong-kind", path, expected },
  };
}

function tooLarge(
  path: string,
  size: number,
  limitBytes: number = MAX_SERVER_FILE_BYTES,
): ServerFailure {
  return {
    ok: false,
    reason: `"${path}" is ${String(size)} bytes, over the ${String(limitBytes)}-byte limit`,
    problem: { code: "too-large", path, size, limitBytes },
  };
}

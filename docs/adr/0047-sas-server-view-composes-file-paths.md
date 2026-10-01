# ADR-0047 — The SAS Server view composes a session's files URL from a server path

- **Status:** Accepted
- **Date:** 2026-10-01
- **Decides:** how the SAS Server view reaches a folder or file on the
  compute server, what its editor URI carries, and which session it uses
- **Amends:** [ADR-0010](0010-compute-client-is-hand-written.md), whose
  "navigate by link relation rather than by constructed path" gains a
  third, bounded exception
- **Constrained by:** [ADR-0027](0027-library-adapter-shape.md) (borrow
  the active profile's session, never start one),
  [ADR-0040](0040-every-uri-scheme-is-the-extensions-own.md) (the scheme
  starts with `pythonOnViya`)
- **Executed in:** Phase 13, slice 13p-i (the "13p-i built" Runbook entry
  in [`docs/phases/phase-13.md`](../phases/phase-13.md))
- **Evidence:** Findings 13.20–13.29 in
  [`docs/phases/phase-13.md`](../phases/phase-13.md); Sean's choices,
  2026-10-01, recorded in that file's "13o done" entry

## Context

Upstream's SAS Server view lists files on the compute server through the
Compute service's `/compute/sessions/{id}/files/…` API. It composes every
URL from a path, writing `/` as `~fs~`.

ADR-0010 has this project navigate by link relation instead, and only two
URLs are composed anywhere: the contexts collection and one session by id
(`src/compute/session.ts`). The 13o probes found that links alone cannot
build this view:

- A session's `getFiles` link reaches only its own working directory, an
  empty per-session folder (Finding 13.20).
- No directory or file carries a link to its parent, so nothing leads from
  that folder to `/`, or to a custom root such as `/mnt/shared`.
- A file's links name the session they were read from. Sessions end after
  15 minutes idle, and this view never starts one. A file open in an
  editor would then hold an address that no longer exists, and could not
  be saved after the user reconnects.

## Decision

1. **One function composes a files URL from a server path:** the
   session's own `self` href, then `/files/`, then the path encoded as the
   server encodes it (Finding 13.22): each segment's `~` as `~~` and `;` as
   `~sc~`, then percent-encoded, joined with `~fs~`; `/` alone is `~fs~`.
   It lives in `src/server/path.ts` and is the only place this view builds
   a URL. Findings 13.22 and 13.28 confirmed it gives the server's own
   href, byte for byte, for `;`, `~`, `#`, spaces and non-ASCII names.
2. **It is used for exactly two things:** the root folder the tree starts
   from, and the file an editor reads or saves. Below the root, the tree
   follows each item's `getDirectoryMembers` link, and paging follows
   `next`. Reading a file's content follows its `getFile` link; saving
   follows its `createFile` link (`PUT …/content`).
3. **The editor URI carries the profile id and the server path,** never a
   session-bound href: `pythonOnViyaServer:/{name}?p={profile id}&path=
   {server path}`. Each read and save looks up that profile's current
   session, so a file opened before a reconnect saves after it.
4. **The view borrows the active profile's session** (ADR-0027). With no
   session it shows a Connect welcome; it never starts a session or signs
   anyone in. Unlike the Library view it does not refuse while a run is in
   progress: a listing and a save both answer at once during a run
   (Findings 13.23 and 13.27).
5. **A write sends the item's real `ETag`.** An empty `If-Match` turns the
   server's check off (Finding 13.26). An editor save sends the `ETag` its
   read returned, so a file changed on the server since it was opened is
   refused (`412`) rather than overwritten.
6. **A `404` is read by asking the session.** The same status means "no
   such path" and "no such session" (Findings 13.21 and 13.29). On a `404`
   the view reads the session's own `state` link: a `404` there means the
   session is gone; otherwise the path is missing or hidden. SAS's
   `errorCode`s are not branched on (`src/wire/viyaError.ts`).

## Alternatives considered

**Root only, links below it.** The URI would hold the session-bound href.
Rejected: once the session ends, an open file could not be saved, and the
user would have to copy out unsaved edits and reopen it.

**Compose every URL, as upstream does.** Listings would be built from
paths too. Rejected: the links are there and carry the server's own
encoding, and each composed URL is one more place an encoding mistake can
hide.

**Start a session when the view is expanded, as upstream does.** Rejected
by ADR-0027's rule: expanding a tree should not start a SAS process.

## Consequences

- ADR-0010's rule now has three exceptions, each in one named function.
  A fourth needs its own ADR.
- An encoding mistake in `src/server/path.ts` would address the wrong
  file. Its unit tests pin the encodings Findings 13.22 and 13.28 observed.
- A custom root that does not exist, or that the server hides, is a `404`
  on the root, and the view says whether the profile or the compute
  context set it, as upstream does.
- 13p-ii's create, rename, move and delete follow the item's own links,
  and add no new composed URL.

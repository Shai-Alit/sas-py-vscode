# Viya 4 fixtures

Nothing goes in here that was not captured from a live Viya 4 deployment and then
sanitised. See [../README.md](../README.md) for the procedure.

Every identifier below is synthetic. The session id
`3f2b1c0a-…-ses0000` and the job id `A1B2C3D4-…` are shared across the files so
that the three compose into one coherent run, which is not how they were
captured — each came from its own throwaway session.

## `compute-session-created.json`

The `201` body from `POST` on a context's `createSession` relation
(`PROBE-FINDINGS.md` finding 21). Twenty-two link relations, which is the whole
session API, and `attributes.sessionInactiveTimeout` at the deployment's 900.

## `compute-job-created.json`

The `201` body from `POST` on a session's `execute` relation (finding 46). Six
fields and ten relations, with `state` at `pending` — a create response never
carries an answer about completion.

Two things in it are the point of keeping it. `cancel` and `delete` carry
**`type: null` explicitly**, where a session's equivalents omit the key, so a
reader must treat absent and null alike. And `log` and `logAsText` are the
**same href**, differing only in `rel` and media type.

Recorded from a projection of the response rather than the whole document, so
two keys the real payload may carry are absent here rather than guessed at: the
`uri` that sits beside `href` on a session's links, and the `itemType` a session's
`log` relation carries. Nothing reads either.

## `compute-job-log-page.json`

One page of `GET {job}/log`, holding the twenty-one lines of finding 52 verbatim
— a job that printed one line and then failed on a bad libref.

It is kept because the vocabulary is the awkward part. Four `type` values appear
(`source`, `note`, `normal`, `error`) and the set is open. `note` is a
**catch-all**: ten of its thirteen lines carry no `NOTE:` prefix, four are the
empty string and two are spaces only — so a filter written as a prefix test
misclassifies most of them, and a reader that drops empty strings deletes the
log's vertical spacing. The `ERROR:` at index 12 is **interleaved with the source
echo**, sitting between the `set` that provoked it and that step's `run;`.

The lines are the wire; the envelope around them is partly reconstructed, and
which is which matters:

- **Recorded.** `count` is `21` and `start` is `0` as finding 51 measured them,
  and `count` is the job's running total rather than this page's size. The
  `version` key is recorded as present on every item (finding 47) — its *value*
  was not, so `1` is a placeholder and nothing reads it. `limit` is absent
  because it was never observed either way.
- **Reconstructed.** The `links` array. Finding 51 recorded two rel sets, for a
  first page carrying `next` and for a last page carrying `prev`; a page that is
  **both** first and last was never captured, so this one is finding 51's first
  page with `next` removed. It is a plausible shape, not an observed one.

One test does assert on the reconstruction — that `next` is **absent**, which is
what ends a drain — and it is worth being clear that this pins the *parser*
rather than the service: it says a page with no `next` relation yields a
`LogPage` with no `next`, which would be true of any envelope built this way. The
claim that a real full-and-final page carries no `next` rests on finding 51,
where it was measured, not on this file.

# Phase 2b — The seam, dialects, and stage-1 capability probing

Bundled for this phase: plan section, runbook punch list, and probe
findings. See `STATUS.md` for where this fits in the overall project,
and the trimmed `PRODUCTION_PLAN.md` / `RUNBOOK.md` at the repo root
for cross-cutting material (architecture, quality gates, the per-slice
loop, conventions).

---

## Plan

_Not yet detailed in PRODUCTION_PLAN.md beyond the phase list._

---

## Runbook

# 2b-i — the seam and the dialects
git checkout -b phase-2b-i-backend-seam
git commit -m "feat(backend): define ExecutionBackend interface and Viya dialect layer"

# 2b-ii — contracts and stage-1 capability probing
git checkout -b phase-2b-ii-contracts-and-probing
git commit -m "feat(dialects): add API contract files, their checker, and stage-1 capability probing"

# ⛔ BARRIER

---

## Probe findings

## 2026-08-16 — Submission mechanism (2-pre), before 2b freezes the interface (Viya 4)

The probe `PRODUCTION_PLAN.md` requires **before** 2b, because all three answers
shape the interface 2b freezes: how user code containing SAS-significant text
behaves when it is inlined into a `SUBMIT` block, whether `SYSCC` is readable as
a session variable rather than only from log text, and how the Python namespace
is cleared without destroying the compute session.

**This probe wrote.** Two sessions in the `SAS Studio compute context`, fourteen
jobs between them, and one fileref whose content was uploaded twice. Both
sessions were deleted at the end and the first was confirmed gone (`404`); the
fileref was deassigned first (`204`). TLS verification was disabled for the probe
only. The endpoint and the user identity are scrubbed here as elsewhere.

### Finding 31 — A bare `endsubmit;` line ends the block; the same text inside a line does not

Two forms, and only one of them is dangerous.

**Embedded, harmless.** `x = "endsubmit;"` — the terminator inside a Python
string on a line with other tokens — reached Python intact: `len(x)` printed
`10`, and the block ran through to its last statement.

**Alone on a line, fatal.** A line whose only content is `endsubmit;` ends the
`SUBMIT` block even when Python considers it to be inside a triple-quoted string:

```
proc python;
submit;
print("MARK-A")
s = """
endsubmit;      <- SAS ends the block here
"""
print("MARK-B", len(s))
```

SAS then parsed the remainder as SAS. The `"""` on the next line produced
`ERROR 180-322: Statement is not valid or it is used out of proper order`, the
step was abandoned, and **not one line of the Python ran** — `MARK-A` never
printed, although it came before the terminator. The job reported `state: error`.

The risk is therefore not "the file mentions `endsubmit`". It is a line that
stands alone as that statement after SAS has looked at it, which is ordinary
Python inside any triple-quoted string, and entirely unremarkable in test data,
documentation strings, or a file that talks about this extension.

### Finding 32 — Inside an intact block, SAS neither resolves macros nor tokenises quotes

Everything else thrown at the inline path came through byte for byte. With
`%let probevar = SECRET42;` executed in the same job, immediately before the
procedure:

| Submitted inside `SUBMIT` | Python saw |
| --- | --- |
| `print("amp-dq:&probevar")` | `amp-dq:&probevar` |
| `print('amp-sq:&probevar')` | `amp-sq:&probevar` |
| `print("pct: %let notreally = 1;")` | `pct: %let notreally = 1;` |
| `t = "don't stop"` | `len(t)` → `10` |
| `u = 'it''s'` | `len(u)` → `3` |
| `# don't stop -- a lone apostrophe in a comment` | ignored as a comment; the job stayed healthy and a following `data _null_` step still ran |
| `v = "quote: \" and apos: '"` | `len(v)` → `20` |

Three of those matter more than the rest. **No macro resolution happens**, in
either quote style, for an automatic (`&sysuserid`, tested separately) or a
user-defined variable — so the `&`-in-a-string hazard `PRODUCTION_PLAN.md` §1.5
anticipated does not fire inside a `SUBMIT` block. **`''` is not collapsed**:
Python received both apostrophes and read them as its own implicit concatenation
of `'it'` and `'s'`, giving 3 characters. And **an unbalanced apostrophe in a
comment is harmless** while the block is intact.

That last one is worth stating carefully, because it is easy to read finding 33
as contradicting it. It does not: the quote damage there happened *after* the
block had already been ended early by finding 31's mechanism, at a point where
SAS was no longer reading Python.

### Finding 33 — A block ended early can leave the tokeniser inside an open quote, and every later job then does nothing while reporting `completed`

This is the worst thing in this probe, and it was found by accident.

The job in finding 31 left SAS parsing `"""` as SAS source: an empty literal
followed by an unterminated one. The session stayed in that state **across job
boundaries**. The next job's statements were swallowed as string content — no
output, no error, no NOTE that anything was wrong — and the one after that
finally produced `NOTE: The quoted string currently being processed has become
more than 262 bytes long. You might have unbalanced quotation marks.` Both jobs
returned **`state: completed`** with the source echoed into the log and nothing
executed. A `PROC PYTHON` step swallowed this way was later measured at
`real time 1:36.57`, so it also hangs.

Recovery is the incantation `PRODUCTION_PLAN.md` §1.5 already names, and it
works:

```
*';*";*/;quit;run;
options nosyntaxcheck nodmssynchk;
%let syscc=0;
```

After it, a `data _null_` step printed again and `PROC PYTHON` resumed its
previous state. **Consequences for the client, and they are not small.** A job's
`state` is *not* a success signal — `completed` covered two jobs that ran nothing
at all. Whatever submission mechanism 3a chooses must either be incapable of
ending the block early (finding 35) or must send the recovery incantation before
every submission, and the extension cannot rely on the user noticing, because the
symptom is silence.

### Finding 34 — `PROC PYTHON`'s option set is enumerated by its own error message

`proc python file=probef;` is not valid syntax, and the error is more useful than
the documentation:

```
ERROR 22-322: Syntax error, expecting one of the following:
              ;, COMMAND, ECHO, INFILE, RESTART, SRC, TERMINATE, TIMEOUT.
```

So the surface is `COMMAND`, `ECHO`, `INFILE`, `RESTART`, `SRC`, `TERMINATE`,
`TIMEOUT`. `INFILE` and `RESTART` are used below. `ECHO` and `TIMEOUT` are
unprobed and both look relevant later — `ECHO` to the log noise 3b filters, and
`TIMEOUT` to 3d-i's Cancel. `TERMINATE` and `RESTART` are *options on the `PROC`
statement*, not statements inside the block: `terminate;` written as a statement
is `ERROR 180-322`.

### Finding 35 — `infile=` runs an uploaded file byte for byte, and echoes no source

`proc python infile=<fileref>;` and `proc python infile="/path/to/file.py";` both
execute an uploaded file, and the file is never seen by the SAS tokeniser. The
same content that destroyed the inline path in finding 31 ran correctly:

| In the file | Result |
| --- | --- |
| `endsubmit;` alone on a line inside `"""…"""` | survived — `len(s)` → `12`, i.e. `\nendsubmit;\n` |
| `"has %let and &sysuserid and ; semicolons"` | survived — `len(t)` → `40` |
| `# don't …` (apostrophe in a comment) | harmless |
| `café ✓` (UTF-8) | printed correctly |
| no trailing newline | ran |

**The file's source is not echoed into the log**, which the inline path does line
by line. That removes the largest single category of noise 3b would otherwise
have to strip, and it means the log holds Python's own output plus SAS's NOTEs
and nothing else.

`restart` composes with it in one statement — `proc python restart infile=probef;`
destroyed the interpreter, started a new one, and ran the file, all in one step.

**This is the answer to 2-pre (i): upload and `infile=`, not inline.** Inline is
byte-faithful in every case tested except one, but that one is silent, is trivial
to hit by accident, and poisons the session rather than the submission.

### Finding 36 — Uploading needs an `If-Match`, and the round trip is byte-identical

A fileref is created with `POST /compute/sessions/{id}/filerefs`, media type
`application/vnd.sas.compute.fileref.request+json`, body `{"name":…,"path":…}`.
The response carries `accessMethod: "DISK"`, `fileName`, `filePath`, `fileSize`,
an `id` equal to the requested name, and seven links: `self`, `alternate`,
`deassign` (`DELETE` the fileref), `content` (`GET`), **`upload` (`PUT`
…/content)**, `append` (`POST`), and `delete` (`DELETE` …/content).

`PUT …/content` with `Content-Type: application/octet-stream` and no `If-Match`
returns **`428 Precondition Required`**. With the `ETag` from a `GET` of the
fileref it returns **`201`**. A 191-byte payload — UTF-8, no trailing newline —
came back from `GET …/content` **byte-identical**, md5 for md5.

Two smaller things. The fileref collection starts at `count: 0` in a new session,
so nothing has to be cleaned up before use. And the `files` endpoint (as opposed
to `filerefs`) rejects `application/vnd.sas.collection+json` with a `406` and
names the acceptable types in `remediation`; its hrefs encode path separators as
`~fs~`.

### Finding 37 — `SYSCC` is a readable session variable, and Compute resets it per job

`GET /compute/sessions/{id}/variables/SYSCC` returns `200` and
`{"name":"SYSCC","scope":"GLOBAL","value":"0","version":1}` with a `self` link.
The variables collection reports `count: 83` on a fresh session, and a `%let`
issued in a job shows up in it (`PROBEVAR` / `SECRET42`), so the endpoint reads
live session state rather than a snapshot.

**`SYSCC` is therefore not log-only, and 3a does not depend on 3b.** The plan's
contingency — reorder or merge the two slices — is not needed. `SYSERR` and
`SYSERRORTEXT` are readable the same way; after the finding 31 failure
`SYSERRORTEXT` held `180-322: Statement is not valid or it is used out of prop…`,
truncated by the service, not by us.

**Compute resets `SYSCC` between jobs.** A job that ended with `SYSCC=1012` was
followed by one that read `&syscc` as `0` in its first statement, with no reset
sent by us. So the value read after a job is that job's, and the client does not
have to zero it first — but nothing here proves the reset is a documented
guarantee rather than an implementation detail, so 3a should still read the value
it cares about immediately after the job it cares about.

### Finding 38 — The interpreter persists across jobs, and `restart` clears it without touching the session

`NOTE: Resuming Python state from previous PROC PYTHON invocation.` appears on
every `PROC PYTHON` after the first, in the same session, **including across
separate jobs**. A variable set in one job was still defined in the next, with
the same interpreter pid.

`proc python restart;` prints `NOTE: Previous Python state destroyed.` followed
by `NOTE: Python initialized.`, and afterwards the marker variable was gone and
the pid had changed (382 → 480). `proc python terminate;` prints
`NOTE: Python terminated.` and the next invocation initialises a fresh one. The
compute session is untouched by either — macro variables, librefs and filerefs
survive, because only the interpreter is recycled.

**This is the answer to 2-pre (iii): `restart`.** It costs about 3.4 seconds to
destroy and initialise, measured twice; a first initialisation in a new session
is about 1.8–4.5 seconds. So `freshNamespace` is a real option on every run
rather than a session-lifecycle event, and neither `reset()` nor the cancellation
fallback needs to destroy the session.

### Finding 39 — A Python exception is `SYSCC=1012`, and the traceback carries two wrapper frames

An unhandled exception produced, in this order: the output written before it, an
`ERROR: Unhandled Python exception.` log line of type `error`, the Python
traceback as `normal` lines, and `NOTE: The SAS System stopped processing this
step because of errors.` The job reported `state: error`, and afterwards
`SYSCC` = `SYSERR` = **`1012`**, with `SYSERRORTEXT` = `Unhandled Python
exception.` A SAS-side syntax error gives `SYSCC=3000` instead, so the two are
distinguishable.

The traceback is not clean:

```
Traceback (most recent call last):
  File "<stdin>", line 5, in <module>
  File "<stdin>", line 2, in <module>
  File "<string>", line 2, in <module>
ValueError: boom-at-line-2
```

The user's own frame is the **last** one, `<string>`, and its line number is
correct against the uploaded file — line 2 raised. The two `<stdin>` frames above
it belong to the harness `PROC PYTHON` wraps around the code. With `infile=` the
offset map for the user's frame is therefore the identity, which is one fewer
thing for 3a to get wrong, but 3b must drop the wrapper frames or every traceback
the user sees will point at lines they did not write.

### What 2-pre settles

1. **Submission is by upload, not by inlining.** Create a fileref, `PUT` the
   editor's bytes with an `If-Match`, run `proc python infile=<fileref>;`. This
   is the only mechanism tested that cannot end the block early, and it also
   removes the source echo from the log.
2. **Failure detection reads `SYSCC` from the variables endpoint.** 3a is
   independent of 3b; the slices keep their planned order.
3. **`freshNamespace` is `proc python restart`,** at roughly 3.4 seconds, with
   the compute session left alone.

### What this probe did not settle

- **`ECHO`, `TIMEOUT`, `COMMAND` and `SRC`.** Named by finding 34's error message
  and never tried. `TIMEOUT` may be the honest answer to 3d-i's Cancel, and `SRC`
  may be a second way to hand over code; both should be probed before 3a fixes a
  design.
- **Whether `SYSCC`'s per-job reset is contractual.** Observed twice, not
  documented here.
- **Large files and concurrency.** The uploaded payload was 191 bytes and one
  job ran at a time. Nothing here says how a megabyte of Python behaves, nor what
  a second job submitted during a `PROC PYTHON` step does.
- **Where the uploaded file should live, and who can read it.** `/tmp` on the
  compute node was used because it was convenient. The session home directory
  under `…/compsrv/default/<session-id>` is the obvious alternative and was not
  compared, and no permissions were checked.
- **Cleanup on failure.** The fileref was deassigned by hand at the end. What
  happens to an uploaded file when a session dies mid-run was not observed.
- **Viya 3.5**, as everywhere else in this file.

## 2026-08-17 — The cadence endpoint (2b-ii), before stage-1 probing is written (Viya 4)

Stage-1 capability probing (§2.3) rests on a single endpoint:
`GET /deploymentData/cadenceVersion`, added in Viya 4 and absent from Viya 3.5.
`src/dialects/resolve.ts` already names its three outcomes — `cadence`, `absent`,
`unreadable` — and this probe ran to find out what those three look like on the
wire before code is written to tell them apart. The third one turned out to be
the interesting one.

**Read-only.** Seven `GET`s and one `HEAD`; nothing was created. TLS
verification was disabled for the probe only. The endpoint host, the token and
the per-request correlator ids are scrubbed here as elsewhere.

### Finding 40 — The cadence resource carries four fields, and the one to show a user is not the one to branch on

`GET /deploymentData/cadenceVersion` answers **200** with
`content-type: application/vnd.sas.deployment.data.cadence.version+json; charset=utf-8; version=1`,
in 0.25–0.29 s over three runs. The body:

```json
{
  "cadenceDisplayName": "Long-Term Support 2026.03",
  "cadenceName": "lts",
  "cadenceRelease": "20260721.1784653667906",
  "cadenceVersion": "2026.03",
  "links": [
    {
      "rel": "self",
      "href": "/deploymentData/cadenceVersion",
      "uri": "/deploymentData/cadenceVersion",
      "type": "application/vnd.sas.deployment.data.cadence.version"
    }
  ],
  "version": 1
}
```

`cadenceVersion` is `2026.03` — exactly the `^\d{4}\.\d{2}$` shape the `CADENCE`
pattern in `resolve.ts` already anchors on, so `resolveDialectId` accepts it
unchanged and no new parsing is needed. `cadenceRelease` is a build stamp rather
than a version and nothing should try to order it. `cadenceName` is the support
track (`lts`), and `cadenceDisplayName` is the string to put in the output
channel: "Long-Term Support 2026.03" tells a user which release *and* which track
in one line, where a bare `2026.03` tells them half of it.

`links[].type` omits the `+json` suffix again (finding 14), and `version: 1` is
the representation version, not the deployment's. `HEAD` answers 200 too, so
presence is testable without a body — but the body is what we want, so the probe
should `GET`.

### Finding 41 — The endpoint is unauthenticated, and the union's stated reason is wrong

No `Authorization` header at all: **200**. A deliberately malformed bearer
token: **200**. For contrast, `/compute/contexts` with no token is **401** with a
`vnd.sas.error+json;version=2` body reading "Full authentication is required to
access this resource".

Two consequences, one comfortable and one not. The comfortable one: an expired
token cannot make the cadence probe fail, so an `unreadable` result never has to
be explained to a user as "you may need to sign in again". The uncomfortable one:
the doc comment on `CadenceSignal` justifies the three-way union by saying the
signed-in user "may simply not have permission to read it", and on this
deployment there is no permission to lack. The union still earns its keep — see
finding 42 — but the reason given for it is not the reason it is needed, and that
sentence is corrected in this slice.

One deployment does not establish that every Viya 4 leaves this endpoint open.
The probe should keep sending the token anyway: it costs nothing, and a
deployment that *did* gate the endpoint would otherwise answer 401 and be read as
Viya 3.5.

### Finding 42 — Three different 404s, and only one of them means "no cadence endpoint"

This is the finding that changes the design. Two 404s were provoked, and they do
not look alike:

| What was asked | Status | `content-type` | Body |
|---|---|---|---|
| `/deploymentData/noSuchThing` — service routed, path unknown | 404 | `application/vnd.sas.error+json;charset=utf-8;version=2` | `{"version":2,"httpStatusCode":404,"message":"There is no handler defined for the path \"/deploymentData/noSuchThing\"."}` |
| `/noSuchServiceAtAll/thing` — nothing routed | 404 | *absent* | empty, `server: envoy` |

The second is the ingress answering on behalf of a service that is not there. It
carries no body, no Viya media type, and no message. A corporate proxy, a VPN
portal or a mistyped host would produce something in the same family.

So **status 404 alone is not evidence of Viya 3.5.** Keying the `absent` arm on
the status would let anything sitting between the editor and the deployment
manufacture a confident, wrong claim about the generation — and the wrong dialect
chosen silently is the failure mode the `reason` field exists to prevent.

There is a control available for free. Sean's wiring decision for this slice is
that the probe runs *after* a Compute session connects, and a live session is
itself proof that the host is a reachable Viya that our token works against. Given
that, a 404 from `/deploymentData/cadenceVersion` is a statement about the
endpoint rather than about reachability, and `absent` is honest. Without a
connected session — a probe run from a colder position in some later slice — the
same 404 should classify as `unreadable`.

### Finding 43 — `Accept: application/json` is honoured, and a wrong one is a 406 that lists the right ones

Asking with `Accept: application/json` returns 200 with
`content-type: application/json; charset=utf-8` and the same body. Asking with
`application/vnd.sas.collection+json` — a type this resource does not serve —
returns **406** with a `vnd.sas.error+json` document whose `details` enumerate
what would have worked:

```
application/vnd.sas.deployment.data.cadence.version+json;version=1
application/vnd.sas.app.registry.cadence.version+json;version=1
application/vnd.sas.deployment.data.cadence.version+json
application/vnd.sas.app.registry.cadence.version+json
application/json
```

Two useful things. `application/json` is on the list, so the contract can ask for
it and get a stable content type back rather than a versioned vendor one — which
matters because the client only reads `cadenceVersion` and has no use for the
representation version. And 406 is a distinct, diagnosable outcome: a deployment
that answers 406 is a Viya that has this resource, so a 406 is `unreadable` with a
detail worth logging, never `absent`.

### Finding 44 — `/deploymentData` is a link document, so the path never has to be composed

`GET /deploymentData` answers 200 with `application/vnd.sas.api+json;version=1`
and five links:

| `rel` | `href` | `type` |
|---|---|---|
| `cadenceVersion` | `/deploymentData/cadenceVersion` | `application/vnd.sas.deployment.data.cadence.version` |
| `cadenceVersion` | `/deploymentData/cadenceVersion` | `application/vnd.sas.app.registry.cadence.version` |
| `licenseFile` | `/deploymentData/licenseFile` | `application/vnd.sas.deployment.data.license.file` |
| `permissionToggles` | `/deploymentData/permissionToggles` | `application/vnd.sas.collection` |
| `setinit` | `/deploymentData/setinit` | `text/plain` |

`method` is `null` on every one of them, so ADR-0010's "navigate by relation"
is available here but incomplete: the relation gives the path, and the verb has
to come from the contract file rather than from the document.

Note the relation appears **twice**, distinguished only by `type`. Any code that
selects a link by `rel` alone gets whichever came first. The two hrefs happen to
be identical today, which means a `rel`-only lookup works by luck rather than by
construction — the contract file should record the media type alongside the
relation, and the checker should not let one be added without the other.

### Finding 45 — Upstream reads the path directly and collapses every failure into `"unknown"`

For comparison, `client/src/connection/rest/RestContentAdapter.ts` in the SAS
extension:

```ts
private async getViyaCadence(): Promise<string> {
  try {
    const { data } = await this.connection.get("/deploymentData/cadenceVersion");
    return data.cadenceVersion;
  } catch (e) {
    console.error("fail to retrieve the viya cadence");
  }
  return "unknown";
}
```

The composed path (ADR-0010), the swallowed exception with no detail carried
forward, and `console.error` rather than an output channel the user can read. The
substantive difference is the return type: a `string` cannot distinguish "no
cadence endpoint" from "could not ask", so 404, 401 and a DNS failure all arrive
as the same word. Upstream can afford that, because the value feeds exactly one
comparison — `this.viyaCadence === "2023.03"`, guarding a `sortBy` parameter one
cadence rejected — and being wrong costs a suboptimal query. It feeds our choice
of dialect, where being wrong costs a dozen unrelated bugs.

Not a criticism of upstream so much as a measurement of how much more weight we
are putting on the same endpoint.

### What this settles

1. **The contract asks for `application/json`** and reads `cadenceVersion`, with
   `cadenceDisplayName` carried alongside for the output channel.
2. **`absent` requires more than a 404.** The 404 must come with a Viya error
   document, and the probe must already have a connected session behind it.
   Anything else — a bodyless ingress 404, a 401, a 406, a transport failure — is
   `unreadable` with the detail attached.
3. **The three-way union stays, with its justification rewritten.** Permission is
   not the reason on this deployment; things in the network path are.
4. **The link document is navigable but not sufficient**, and the `cadenceVersion`
   relation is ambiguous by media type, so the contract file records both.

### What this probe did not settle

- **What Viya 3.5 actually answers.** The whole `absent` arm is still inference:
  no 3.5 deployment was available, so "the endpoint is missing" was simulated
  with a missing sibling path and an unrouted service on a Viya 4. If a 3.5
  becomes reachable, this is the first thing to check.
- **Whether any Viya 4 gates the endpoint.** Unauthenticated here; one
  deployment.
- **`licenseFile`, `permissionToggles` and `setinit`.** Named by the link
  document, never fetched. `permissionToggles` may be relevant to a later slice
  that has to explain why an action is unavailable.
- **Caching.** The response sends `cache-control: no-cache, no-store` and no
  `ETag`, so there is nothing to revalidate against; whether the cadence can
  change under a live session was not tested, and the per-profile cache this
  slice adds assumes it cannot within a session.


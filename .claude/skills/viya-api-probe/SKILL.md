---
name: "viya-api-probe"
description: "Safely probe a live SAS Viya REST API with curl — look up the documented shape first, load a bearer token from the creds file without leaking it, then run read-only collection/pagination/ETag/async-job probes to confirm the real wire shape and record where the documentation and the deployment disagree. Use when verifying a Viya 3.5 or Viya 4 endpoint against a live deployment before implementing against it."
---

You are probing a **live** SAS Viya REST API to confirm the real request/response
wire shape of an endpoint before writing code against it. This is a read-first,
credential-sensitive task. Follow the safety rules first — they are not optional.

## 0. Credential safety — read this before running anything

You will be handling a live bearer token. Commit to all of the following:

- **Never** `echo`, `print`, `cat`, or `log` the token, and never paste it into a
  chat message, a file, a fixture, a commit, or memory.
- Load the token into a **shell variable only**, and reference it only inside a
  `curl -H "Authorization: Bearer $TOKEN"`. Keep every probe in a single bash call
  so the variable never has to be re-derived or persisted.
- Prefer **read-only** requests (`GET`). Any mutating probe (`POST`/`PUT`/`DELETE`)
  must be called out to the user first and, ideally, run against a throwaway
  object that you clean up in the same shell call under a `trap`.
- Before turning any captured response into a committed fixture, **scrub** it (see
  §6). Tokens, internal hostnames, real usernames, and org-identifying ids do not
  belong in the repo.
- **Nothing deployment-identifying goes into a web search query.** Searching is
  part of this skill (§3), and a search box is a different trust boundary from a
  local shell: never put the internal hostname, a tenant or org id, a real
  username, a session id, or any fragment of a token into one. Search for the
  *service and endpoint* in the abstract — "SAS Viya compute API create session
  media type" — not for anything that identifies where you are pointed.

## 1. Locate and load the token

The canonical creds file lives at **`C:\certs\creds.json`** (bash form
`/c/certs/creds.json`). It sits **outside** this repo, so it is never at risk of
being committed — do not copy it into the working tree.

- **Under Claude Code (this environment).** The `Bash` tool reads the real
  filesystem, so read `/c/certs/creds.json` directly. Honour `$VIYA_CREDS` if the
  user has set it to point somewhere else. No staging step, no copy.
- **Under the claude.ai desktop local-agent sandbox.** That runtime can only see
  mounted folders. Ask the user to add `C:\certs` to the session as a second
  (read-only) folder so the file is mounted in place — still no copy into the
  repo. Only if that is impossible, fall back to a copy into a git-ignored path
  and remind them to delete it afterwards.

The file has one section per deployment. A section looks like:

```json
"verde": {
  "host": "https://verde-viya.example.internal/",
  "server_url": "verde-viya.example.internal",
  "token": "eyJ..."
}
```

Load the host and token without ever printing the token:

```bash
CREDS=${VIYA_CREDS:-/c/certs/creds.json}   # override with $VIYA_CREDS if set
SECTION=verde                              # the deployment section you want
HOST=$(jq -r ".${SECTION}.host"  "$CREDS" | sed 's:/*$::')   # trim trailing slash
TOKEN=$(jq -r ".${SECTION}.token" "$CREDS")
# Sanity check WITHOUT revealing the token:
echo "host=$HOST  token_len=${#TOKEN}"
```

If `jq` isn't available, use `python -c 'import json,sys;print(json.load(open(sys.argv[1]))["verde"]["token"])'`
piped into the variable — same rule: never echo the value.

## 2. Network + TLS notes

- This environment **can** reach internal corporate Viya hosts over HTTPS. A
  quick reachability check:
  `curl -sS -o /dev/null -w '%{http_code} %{time_connect}s\n' "$HOST"`.
- Viya deployments often use an **internal TLS cert**. `C:\certs\cacert.pem` on
  this machine is a CA bundle that usually covers them — try
  `--cacert /c/certs/cacert.pem` first. If curl still fails with a cert error you
  may add `-k` **for probing only** — note in your output that verification was
  disabled. Never bake `-k` into shipped client code.
- A connect **timeout** (as opposed to a cert or HTTP error) means the VPN is
  down, not that anything here is misconfigured.
- Always send an explicit `Accept` header; Viya is media-type driven and the
  response envelope changes with it.

Define reusable curl options once:

```bash
AUTH=(-H "Authorization: Bearer $TOKEN")
# prefer the CA bundle; add -k here only if it still fails on the internal cert:
CURL=(curl -sS --cacert /c/certs/cacert.pem "${AUTH[@]}")
```

## 3. Establish the documented shape *before* you curl

Probing blind tells you what the server did. Probing against a written claim
tells you something more useful: whether the documentation can be trusted for the
*next* endpoint too. Spend a few minutes here first.

**Prefer the deployment's own description of itself.** It is version-correct by
construction, where the public docs are correct for whatever release they were
written against. Many services expose one or more of these — try them and see:

```bash
"${CURL[@]}" -H "Accept: application/vnd.sas.api+json" "$HOST/<service>/"   | jq '{version, links: [.links[].rel]}'
"${CURL[@]}" -H "Accept: application/json"             "$HOST/<service>/apiMeta" | jq .
```

The root/`apiMeta` response usually enumerates the link relations, which is the
closest thing to a machine-readable contract you will get, and it is also how you
learn whether the client should be composing URLs at all or following hrefs.

**Then search the public reference** for the endpoint: the SAS developer REST API
reference, the service's documentation page, and — for anything with SAS-language
syntax on the far side, like `PROC` options — the SAS procedure documentation.
Observe the safety rule in §0 about what may appear in a query.

Write down, before running anything, what the documentation *claims*: path,
method, request `Content-Type`, response `Accept` media types, required headers,
query parameters and their defaults, success status, and the fields the client
will read. That written claim is now the thing your probe tests. A probe that
confirms it is cheap and still worth recording; a probe that refutes it is the
one that pays for the whole exercise.

**The server always wins.** Documentation drifts, describes a different Viya
version, or describes an option the deployment's SAS release does not have.
Viya 3.5 and Viya 4 differ, and a given site may be patched ahead of or behind
the docs. Never let a documented shape override an observed one — the docs tell
you *what to check*, not what is true.

**Three ways this has actually paid off**, as a sense of what to watch for:

- **A wrong option name.** Documentation and habit both suggested a `FILE=`
  option on a `PROC`; the real one was `INFILE=`. The error message enumerated
  the true option list, which is a better reference than the prose was.
- **A parameter that is inert on its own.** A long-poll `wait` query parameter
  is documented as "wait this many seconds for a change", and does nothing at
  all unless an `If-None-Match` header travels with it. Reading the docs alone,
  you would ship a poll that hammers the server.
- **A field documented as present arriving null.** A collection envelope's
  `count` is described as the total; on a real deployment it came back `null`,
  so any client using it for paging arithmetic breaks on live data.

## 4. Core probe patterns

Capture both **headers and body** when the shape matters (`-D -` dumps response
headers; `-i` inlines them). Pretty-print bodies with `jq .`.

**A single resource** — note the resource-specific `Accept` media type:

```bash
"${CURL[@]}" -H "Accept: application/vnd.sas.decision+json" \
  "$HOST/decisions/flows/<id>" | jq .
```

**A collection** — Viya wraps lists in `application/vnd.sas.collection+json` with
an `items[]` array and a sibling `links[]` array. Request a page and inspect the
envelope, the per-item shape, and the paging links:

```bash
"${CURL[@]}" -H "Accept: application/vnd.sas.collection+json" \
  "$HOST/decisions/flows?start=0&limit=5" \
  | jq '{count, start, limit,
         item0: .items[0],
         next: (.links[] | select(.rel=="next") | .href)}'
```

**Follow pagination** — the `rel:"next"` link carries the fully-formed next URL
(query params included). Confirm it terminates (absent `next` on the last page):

```bash
NEXT="/decisions/flows?start=0&limit=5"
while [ -n "$NEXT" ]; do
  PAGE=$("${CURL[@]}" -H "Accept: application/vnd.sas.collection+json" "$HOST$NEXT")
  echo "$PAGE" | jq -c '{n: (.items|length), start, limit}'
  NEXT=$(echo "$PAGE" | jq -r '(.links[]? | select(.rel=="next") | .href) // empty' \
         | sed "s#^$HOST##")   # reduce absolute href back to a path
done
```

**ETag / If-Match round trip** — for optimistic-concurrency endpoints (e.g. MAS
`PUT /modules/{id}/source`), first `GET` to read the `ETag` response header, then
send it back as `If-Match`. Grab the ETag without printing the body:

```bash
ETAG=$("${CURL[@]}" -D - -o /dev/null \
        -H "Accept: application/vnd.sas.microanalytic.module.source+json" \
        "$HOST/microanalyticScore/modules/<id>/source" \
      | awk 'tolower($1)=="etag:"{print $2}' | tr -d '\r')
echo "etag=$ETAG"
# then: "${CURL[@]}" -X PUT -H "If-Match: $ETAG" -H "Content-Type: <...source+json>" --data @body.json <url>
```

Missing `If-Match` where required returns **428 Precondition Required**; a stale
one returns **412 Precondition Failed**.

**POST (execute / create)** — send the body under the endpoint's specific
`Content-Type` (Viya distinguishes e.g. `.module.definition+json` for create from
`.module+json`). Echo the HTTP status to see 200 vs 201 vs 202/415:

```bash
"${CURL[@]}" -w '\n-> HTTP %{http_code}\n' \
  -H "Content-Type: application/vnd.sas.microanalytic.module.step.input+json" \
  -H "Accept: application/json" \
  --data '{"inputs":[{"name":"x","value":1}]}' \
  "$HOST/microanalyticScore/modules/<id>/steps/<step>" | jq . 2>/dev/null
```

**Async job (202 + Location, then poll)** — submit returns `202` with a `Location`
header pointing at the job resource; poll it until `state` reaches a terminal
value (`completed`/`failed`). Capture the `Location`:

```bash
LOC=$("${CURL[@]}" -D - -o /dev/null -X POST \
       -H "Content-Type: application/vnd.sas.microanalytic.module.definition+json" \
       -H "Accept: application/vnd.sas.microanalytic.job+json" \
       --data @job.json "$HOST/microanalyticScore/jobs" \
     | awk 'tolower($1)=="location:"{print $2}' | tr -d '\r')
"${CURL[@]}" -H "Accept: application/vnd.sas.microanalytic.job+json" "$HOST$LOC" \
  | jq '{id, state, moduleId, errors}'
```

**A terminal state is not a claim that anything happened.** Where the endpoint
runs *submitted code* rather than acting on a resource, `completed` means the
request was accepted and finished, not that the code produced its effect. Always
verify the effect independently — read back a variable, list a created object,
check the log — and treat a `completed` with no observable effect as a finding in
its own right, not as a probe that failed to prove anything.

## 5. What to record from a probe

For each endpoint, note: the exact **path**, **method**, request `Content-Type`
and response `Accept` media types, required headers (e.g. `If-Match`), the
**query params** that matter (`start`/`limit`/`waitTime`/…), the HTTP status on
success, the **top-level response fields** the client will read, and — for
collections — the **per-item fields** and the paging-link shape. Distinguish
representation-version fields (e.g. `version: 2`) from resource data.

**Record agreement and disagreement with §3's written claim as its own line**,
not as a silent overwrite of what the docs said. A finding of the form

> Documented: `wait=N` polls for up to N seconds.
> Observed (Viya 4, 2026-08-16): inert unless `If-None-Match` accompanies it;
> returns immediately with 200 otherwise.

is worth much more later than a bare note of the observed behaviour, because it
carries three things the bare note does not: that somebody checked, what a reader
of the docs would wrongly conclude, and a date and version against which it can
be re-checked. Where the docs turned out to be right, say so in one line — that
is evidence about the documentation's reliability, which is what tells the next
person whether they can skip a probe.

Note **what the probe did not settle**, explicitly. An unprobed option or an
untested size or concurrency case is an open question, and an unlabelled one gets
read as settled by whoever implements against the write-up.

## 6. Scrubbing before anything is committed

If a captured payload becomes a test fixture or example, first replace: the token
(remove entirely), internal hostnames/URLs (`links[].href`), real user names
(`createdBy`/`modifiedBy`), and any org-identifying ids/names with synthetic but
structurally-faithful values. Keep the envelope, field names, types, and
null/absent patterns exactly as the server returned them — that fidelity is the
whole point of the fixture. Never keep the live token in a saved file.

## 7. Wrap-up

Summarize the confirmed shape to the user in prose, including anywhere the
deployment contradicted the documentation. Clean up every object a mutating probe
created, and confirm the cleanup (a deleted resource should read back as `404`).
If a fallback copy of `creds.json` was ever staged (see §1), remind the user to
delete it. Do **not** save the token, the raw un-scrubbed payloads, or the
internal hostname to memory.

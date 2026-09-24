# Connecting to CAS from Python

Your Python code, running in the same Compute session **Run File**/**Run
Selection** use, can open an authenticated `swat.CAS()` connection — no
separate CAS credential to acquire, paste in, or store. It reuses the same
Viya access token this extension already borrows per request for everything
else it does.

This page is about that Python-side connection. For a no-code look at CAS
servers, caslibs and tables — no `swat` required — see [Browsing
CAS](browsing-cas.md).

## Getting a connection

1. Sign in and connect to SAS Viya, the same as running any Python code.
2. With a `.py` file open and your cursor where you want it, run **Insert CAS
   Connection Snippet** from the Command Palette.
3. If the deployment has more than one CAS server, pick one. Most deployments
   have exactly one and skip this step.

This delivers a fresh token into the session as a plain file, then inserts:

```python
with open("CT123456") as _cas_token_file:
    _cas_token = _cas_token_file.read().strip()
import swat
conn = swat.CAS("<internal-host>", <port>, password=_cas_token)
```

`<internal-host>` and `<port>` are this deployment's own values, read from
the CAS server you picked — not something you supply. The generated file name
changes every time you run the command, so **run it again** any time you need
a fresh connection or the token has expired (see below), rather than reusing
an old snippet.

## Why there is no `password="..."` literal to see

The naive way to get a credential into a cell — writing it directly into a
`SAS.submit()` call — leaks it into the job log in plaintext: the SAS code
you pass to `SAS.submit()` is echoed into the log as its own line, and that
echo cannot be relied on to mask a `password=` value (confirmed live,
[Finding 12.1](phases/phase-12.md)) — the same property [Python and SAS
libraries](data-access.md)'s own "Never write a credential as a literal"
section warns about. The token this command delivers never travels through a
submitted statement at all: it lands as a file's raw bytes, the same upload
path this extension already uses to get your own `.py` source into the
session, and the snippet only ever reads it back from disk.

## Reconnecting after a while

The token matters at the moment you **connect**, and not afterwards. Once
`conn` is open it keeps working for as long as your Python process holds it —
a connection outlives the token that opened it, and CAS actions keep
succeeding after that token has expired (measured, [Finding
12.9](phases/phase-12.md)). You do not need to refresh anything while you are
working.

Opening a **new** connection is the case that needs a fresh token. If you run
`swat.CAS(...)` again later in the same session — reconnecting, or re-running
the connection lines — the token file the snippet wrote may have aged out, and
that connect is refused with an authentication error. Run **Insert CAS
Connection Snippet** again first, then run the new connection lines.

So an authentication error **on connect** means a stale token. An
authentication error part-way through a session that was already working is
something else, and re-running the snippet will not fix it.

## Binary vs. REST/HTTP

The snippet above uses `swat`'s binary protocol, pointed at the CAS server's
own host and port. It needs no further setup, and — importantly — it does not
depend on how your deployment's web front end is configured.

`swat` also supports a REST/HTTP connection to the same server, using the same
token as the password with no username — see `swat`'s own ["Binary vs.
REST"](https://sassoftware.github.io/python-swat/binary-vs-rest.html)
documentation for when you would prefer that transport instead.

**The REST/HTTP transport goes out through your deployment's ingress; the
binary one does not.** That is the practical difference between them, and it
is the one that bites. CAS's HTTP route is not published or permitted on
every deployment, and your Python is already running *inside* Viya — a REST
connection sends it back out the front door and in again, where an ingress
rule, an IP allowlist or a WAF can refuse it.

When that happens the failure does not look like a network failure. `swat`
parses the response body as JSON without checking the HTTP status code first,
so a front end that answers with an HTML error page surfaces as a JSON decode
error instead:

```
Expecting value: line 1 column 1 (char 0)
```

That message means `swat` was handed something that was not JSON — most often
an HTML error page from the front end (confirmed, [Finding
12.8](phases/phase-12.md)). It does not mean there is anything wrong with your
query, your caslib or your token. If you see it, use the binary snippet
above. If you specifically need the REST transport, your platform team can
confirm from the ingress logs whether the CAS HTTP route is reachable for
your client.

## Running native SQL against an external database

If a caslib is backed by an external database connector (Snowflake, for
example), FedSQL's explicit pass-through lets you run that database's own
native SQL directly against it, without first loading the table's rows into
CAS memory. With `conn` already open (above), run **Insert CAS SQL
Passthrough Snippet** from the Command Palette to insert:

```python
conn.loadactionset("fedsql")
result = conn.fedsql.execDirect(
    query='''select * from connection to CASLIB (select * from native_table)'''
)
df = result["Result Set"]
```

Replace `CASLIB` with the caslib's own name and the inner `select * from
native_table` with your native query — everything between `connection to
CASLIB ( ... )`'s parentheses runs unmodified in the external database
itself; only its result set comes back through CAS. `result["Result Set"]`
is already a `pandas.DataFrame` (a `SASDataFrame`, `swat`'s own subclass),
ready to use like any other. Nothing is written to CAS memory unless the
action is also given a `casout=`.

The `query=` value is wrapped in triple quotes (`'''...'''`) rather than a
single pair of double quotes, so you can freely use quotes inside your native
query without escaping anything — for example, a Snowflake table or column
name that needs double quotes around it, or a `where` clause comparing a
string column with single quotes.

**Expect single-threaded reads.** A pass-through query always runs with
`numReadNodes=1` on the CAS side, regardless of how many worker nodes the
server has — CAS does not parallelize a `connection to` query, only whatever
the external database itself does. This is normal behaviour, not something
to work around: confirmed against a real Snowflake-backed caslib (Finding
11.2, `docs/phases/phase-11.md`), where the log's own `WARNING: Multi-node
read is not allowed with the FedSQL execDirect action` line names it
explicitly.

The caslib already owns the credential to the external database — configured
by whoever defined the caslib — so this needs no separate credential of its
own; it rides on the same connection **Insert CAS Connection Snippet**
already opened.

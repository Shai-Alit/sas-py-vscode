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

This writes a fresh token into the session as a plain file named
`CASTOKEN`, then inserts:

```python
with open("CASTOKEN") as _cas_token_file:
    _cas_token = _cas_token_file.read().strip()
import swat
conn = swat.CAS("<internal-host>", <port>, password=_cas_token)
```

`<internal-host>` and `<port>` are this deployment's own values, read from
the CAS server you picked — not something you supply.

The file name stays the same. Running the command again in the same session
replaces the token in the same file, so code that opens `CASTOKEN` keeps
working with the new token. To refresh the token without inserting
anything, run **Refresh CAS Token** instead. The file lives in the session's
working directory, so a new session (after **Disconnect**, or once an idle
session has timed out) has none until you run one of the two commands in it.

## Reusing the connection in your own code

Because the name does not change, the connection lines above can live in a
module you commit and share, instead of being inserted into each file.
Anyone who runs **Refresh CAS Token** once in their session can then run
that module unchanged.

To use a different name, for example one your team has agreed on, set
**`pythonOnViya.cas.tokenFileref`** (see [Settings](reference/settings.md)).
It must be 1 to 8 letters, digits or underscores and not start with a digit,
and it is upper-cased: `teamtok` becomes a file named `TEAMTOK`.

If your own SAS code has already assigned a fileref with that name in the
session, for example with a `filename` statement, neither command writes
the token into your file. They tell you so and write nothing; choose another
name, or release yours with `filename <name> clear;`.

To have the connection ready in every run, you can also put these lines in
your profile's Python startup snippet (see [Python that runs before your
code](connection-profiles.md#python-that-runs-before-your-code)). The snippet
runs again before each Run File. Until you have run **Refresh CAS Token** in
a session, there is no token file, so the snippet reports a `FileNotFoundError`; your
own code still runs.

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
the connection lines — the token in the file may have aged out, and that
connect is refused with an authentication error. Run **Refresh CAS Token**
first, which puts a fresh token in the same file, then run the connection
lines again. How long a token lasts is set by your deployment's
administrator.

So an authentication error **on connect** means a stale token. An
authentication error part-way through a session that was already working is
something else, and re-running the snippet will not fix it.

## Why not `SAS_SERVICES_TOKEN`?

Python running in a Compute session can also see a token of the session's
own, in the `SAS_SERVICES_TOKEN` environment variable, and some published
examples connect to CAS with it. It works at first, but that variable is set
once, when the session starts, and is never updated. Once it expires, every
new connection made with it is refused, even after **Run File** starts a new
interpreter ([Finding 12.25](phases/phase-12.md#finding-1225--the-sessions-own-sas_services_token-is-never-refreshed-a-fileref-the-users-sas-code-assigns-is-listed-like-ours-and-homedirectory-tells-them-apart)). The file this extension
writes gets a current token each time you run **Refresh CAS Token**.

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

**What has and has not been tried.** Pass-through has been confirmed only
against a Snowflake caslib, with a small result. Other databases and large
results have not been measured. SAS documents that a result set returned
to the client is assembled in full in the CAS controller's memory before
it comes back, so for a large result, try your native query with a row
limit first.

The caslib already owns the credential to the external database — configured
by whoever defined the caslib — so this needs no separate credential of its
own; it rides on the same connection **Insert CAS Connection Snippet**
already opened.

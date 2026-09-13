# Connecting to CAS from Python

Your Python code, running in the same Compute session **Run File**/**Run
Selection** use, can open an authenticated `swat.CAS()` connection — no
separate CAS credential to acquire, paste in, or store. It reuses the same
Viya access token this extension already borrows per request for everything
else it does.

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
`SAS.submit()` block — leaks it into the job log in plaintext, because the
job log echoes submitted source verbatim, unconditionally, the same property
[Python and SAS libraries](data-access.md)'s own "Never write a credential as
a literal" section warns about. The token this command delivers never
travels through a submitted statement at all: it lands as a file's raw bytes,
the same upload path this extension already uses to get your own `.py`
source into the session, and the snippet only ever reads it back from disk.

## Reconnecting after a while

A Viya access token is short-lived — measured in minutes, not hours — while
the CAS connection you open with it can stay around for as long as your
Python process runs. If a CAS action starts failing with an authentication
error after your session has been open for a while, that is almost certainly
an expired token, not a code problem: run **Insert CAS Connection Snippet**
again to get a fresh one and reconnect.

## Binary vs. REST/HTTP

The snippet above uses `swat`'s binary protocol, which needs no further
setup on this deployment. `swat` also supports a REST/HTTP connection to the
same server, using the same token (`password=<token>`, no username) — see
`swat`'s own ["Binary vs.
REST"](https://sassoftware.github.io/python-swat/binary-vs-rest.html)
documentation for when you would prefer that transport instead.

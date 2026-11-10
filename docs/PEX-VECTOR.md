# Related synthetic cases with Java PEX and IRIS Vector Search

The optional `KnAIghts.Context.Production` adds related-case context to the
existing synthetic mismatch review. IRIS searches its own indexed audit facts,
passes a selected hit to a Java Production Extension (PEX) business operation,
and includes the returned description in the Workflow review task. The
reviewer can record Reviewed or Declined; the existing custom adapter writes a
private notice after rechecking the audit, source facts, and completed task.

The match is advisory. It cannot accept a source, choose a semantic selection,
approve the separate synthetic task, or execute that task. The output uses the
two project-owned synthetic cases only. It is not clinical decision support.

## How similarity works

The operator explicitly indexes a previously persisted, validated audit with
`KnAIghts.Context.Vector.IndexAudit(id)`. The table stores the exact audit and
its server-owned facts alongside a six-number feature vector. Those features
are hand-defined indicators for matching or mismatching sources, the accepted or
review disposition, exact citations, and synthetic scope. They are **not**
learned embeddings, and the cosine score is not a general measure of medical or
semantic similarity.

The query compares the target audit with up to five other indexed rows using
`VECTOR_COSINE`. Before presenting a hit, IRIS re-reads its original audit and
facts and compares them with the indexed copies. An absent match is normal;
duplicate audit inserts are rejected. The Java operation validates and formats
the selected synthetic hit. IRIS verifies the returned identity and score before
including the text in a Workflow task. The vector table and Java component are
trusted operator-controlled resources; these checks do not establish protection
against a privileged user changing the stored feature vectors or component.

## Local setup

Use a dedicated IRIS for Health AI Hub Community Build 154 fixture and an
authorized operator. The default Dockerfile and review-production selection
remain in place. `Dockerfile.pex` is an opt-in image profile that compiles the two
Java classes against the PEX jar in the supplied IRIS image; it requires that
image's Java compiler and does not download a Java dependency.

```powershell
docker build --pull=false -f Dockerfile.pex `
  --build-arg IRIS_IMAGE=ALREADY_PRESENT_BUILD154_IMAGE `
  -t knaights-context-local:private .
```

Create an owned fixture using the bootstrap and private-state approach in
[Fresh local native-agent session](LIVE_SESSION_LOCAL.md). Select the image just
built as its application image and start the Compose service with `up -d
--no-build` so the default Dockerfile does not replace it. This setup does not
require a model call. Check the bootstrap completion marker and compile results.

In the dedicated namespace, run the two statements in
[`sql/context-index-v1.sql`](../sql/context-index-v1.sql) once, in order, using
the IRIS SQL interface. They create a table and cosine HNSW index; they do not
drop or replace an existing object. Inspect any naming conflict before proceeding.

In that fixture's `%SYS` namespace, configure a **new**, local Java external
language gateway named `KnAIghtsJava`, using an available local port and the
appropriate OS classpath separator. The following is the tested Linux-container
example; inspect the name and port first and do not replace a shared gateway.

```objectscript
Set p("Type")="Java",p("Port")=55556,p("Resource")="%Gateway_Object"
Set p("BindToIPAddress")="127.0.0.1",p("UseSharedMemory")=0
Set p("ClassPath")="/usr/irissys/dev/java/lib/1.8/intersystems-pex-1.0.0-shaded.jar:/tmp/knaights-pex.jar"
Set sc=##class(Config.Gateways).Create("KnAIghtsJava",.p)
If $SYSTEM.Status.IsOK(sc) Set sc=##class(%Net.Remote.Service).SpawnGateway("KnAIghtsJava",30)
Do $SYSTEM.Status.DisplayError(sc)
```

Switch deliberately from the existing production to
`KnAIghts.Context.Production` in the dedicated namespace. Configure the
`KnAIghtsNotice` adapter's private output directory, Workflow actions, role, and
reviewer as described in [Synthetic Workflow review](BONUS-WORKFLOW.md). Those
instructions use the earlier `KnAIghts.Bonus.Production`; select
`KnAIghts.Context.Production` for this profile. A namespace runs one production
at a time. Do not stop an unrelated or shared production.

Use the existing evidence-review route to obtain valid synthetic audits. Index
one or more audits as an authorized operator, then submit a **different**
persisted mismatch audit to `KnAIghtsBonusEntry` as shown in the Workflow guide:

```objectscript
Set sc=##class(KnAIghts.Context.Vector).IndexAudit(<existing-synthetic-audit-id>)
Do $SYSTEM.Status.DisplayError(sc)
```

The task is available in the `KnAIghtsReviewers` worklist. Inspect its
related-case description, review choice, production messages, and private notice.
Keep the output directory private and reconcile interrupted or duplicate writes;
the adapter does not claim exactly-once delivery or crash recovery.

## Current scope

In an isolated local Build 154 fixture, the project compiled the Java PEX
component, created and populated the vector index, returned a related synthetic
audit, sent the PEX description into a Workflow task, and produced a checked
notice after a programmatic reviewer choice. A stale indexed audit was skipped,
a duplicate was rejected, and Java PEX rejected a non-synthetic case. An
`EXPLAIN` of the tested search with the same synthetic values selected the HNSW
index and ACORN-1. This small fixture is not a performance benchmark, a human
portal test, or proof of organizer bonus credit.

A later isolated combined-flow check requested both native synthetic reviews
through the browser, created the real Workflow task with vector/PEX context,
recorded Reviewed through the restricted operator interface, and displayed the
persisted notice in the Book. Independent IRIS message, audit, task and notice
readback matched that result. A separate reconnect check recovered the retained
task and notice without repeating inference. These observations do not establish
broad multi-user load, crash recovery or a new integrated IPM package.

The fixture logged an IRIS startup error involving `Sharding,SYS.ICM` before
the project bootstrap completed. The scoped checks passed afterward; the cause
and broader impact of that startup event have not been established.

The default live viewer uses the default review production. An explicitly
configured [local context-live profile](CONTEXT-LIVE.md) also connects the
viewer to this Workflow/PEX/vector production through a separately authenticated
operator. The static Pages simulation does not call it. The existing package
builders do not yet include these new classes or the Java jar; local source/image
qualification does not establish a public package install.

See InterSystems' [PEX object gateway documentation](https://docs.intersystems.com/irislatest/csp/docbook/DocBook.UI.Page.cls?KEY=EPEX_object_gateway)
and [IRIS Vector Search documentation](https://docs.intersystems.com/irislatest/csp/docbook/DocBook.UI.Page.cls?KEY=GSQL_vecsearch)
for gateway and index behavior.

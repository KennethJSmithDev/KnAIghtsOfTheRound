# Synthetic Workflow review and notice adapter

The opt-in `KnAIghts.Bonus.Production` adds a real InterSystems Workflow Engine
worklist and a custom `Ens.OutboundAdapter` to the existing synthetic evidence
review route. It is a local prototype for an operator-controlled namespace.

1. An operator submits the ID of a persisted `synthetic-b` mismatch audit to
   `KnAIghtsBonusEntry`. The service checks the caller's `%Admin_Operate`
   privilege, the disposition, empty selection, ordered citations, limitation,
   and current server-owned synthetic facts. It captures those facts itself.
2. `KnAIghtsReviewFlow` sends a task to `KnAIghtsReviewers`, an
   `EnsLib.Workflow.Operation`. A configured workflow user takes the worklist
   item and chooses Reviewed or Declined.
3. Before sending the notice, `KnAIghtsNotice` checks the original audit and
   facts again and compares the persisted completed workflow task, role, source,
   subject, action, and reviewer. `KnAIghts.Bonus.NoticeAdapter` then writes a
   small JSON notice to an operator-configured private directory. An Embedded
   Python class method computes a SHA-256 checksum over canonical JSON for the
   validated synthetic audit and its facts; the notice includes that checksum.

The notice records a review choice only. It does not change the source
disposition, create a verified selection, or call the separate
`KnAIghts.Review.SyntheticTask` approval or execution API. This entry is not
exposed as an HTTP or MCP endpoint. A caller able to invoke production hosts
directly is part of the trusted local operator boundary. The checksum helps
compare evidence snapshots; it is not a digital signature or an authorization.

## Local setup

Use a dedicated, operator-owned IRIS namespace or disposable fixture. A
namespace can run one production at a time: arrange a deliberate transition
from the existing production to `KnAIghts.Bonus.Production`; do not stop a
shared or unrelated production. Import and compile the project classes using
the existing bootstrap before switching productions.

- Create an existing private output directory writable by the IRIS process.
  Set the `Directory` adapter setting on `KnAIghtsNotice` to that directory
  and update the production. The adapter does not create the directory.
- Run `##class(KnAIghts.Bonus.Setup).EnsureActions()` as an authorized operator.
  It adds the two prefixed Workflow actions if absent and does not replace other
  definitions. The Workflow operation creates the `KnAIghtsReviewers` role on
  startup; add an actual Workflow user to that role using the Workflow setup.
- First obtain a valid, persisted `synthetic-b` mismatch audit through the
  existing evidence-review route. Submit its ID from an authorized IRIS session:

```objectscript
Set request = ##class(KnAIghts.Bonus.ReviewRequest).%New()
Set request.AuditId = <synthetic-mismatch-audit-id>
Set sc = ##class(Ens.Director).CreateBusinessService("KnAIghtsBonusEntry", .entry)
If $SYSTEM.Status.IsOK(sc) Set sc = entry.ProcessInput(request, .response, .hint)
Do $SYSTEM.Status.DisplayError(sc)
```

The user can then take the item from the `KnAIghtsReviewers` worklist and
choose one of the two actions. Inspect the production message trace and the
private output directory for the result. Notice filenames include the Workflow
task ID. Existing files are never intentionally overwritten. The lock protects
workers in the same IRIS instance, not outside filesystem writers. Use a
private directory and manually reconcile an interrupted or duplicate write;
exactly-once delivery and crash recovery are not established.

The default application bootstrap still starts `KnAIghts.Review.Production`.
This earlier Workflow prototype uses an operator entry and worklist. A separate
[context-live profile](CONTEXT-LIVE.md) connects the viewer to the newer
Workflow/PEX/vector production through a separately authenticated operator.
Neither the default twelve-class package builder nor the separately qualified
integrated archive includes these new classes.

## Qualification scope

An offline, isolated IRIS for Health AI Hub Community Build 154 fixture
compiled the new source at bootstrap and exercised both choices with synthetic
proposals and programmatic Workflow actions. Its Embedded Python checksum was
independently recomputed from the fixture's audit and facts, and a changed fact
produced a different checksum. Tests also rejected changed captured
evidence, a forged reviewer, a mismatched choice, a missing task, and an
attempted overwrite. Those tests did not run a new native model inference or a
human portal session, and do not establish public registry installation,
multi-user behavior, crash recovery, or organizer bonus credit.

# Synthetic review task

`KnAIghts.Review.SyntheticTask` manages one demonstration task, `synthetic-review-001`. A validated source-mismatch review can be proposed, explicitly approved by an operator, and marked `REVIEWED`. The original evidence and review disposition remain intact.

Use a dedicated development namespace. The API requires the authenticated IRIS session to have `%Admin_Operate:U`. It has no MCP or HTTP endpoint. The task is a local demonstration effect, and broader task routing remains future work.

## Propose, inspect, approve, execute

Start with an existing `synthetic-b` review response produced by the governed production. Its disposition must be `REVIEW_REQUESTED` with action `REQUEST_REVIEW`. Set `reviewAuditId` to the returned audit ID. The task validates the stored response and exact source references itself.

```objectscript
Set result=##class(KnAIghts.Review.SyntheticTask).Propose(reviewAuditId,0)
Write result.%ToJSON()
Set current=##class(KnAIghts.Review.SyntheticTask).Read()
Set task=current.%Get("task")
Write task.%ToJSON()
```

Proceed only after `Propose` returns `PROPOSED` and `Read` returns `OK`. Inspect the evidence and proposed effect before approving it. Approval captures the current task and evidence revisions and the actual authenticated approver.

```objectscript
Set result=##class(KnAIghts.Review.SyntheticTask).Approve(task.%Get("revision"),task.%Get("evidenceRevision"))
Write result.%ToJSON()
```

Proceed to execution only after approval returns `APPROVED`. Retain a stable operation ID for any retry and use the revisions returned with the approved task.

```objectscript
Set task=result.%Get("task")
Set result=##class(KnAIghts.Review.SyntheticTask).Execute("review-action-001",task.%Get("revision"),task.%Get("evidenceRevision"))
Write result.%ToJSON()
```

A successful execution returns `EXECUTED`, the updated task, and an execution receipt. Repeating its operation ID returns `DUPLICATE_EXECUTION` and the retained receipt. That receipt lets a caller reconcile a lost response. A completed task rejects another operation ID as `TASK_COMPLETE`.

## Evidence changes and stale approval

`ReviseEvidence(newReviewAuditId,expectedRevision)` binds another validated review entry from the same synthetic case. It advances both revisions and clears active approval while preserving transition history. The operator must inspect and approve the revised proposal before executing it.

An execution using the old evidence revision returns `STALE_APPROVAL`. Changes to the bound audit JSON or current source facts return `EVIDENCE_CHANGED`. Missing, malformed, or wrong-case evidence fails validation.

## State and failure handling

Task transitions, approval history, and operation receipts share a bounded lock and an IRIS transaction. The API rejects an existing caller transaction, returns `BUSY` on lock timeout, and returns `ERROR` after an internal failure. Read the task to reconcile its stored state before retrying.

The task stays fixed after `REVIEWED`. Its history is stored separately from the production's review audit. This sample does not provide external effects, assignment queues, or a general workflow designer.

## Exercise the sample

After installing the package and starting the production in a fresh dedicated namespace, run `scripts/test-synthetic-task.script` through an IRIS session. It appends three synthetic review audit records and exercises one task through proposal, approval, evidence revision, stale-approval rejection, execution, and duplicate rejection. Require `KNAIGHTS_SYNTHETIC_TASK_OK` and check that no failure or runtime error occurred.

Keep the original review records and task history when collecting evidence. The test is intended for a fresh namespace and leaves its demonstration records available for inspection.

## Testing status

Sequential transitions, stale approval, duplicate receipt reconciliation, missing or changed evidence, authenticated restricted-user denial, lock timeout, and a bounded mid-write serialization failure have been exercised on Build 154. Same-package reinstall preserved the completed task, history and receipts. Concurrent first-execution testing remains incomplete. The sample requires trusted, configured ingress and an operator session with the stated permission.

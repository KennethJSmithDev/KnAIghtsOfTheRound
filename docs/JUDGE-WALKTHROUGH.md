# Judge walkthrough

This walkthrough exercises the native AI Hub agent, the IRIS evidence-validation boundary, and an operator-approved synthetic task update. Prepare the image, installation and model before recording. Model load and inference times depend on the demonstration environment.

## Prepare the environment

Use a fresh, owned **IRIS for Health AI Hub Community 2026.3.0AI.154.0 Linux x64** instance. Obtain its Community archive through the [InterSystems Early Access portal](https://evaluation.intersystems.com/Eval/early-access/AIHub). Availability of that exact archive requires confirmation with your portal account. The contest accepts Builds 109 and 154, and this application's demonstrated compatibility is Build 154.

Follow the [README](../README.md#getting-started) and [installation guide](INTEROPERABILITY.md). With the source checkout as the current directory, load and alias the vendor image using the exact image tag or ID reported by Docker.

```powershell
docker image load -i irishealth-community-2026.3.0AI.154.0-docker.tar.gz
docker image tag <loaded-tag-or-sha256-image-id> knaights-iris:build154
$env:KNAIGHTS_IRIS_IMAGE = "knaights-iris:build154"
docker compose build
```

Provide the existing local `gpt-oss:20b` model through an authorized OpenAI-compatible endpoint. This is the currently supported native provider configuration. Copy `.env.example` to `.env`, set `KNAIGHTS_PROVIDER_BASE_URL` to the reachable provider URL, and create `.local` for private configuration and captured output. Use the [native route configuration](INTEROPERABILITY.md#optional-native-agent-route) to check admitted endpoint shapes and resource capacity before starting.

```powershell
New-Item -ItemType Directory -Force .local | Out-Null
docker compose -f compose.yaml -f compose.live.yaml up --build -d
docker compose -f compose.yaml -f compose.live.yaml logs iris
```

Require vendor health `healthy` and `KNAIGHTS_BOOTSTRAP_OK`. The live override enables provider routing and can also have outbound reachability. Verify its routes for the installation. The retained native qualification used an internal network and an owned local relay. [IPM installation](INTEROPERABILITY.md#ipm-installation) is an alternative for an owned namespace with IPM 0.10.9. Production startup is explicit with that installation path.

## 1. Submit two real native-agent requests

Run both cases through the application entry point. Each request traverses `KnAIghtsEntry → AssessEvidence`, invokes native `%AI.Agent`, and requires the `ReadEvidence` tool before IRIS considers the proposed action and citations.

```powershell
@'
Set $ETRAP="Write !,""JUDGE_RUN_FAILED"",! Halt"
Write !,"APP_STATUS ",##class(KnAIghts.Review.App).Status().%ToJSON(),!
Set sc=##class(KnAIghts.Review.App).Submit("synthetic-a",.response)
If $SYSTEM.Status.IsError(sc) { Do $SYSTEM.Status.DisplayError(sc) Halt }
Write !,"NATIVE_RESULT ",response.ToJSON(),!
Set sc=##class(KnAIghts.Review.App).Submit("synthetic-b",.response)
If $SYSTEM.Status.IsError(sc) { Do $SYSTEM.Status.DisplayError(sc) Halt }
Write !,"NATIVE_RESULT ",response.ToJSON(),!
Halt
'@ | docker compose -f compose.yaml -f compose.live.yaml exec -T iris iris session IRIS -U USER |
  Tee-Object -FilePath .local/judge-native.log
```

Check that `APP_STATUS` reports a running production, Build 154, and `liveEnabled=true`. Inspect both returned records.

| Case | Status | Action | Semantic ID |
|---|---|---|---|
| `synthetic-a` | `ACCEPTED` | `SHOW_VERIFIED` | `synthetic.structure.001` |
| `synthetic-b` | `REVIEW_REQUESTED` | `REQUEST_REVIEW` | Empty |

Both results must preserve the ordered citations `ImagingStudy/example-ct` and `ImagingSelection/example-segment` and include the synthetic limitation. Retain each returned `auditId`; its value depends on existing records. The model selects the action and references. IRIS derives the displayed explanation and semantic selection from validated source facts.

A missing evidence projection, failed provider call, missing required tool call, unsupported citation, or source conflict must produce a failure or review result before any verified selection is returned. Treat an incomplete response as an incomplete demonstration.

## 2. Verify the stored IRIS evidence independently

Open a separate session and inspect the audit rows and production message headers. Match each native response to the row at its returned audit ID, including case, status, action, citations, limitation, and semantic ID. Check that the two requests have separate Interoperability sessions.

```powershell
@'
Set count=$Get(^KnAIghtsReviewAudit)
For id=1:1:count { Write !,"AUDIT ",id," ",$Get(^KnAIghtsReviewAudit(id)),! }
Set rows=##class(%SQL.Statement).%ExecDirect(,"SELECT ID,SessionId,SourceConfigName,TargetConfigName FROM Ens.MessageHeader WHERE SourceConfigName='KnAIghtsEntry' AND TargetConfigName='AssessEvidence'")
Do rows.%Display()
Halt
'@ | docker compose -f compose.yaml -f compose.live.yaml exec -T iris iris session IRIS -U USER |
  Tee-Object -FilePath .local/judge-readback.log
```

The supported provider's request trace can supply additional evidence of `ReadEvidence` tool invocation and final completions. Capture only synthetic payloads and omit credentials. Distinguish that model trace from the stored application responses and message route.

## 3. Complete the native agent's review task

Use the actual `auditId` from the native `synthetic-b` response above. The task must not already exist in this dedicated namespace. Enter the following in an authenticated operator session, substituting that returned ID for `<review-audit-id>`:

```objectscript
Set reviewAuditId=<review-audit-id>
Set result=##class(KnAIghts.Review.SyntheticTask).Propose(reviewAuditId,0)
Write result.%ToJSON()
```

Require `PROPOSED`. Inspect the returned evidence and `MARK_REVIEWED` effect. The source mismatch remains documented. When ready to approve, use the current task revisions:

```objectscript
Set current=##class(KnAIghts.Review.SyntheticTask).Read()
Set task=current.%Get("task")
Write task.%ToJSON()
Set result=##class(KnAIghts.Review.SyntheticTask).Approve(task.%Get("revision"),task.%Get("evidenceRevision"))
Write result.%ToJSON()
```

Require `APPROVED`. Execute the approved task using a stable operation ID:

```objectscript
Set task=result.%Get("task")
Set revision=task.%Get("revision"), evidenceRevision=task.%Get("evidenceRevision")
Set result=##class(KnAIghts.Review.SyntheticTask).Execute("judge-review-001",revision,evidenceRevision)
Write result.%ToJSON()
Set repeated=##class(KnAIghts.Review.SyntheticTask).Execute("judge-review-001",revision,evidenceRevision)
Write repeated.%ToJSON()
```

Require `EXECUTED` with task `REVIEWED`, followed by `DUPLICATE_EXECUTION` with the same receipt. Read the task and confirm its audit ID still points to the actual native response from step 1. This connects native agent decision, persisted evidence, explicit operator approval, and one local task effect.

## 4. Exercise stale approval and negative controls separately

Use a separate fresh dedicated namespace where `synthetic-review-001` has never been created. A fresh owned application container's `USER` namespace is suitable. Retain the completed native-linked task from step 3. The task API requires the authenticated session's `%Admin_Operate:U` permission.

Run the shipped script once. It creates three synthetic review audit records through the existing service, then demonstrates proposal, operator approval, changed evidence, stale-approval rejection, fresh approval, one update to `REVIEWED`, and duplicate receipt reconciliation. It performs zero model inference. [Synthetic task guide](SYNTHETIC-TASK.md)

```powershell
Get-Content -Raw scripts/test-synthetic-task.script |
  docker compose -f compose.yaml -f compose.live.yaml exec -T iris iris session IRIS -U USER |
  Tee-Object -FilePath .local/judge-task.log
Select-String -Path .local/judge-task.log -Pattern '^KNAIGHTS_SYNTHETIC_TASK_OK$'
```

Require the success marker and inspect the complete output for `FAIL` markers and IRIS runtime errors. An IRIS session exit code alone is insufficient. Keep the resulting task, history, and receipts when repeating the demonstration in another fresh namespace.

| Interaction exercised by the script | Required result |
|---|---|
| Propose a validated source-mismatch review | `PROPOSED` |
| Approve the inspected task and evidence revisions | `APPROVED` |
| Bind a new validated review entry | `EVIDENCE_REVISED` |
| Execute using the old evidence approval | `STALE_APPROVAL` |
| Approve the current revisions and execute | `EXECUTED`, task `REVIEWED` |
| Repeat the same operation ID | `DUPLICATE_EXECUTION`, original receipt |
| Use another operation ID after completion | `TASK_COMPLETE` |

Missing or wrong-case evidence is rejected. Changed bound evidence requires review again. Read the retained task independently after the script finishes.

```powershell
@'
Write !,"TASK_READBACK ",##class(KnAIghts.Review.SyntheticTask).Read().%ToJSON(),!
Halt
'@ | docker compose -f compose.yaml -f compose.live.yaml exec -T iris iris session IRIS -U USER
```

## Optional Codex MCP demonstration

The authenticated Codex MCP seat is a separate agent integration. Follow the [seat setup](INTEROPERABILITY.md#codex-seat-setup) and the prompt in the README to use `ReadSyntheticEvidence` and `SubmitSyntheticDecision`. That path uses Codex's supported ChatGPT sign-in and a restricted IRIS principal. It works with native application inference disabled. Show its actual tool calls and returned audit IDs when demonstrating this path.

## Scope and recording

The demonstrated application provides synthetic evidence review and one local task effect. Sequential task controls, actual restricted-user denial, evidence-change rejection, lock timeout, a bounded rollback condition, and same-artifact reinstall have been exercised. Concurrent first-execution testing remains incomplete. The native agent, Codex seat, and IPM lifecycle have separate qualification coverage. [Current qualification scope](INTEROPERABILITY.md#qualification-evidence)

Restrict ingress to trusted configured interfaces. Internal trusted callers can construct principal attribution in review messages. Task actor identity comes from the authenticated IRIS operator session. The review audit records attempts, while the task operation receipt supports duplicate reconciliation for this one task.

For a recording, capture the actual native request and results, a separate audit/message readback, and the task's stale and duplicate controls. A screen capture of the two command windows and final task state can show this workflow directly. Keep model credentials, portal details, and unrelated instance data outside the capture. This guide provides a filming sequence. It makes no claim that a new run or recording has been performed.

The dashboard, immersive Round Table, Book of Receipts interface, domain visualization, and human-review delivery remain roadmap items. Present them as planned development when discussing the entry.

### Suggested narration

Use these lines after showing the corresponding successful result:

> KnAIghts brings agents to the table, while IRIS owns the decision boundary.

> The first case has matching source evidence. The native agent reads it and proposes a selection. IRIS checks the references and records the accepted result.

> The second case has conflicting sources. The result requests review and returns no verified selection. We can inspect the exact evidence and stored decision independently.

> An operator can turn that review into a synthetic task, inspect it, approve it, and execute one update. A stale approval is rejected. Repeating an execution returns its stored receipt.

## Stop the owned runtime

Retain the demonstration records and stop the owned production before the application container.

```powershell
@'
Set sc=##class(Ens.Director).StopProduction(30,0)
Write !,"STOP_OK ",$SYSTEM.Status.IsOK(sc),!
Halt
'@ | docker compose -f compose.yaml -f compose.live.yaml exec -T iris iris session IRIS -U USER
docker compose -f compose.yaml -f compose.live.yaml stop
```

The operator manages the separately supplied model endpoint and its shutdown.

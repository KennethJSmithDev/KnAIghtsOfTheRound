Class KnAIghts.Review.SyntheticTask
{
Parameter TASKID As STRING = "synthetic-review-001";

/// This internal operator API changes one synthetic task. Identity comes from the
/// authenticated IRIS session and the existing operator resource, never a request field.
/// It has no MCP/HTTP route. Recheck restricted-seat denial before exposing another caller.
ClassMethod Propose(auditId As %Integer, expectedRevision As %Integer) As %DynamicObject
{
    Quit ..Change("propose", auditId, expectedRevision, 0, "")
}

ClassMethod Approve(expectedRevision As %Integer, expectedEvidenceRevision As %Integer) As %DynamicObject
{
    Quit ..Change("approve", 0, expectedRevision, expectedEvidenceRevision, "")
}

ClassMethod ReviseEvidence(auditId As %Integer, expectedRevision As %Integer) As %DynamicObject
{
    Quit ..Change("revise", auditId, expectedRevision, 0, "")
}

ClassMethod Execute(operationId As %String, expectedRevision As %Integer, expectedEvidenceRevision As %Integer) As %DynamicObject
{
    Quit ..Change("execute", 0, expectedRevision, expectedEvidenceRevision, operationId)
}

ClassMethod Read() As %DynamicObject
{
    If '..Authorized() Quit {"status":"DENIED"}
    Lock +^KnAIghtsSyntheticTask:2
    If '$Test Quit {"status":"BUSY"}
    Try {
        Set task = ..Task(), result = {"status":"NOT_FOUND"}
        If $IsObject(task) {
            Set result = {"status":"OK"}
            Do result.%Set("task", task)
        }
    } Catch exception {
        Set result = {"status":"ERROR"}
    }
    Lock -^KnAIghtsSyntheticTask
    Quit result
}

ClassMethod Authorized() As %Boolean [ Private ]
{
    Quit ($USERNAME'="") && $SYSTEM.Security.Check("%Admin_Operate", "U")
}

ClassMethod ValidRevision(value As %String) As %Boolean [ Private ]
{
    If value'?1.10N Quit 0
    Quit +value<2147483647
}

/// One bounded lock protects every transition and operation receipt. Reject ambient
/// transactions so this API cannot commit or roll back a caller's unrelated work.
/// The task, history and execution receipt commit together. No native review audit is written.
ClassMethod Change(action As %String, auditId As %Integer, revision As %Integer, evidenceRevision As %Integer, operationId As %String) As %DynamicObject [ Private ]
{
    If '..Authorized() Quit {"status":"DENIED"}
    If $TLevel Quit {"status":"AMBIENT_TRANSACTION_REJECTED"}
    If '..ValidRevision(revision) Quit {"status":"INVALID_REVISION"}
    If '..ValidRevision(evidenceRevision) Quit {"status":"INVALID_REVISION"}
    If action="execute" {
        If ($Length(operationId)<1)!($Length(operationId)>64) Quit {"status":"INVALID_OPERATION_ID"}
        If $Translate(operationId,"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")'="" Quit {"status":"INVALID_OPERATION_ID"}
    }
    Lock +^KnAIghtsSyntheticTask:2
    If '$Test Quit {"status":"BUSY"}
    Try {
        TStart
        If action="propose" {
            Set result = ..ProposeLocked(auditId, revision)
        } ElseIf action="approve" {
            Set result = ..ApproveLocked(revision, evidenceRevision)
        } ElseIf action="revise" {
            Set result = ..ReviseLocked(auditId, revision)
        } ElseIf action="execute" {
            Set result = ..ExecuteLocked(operationId, revision, evidenceRevision)
        } Else {
            Set result = {"status":"INVALID_ACTION"}
        }
        TCommit
    } Catch exception {
        If $TLevel TRollback 1
        Set result = {"status":"ERROR"}
    }
    Lock -^KnAIghtsSyntheticTask
    Quit result
}

ClassMethod Task() As %DynamicObject [ Private ]
{
    Set raw = $Get(^KnAIghtsSyntheticTask(..#TASKID))
    If raw="" Quit ""
    Quit ##class(%DynamicObject).%FromJSON(raw)
}

/// Bind an existing synthetic review response to its exact immutable audit JSON and
/// current server-owned facts. Unknown cases, missing records and unsupported citations fail closed.
ClassMethod Evidence(auditId As %Integer) As %DynamicObject [ Private ]
{
    If '..ValidRevision(auditId) Quit {"status":"INVALID_EVIDENCE"}
    If auditId<1 Quit {"status":"INVALID_EVIDENCE"}
    Set raw = $Get(^KnAIghtsReviewAudit(auditId))
    If raw="" Quit {"status":"EVIDENCE_UNAVAILABLE"}
    Try {
        Set audit = ##class(%DynamicObject).%FromJSON(raw)
        Set packet = ##class(KnAIghts.Review.Cases).Resolve("synthetic-b")
        Set facts = packet.%Get("facts"), refs = facts.%Get("evidenceRefs")
        Set valid = audit.%Get("caseId")="synthetic-b"
        Set valid = valid && (audit.%Get("status")="REVIEW_REQUESTED")
        Set valid = valid && (audit.%Get("action")="REQUEST_REVIEW")
        Set valid = valid && (audit.%Get("semanticId")="")
        Set valid = valid && (audit.%Get("auditId")=auditId)
        Set valid = valid && (audit.%Get("citations").%ToJSON()=refs.%ToJSON())
        Set valid = valid && (audit.%Get("limitation")=packet.%Get("limitation"))
        Set valid = valid && (facts.%Get("kind")="synthetic")
    } Catch exception {
        Set valid = 0
    }
    If 'valid Quit {"status":"INVALID_EVIDENCE"}
    Set result = {"status":"VALID"}
    Do result.%Set("auditId", auditId)
    Do result.%Set("auditJson", raw)
    Do result.%Set("factsJson", facts.%ToJSON())
    Quit result
}

ClassMethod EvidenceMatches(task As %DynamicObject) As %Boolean [ Private ]
{
    Set current = ..Evidence(task.%Get("auditId"))
    If current.%Get("status")'="VALID" Quit 0
    Quit (current.%Get("auditJson")=task.%Get("auditJson")) && (current.%Get("factsJson")=task.%Get("factsJson"))
}

ClassMethod Save(task As %DynamicObject, outcome As %String) As %DynamicObject [ Private ]
{
    Do task.%Set("updatedBy", $USERNAME)
    Set raw = task.%ToJSON()
    Set ^KnAIghtsSyntheticTask(..#TASKID) = raw
    Set ^KnAIghtsSyntheticTask("history", task.%Get("revision")) = raw
    Set result = {}
    Do result.%Set("status", outcome)
    Do result.%Set("task", task)
    Quit result
}

ClassMethod ProposeLocked(auditId As %Integer, revision As %Integer) As %DynamicObject [ Private ]
{
    If $Data(^KnAIghtsSyntheticTask(..#TASKID)) Quit {"status":"ALREADY_EXISTS"}
    If revision'=0 Quit {"status":"STALE_REVISION"}
    Set evidence = ..Evidence(auditId)
    If evidence.%Get("status")'="VALID" Quit evidence
    Set task = {"status":"OPEN","revision":0,"evidenceRevision":0,"caseId":"synthetic-b","effect":"MARK_REVIEWED"}
    Do task.%Set("taskId", ..#TASKID)
    Set ^KnAIghtsSyntheticTask("history", 0) = task.%ToJSON()
    Do task.%Set("status", "PROPOSED")
    Do task.%Set("revision", 1)
    Do task.%Set("evidenceRevision", 1)
    Do task.%Set("auditId", auditId)
    Do task.%Set("auditJson", evidence.%Get("auditJson"))
    Do task.%Set("factsJson", evidence.%Get("factsJson"))
    Do task.%Set("proposedBy", $USERNAME)
    Quit ..Save(task, "PROPOSED")
}

ClassMethod ApproveLocked(revision As %Integer, evidenceRevision As %Integer) As %DynamicObject [ Private ]
{
    Set task = ..Task()
    If '$IsObject(task) Quit {"status":"NOT_FOUND"}
    If task.%Get("revision")'=revision Quit {"status":"STALE_REVISION"}
    If task.%Get("evidenceRevision")'=evidenceRevision Quit {"status":"STALE_EVIDENCE"}
    If task.%Get("status")'="PROPOSED" Quit {"status":"INVALID_STATE"}
    If '..EvidenceMatches(task) Quit {"status":"EVIDENCE_CHANGED"}
    Set nextRevision = revision+1, approval = {}
    Do approval.%Set("approvalId", ..#TASKID_"-approval-"_nextRevision)
    Do approval.%Set("approvedBy", $USERNAME)
    Do approval.%Set("taskRevision", nextRevision)
    Do approval.%Set("evidenceRevision", evidenceRevision)
    Do approval.%Set("auditJson", task.%Get("auditJson"))
    Do approval.%Set("factsJson", task.%Get("factsJson"))
    Do task.%Set("approval", approval)
    Do task.%Set("status", "APPROVED")
    Do task.%Set("revision", nextRevision)
    Quit ..Save(task, "APPROVED")
}

ClassMethod ReviseLocked(auditId As %Integer, revision As %Integer) As %DynamicObject [ Private ]
{
    Set task = ..Task()
    If '$IsObject(task) Quit {"status":"NOT_FOUND"}
    If task.%Get("revision")'=revision Quit {"status":"STALE_REVISION"}
    If task.%Get("status")="REVIEWED" Quit {"status":"TASK_COMPLETE"}
    If task.%Get("auditId")=auditId Quit {"status":"EVIDENCE_NOT_REVISED"}
    Set evidence = ..Evidence(auditId)
    If evidence.%Get("status")'="VALID" Quit evidence
    Do task.%Set("revision", revision+1)
    Do task.%Set("evidenceRevision", task.%Get("evidenceRevision")+1)
    Do task.%Set("status", "PROPOSED")
    Do task.%Set("approval", {})
    Do task.%Set("auditId", auditId)
    Do task.%Set("auditJson", evidence.%Get("auditJson"))
    Do task.%Set("factsJson", evidence.%Get("factsJson"))
    Quit ..Save(task, "EVIDENCE_REVISED")
}

ClassMethod ExecuteLocked(operationId As %String, revision As %Integer, evidenceRevision As %Integer) As %DynamicObject [ Private ]
{
    Set prior = $Get(^KnAIghtsSyntheticTask("operations", operationId))
    If prior'="" {
        Set result = {"status":"DUPLICATE_EXECUTION"}
        Do result.%Set("receipt", ##class(%DynamicObject).%FromJSON(prior))
        Quit result
    }
    Set task = ..Task()
    If '$IsObject(task) Quit {"status":"NOT_FOUND"}
    If task.%Get("evidenceRevision")'=evidenceRevision Quit {"status":"STALE_APPROVAL"}
    If task.%Get("revision")'=revision Quit {"status":"STALE_REVISION"}
    If task.%Get("status")="REVIEWED" Quit {"status":"TASK_COMPLETE"}
    If task.%Get("status")'="APPROVED" Quit {"status":"APPROVAL_REQUIRED"}
    Set approval = task.%Get("approval")
    If '$IsObject(approval) Quit {"status":"STALE_APPROVAL"}
    If approval.%Get("taskRevision")'=revision Quit {"status":"STALE_APPROVAL"}
    If approval.%Get("evidenceRevision")'=evidenceRevision Quit {"status":"STALE_APPROVAL"}
    If approval.%Get("approvedBy")="" Quit {"status":"STALE_APPROVAL"}
    If approval.%Get("auditJson")'=task.%Get("auditJson") Quit {"status":"STALE_APPROVAL"}
    If approval.%Get("factsJson")'=task.%Get("factsJson") Quit {"status":"STALE_APPROVAL"}
    If '..EvidenceMatches(task) Quit {"status":"EVIDENCE_CHANGED"}
    Set receipt = {}
    Do receipt.%Set("taskId", ..#TASKID)
    Do receipt.%Set("operationId", operationId)
    Do receipt.%Set("approvalId", approval.%Get("approvalId"))
    Do receipt.%Set("approvedBy", approval.%Get("approvedBy"))
    Do receipt.%Set("executedBy", $USERNAME)
    Do receipt.%Set("taskRevision", revision+1)
    Do receipt.%Set("evidenceRevision", evidenceRevision)
    Do receipt.%Set("status", "REVIEWED")
    Do task.%Set("status", "REVIEWED")
    Do task.%Set("revision", revision+1)
    Do task.%Set("execution", receipt)
    Set ^KnAIghtsSyntheticTask("operations", operationId) = receipt.%ToJSON()
    Set result = ..Save(task, "EXECUTED")
    Do result.%Set("receipt", receipt)
    Quit result
}
}

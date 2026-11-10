Include %occStatus

Class KnAIghts.Bonus.NoticeAdapter Extends Ens.OutboundAdapter
{
Parameter SETTINGS = "Directory:Basic";
Property Directory As %String(MAXLEN = 200);

/// A deliberately narrow filesystem adapter for an operator-owned output directory.
/// Never overwrite a prior task notice. The IRIS lock covers this production's workers,
/// not external filesystem writers; use a private directory and reconcile interrupted writes.
Method WriteNotice(request As KnAIghts.Bonus.NoticeRequest) As %Status
{
    Set dir = ..Directory
    If (dir="") || ('##class(%File).DirectoryExists(dir)) Quit $$$ERROR($$$GeneralError, "Notice directory is not configured")
    If $Extract(dir,*)'="/" Set dir = dir_"/"
    Set path = dir_"synthetic-review-task-"_request.TaskId_".json"
    Lock +^KnAIghtsBonusNotice(request.TaskId):2
    If '$Test Quit $$$ERROR($$$GeneralError, "Notice is busy")
    Set sc = $$$OK, opened = 0, oldIO = $IO
    Try {
        If ##class(%File).Exists(path) {
            Set sc = $$$ERROR($$$GeneralError, "Notice already exists; reconcile before retry")
        } Else {
            Set notice = {"kind":"synthetic-workflow-review","sourceDisposition":"REVIEW_REQUESTED","sourceAction":"REQUEST_REVIEW","semanticSelection":"","effect":"NOTICE_ONLY"}
            Do notice.%Set("auditId", request.AuditId)
            Do notice.%Set("workflowTaskId", request.TaskId)
            Do notice.%Set("reviewAction", request.ReviewAction)
            Do notice.%Set("reviewer", request.Reviewer)
            Do notice.%Set("evidenceHashAlgorithm", "sha256-canonical-json-v1")
            Do notice.%Set("evidenceHash", request.EvidenceHash)
            Open path:("WNS"):2
            If '$Test {
                Set sc = $$$ERROR($$$GeneralError, "Cannot open notice")
            } Else {
                Set opened = 1
                Use path Write notice.%ToJSON(),!
                Use oldIO Close path Set opened = 0
                // The restricted viewer cannot run Embedded Python. Retain the
                // writer's exact validated payload only after the file is closed,
                // so readback can compare both records without extra privileges.
                Set ^KnAIghtsBonusNotice(request.TaskId,"receipt")=notice.%ToJSON()
            }
        }
    } Catch exception {
        Use oldIO
        If opened Close path
        Set sc = exception.AsStatus()
    }
    Lock -^KnAIghtsBonusNotice(request.TaskId)
    Quit sc
}
}

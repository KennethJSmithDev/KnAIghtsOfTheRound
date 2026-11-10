Include %occStatus

Class KnAIghts.Context.Live
{
/// Only the separately authenticated local operator can create or answer a
/// synthetic Workflow task. A review choice never approves or executes the
/// separate synthetic task. Keep ambiguous sends fail-closed on retries.
ClassMethod Allowed() As %Boolean
{
    Quit ($ZConvert($USERNAME,"L")="knaights_operator") && $SYSTEM.Security.Check("KnAIghtsWorkflowUse","U") && ('$SYSTEM.Security.Check("%Admin_Operate","U")) && ($SYSTEM.Util.GetEnviron("KNAIGHTS_CONTEXT_LIVE")="1")
}

ClassMethod Resolve(requestId As %String, Output run As %DynamicObject, Output auditId As %Integer) As %Status [ Private ]
{
    Set run="",auditId=0
    If ($Length(requestId)<1)!($Length(requestId)>64)!($Translate(requestId,"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")'="") Quit $$$ERROR($$$GeneralError,"Invalid live request")
    Set stored=$Get(^KnAIghtsLiveSession("run",requestId))
    If stored="" Quit $$$ERROR($$$GeneralError,"Live request unavailable")
    Set sc=$$$OK
    Try {
        Set run=##class(%DynamicObject).%FromJSON(stored)
        If (run.%Get("requestId")'=requestId)!(run.%Get("status")'="COMPLETE") Throw ##class(%Exception.General).%New("Live request incomplete")
        If (run.%Get("agent").%Get("kind")'="native-ai-hub")!(run.%Get("interop").%Get("status")'="VERIFIED") Throw ##class(%Exception.General).%New("Live source binding unavailable")
        Set auditId=run.%Get("response").%Get("auditId")
        Set sc=##class(KnAIghts.Context.Audit).Capture(auditId,.raw,.facts,.caseId,.disposition,.vector)
        If $$$ISERR(sc) Throw ##class(%Exception.StatusException).CreateFromStatus(sc)
        If (caseId'=run.%Get("caseId"))!(raw'=run.%Get("response").%ToJSON())!(facts'=run.%Get("facts").%ToJSON()) Throw ##class(%Exception.General).%New("Live evidence changed")
    } Catch exception {
        Set sc=$$$ERROR($$$GeneralError,"Live source binding unavailable")
    }
    Quit sc
}

ClassMethod Queue(requestId As %String) As %DynamicObject
{
    If '..Allowed() Quit {"status":"DENIED"}
    Set sc=..Resolve(requestId,.run,.auditId)
    If $$$ISERR(sc) Quit {"status":"LIVE_RUN_UNAVAILABLE"}
    If (run.%Get("caseId")'="synthetic-b")!(run.%Get("response").%Get("status")'="REVIEW_REQUESTED") Quit {"status":"MISMATCH_REQUIRED"}
    Lock +^KnAIghtsLiveWorkflow(requestId):2
    If '$Test Quit {"status":"BUSY"}
    Set result={"status":"UNAVAILABLE"}
    Try {
        Set old=$Get(^KnAIghtsLiveWorkflow(requestId,"stage"))
        If old'="" {
            If $Get(^KnAIghtsLiveWorkflow(requestId,"audit"))'=auditId {
                Set result={"status":"CORRELATION_MISMATCH"}
            } ElseIf old="QUEUED" {
                Set result={"status":"QUEUED"}
            } Else {
                Set result={"status":"SUBMISSION_UNCERTAIN"}
            }
        } Else {
            // Index only independently bound earlier native runs from this same
            // local session. Never replace an existing vector row.
            Set count=$Get(^KnAIghtsLiveSession("count"),0),sc=$$$OK
            For i=1:1:count {
                Set other=$Get(^KnAIghtsLiveSession("order",i))
                If other'=requestId {
                    Set priorSc=..Resolve(other,.prior,.priorAudit)
                    If $$$ISOK(priorSc) Set sc=##class(KnAIghts.Context.Vector).EnsureLiveAudit(priorAudit)
                    If $$$ISERR(sc) Quit
                }
            }
            If $$$ISERR(sc) {
                Set result={"status":"INDEX_UNAVAILABLE"}
            } Else {
                Set ^KnAIghtsLiveWorkflow(requestId,"audit")=auditId
                Set ^KnAIghtsLiveWorkflow(requestId,"stage")="STARTING"
                Set sc=##class(Ens.Director).CreateBusinessService("KnAIghtsLiveWorkflow",.entry)
                If $$$ISOK(sc) {
                    Set input=##class(KnAIghts.Bonus.ReviewRequest).%New(),input.AuditId=auditId
                    Set sc=entry.ProcessInput(input,.ack,.hint)
                }
                If $$$ISOK(sc) {
                    Set ^KnAIghtsLiveWorkflow(requestId,"stage")="QUEUED",result={"status":"QUEUED"}
                } Else {
                    Set ^KnAIghtsLiveWorkflow(requestId,"stage")="UNCERTAIN",result={"status":"SUBMISSION_UNCERTAIN"}
                }
            }
        }
    } Catch exception {
        Set result={"status":"SUBMISSION_UNCERTAIN"}
    }
    Lock -^KnAIghtsLiveWorkflow(requestId)
    Quit result
}

ClassMethod Status(requestId As %String) As %DynamicObject
{
    If '..Allowed() Quit {"status":"DENIED"}
    Set sc=..Resolve(requestId,.run,.auditId)
    If $$$ISERR(sc) Quit {"status":"LIVE_RUN_UNAVAILABLE"}
    Set stage=$Get(^KnAIghtsLiveWorkflow(requestId,"stage"))
    If stage="" Quit {"status":"NOT_REQUESTED"}
    If $Get(^KnAIghtsLiveWorkflow(requestId,"audit"))'=auditId Quit {"status":"CORRELATION_MISMATCH"}
    If stage'="QUEUED" Quit {"status":"SUBMISSION_UNCERTAIN"}
    Set taskId=$Get(^KnAIghtsLiveWorkflow(requestId,"task")),item=$Get(^KnAIghtsLiveWorkflow(requestId,"item"))
    If taskId="" {
        Set st=##class(%SQL.Statement).%New(),sc=st.%Prepare("SELECT %ID AS ItemId,Task FROM EnsLib_Workflow.Worklist WHERE UserName = ?")
        If $$$ISERR(sc) Quit {"status":"WORKLIST_UNAVAILABLE"}
        Set rows=st.%Execute($USERNAME),found=0
        If rows.%SQLCODE<0 Quit {"status":"WORKLIST_UNAVAILABLE"}
        While rows.%Next() {
            Set candidate=##class(EnsLib.Workflow.TaskResponse).%OpenId(rows.%Get("Task"))
            If $IsObject(candidate),candidate.%Subject=("Synthetic mismatch audit "_auditId),candidate.%RoleName="KnAIghtsReviewers",candidate.%TaskStatus.Source="KnAIghtsReviewFlow" {
                Set found=found+1,taskId=candidate.%Id(),item=rows.%Get("ItemId")
            }
        }
        If found=0 Quit {"status":"QUEUED"}
        If found'=1 Quit {"status":"WORKLIST_AMBIGUOUS"}
        Set ^KnAIghtsLiveWorkflow(requestId,"task")=taskId,^KnAIghtsLiveWorkflow(requestId,"item")=item
    }
    Set task=##class(EnsLib.Workflow.TaskResponse).%OpenId(taskId)
    If '$IsObject(task) Quit {"status":"WORKLIST_UNAVAILABLE"}
    If (task.%Subject'=("Synthetic mismatch audit "_auditId))!(task.%RoleName'="KnAIghtsReviewers")!(task.%TaskStatus.Source'="KnAIghtsReviewFlow") Quit {"status":"WORKLIST_UNAVAILABLE"}
    Set result={"status":"PENDING"}
    Do result.%Set("auditId",auditId),result.%Set("taskId",taskId),result.%Set("summary",task.%Message)
    If task.%TaskStatus.IsComplete {
        If (task.%Action'="KnAIghtsReviewed")&&(task.%Action'="KnAIghtsDeclined") Quit {"status":"WORKLIST_UNAVAILABLE"}
        Do result.%Set("status","COMPLETED"),result.%Set("action",task.%Action),result.%Set("reviewer",task.%UserName)
        Do result.%Set("notice",..NoticeProjection(auditId,taskId,task.%Action,task.%UserName))
    } ElseIf $Get(^KnAIghtsLiveWorkflow(requestId,"decisionStage"))="SENT" {
        Do result.%Set("status","DECISION_PENDING")
    } ElseIf $Get(^KnAIghtsLiveWorkflow(requestId,"decision"))'="" {
        Do result.%Set("status","DECISION_UNCERTAIN")
    }
    Quit result
}

/// The adapter owns the notice. Read its configured file under the writer's lock
/// and bind its content to the persisted task and revalidated source; absence,
/// malformed data, and read failures never become a claimed delivered notice.
ClassMethod NoticeProjection(auditId As %Integer, taskId As %String, action As %String, reviewer As %String) As %DynamicObject [ Private ]
{
    Set result={"status":"UNAVAILABLE"}
    If (taskId'?1.N)!(taskId<1) Quit result
    Lock +^KnAIghtsBonusNotice(taskId):2
    If '$Test Quit result
    Try {
        Set dir=##class(Ens.Director).GetAdapterSettingValue("KnAIghts.Context.Production||KnAIghtsNotice","Directory",.sc)
        If $$$ISERR(sc)!(dir="") Throw ##class(%Exception.General).%New("Notice directory unavailable")
        If $Extract(dir,*)'="/" Set dir=dir_"/"
        Set path=dir_"synthetic-review-task-"_taskId_".json"
        If '##class(%File).Exists(path) {
            Set result={"status":"PENDING"}
        } Else {
            Set stream=##class(%Stream.FileCharacter).%New(),sc=stream.LinkToFile(path)
            If $$$ISERR(sc) Throw ##class(%Exception.General).%New("Notice read unavailable")
            Set text=stream.Read(4097)
            If ($Length(text)>4096)!('stream.AtEnd) Throw ##class(%Exception.General).%New("Notice too large")
            Set notice=##class(%DynamicObject).%FromJSON(text)
            Set receipt=$Get(^KnAIghtsBonusNotice(taskId,"receipt")),valid=(receipt'="")
            If valid Set emitted=##class(%DynamicObject).%FromJSON(receipt),valid=(notice.%ToJSON()=emitted.%ToJSON())
            Set digest=notice.%Get("evidenceHash")
            Set valid=valid && ($Length(digest)=64) && ($Translate(digest,"0123456789abcdef")="")
            Set valid=valid && (notice.%Get("kind")="synthetic-workflow-review") && (notice.%Get("sourceDisposition")="REVIEW_REQUESTED") && (notice.%Get("sourceAction")="REQUEST_REVIEW")
            Set valid=valid && (notice.%Get("semanticSelection")="") && (notice.%Get("effect")="NOTICE_ONLY") && (notice.%Get("auditId")=auditId) && (notice.%Get("workflowTaskId")=taskId)
            Set valid=valid && (notice.%Get("reviewAction")=action) && (notice.%Get("reviewer")=reviewer) && (notice.%Get("evidenceHashAlgorithm")="sha256-canonical-json-v1") && (notice.%Get("evidenceHash")=digest)
            If valid {
                Set result={"status":"RECORDED","effect":"NOTICE_ONLY"}
                Do result.%Set("auditId",auditId),result.%Set("taskId",taskId),result.%Set("action",action),result.%Set("reviewer",reviewer),result.%Set("evidenceHash",digest)
            } Else {
                Set result={"status":"INVALID"}
            }
        }
    } Catch exception {
        Set result={"status":"UNAVAILABLE"}
    }
    Lock -^KnAIghtsBonusNotice(taskId)
    Quit result
}

ClassMethod Decide(requestId As %String, action As %String) As %DynamicObject
{
    If '..Allowed() Quit {"status":"DENIED"}
    If (action'="KnAIghtsReviewed")&&(action'="KnAIghtsDeclined") Quit {"status":"ACTION_DENIED"}
    Lock +^KnAIghtsLiveWorkflow(requestId):2
    If '$Test Quit {"status":"BUSY"}
    Set result={"status":"DECISION_UNCERTAIN"}
    Try {
        Set current=..Status(requestId)
        If current.%Get("status")="COMPLETED" {
            If current.%Get("action")=action Set result=current
        } ElseIf (current.%Get("status")="PENDING") && ($Get(^KnAIghtsLiveWorkflow(requestId,"decision"))="") {
            Set item=$Get(^KnAIghtsLiveWorkflow(requestId,"item"))
            Set ^KnAIghtsLiveWorkflow(requestId,"decision")=action,^KnAIghtsLiveWorkflow(requestId,"decisionStage")="SUBMITTING"
            Set message="",sc=##class(EnsLib.Workflow.Engine).%TakeOwnershipForTask(item,$USERNAME,.message)
            If $$$ISOK(sc) Set sc=##class(EnsLib.Workflow.Engine).%ProcessAction(action,item,$USERNAME,.message)
            If $$$ISOK(sc) {
                Set ^KnAIghtsLiveWorkflow(requestId,"decisionStage")="SENT",result={"status":"DECISION_PENDING"}
            } Else {
                Set ^KnAIghtsLiveWorkflow(requestId,"decisionStage")="UNCERTAIN"
            }
        }
    } Catch exception {
        If $Get(^KnAIghtsLiveWorkflow(requestId,"decision"))'="" Set ^KnAIghtsLiveWorkflow(requestId,"decisionStage")="UNCERTAIN"
        Set result={"status":"DECISION_UNCERTAIN"}
    }
    Lock -^KnAIghtsLiveWorkflow(requestId)
    Quit result
}
}

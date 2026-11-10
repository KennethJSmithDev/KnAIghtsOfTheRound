Include %occStatus

Class KnAIghts.LiveSession.State
{
ClassMethod Allowed() As %Boolean [ Private ]
{
    Quit ($ZConvert($USERNAME,"L")="knaights_codex") && $SYSTEM.Security.Check("KnAIghtsSeatUse","U") && ('$SYSTEM.Security.Check("%Admin_Operate","U"))
}

/// Context production is an explicit live-session profile. Keep its status
/// projection here so the qualified core review class and its package bytes do
/// not change. An unrelated running production never becomes an admitted one.
ClassMethod RuntimeStatus() As %DynamicObject [ Private ]
{
    Set result=##class(KnAIghts.Review.App).Status(),contextLive=0
    If $SYSTEM.Util.GetEnviron("KNAIGHTS_CONTEXT_LIVE")="1" {
        Set sc=##class(Ens.Director).GetProductionStatus(.name,.state)
        If $SYSTEM.Status.IsOK(sc),$Get(name)="KnAIghts.Context.Production",+$Get(state)=1 Set contextLive=1
    }
    If contextLive Do result.%Set("running",1,"boolean")
    Do result.%Set("contextLive",contextLive,"boolean")
    Quit result
}

ClassMethod Snapshot() As %DynamicObject
{
    If '..Allowed() Quit {"status":"DENIED"}
    Set result={"apiVersion":1,"status":"OK"}, caller={}
    Do caller.%Set("principal",$USERNAME),caller.%Set("operatorUse",$SYSTEM.Security.Check("%Admin_Operate","U"),"boolean")
    Do result.%Set("caller",caller),result.%Set("runtime",..RuntimeStatus())
    Set runs=[]
    Lock +^KnAIghtsLiveSession("ledger"):2
    If '$Test Quit {"status":"BUSY"}
    Try {
        Set count=$Get(^KnAIghtsLiveSession("count"),0)
        For i=1:1:count {
            Set id=$Get(^KnAIghtsLiveSession("order",i)),raw=$Get(^KnAIghtsLiveSession("run",id))
            If raw'="" Do runs.%Push(##class(%DynamicObject).%FromJSON(raw))
        }
        Do result.%Set("runs",runs),result.%Set("nativeSubmissions",count)
    } Catch exception {
        Set result={"status":"SNAPSHOT_UNAVAILABLE"}
    }
    Lock -^KnAIghtsLiveSession("ledger")
    Do result.%Set("task",..TaskProjection())
    Quit result
}

/// This projection reads task state under the same lock as its operator API. It never
/// calls an approval/execution method or returns the stored source/audit snapshots.
ClassMethod TaskProjection() As %DynamicObject [ Private ]
{
    Lock +^KnAIghtsSyntheticTask:2
    If '$Test Quit {"available":false,"status":"BUSY"}
    Set result={"available":false,"status":"NOT_CREATED"}
    Try {
        Set raw=$Get(^KnAIghtsSyntheticTask("synthetic-review-001"))
        If raw'="" {
            Set task=##class(%DynamicObject).%FromJSON(raw)
            Set result={"available":true}
            For field="taskId","caseId","status","revision","evidenceRevision","proposedBy","updatedBy" Do result.%Set(field,task.%Get(field))
            Set approval=task.%Get("approval")
            If $IsObject(approval),approval.%Get("approvalId")'="" {
                Set projected={}
                For field="approvalId","approvedBy","taskRevision","evidenceRevision" Do projected.%Set(field,approval.%Get(field))
                Do result.%Set("approval",projected)
            }
            Set execution=task.%Get("execution")
            If $IsObject(execution) Do result.%Set("execution",execution)
        }
    } Catch exception {
        Set result={"available":false,"status":"UNAVAILABLE"}
    }
    Lock -^KnAIghtsSyntheticTask
    Quit result
}

/// Request IDs reconcile repeated HTTP requests without another native invocation.
/// This private campaign admits at most two native submissions and one at a time.
ClassMethod Run(caseId As %String, requestId As %String) As %DynamicObject
{
    If '..Allowed() Quit {"status":"DENIED"}
    If $TLevel Quit {"status":"AMBIENT_TRANSACTION_REJECTED"}
    If (caseId'="synthetic-a") && (caseId'="synthetic-b") Quit {"status":"CASE_NOT_ALLOWED"}
    If ($Length(requestId)<1)!($Length(requestId)>64) Quit {"status":"INVALID_REQUEST_ID"}
    If $Translate(requestId,"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")'="" Quit {"status":"INVALID_REQUEST_ID"}
    Set prior=$Get(^KnAIghtsLiveSession("run",requestId))
    If prior'="" {
        Set existing=##class(%DynamicObject).%FromJSON(prior)
        If existing.%Get("caseId")'=caseId Quit {"status":"CORRELATION_MISMATCH"}
        Quit ..Snapshot()
    }
    Lock +^KnAIghtsLiveSession("execution"):0
    If '$Test Quit {"status":"BUSY"}
    Set result={"status":"UNAVAILABLE"}
    Try {
        // Reconcile again under the execution lock so a delayed duplicate cannot
        // replace an already completed run after its first unlocked lookup.
        Set prior=$Get(^KnAIghtsLiveSession("run",requestId))
        If prior'="" {
            Set existing=##class(%DynamicObject).%FromJSON(prior)
            If existing.%Get("caseId")'=caseId {
                Set result={"status":"CORRELATION_MISMATCH"}
            } Else {
                Set result={"status":"STORED"}
            }
        } Else {
            Set status=..RuntimeStatus()
            If status.%Get("running"),status.%Get("liveEnabled") Set result=..Invoke(caseId,requestId)
        }
    } Catch exception {
        If $TLevel TRollback 1
        Set result={"status":"RUN_UNAVAILABLE"}
    }
    Lock -^KnAIghtsLiveSession("ledger")
    Lock -^KnAIghtsLiveSession("execution")
    If result.%Get("status")="STORED" Set result=..Snapshot()
    Quit result
}

ClassMethod Invoke(caseId As %String, requestId As %String) As %DynamicObject [ Private ]
{
    Lock +^KnAIghtsLiveSession("ledger"):2
    If '$Test Quit {"status":"BUSY"}
    Set count=$Get(^KnAIghtsLiveSession("count"),0)
    If count>=2 { Lock -^KnAIghtsLiveSession("ledger") Quit {"status":"ALLOWANCE_EXHAUSTED"} }
    Set packet=##class(KnAIghts.Review.Cases).Resolve(caseId),facts=packet.%Get("facts")
    Set run={"status":"RUNNING","agent":{"kind":"native-ai-hub","model":"gpt-oss:20b"}}
    Do run.%Set("requestId",requestId),run.%Set("caseId",caseId),run.%Set("actor",$USERNAME)
    Do run.%Set("facts",facts),run.%Set("startedAt",$ZDateTime($Horolog,3))
    TStart
    Set ^KnAIghtsLiveSession("count")=count+1
    Set ^KnAIghtsLiveSession("order",count+1)=requestId
    Set ^KnAIghtsLiveSession("run",requestId)=run.%ToJSON()
    TCommit
    Lock -^KnAIghtsLiveSession("ledger")
    Try {
        Set sc=##class(KnAIghts.Review.App).Submit(caseId,.response)
        If $$$ISERR(sc) {
            Do run.%Set("status","ERROR"),run.%Set("error","INTEROPERABILITY_ERROR")
        } Else {
            Set raw=response.ToJSON(),audit=$Get(^KnAIghtsReviewAudit(response.AuditId))
            // Retain the exact typed response before projecting its header binding.
            // This private candidate is never returned by Snapshot or treated as accepted.
            Set candidate={}
            Do candidate.%Set("responseRaw",raw),candidate.%Set("auditId",response.AuditId),candidate.%Set("responseBodyId",response.%Id())
            Set ^KnAIghtsLiveSession("candidate",requestId)=candidate.%ToJSON()
            Set binding=..MessageBinding(response.AuditId,raw)
            If (audit=raw),(binding.%Get("status")="VERIFIED"),response.CodexPrincipal="" {
                Do run.%Set("status","COMPLETE"),run.%Set("response",##class(%DynamicObject).%FromJSON(raw))
                Do run.%Set("interop",binding)
            } Else {
                Do run.%Set("status","ERROR"),run.%Set("error","AUDIT_OR_MESSAGE_BINDING_UNAVAILABLE")
            }
        }
    } Catch exception {
        Do run.%Set("status","ERROR"),run.%Set("error","NATIVE_RESPONSE_UNAVAILABLE")
    }
    Do run.%Set("completedAt",$ZDateTime($Horolog,3))
    Lock +^KnAIghtsLiveSession("ledger"):2
    If '$Test Quit {"status":"STORE_UNAVAILABLE"}
    Set ^KnAIghtsLiveSession("run",requestId)=run.%ToJSON()
    Lock -^KnAIghtsLiveSession("ledger")
    Quit {"status":"STORED"}
}

/// Match the actual persisted response body and its corresponding request header.
/// Audit ordinals and timing are never substituted for Interoperability session IDs.
ClassMethod MessageBinding(auditId As %Integer, raw As %String) As %DynamicObject [ Private ]
{
    Set result={"status":"UNAVAILABLE"},matches=0
    Set rows=##class(%SQL.Statement).%ExecDirect(,"SELECT TOP 100 ID,SessionId,MessageBodyId,CorrespondingMessageId FROM Ens.MessageHeader WHERE MessageBodyClassName='KnAIghts.Review.Response' AND SourceConfigName='AssessEvidence' AND TargetConfigName='KnAIghtsEntry' ORDER BY ID DESC")
    While rows.%Next() {
        Set body=##class(KnAIghts.Review.Response).%OpenId(rows.%Get("MessageBodyId"))
        If $IsObject(body),body.AuditId=auditId,body.ToJSON()=raw {
            Set header=##class(Ens.MessageHeader).%OpenId(rows.%Get("CorrespondingMessageId"))
            If $IsObject(header),header.SourceConfigName="KnAIghtsEntry",header.TargetConfigName="AssessEvidence",header.SessionId=rows.%Get("SessionId"),header.MessageBodyClassName="KnAIghts.Review.Request" {
                Set request=##class(KnAIghts.Review.Request).%OpenId(header.MessageBodyId)
                If $IsObject(request),request.CaseId=body.CaseId,request.CodexPrincipal="" {
                    Set matches=matches+1,result={"status":"VERIFIED"}
                    Do result.%Set("sessionId",rows.%Get("SessionId"))
                    Do result.%Set("requestHeaderId",header.%Id())
                    Do result.%Set("responseHeaderId",rows.%Get("ID"))
                    Do result.%Set("responseBodyId",rows.%Get("MessageBodyId"))
                }
            }
        }
    }
    If matches'=1 Set result={"status":"UNAVAILABLE"}
    Quit result
}
}

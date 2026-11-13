Include %occStatus

Class KnAIghts.CloudDemo.State
{
ClassMethod Mode() As %String
{
    Set configured=$SYSTEM.Util.GetEnviron("KOTR_CLOUD_PROVIDER_MODE")
    If (configured="") || (configured="replay") Quit "native-agent-model-replay"
    If configured="live" Quit "native-agent-live"
    Quit ""
}

ClassMethod Allowed() As %Boolean [ Private ]
{
    Quit ($ZConvert($USERNAME,"L")="knaights_codex") && $SYSTEM.Security.Check("KnAIghtsSeatUse","U") && ('$SYSTEM.Security.Check("%Admin_Operate","U"))
}

ClassMethod ValidId(requestId As %String) As %Boolean [ Private ]
{
    Quit ($Length(requestId)>=20) && ($Length(requestId)<=64) && ($Translate(requestId,"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")="")
}

ClassMethod Read(requestId As %String) As %DynamicObject
{
    If '..Allowed() Quit {"status":"DENIED"}
    If '..ValidId(requestId) Quit {"status":"INVALID_REQUEST_ID"}
    Set raw=$Get(^KnAIghtsCloudDemo("run",requestId))
    If raw="" Quit {"status":"NOT_FOUND"}
    Set verified=1
    Try {
        Set run=##class(%DynamicObject).%FromJSON(raw)
        If run.%GetTypeOf("response")="object" {
            Set body=run.%Get("response"),binding=run.%Get("interop")
            If ($Get(^KnAIghtsReviewAudit(body.%Get("auditId")))'=body.%ToJSON()) || ('..VerifyBinding(run.%Get("caseId"),body.%ToJSON(),binding)) Set verified=0
        }
    } Catch exception {
        Set verified=0
    }
    If 'verified Quit {"status":"AUTHORITATIVE_READBACK_UNAVAILABLE"}
    Set result={"status":"OK"}
    Do result.%Set("run",run)
    Quit result
}

/// Reserve each request before dispatch. A lost response or interrupted worker never
/// grants permission to invoke the production again with the same request identity.
ClassMethod Run(caseId As %String, requestId As %String) As %DynamicObject
{
    If '..Allowed() Quit {"status":"DENIED"}
    If $TLevel Quit {"status":"AMBIENT_TRANSACTION_REJECTED"}
    If (caseId'="synthetic-a") && (caseId'="synthetic-b") Quit {"status":"CASE_NOT_ALLOWED"}
    If '..ValidId(requestId) Quit {"status":"INVALID_REQUEST_ID"}
    Lock +^KnAIghtsCloudDemo("execution"):0
    If '$Test Quit {"status":"BUSY"}
    Set result={"status":"RUN_UNAVAILABLE"}
    Try {
        Set raw=$Get(^KnAIghtsCloudDemo("run",requestId))
        If raw'="" {
            Set prior=##class(%DynamicObject).%FromJSON(raw)
            If prior.%Get("caseId")'=caseId {
                Set result={"status":"CORRELATION_MISMATCH"}
            } Else {
                Set result=..Read(requestId)
            }
        } Else {
            Set runtime=##class(KnAIghts.Review.App).Status(),count=+$Get(^KnAIghtsCloudDemo("count"))
            Set now=($Piece($Horolog,",",1)*86400)+$Piece($Horolog,",",2)
            If ('runtime.%Get("running")) || ('runtime.%Get("liveEnabled")) || (..Mode()="") {
                Set result={"status":"PRODUCTION_UNAVAILABLE"}
            } ElseIf count>=1000 {
                Set result={"status":"ALLOWANCE_EXHAUSTED"}
            } ElseIf (now-+$Get(^KnAIghtsCloudDemo("lastStart")))<2 {
                Set result={"status":"RATE_LIMITED"}
            } Else {
                Set result=..Invoke(caseId,requestId,count,now)
            }
        }
    } Catch exception {
        If $TLevel TRollback 1
        Set result={"status":"RUN_UNAVAILABLE"}
    }
    Lock -^KnAIghtsCloudDemo("execution")
    Quit result
}

ClassMethod Invoke(caseId As %String, requestId As %String, count As %Integer, now As %Integer) As %DynamicObject [ Private ]
{
    Set packet=##class(KnAIghts.Review.Cases).Resolve(caseId),facts=packet.%Get("facts")
    Set run={"state":"RUNNING"},mode=..Mode()
    Do run.%Set("proposalKind",mode)
    Set agent={"kind":"native-ai-hub","model":"gpt-oss:20b"}
    Do agent.%Set("providerMode",$Select(mode="native-agent-live":"live-provider",1:"recorded-model-responses"))
    Do run.%Set("agent",agent)
    Do run.%Set("caseId",caseId),run.%Set("requestId",requestId),run.%Set("facts",facts)
    Do run.%Set("startedAt",$ZDateTime($Horolog,3))
    TStart
    Set ^KnAIghtsCloudDemo("count")=count+1,^KnAIghtsCloudDemo("lastStart")=now
    Set ^KnAIghtsCloudDemo("run",requestId)=run.%ToJSON()
    TCommit
    Try {
        Set sc=##class(KnAIghts.Review.App).Submit(caseId,.response)
        If $$$ISERR(sc) {
            Do run.%Set("state","ERROR"),run.%Set("error","INTEROPERABILITY_ERROR")
        } Else {
            Set raw=response.ToJSON(),binding=..MessageBinding(caseId,response.%Id(),raw)
            If ($Get(^KnAIghtsReviewAudit(response.AuditId))=raw),(binding.%Get("status")="VERIFIED"),response.CodexPrincipal="" {
                Do run.%Set("response",##class(%DynamicObject).%FromJSON(raw))
                Do run.%Set("interop",binding)
                If (response.Status="ACCEPTED") || (response.Status="REVIEW_REQUESTED") {
                    Do run.%Set("state","COMPLETE")
                } Else {
                    Do run.%Set("state","ERROR"),run.%Set("error","NATIVE_DECISION_NOT_ACCEPTED")
                }
            } Else {
                Do run.%Set("state","ERROR"),run.%Set("error","AUDIT_OR_MESSAGE_BINDING_UNAVAILABLE")
            }
        }
    } Catch exception {
        Do run.%Set("state","ERROR"),run.%Set("error","NATIVE_RESPONSE_UNAVAILABLE")
    }
    Do run.%Set("completedAt",$ZDateTime($Horolog,3))
    Set ^KnAIghtsCloudDemo("run",requestId)=run.%ToJSON()
    Quit ..Read(requestId)
}

ClassMethod MessageBinding(caseId As %String, bodyId As %String, raw As %String) As %DynamicObject [ Private ]
{
    Set result={"status":"UNAVAILABLE"},matches=0
    Set rows=##class(%SQL.Statement).%ExecDirect(,"SELECT TOP 2 ID,SessionId,MessageBodyId,CorrespondingMessageId FROM Ens.MessageHeader WHERE MessageBodyClassName='KnAIghts.Review.Response' AND MessageBodyId=? AND SourceConfigName='AssessEvidence' AND TargetConfigName='KnAIghtsEntry'",bodyId)
    If rows.%SQLCODE<0 Quit result
    While rows.%Next() {
        Set binding={"status":"VERIFIED"}
        Do binding.%Set("sessionId",rows.%Get("SessionId")),binding.%Set("requestHeaderId",rows.%Get("CorrespondingMessageId"))
        Do binding.%Set("responseHeaderId",rows.%Get("ID")),binding.%Set("responseBodyId",rows.%Get("MessageBodyId"))
        If ..VerifyBinding(caseId,raw,binding) Set matches=matches+1,result=binding
    }
    If (matches'=1) || (rows.%SQLCODE<0) Set result={"status":"UNAVAILABLE"}
    Quit result
}

/// Read actual persisted headers and bodies. Stored display identifiers alone do not
/// establish a session, and audit ordinals are never used as message identities.
ClassMethod VerifyBinding(caseId As %String, raw As %String, binding As %DynamicObject) As %Boolean [ Private ]
{
    Set responseHeader=##class(Ens.MessageHeader).%OpenId(binding.%Get("responseHeaderId"))
    If '$IsObject(responseHeader) Quit 0
    If (responseHeader.MessageBodyClassName'="KnAIghts.Review.Response") || (responseHeader.SourceConfigName'="AssessEvidence") || (responseHeader.TargetConfigName'="KnAIghtsEntry") Quit 0
    If (responseHeader.SessionId'=binding.%Get("sessionId")) || (responseHeader.CorrespondingMessageId'=binding.%Get("requestHeaderId")) || (responseHeader.MessageBodyId'=binding.%Get("responseBodyId")) Quit 0
    Set body=##class(KnAIghts.Review.Response).%OpenId(responseHeader.MessageBodyId)
    If '$IsObject(body) Quit 0
    If (body.CaseId'=caseId) || (body.CodexPrincipal'="") || (body.ToJSON()'=raw) Quit 0
    Set requestHeader=##class(Ens.MessageHeader).%OpenId(responseHeader.CorrespondingMessageId)
    If '$IsObject(requestHeader) Quit 0
    If (requestHeader.MessageBodyClassName'="KnAIghts.Review.Request") || (requestHeader.SourceConfigName'="KnAIghtsEntry") || (requestHeader.TargetConfigName'="AssessEvidence") || (requestHeader.SessionId'=responseHeader.SessionId) Quit 0
    Set request=##class(KnAIghts.Review.Request).%OpenId(requestHeader.MessageBodyId)
    If '$IsObject(request) Quit 0
    Quit (request.CaseId=caseId) && (request.CodexPrincipal="") && (request.CodexProposal="")
}
}

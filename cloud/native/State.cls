Include %occStatus

Class KnAIghts.CloudDemo.State
{
Parameter AttemptLimit = 1000;
Parameter StartIntervalSeconds = 2;

ClassMethod Mode() As %String
{
    Set configured=$SYSTEM.Util.GetEnviron("KOTR_CLOUD_PROVIDER_MODE")
    If (configured="") || (configured="replay") Quit "native-agent-model-replay"
    If configured="live" Quit "native-agent-live"
    Quit ""
}

ClassMethod Profile(mode As %String = "") As %DynamicObject
{
    If mode="" Set mode=..Mode()
    Set agent={"kind":"native-ai-hub","model":"gpt-oss:20b"}
    Do agent.%Set("providerMode",$Select(mode="native-agent-live":"live-provider",1:"recorded-model-responses"))
    Quit agent
}

/// A single global read is an advisory snapshot. Only Run reserves attempts, under its lock.
ClassMethod Allowance() As %DynamicObject
{
    If '..Allowed() Quit {"status":"DENIED"}
    Set result={"status":"UNAVAILABLE"}
    Try {
        Set used=$Get(^KnAIghtsCloudDemo("count"),0)
        If (used?1.N) && (used<=..#AttemptLimit) {
            Set used=+used,result={"status":"OK","scope":"shared-retained-instance","maxConcurrent":1}
            Do result.%Set("limit",..#AttemptLimit),result.%Set("used",used)
            Do result.%Set("remaining",..#AttemptLimit-used),result.%Set("minIntervalSeconds",..#StartIntervalSeconds)
        }
    } Catch exception {
        Set result={"status":"UNAVAILABLE"}
    }
    Quit result
}

ClassMethod ByokEnabled() As %Boolean
{
    Quit $SYSTEM.Util.GetEnviron("KOTR_CLOUD_BYOK_ENABLED")="1"
}

ClassMethod NewReviewsBlocked() As %Boolean
{
    If '..Allowed() Quit 1
    Quit $Data(^KnAIghtsCloudDemo("leaseBarrier"))>0
}

ClassMethod ValidLease(leaseId As %String) As %Boolean [ Private ]
{
    Quit ($Length(leaseId)=64) && ($Translate(leaseId,"0123456789abcdef")="")
}

/// Only opaque lease identities cross this loopback boundary; provider keys never enter IRIS.
ClassMethod LeaseCall(action As %String, input As %DynamicObject) As %DynamicObject [ Private ]
{
    Set result={"status":"LEASE_UNAVAILABLE"}
    Try {
        Set http=##class(%Net.HttpRequest).%New()
        Set http.Server="127.0.0.1",http.Port=11434,http.Https=0,http.Timeout=5
        Set http.ContentType="application/json"
        Do http.SetHeader("Authorization","Bearer local-only")
        Do http.EntityBody.Write(input.%ToJSON())
        Set sc=http.Post("/lease/"_action)
        If $$$ISOK(sc),$IsObject(http.HttpResponse),http.HttpResponse.StatusCode=200 {
            Set body=http.HttpResponse.Data.Read(1025)
            If ($Length(body)<1025),http.HttpResponse.Data.AtEnd {
                Set reply=##class(%DynamicObject).%FromJSON(body)
                If reply.%Get("status")="OK" Set result=reply
            }
        }
    } Catch exception {
        Set result={"status":"LEASE_UNAVAILABLE"}
    }
    Quit result
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
ClassMethod Run(caseId As %String, requestId As %String, leaseId As %String = "") As %DynamicObject
{
    If '..Allowed() Quit {"status":"DENIED"}
    If $TLevel Quit {"status":"AMBIENT_TRANSACTION_REJECTED"}
    If (caseId'="synthetic-a") && (caseId'="synthetic-b") Quit {"status":"CASE_NOT_ALLOWED"}
    If '..ValidId(requestId) Quit {"status":"INVALID_REQUEST_ID"}
    If (leaseId'=""),('..ByokEnabled() || '..ValidLease(leaseId)) Quit {"status":"INVALID_REQUEST"}
    If ..ByokEnabled(),(..Mode()'="native-agent-model-replay") Quit {"status":"PRODUCTION_UNAVAILABLE"}
    Lock +^KnAIghtsCloudDemo("execution"):0
    If '$Test Quit {"status":"BUSY"}
    Set result={"status":"RUN_UNAVAILABLE"}
    Try {
        Set raw=$Get(^KnAIghtsCloudDemo("run",requestId))
        If raw'="" {
            Set prior=##class(%DynamicObject).%FromJSON(raw)
            If (prior.%Get("caseId")'=caseId) || ((leaseId'="") && (prior.%Get("proposalKind")'="native-agent-live")) {
                Set result={"status":"CORRELATION_MISMATCH"}
            } Else {
                Set result=..Read(requestId)
            }
        } ElseIf $Data(^KnAIghtsCloudDemo("leaseBarrier")) {
            Set result={"status":"LEASE_RECOVERY_REQUIRED"}
        } Else {
            Set runtime=##class(KnAIghts.Review.App).Status(),count=+$Get(^KnAIghtsCloudDemo("count"))
            Set now=($Piece($Horolog,",",1)*86400)+$Piece($Horolog,",",2)
            If ('runtime.%Get("running")) || ('runtime.%Get("liveEnabled")) || (..Mode()="") {
                Set result={"status":"PRODUCTION_UNAVAILABLE"}
            } ElseIf count>=..#AttemptLimit {
                Set result={"status":"ALLOWANCE_EXHAUSTED"}
            } ElseIf (now-+$Get(^KnAIghtsCloudDemo("lastStart")))<..#StartIntervalSeconds {
                Set result={"status":"RATE_LIMITED"}
            } Else {
                Set result=..Invoke(caseId,requestId,count,now,leaseId)
            }
        }
    } Catch exception {
        If $TLevel TRollback 1
        Set result={"status":"RUN_UNAVAILABLE"}
    }
    Lock -^KnAIghtsCloudDemo("execution")
    Quit result
}

ClassMethod Invoke(caseId As %String, requestId As %String, count As %Integer, now As %Integer, leaseId As %String = "") As %DynamicObject [ Private ]
{
    Set packet=##class(KnAIghts.Review.Cases).Resolve(caseId),facts=packet.%Get("facts")
    Set run={"state":"RUNNING"},mode=$Select(leaseId'="":"native-agent-live",1:..Mode())
    Do run.%Set("proposalKind",mode)
    Set agent=..Profile(mode)
    Do run.%Set("agent",agent)
    Do run.%Set("caseId",caseId),run.%Set("requestId",requestId),run.%Set("facts",facts)
    Do run.%Set("startedAt",$ZDateTime($Horolog,3))
    Set leased=..ByokEnabled(),activeLease=leaseId,leaseReady=1,terminalProof=0
    TStart
    Set ^KnAIghtsCloudDemo("count")=count+1,^KnAIghtsCloudDemo("lastStart")=now
    If leased Set ^KnAIghtsCloudDemo("leaseBarrier")=requestId
    Set ^KnAIghtsCloudDemo("run",requestId)=run.%ToJSON()
    TCommit
    Try {
        If leased {
            Set input={}
            Do input.%Set("requestId",requestId),input.%Set("caseId",caseId)
            If leaseId'="" Do input.%Set("leaseId",leaseId)
            Set begun=..LeaseCall("begin",input),expected=$Select(leaseId'="":"live",1:"replay")
            Set leaseReady=(begun.%Get("status")="OK") && (begun.%Get("mode")=expected) && ..ValidLease(begun.%Get("leaseId"))
            If leaseId'="",begun.%Get("leaseId")'=leaseId Set leaseReady=0
            If leaseReady {
                Set activeLease=begun.%Get("leaseId")
            } Else {
                Do run.%Set("state","ERROR"),run.%Set("error","MODEL_LEASE_UNAVAILABLE")
            }
        }
        If leaseReady {
            Set sc=##class(KnAIghts.Review.App).Submit(caseId,.response)
            If $$$ISERR(sc) {
                Do run.%Set("state","ERROR"),run.%Set("error","INTEROPERABILITY_ERROR")
            } Else {
                Set raw=response.ToJSON(),binding=..MessageBinding(caseId,response.%Id(),raw)
                If ($Get(^KnAIghtsReviewAudit(response.AuditId))=raw),(binding.%Get("status")="VERIFIED"),response.CodexPrincipal="" {
                    Set terminalProof=1
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
        }
    } Catch exception {
        Do run.%Set("state","ERROR"),run.%Set("error","NATIVE_RESPONSE_UNAVAILABLE")
    }
    If leased {
        // A timeout does not prove the queued worker stopped. Retain the durable barrier
        // across restart until a verified response and matching provider finish both exist.
        Set input={}
        Do input.%Set("requestId",requestId),input.%Set("leaseId",activeLease)
        Set finished={"status":"LEASE_UNAVAILABLE"}
        If terminalProof Set finished=..LeaseCall("end",input)
        If terminalProof,(finished.%Get("status")="OK") {
            If $Get(^KnAIghtsCloudDemo("leaseBarrier"))=requestId Kill ^KnAIghtsCloudDemo("leaseBarrier")
        } Else {
            If ..ValidLease(activeLease) Set ignored=..LeaseCall("quarantine",input)
            If terminalProof Do run.%Set("state","ERROR"),run.%Set("error","LEASE_RECOVERY_REQUIRED")
        }
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

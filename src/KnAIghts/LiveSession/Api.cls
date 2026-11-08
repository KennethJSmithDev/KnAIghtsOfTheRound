Include %occStatus

Class KnAIghts.LiveSession.Api Extends %CSP.REST
{
XData UrlMap [ XMLNamespace = "http://www.intersystems.com/urlmap" ]
{
<Routes>
  <Route Url="/v1/session" Method="GET" Call="ReadSnapshot"/>
  <Route Url="/v1/run" Method="POST" Call="RunSyntheticCase"/>
</Routes>
}

ClassMethod Allowed() As %Boolean [ Private ]
{
    Quit ($ZConvert($USERNAME,"L")="knaights_codex") && $SYSTEM.Security.Check("KnAIghtsSeatUse","U") && ('$SYSTEM.Security.Check("%Admin_Operate","U"))
}

ClassMethod ReadSnapshot() As %Status
{
    If '..Allowed() { Set %response.Status="403 Forbidden" Write "{""status"":""DENIED""}" Quit $$$OK }
    Set %response.ContentType="application/json"
    Write ##class(KnAIghts.LiveSession.State).Snapshot().%ToJSON()
    Quit $$$OK
}

ClassMethod RunSyntheticCase() As %Status
{
    Set %response.ContentType="application/json"
    If '..Allowed() { Set %response.Status="403 Forbidden" Write "{""status"":""DENIED""}" Quit $$$OK }
    If $ZConvert($Piece(%request.GetCgiEnv("CONTENT_TYPE"),";",1),"L")'="application/json" { Set %response.Status="415 Unsupported Media Type" Write "{""status"":""INVALID_CONTENT_TYPE""}" Quit $$$OK }
    Set valid=1, body=""
    Try {
        Set body=%request.Content.Read(1025)
        Set valid=($Length(body)<1025) && %request.Content.AtEnd
        Set input=##class(%DynamicObject).%FromJSON(body)
        Set valid=valid && (input.%Size()=2) && (input.%GetTypeOf("caseId")="string") && (input.%GetTypeOf("requestId")="string")
    } Catch exception {
        Set valid=0
    }
    If 'valid { Set %response.Status="400 Bad Request" Write "{""status"":""INVALID_REQUEST""}" Quit $$$OK }
    Set caseId=input.%Get("caseId"), requestId=input.%Get("requestId")
    If '..ValidCase(caseId) { Set %response.Status="400 Bad Request" Write "{""status"":""CASE_NOT_ALLOWED""}" Quit $$$OK }
    If ($Length(requestId)<1)!($Length(requestId)>64) { Set %response.Status="400 Bad Request" Write "{""status"":""INVALID_REQUEST_ID""}" Quit $$$OK }
    If $Translate(requestId,"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")'="" { Set %response.Status="400 Bad Request" Write "{""status"":""INVALID_REQUEST_ID""}" Quit $$$OK }
    Set result=##class(KnAIghts.LiveSession.State).Run(caseId,requestId)
    If result.%Get("status")'="OK" Set %response.Status="409 Conflict"
    Write result.%ToJSON()
    Quit $$$OK
}

ClassMethod ValidCase(caseId As %String) As %Boolean [ Private ]
{
    Quit (caseId="synthetic-a") || (caseId="synthetic-b")
}
}

Include %occStatus

Class KnAIghts.CloudDemo.Api Extends %CSP.REST
{
XData UrlMap [ XMLNamespace = "http://www.intersystems.com/urlmap" ]
{
<Routes>
  <Route Url="/api/health" Method="GET" Call="Health"/>
  <Route Url="/api/state" Method="GET" Call="ReadRun"/>
  <Route Url="/api/reviews" Method="POST" Call="Review"/>
</Routes>
}

ClassMethod Allowed() As %Boolean [ Private ]
{
    Quit ($ZConvert($USERNAME,"L")="knaights_codex") && $SYSTEM.Security.Check("KnAIghtsSeatUse","U") && ('$SYSTEM.Security.Check("%Admin_Operate","U"))
}

ClassMethod Answer(result As %DynamicObject) As %Status [ Private ]
{
    Set %response.ContentType="application/json"
    Do %response.SetHeader("Cache-Control","no-store")
    Set status=result.%Get("status")
    If status'="OK" {
        Set %response.Status=$Case(status,"DENIED":"403 Forbidden","NOT_FOUND":"404 Not Found","INVALID_REQUEST":"400 Bad Request","INVALID_CONTENT_TYPE":"415 Unsupported Media Type","CASE_NOT_ALLOWED":"400 Bad Request","INVALID_REQUEST_ID":"400 Bad Request","CORRELATION_MISMATCH":"409 Conflict","BUSY":"409 Conflict","RATE_LIMITED":"429 Too Many Requests","ALLOWANCE_EXHAUSTED":"429 Too Many Requests",:"503 Service Unavailable")
    }
    Write result.%ToJSON()
    Quit $$$OK
}

ClassMethod Health() As %Status
{
    If '..Allowed() Quit ..Answer({"status":"DENIED"})
    Set runtime=##class(KnAIghts.Review.App).Status()
    Set mode=##class(KnAIghts.CloudDemo.State).Mode()
    Set result={"status":"OK","production":"KnAIghts.Review.Production"}
    Do result.%Set("mode",mode)
    Do result.%Set("running",runtime.%Get("running"),"boolean")
    Do result.%Set("agent",##class(KnAIghts.CloudDemo.State).Profile())
    Do result.%Set("allowance",##class(KnAIghts.CloudDemo.State).Allowance())
    Do result.%Set("byokEnabled",##class(KnAIghts.CloudDemo.State).ByokEnabled(),"boolean")
    Do result.%Set("newReviewsBlocked",##class(KnAIghts.CloudDemo.State).NewReviewsBlocked(),"boolean")
    If ('runtime.%Get("running")) || ('runtime.%Get("liveEnabled")) || (mode="") Do result.%Set("status","PRODUCTION_UNAVAILABLE")
    Quit ..Answer(result)
}

ClassMethod ReadRun() As %Status
{
    If '..Allowed() Quit ..Answer({"status":"DENIED"})
    Quit ..Answer(##class(KnAIghts.CloudDemo.State).Read($Get(%request.Data("requestId",1))))
}

ClassMethod Review() As %Status
{
    If '..Allowed() Quit ..Answer({"status":"DENIED"})
    If $ZConvert($Piece(%request.GetCgiEnv("CONTENT_TYPE"),";",1),"L")'="application/json" {
        Quit ..Answer({"status":"INVALID_CONTENT_TYPE"})
    }
    Set valid=1
    Try {
        Set body=%request.Content.Read(1025)
        Set valid=($Length(body)<1025) && %request.Content.AtEnd
        Set input=##class(%DynamicObject).%FromJSON(body)
        Set valid=valid && (input.%GetTypeOf("caseId")="string") && (input.%GetTypeOf("requestId")="string")
        Set valid=valid && ((input.%Size()=2) || ((input.%Size()=3) && (input.%GetTypeOf("leaseId")="string")))
    } Catch exception {
        Set valid=0
    }
    If 'valid Quit ..Answer({"status":"INVALID_REQUEST"})
    Quit ..Answer(##class(KnAIghts.CloudDemo.State).Run(input.%Get("caseId"),input.%Get("requestId"),input.%Get("leaseId")))
}
}

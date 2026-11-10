Include %occStatus

Class KnAIghts.Context.OperatorApi Extends %CSP.REST
{
XData UrlMap [ XMLNamespace = "http://www.intersystems.com/urlmap" ]
{
<Routes>
  <Route Url="/v1/queue" Method="POST" Call="Queue"/>
  <Route Url="/v1/status" Method="POST" Call="Status"/>
  <Route Url="/v1/decision" Method="POST" Call="Decision"/>
</Routes>
}

ClassMethod Input(Output value As %DynamicObject, decision As %Boolean = 0) As %Boolean [ Private ]
{
    Set value="",valid=1
    If $ZConvert($Piece(%request.GetCgiEnv("CONTENT_TYPE"),";",1),"L")'="application/json" Quit 0
    Try {
        Set body=%request.Content.Read(1025),valid=($Length(body)<1025) && %request.Content.AtEnd
        Set value=##class(%DynamicObject).%FromJSON(body)
        Set valid=valid && (value.%Size()=$Select(decision:2,1:1)) && (value.%GetTypeOf("requestId")="string")
        If decision Set valid=valid && (value.%GetTypeOf("action")="string")
    } Catch exception {
        Set valid=0
    }
    Quit valid
}

ClassMethod Handle(kind As %String) As %Status [ Private ]
{
    Set %response.ContentType="application/json"
    If '##class(KnAIghts.Context.Live).Allowed() { Set %response.Status="403 Forbidden" Write "{""status"":""DENIED""}" Quit $$$OK }
    If '..Input(.input,kind="decision") { Set %response.Status="400 Bad Request" Write "{""status"":""INVALID_REQUEST""}" Quit $$$OK }
    Set requestId=input.%Get("requestId")
    If kind="queue" Set result=##class(KnAIghts.Context.Live).Queue(requestId)
    If kind="status" Set result=##class(KnAIghts.Context.Live).Status(requestId)
    If kind="decision" Set result=##class(KnAIghts.Context.Live).Decide(requestId,input.%Get("action"))
    Write result.%ToJSON()
    Quit $$$OK
}

ClassMethod Queue() As %Status
{
    Quit ..Handle("queue")
}

ClassMethod Status() As %Status
{
    Quit ..Handle("status")
}

ClassMethod Decision() As %Status
{
    Quit ..Handle("decision")
}
}

Include %occStatus

Class KnAIghts.Health.Api Extends %CSP.REST
{
Parameter CONTENTTYPE = "application/json";

XData UrlMap [ XMLNamespace = "http://www.intersystems.com/urlmap" ]
{
<Routes>
  <Route Url="/v1/sources" Method="GET" Call="Sources"/>
  <Route Url="/v1/state" Method="POST" Call="State"/>
  <Route Url="/v1/inspect" Method="POST" Call="Inspect"/>
</Routes>
}

ClassMethod Answer(value As %DynamicObject) As %Status
{
    Do %response.SetHeader("Cache-Control","no-store")
    Set %response.ContentType="application/json"
    If value.status="DENIED" Set %response.Status="403 Forbidden"
    If value.status="INVALID_REQUEST" Set %response.Status="400 Bad Request"
    If value.status="CONFLICT" Set %response.Status="409 Conflict"
    If value.status="UNAVAILABLE" Set %response.Status="503 Service Unavailable"
    Write value.%ToJSON()
    Quit $$$OK
}

ClassMethod Sources() As %Status
{
    Quit ..Answer(##class(KnAIghts.Health.Control).Sources())
}

ClassMethod Input(inspect As %Boolean) As %DynamicObject [ Private ]
{
    Try {
        If $ZConvert($Piece(%request.GetCgiEnv("CONTENT_TYPE"),";",1),"L")'="application/json" Throw ##class(%Exception.General).%New("JSON content required")
        If %request.Content.Size>1024 Throw ##class(%Exception.General).%New("Invalid request size")
        Set value=##class(%DynamicObject).%FromJSON(%request.Content.Read())
        If value.%Size()'=$Select(inspect:2,1:1) Throw ##class(%Exception.General).%New("Invalid request keys")
        If value.%GetTypeOf("sourceId")'="string" Throw ##class(%Exception.General).%New("Invalid source ID")
        If inspect,value.%GetTypeOf("requestId")'="string" Throw ##class(%Exception.General).%New("Invalid request identity")
        Do value.%Set("valid",1,"boolean")
    } Catch ex { Set value={"valid":false} }
    Quit value
}

ClassMethod State() As %Status
{
    Set value=..Input(0)
    If 'value.valid Quit ..Answer({"status":"INVALID_REQUEST"})
    Quit ..Answer(##class(KnAIghts.Health.Control).State(value.sourceId))
}

ClassMethod Inspect() As %Status
{
    Set value=..Input(1)
    If 'value.valid Quit ..Answer({"status":"INVALID_REQUEST"})
    Quit ..Answer(##class(KnAIghts.Health.Control).Inspect(value.sourceId,value.requestId))
}
}

Include %occStatus
Class KnAIghts.Seats.Api Extends %CSP.REST
{
XData UrlMap [ XMLNamespace = "http://www.intersystems.com/urlmap" ]
{
<Routes><Route Url="/v1/identity" Method="GET" Call="Identity"/><Route Url="/v1/rpc" Method="POST" Call="Rpc"/></Routes>
}
ClassMethod Identity() As %Status
{
    Set %response.ContentType="application/json"
    Write ##class(KnAIghts.Seats.Registry).Call("identity",{}).%ToJSON()
    Quit $$$OK
}
ClassMethod Rpc() As %Status
{
    Set %response.ContentType="application/json",result={"status":"INVALID_REQUEST"}
    Try {
        Set raw=%request.Content.Read(16001)
        If ($Length(raw)>16000)!('%request.Content.AtEnd) Throw ##class(%Exception.StatusException).CreateFromStatus($$$ERROR($$$GeneralError,"Input too large"))
        Set input=##class(%DynamicObject).%FromJSON(raw),op=input.op,args=input.args
        If op="finish" {
            If ('$SYSTEM.Security.Check("KnAIghtsSeatUse","U"))!('$SYSTEM.Security.Check("KnAIghtsSeatPropose","U")) { Set result={"status":"DENIED"} }
            Else {
                Set request=##class(KnAIghts.Seats.Request).%New(),request.Owner=$ZConvert($USERNAME,"L"),request.JobId=+args.jobId,request.Lease=args.lease,request.Authorization=args.nonce
                Set request.Proposal=args.proposal,request.ResponseId=args.responseId,request.UsageJson=args.usage.%ToJSON()
                Set sc=##class(Ens.Director).CreateBusinessService("SeatEntry",.service)
                If $SYSTEM.Status.IsError(sc) Throw ##class(%Exception.StatusException).CreateFromStatus(sc)
                Set sc=service.ProcessInput(request,.response)
                If $SYSTEM.Status.IsError(sc) Throw ##class(%Exception.StatusException).CreateFromStatus(sc)
                Set result=##class(%DynamicObject).%FromJSON(response.Json)
            }
        } Else { Set result=##class(KnAIghts.Seats.Registry).Call(op,args) }
    } Catch exception { Set result={"status":"INVALID_REQUEST"} }
    Write result.%ToJSON()
    Quit $$$OK
}
}

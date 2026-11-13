Include %occStatus

Class KnAIghts.Health.Control
{
ClassMethod Allows(sourceId As %String) As %Boolean
{
    If '$SYSTEM.Security.Check("KnAIghtsHealthUse","U") Quit 0
    Quit (sourceId?1.64(1AN,1"-",1"_",1".")) && (+$Get(^KnAIghtsHealthAccess($USERNAME,sourceId))=1)
}

/// The catalog is an operator-configured identity view; endpoints and credentials stay private.
ClassMethod Sources() As %DynamicObject
{
    If '$SYSTEM.Security.Check("KnAIghtsHealthUse","U") Quit {"status":"DENIED"}
    Try {
        Set sc=##class(KnAIghts.Health.App).Catalog(.all)
        If $SYSTEM.Status.IsError(sc) Throw ##class(%Exception.StatusException).CreateFromStatus(sc)
        Set items=[]
        For i=0:1:all.%Size()-1 { Set item=all.%Get(i) If ..Allows(item.sourceId) Do items.%Push(item) }
        Set result={"apiVersion":1,"status":"OK","scope":"synthetic","authority":"inspection only"}
        Do result.%Set("actor",$USERNAME),result.%Set("sources",items)
    } Catch ex { Set result={"status":"UNAVAILABLE"} }
    Quit result
}

ClassMethod State(sourceId As %String) As %DynamicObject
{
    If '..Allows(sourceId) Quit {"status":"DENIED"}
    Set result={"apiVersion":1,"status":"NO_INSPECTION","scope":"synthetic"}
    Do result.%Set("sourceId",sourceId),result.%Set("actor",$USERNAME)
    Set requestId=$Get(^KnAIghtsHealthLatest($USERNAME,sourceId))
    If requestId'="" Quit ..RequestState(sourceId,requestId)
    Quit result
}

ClassMethod RequestState(sourceId As %String, requestId As %String) As %DynamicObject [ Private ]
{
    Try {
        Set result=##class(%DynamicObject).%FromJSON(^KnAIghtsHealthRequest($USERNAME,requestId))
        If result.sourceId'=sourceId {
            Set result={"status":"CONFLICT"}
        } ElseIf result.status="COMPLETE" {
            Set receipt=##class(%DynamicObject).%FromJSON(^KnAIghtsHealthReceipt(result.recordId))
            If (receipt.sourceId'=sourceId)!(receipt.actor'=$USERNAME) {
                Set result={"status":"UNAVAILABLE"}
            } Else { Do result.%Set("receipt",receipt) }
        }
    } Catch ex { Set result={"status":"UNAVAILABLE"} }
    Quit result
}

/// Retried request identities return persisted state. A pending/uncertain attempt is never replayed automatically.
ClassMethod Inspect(sourceId As %String, requestId As %String) As %DynamicObject
{
    If '..Allows(sourceId) Quit {"status":"DENIED"}
    If requestId'?1.64(1AN,1"-",1"_") Quit {"status":"INVALID_REQUEST"}
    Set actor=$USERNAME
    Set pending={"apiVersion":1,"status":"PENDING","scope":"synthetic"}
    Do pending.%Set("sourceId",sourceId),pending.%Set("requestId",requestId),pending.%Set("actor",actor)
    Lock +^KnAIghtsHealthRequest(actor,requestId):1
    If '$Test Quit pending
    Try {
        If $Data(^KnAIghtsHealthRequest(actor,requestId)) {
            Set result=..RequestState(sourceId,requestId)
        } Else {
            Set result={"apiVersion":1,"status":"PENDING","scope":"synthetic"}
            Do result.%Set("sourceId",sourceId),result.%Set("requestId",requestId),result.%Set("actor",actor)
            Set ^KnAIghtsHealthRequest(actor,requestId)=result.%ToJSON(),^KnAIghtsHealthLatest(actor,sourceId)=requestId
            Set sc=##class(KnAIghts.Health.App).Inspect(sourceId,.response)
            If $SYSTEM.Status.IsError(sc) {
                Do result.%Set("status","UNAVAILABLE")
            } Else {
                Do result.%Set("status","COMPLETE"),result.%Set("recordId",response.RecordId)
            }
            Set ^KnAIghtsHealthRequest(actor,requestId)=result.%ToJSON()
            Set result=..RequestState(sourceId,requestId)
        }
    } Catch ex { Set result={"status":"UNAVAILABLE"} }
    Lock -^KnAIghtsHealthRequest(actor,requestId)
    Quit result
}
}

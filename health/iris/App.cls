Include %occStatus

Class KnAIghts.Health.App
{
ClassMethod Start(production As %String = "KnAIghts.Health.Production") As %Status
{
    If '$SYSTEM.Security.Check("KnAIghtsHealthUse","U") Quit $$$ERROR($$$GeneralError,"Health inspection resource required")
    If (production'="KnAIghts.Health.Production")&&(production'="KnAIghts.Health.TransportProduction") Quit $$$ERROR($$$GeneralError,"Health production not admitted")
    Set sc=##class(Ens.Director).GetProductionStatus(.name,.state)
    If $$$ISERR(sc) Quit sc
    If $Get(name)=production,+$Get(state)=1 Quit $$$OK
    If $Get(name)'="" Quit $$$ERROR($$$GeneralError,"A production is already in use")
    Quit ##class(Ens.Director).StartProduction(production)
}

ClassMethod Inspect(sourceId As %String, Output response As KnAIghts.Health.Response) As %Status
{
    If '$SYSTEM.Security.Check("KnAIghtsHealthUse","U") Quit $$$ERROR($$$GeneralError,"Health inspection resource required")
    If $Length(sourceId)>64 Quit $$$ERROR($$$GeneralError,"Source ID too long")
    Set request=##class(KnAIghts.Health.Request).%New(),request.SourceId=sourceId
    Set sc=##class(Ens.Director).CreateBusinessService("HealthEntry",.service)
    If $$$ISERR(sc) Quit sc
    Quit service.ProcessInput(request,.response)
}

ClassMethod Catalog(Output sources As %DynamicArray) As %Status
{
    If '$SYSTEM.Security.Check("KnAIghtsHealthUse","U") Quit $$$ERROR($$$GeneralError,"Health inspection resource required")
    Set request=##class(KnAIghts.Health.Request).%New(),request.Action="catalog"
    Set sc=##class(Ens.Director).CreateBusinessService("HealthEntry",.service)
    If $$$ISERR(sc) Quit sc
    Set sc=service.ProcessInput(request,.response)
    If $$$ISERR(sc) Quit sc
    Set sources=##class(%DynamicArray).%FromJSON(response.ReceiptJson)
    Quit $$$OK
}
}

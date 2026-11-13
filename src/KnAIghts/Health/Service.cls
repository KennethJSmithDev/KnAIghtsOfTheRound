Include %occStatus

Class KnAIghts.Health.Service Extends Ens.BusinessService
{
Method OnProcessInput(input As %RegisteredObject, Output response As %RegisteredObject) As %Status
{
    If '$SYSTEM.Security.Check("KnAIghtsHealthUse","U") Quit $$$ERROR($$$GeneralError,"Health inspection resource required")
    If '$IsObject(input) Quit $$$ERROR($$$GeneralError,"Expected health request")
    If 'input.%IsA("KnAIghts.Health.Request") Quit $$$ERROR($$$GeneralError,"Expected health request")
    If (input.Action'="inspect")&&(input.Action'="catalog") Quit $$$ERROR($$$GeneralError,"Unknown health action")
    Set request=##class(KnAIghts.Health.Request).%New(),request.SourceId=input.SourceId,request.Actor=$USERNAME
    Set request.Action=input.Action
    Quit ..SendRequestSync("InspectHealthSource",request,.response,90)
}
}

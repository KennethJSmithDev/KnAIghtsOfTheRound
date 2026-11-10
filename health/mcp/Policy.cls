Include %occStatus

Class KnAIghts.Health.Policy Extends (%AI.Policy.Authorization, %XML.Adaptor)
{
Parameter XMLNAME = "Authorization";

Method %CanExecute(toolref As %String, call As %DynamicObject, metadata As %DynamicObject) As %Status
{
    If call.name="ListHealthSources",$SYSTEM.Security.Check("KnAIghtsHealthUse","U") Quit $$$OK
    If (call.name="ReadHealthSourceState")!(call.name="InspectHealthSource") {
        If ##class(KnAIghts.Health.Control).Allows(call.arguments.%Get("sourceId","")) Quit $$$OK
    }
    Quit $$$ERROR($$$GeneralError,"Health tool or configured source denied")
}
}

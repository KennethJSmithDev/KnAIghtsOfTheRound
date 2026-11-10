Include %occStatus

Class KnAIghts.Integration.Policy Extends KnAIghts.Review.CodexPolicy
{
Method %CanExecute(toolref As %String, call As %DynamicObject, metadata As %DynamicObject) As %Status
{
    Set name=call.%Get("name")
    If (name="ReadSyntheticAudit")!(name="FindRelatedSyntheticCases") {
        If ..Allows(call.arguments.%Get("caseId","")) Quit $$$OK
        Quit $$$ERROR($$$GeneralError,"Synthetic case denied")
    }
    Quit ##super(toolref,call,metadata)
}
}

Include %occStatus

Class KnAIghts.Bonus.Setup
{
/// Workflow action definitions are namespace-wide. Create only these two names;
/// never replace an existing definition or clear the other Workflow actions.
ClassMethod EnsureActions() As %Status
{
    If ($USERNAME="") || '$SYSTEM.Security.Check("%Admin_Operate", "U") Quit $$$ERROR($$$GeneralError, "Operator authorization required")
    Set sc = ..EnsureAction("KnAIghtsReviewed", "Reviewed")
    If $$$ISERR(sc) Quit sc
    Quit ..EnsureAction("KnAIghtsDeclined", "Declined")
}

ClassMethod EnsureAction(name As %String, caption As %String) As %Status [ Private ]
{
    Set action = ##class(EnsLib.Workflow.ActionDefinition).IDOpen(name)
    If $IsObject(action) {
        If action.Caption'=caption Quit $$$ERROR($$$GeneralError, "Existing Workflow action conflicts with KnAIghts")
        Quit $$$OK
    }
    Set action = ##class(EnsLib.Workflow.ActionDefinition).%New()
    Set action.Name = name, action.Caption = caption
    Quit action.%Save()
}
}

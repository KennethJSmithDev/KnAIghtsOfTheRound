Include %occStatus

Class KnAIghts.Review.CodexPolicy Extends (%AI.Policy.Authorization, %XML.Adaptor)
{
Parameter XMLNAME = "Authorization";

ClassMethod SyntheticCase(caseId As %String) As %Boolean
{
    Quit (caseId="synthetic-a") || (caseId="synthetic-b")
}

/// The provisioned MCP seat may act only as its authenticated IRIS principal on the
/// synthetic cases. Keep the discovery authorization and tool methods aligned with this check.
/// The Build 154 Codex seat witness covers wrong credentials and H000 denial. See
/// docs/INTEROPERABILITY.md#qualification-evidence. Repeat both denials if the endpoint or roles change.
ClassMethod Allows(caseId As %String) As %Boolean
{
    Quit ($ZCONVERT($USERNAME,"L")="knaights_codex") && ..SyntheticCase(caseId)
}

Method %CanExecute(toolref As %String, call As %DynamicObject, metadata As %DynamicObject) As %Status
{
    Set name = call.%Get("name")
    If (name="ReadSyntheticEvidence") || (name="SubmitSyntheticDecision") {
        If ..Allows(call.arguments.%Get("caseId","")) Quit $$$OK
    }
    Quit $$$ERROR($$$GeneralError, "Codex tool or case denied")
}
}

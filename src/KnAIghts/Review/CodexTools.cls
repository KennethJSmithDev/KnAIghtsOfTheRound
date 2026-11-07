Class KnAIghts.Review.CodexTools Extends %AI.ToolSet
{
XData Definition [ MimeType = application/xml ]
{
<ToolSet Name="KnAIghtsCodexSeat">
  <Policies><Authorization Class="KnAIghts.Review.CodexPolicy"/></Policies>
  <Tool Name="ReadSyntheticEvidence" Method="ReadSyntheticEvidence"/>
  <Tool Name="SubmitSyntheticDecision" Method="SubmitSyntheticDecision"/>
</ToolSet>
}

/// Read the source facts for one assigned synthetic case before making a decision.
ClassMethod ReadSyntheticEvidence(caseId As %String) As %DynamicObject
{
    If '..Allowed(caseId) Quit {"status":"DENIED"}
    Set packet = ##class(KnAIghts.Review.Cases).Resolve(caseId)
    Quit packet.%Get("facts")
}

/// Submit one proposed action and exact citations as JSON with keys action and citations.
/// Use SHOW_VERIFIED for a matching source and REQUEST_REVIEW when the sources disagree.
ClassMethod SubmitSyntheticDecision(caseId As %String, proposal As %String) As %DynamicObject
{
    If '..Allowed(caseId) Quit {"status":"DENIED"}
    Set sc = ##class(KnAIghts.Review.App).SubmitCodex(caseId, proposal, .response)
    If $SYSTEM.Status.IsError(sc) Quit {"status":"SERVICE_ERROR"}
    Quit ##class(%DynamicObject).%FromJSON(response.ToJSON())
}

ClassMethod Allowed(caseId As %String) As %Boolean [ Private ]
{
    Quit ##class(KnAIghts.Review.CodexPolicy).Allows(caseId)
}
}

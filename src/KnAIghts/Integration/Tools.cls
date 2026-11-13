Class KnAIghts.Integration.Tools Extends KnAIghts.Review.CodexTools
{
XData Definition [ MimeType = application/xml ]
{
<ToolSet Name="KnAIghtsIntegrationSeat">
  <Policies><Authorization Class="KnAIghts.Integration.Policy"/></Policies>
  <Tool Name="ReadSyntheticEvidence" Method="ReadSyntheticEvidence"/>
  <Tool Name="SubmitSyntheticDecision" Method="SubmitSyntheticDecision"/>
  <Tool Name="ReadSyntheticAudit" Method="ReadSyntheticAudit"/>
  <Tool Name="FindRelatedSyntheticCases" Method="FindRelatedSyntheticCases"/>
</ToolSet>
}

/// Read one revalidated synthetic audit. The supplied case must match its stored identity.
ClassMethod ReadSyntheticAudit(caseId As %String, auditId As %Integer) As %DynamicObject
{
    If '##class(KnAIghts.Review.CodexPolicy).Allows(caseId) Quit {"status":"DENIED"}
    Set sc=##class(KnAIghts.Context.Audit).Capture(auditId,.raw,.facts,.storedCase,.disposition,.vector)
    If $SYSTEM.Status.IsError(sc) Quit {"status":"AUDIT_UNAVAILABLE"}
    If storedCase'=caseId Quit {"status":"DENIED"}
    Set result={"status":"OK","scope":"synthetic"}
    Do result.%Set("audit",##class(%DynamicObject).%FromJSON(raw))
    Quit result
}

/// Read advisory six-feature context without indexing, queueing, reviewing or approving work.
ClassMethod FindRelatedSyntheticCases(caseId As %String, auditId As %Integer) As %DynamicObject
{
    Set result=..ReadSyntheticAudit(caseId,auditId)
    If result.%Get("status")'="OK" Quit result
    Set sc=##class(KnAIghts.Context.Vector).FindRelated(auditId,.match)
    If $SYSTEM.Status.IsError(sc) Quit {"status":"CONTEXT_UNAVAILABLE"}
    Set result={"status":"OK","advisory":true,"features":"six hand-defined synthetic features"}
    Do result.%Set("related",match)
    Quit result
}
}

Include %occStatus

Class KnAIghts.Context.Operation Extends Ens.BusinessOperation
{
Parameter INVOCATION = "Queue";

/// The Java PEX response formats related-case context. IRIS rechecks the echoed
/// identifiers against its own vector hit; neither that text nor the score is a
/// source disposition, selection, operator approval, or execution authority.
Method Find(request As KnAIghts.Context.Request, Output response As KnAIghts.Context.Response) As %Status
{
    Set response=##class(KnAIghts.Context.Response).%New(),response.Found=0
    Set sc=##class(KnAIghts.Context.Vector).FindRelated(request.AuditId,.match)
    If $$$ISERR(sc) Quit sc
    If 'match.%Get("found") {
        Set response.Summary="No related indexed synthetic audit. Context only; not an approval."
        Quit $$$OK
    }
    Set payload=##class(EnsLib.PEX.Message).%New(),payload.%classname="knaights.pex.RelatedCase"
    Set payload.%jsonObject={}
    Do payload.%jsonObject.%Set("caseId",match.%Get("caseId"))
    Do payload.%jsonObject.%Set("auditId",match.%Get("auditId")_"")
    Do payload.%jsonObject.%Set("disposition",match.%Get("disposition"))
    Do payload.%jsonObject.%Set("similarity",match.%Get("similarity")_"")
    Set reply="",sc=..SendRequestSync("KnAIghtsPex",payload,.reply,20)
    If $$$ISERR(sc) Quit sc
    If '$IsObject(reply) Quit $$$ERROR($$$GeneralError, "PEX returned no context")
    If reply.%classname'="knaights.pex.RelatedCase" Quit $$$ERROR($$$GeneralError, "Unexpected PEX response")
    Set result=reply.%jsonObject
    If '$IsObject(result) Quit $$$ERROR($$$GeneralError, "Invalid PEX response")
    If result.%Get("formatVersion")'="knaights-related-case-v1" Quit $$$ERROR($$$GeneralError, "Unexpected PEX format")
    If (result.%Get("auditId")'=(match.%Get("auditId")_""))!(result.%Get("caseId")'=match.%Get("caseId")) Quit $$$ERROR($$$GeneralError, "PEX context identity mismatch")
    If (result.%Get("disposition")'=match.%Get("disposition"))!(result.%Get("similarity")'=(match.%Get("similarity")_"")) Quit $$$ERROR($$$GeneralError, "PEX context facts mismatch")
    If ($Length(result.%Get("summary"))<1)!($Length(result.%Get("summary"))>400) Quit $$$ERROR($$$GeneralError, "Invalid PEX summary")
    Set response.Found=1,response.RelatedAuditId=match.%Get("auditId"),response.RelatedCaseId=match.%Get("caseId")
    Set response.Similarity=match.%Get("similarity")_"",response.Summary=result.%Get("summary")
    Quit $$$OK
}

XData MessageMap
{
<MapItems>
  <MapItem MessageType="KnAIghts.Context.Request"><Method>Find</Method></MapItem>
</MapItems>
}
}

Include %occStatus

Class KnAIghts.Context.Audit
{
/// Only the two server-owned synthetic evidence patterns enter this index. Each
/// row binds the exact audit and facts; similarity never validates a source or
/// authorizes a task. Recheck those bindings if the review response schema changes.
ClassMethod Capture(id As %Integer, Output raw As %String, Output factsJson As %String, Output caseId As %String, Output disposition As %String, Output vector As %String) As %Status
{
    Set raw="", factsJson="", caseId="", disposition="", vector=""
    If (id<1)!(id>2147483646) Quit $$$ERROR($$$GeneralError, "Invalid synthetic audit")
    Set raw=$Get(^KnAIghtsReviewAudit(id))
    If raw="" Quit $$$ERROR($$$GeneralError, "Synthetic audit unavailable")
    Set valid=0
    Try {
        Set audit=##class(%DynamicObject).%FromJSON(raw), caseId=audit.%Get("caseId")
        If (caseId="synthetic-a")!(caseId="synthetic-b") {
            Set packet=##class(KnAIghts.Review.Cases).Resolve(caseId), facts=packet.%Get("facts")
            Set refs=facts.%Get("evidenceRefs"), disposition=audit.%Get("status")
            Set valid=(audit.%Get("auditId")=id) && (facts.%Get("kind")="synthetic")
            Set valid=valid && (audit.%Get("citations").%ToJSON()=refs.%ToJSON())
            Set valid=valid && (audit.%Get("limitation")=packet.%Get("limitation"))
            If caseId="synthetic-a" {
                Set valid=valid && (facts.%Get("ctStudy")=facts.%Get("segStudy")) && packet.%Get("selectionAllowed")
                Set valid=valid && (disposition="ACCEPTED") && (audit.%Get("action")="SHOW_VERIFIED")
                Set valid=valid && (audit.%Get("semanticId")=facts.%Get("selectionId"))
                Set vector="1,0,1,0,1,1"
            } Else {
                Set valid=valid && (facts.%Get("ctStudy")'=facts.%Get("segStudy")) && ('packet.%Get("selectionAllowed"))
                Set valid=valid && (disposition="REVIEW_REQUESTED") && (audit.%Get("action")="REQUEST_REVIEW")
                Set valid=valid && (audit.%Get("semanticId")="")
                Set vector="0,1,0,1,1,1"
            }
            If valid Set factsJson=facts.%ToJSON()
        }
    } Catch exception {
        Set valid=0
    }
    If 'valid Quit $$$ERROR($$$GeneralError, "Audit is not a supported source-bound synthetic result")
    Quit $$$OK
}
}

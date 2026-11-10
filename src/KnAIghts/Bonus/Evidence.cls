Include %occStatus

Class KnAIghts.Bonus.Evidence
{
/// The worklist accepts only a server-owned synthetic mismatch audit. Preserve both
/// the audit and its source facts so they can be checked again after a human responds.
/// The workflow response does not approve or execute KnAIghts.Review.SyntheticTask.
ClassMethod Capture(auditId As %Integer, Output raw As %String, Output factsJson As %String) As %Status
{
    Set raw = "", factsJson = ""
    If (auditId<1)!(auditId>2147483646) Quit $$$ERROR($$$GeneralError, "Invalid synthetic audit")
    Set raw = $Get(^KnAIghtsReviewAudit(auditId))
    If raw="" Quit $$$ERROR($$$GeneralError, "Synthetic audit unavailable")
    Set valid = 0
    Try {
        Set audit = ##class(%DynamicObject).%FromJSON(raw)
        Set packet = ##class(KnAIghts.Review.Cases).Resolve("synthetic-b")
        Set facts = packet.%Get("facts"), refs = facts.%Get("evidenceRefs")
        Set valid = (audit.%Get("caseId")="synthetic-b") && (audit.%Get("status")="REVIEW_REQUESTED")
        Set valid = valid && (audit.%Get("action")="REQUEST_REVIEW") && (audit.%Get("semanticId")="")
        Set valid = valid && (audit.%Get("auditId")=auditId) && (audit.%Get("citations").%ToJSON()=refs.%ToJSON())
        Set valid = valid && (audit.%Get("limitation")=packet.%Get("limitation")) && (facts.%Get("kind")="synthetic")
        If valid Set factsJson = facts.%ToJSON()
    } Catch exception {
        Set valid = 0
    }
    If 'valid Quit $$$ERROR($$$GeneralError, "Audit is not a valid synthetic mismatch")
    Quit $$$OK
}
}

Include %occStatus

Class KnAIghts.Bonus.NoticeOperation Extends Ens.BusinessOperation
{
Parameter ADAPTER = "KnAIghts.Bonus.NoticeAdapter";
Parameter INVOCATION = "Queue";

Method WriteNotice(request As KnAIghts.Bonus.NoticeRequest, Output response As Ens.Response) As %Status
{
    Set response = ##class(Ens.Response).%New()
    Set sc = ##class(KnAIghts.Bonus.Evidence).Capture(request.AuditId, .raw, .facts)
    If $$$ISERR(sc) Quit sc
    If (raw'=request.AuditJson)!(facts'=request.FactsJson) Quit $$$ERROR($$$GeneralError, "Synthetic evidence changed during review")
    If (request.TaskId<1) || ((request.ReviewAction'="KnAIghtsReviewed") && (request.ReviewAction'="KnAIghtsDeclined")) Quit $$$ERROR($$$GeneralError, "Invalid workflow result")
    Set task = ##class(EnsLib.Workflow.TaskResponse).%OpenId(request.TaskId)
    If '$IsObject(task) Quit $$$ERROR($$$GeneralError, "Workflow task unavailable")
    // A typed message alone is not evidence of a completed Workflow task. Bind the
    // notice to the persisted task, role, subject, choice and handling user.
    If 'task.%TaskStatus.IsComplete Quit $$$ERROR($$$GeneralError, "Workflow task incomplete")
    If task.%RoleName'="KnAIghtsReviewers" Quit $$$ERROR($$$GeneralError, "Unexpected workflow role")
    If task.%TaskStatus.Source'="KnAIghtsReviewFlow" Quit $$$ERROR($$$GeneralError, "Unexpected workflow source")
    If task.%Subject'=("Synthetic mismatch audit "_request.AuditId) Quit $$$ERROR($$$GeneralError, "Unexpected workflow subject")
    If (task.%Action'=request.ReviewAction)!(task.%UserName'=request.Reviewer)!(request.Reviewer="") Quit $$$ERROR($$$GeneralError, "Workflow response does not match")
    // Embedded Python hashes the revalidated synthetic evidence, not caller input.
    // The digest is an integrity aid and does not authorize any task effect.
    Set sc = $$$OK
    Try {
        Set request.EvidenceHash = ##class(KnAIghts.Bonus.Fingerprint).Evidence(raw, facts)
    } Catch exception {
        Set sc = exception.AsStatus()
    }
    If $$$ISERR(sc) Quit sc
    If $Length(request.EvidenceHash)'=64 Quit $$$ERROR($$$GeneralError, "Evidence fingerprint failed")
    Quit ..Adapter.WriteNotice(request)
}

XData MessageMap
{
<MapItems>
  <MapItem MessageType="KnAIghts.Bonus.NoticeRequest"><Method>WriteNotice</Method></MapItem>
</MapItems>
}
}

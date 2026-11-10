Include %occStatus

Class KnAIghts.Bonus.Entry Extends Ens.BusinessService
{
/// This is an internal operator entry, not an HTTP or MCP endpoint. The caller cannot
/// supply its own evidence snapshot or reviewer identity. Recheck principal and stale
/// evidence handling before exposing this entry through any other transport.
Method OnProcessInput(input As %RegisteredObject, Output response As %RegisteredObject) As %Status
{
    If ($USERNAME="") || '$SYSTEM.Security.Check("%Admin_Operate", "U") Quit $$$ERROR($$$GeneralError, "Operator authorization required")
    If '$IsObject(input) Quit $$$ERROR($$$GeneralError, "Expected synthetic review request")
    If 'input.%IsA("KnAIghts.Bonus.ReviewRequest") Quit $$$ERROR($$$GeneralError, "Expected synthetic review request")
    Set sc = ##class(KnAIghts.Bonus.Evidence).Capture(input.AuditId, .raw, .facts)
    If $$$ISERR(sc) Quit sc
    Set request = ##class(KnAIghts.Bonus.ReviewRequest).%New()
    Set request.AuditId = input.AuditId, request.AuditJson = raw, request.FactsJson = facts
    Set response = ##class(Ens.Response).%New()
    Quit ..SendRequestAsync("KnAIghtsReviewFlow", request)
}
}

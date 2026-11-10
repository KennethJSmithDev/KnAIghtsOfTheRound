Include %occStatus

Class KnAIghts.Context.LiveEntry Extends Ens.BusinessService
{
/// A dedicated local operator resource authorizes only the synthetic Workflow
/// entry. The restricted live viewer identity never acquires operator authority.
Method OnProcessInput(input As %RegisteredObject, Output response As %RegisteredObject) As %Status
{
    If ($ZConvert($USERNAME,"L")'="knaights_operator") || '$SYSTEM.Security.Check("KnAIghtsWorkflowUse","U") Quit $$$ERROR($$$GeneralError,"Live workflow operator required")
    If '$IsObject(input) Quit $$$ERROR($$$GeneralError,"Expected synthetic review request")
    If 'input.%IsA("KnAIghts.Bonus.ReviewRequest") Quit $$$ERROR($$$GeneralError,"Expected synthetic review request")
    Set sc=##class(KnAIghts.Bonus.Evidence).Capture(input.AuditId,.raw,.facts)
    If $$$ISERR(sc) Quit sc
    Set request=##class(KnAIghts.Bonus.ReviewRequest).%New()
    Set request.AuditId=input.AuditId,request.AuditJson=raw,request.FactsJson=facts
    Set response=##class(Ens.Response).%New()
    Quit ..SendRequestAsync("KnAIghtsReviewFlow",request)
}
}

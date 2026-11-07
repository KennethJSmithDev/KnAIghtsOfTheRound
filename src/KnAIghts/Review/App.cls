Include %occStatus

Class KnAIghts.Review.App
{
/// The bootstrap owns one Interoperability production in its namespace. It accepts the
/// already-running KnAIghts production and preserves any other active production. See the
/// Build 154 bootstrap evidence in docs/INTEROPERABILITY.md#qualification-evidence.
/// Check clean startup, restart and coexistence before changing this guard.
ClassMethod Start() As %Status
{
    Set sc = ##class(Ens.Director).GetProductionStatus(.name, .state)
    If $$$ISERR(sc) Quit sc
    If $Get(name)="KnAIghts.Review.Production",+$Get(state)=1 Quit $$$OK
    If $Get(name)'="" Quit $$$ERROR($$$GeneralError, "The namespace already has a production in use")
    Quit ##class(Ens.Director).StartProduction("KnAIghts.Review.Production")
}

ClassMethod Status() As %DynamicObject
{
    Set result = {}
    Set sc = ##class(Ens.Director).GetProductionStatus(.name, .state)
    Set running = 0
    If $SYSTEM.Status.IsOK(sc),$Get(name)="KnAIghts.Review.Production",+$Get(state)=1 Set running = 1
    Do result.%Set("running", running, "boolean")
    Do result.%Set("version", $ZVERSION)
    Do result.%Set("liveEnabled", $SYSTEM.Util.GetEnviron("KNAIGHTS_LIVE")="1", "boolean")
    Quit result
}

/// Caller needs access to the app's production. The service resolves case
/// authority server-side and returns one typed disposition.
ClassMethod Submit(caseId As %String, Output response As KnAIghts.Review.Response) As %Status
{
    If $Length(caseId)>48 Quit $$$ERROR($$$GeneralError, "Invalid case identifier")
    Set request = ##class(KnAIghts.Review.Request).%New()
    Set request.CaseId = caseId
    Quit ..Dispatch(request, .response)
}

ClassMethod SubmitCodex(caseId As %String, proposal As %String, Output response As KnAIghts.Review.Response) As %Status
{
    If '##class(KnAIghts.Review.CodexPolicy).Allows(caseId) Quit $$$ERROR($$$GeneralError, "Codex case denied")
    If $Length(proposal)>4096 Quit $$$ERROR($$$GeneralError, "Proposal exceeds size limit")
    Set request = ##class(KnAIghts.Review.Request).%New()
    Set request.CaseId = caseId, request.CodexPrincipal = $USERNAME, request.CodexProposal = proposal
    Quit ..Dispatch(request, .response)
}

/// Both ingress methods use the adapterless service created by Ens.Director so the typed
/// message follows the production route and its audit. See the Build 154 Codex seat witness
/// in docs/INTEROPERABILITY.md#qualification-evidence. Recheck message headers and response
/// identity if changing the service entry or dispatch method.
ClassMethod Dispatch(request As KnAIghts.Review.Request, Output response As KnAIghts.Review.Response) As %Status [ Private ]
{
    Set sc = ##class(Ens.Director).CreateBusinessService("KnAIghtsEntry", .entry)
    If $$$ISERR(sc) Quit sc
    Quit entry.ProcessInput(request, .response, .hint)
}
}

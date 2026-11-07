Include %occStatus

Class KnAIghts.Review.Operation Extends Ens.BusinessOperation
{
Parameter INVOCATION = "Queue";

Method Assess(request As KnAIghts.Review.Request, Output response As KnAIghts.Review.Response) As %Status
{
    Set response = ##class(KnAIghts.Review.Response).%New()
    Set response.CaseId = request.CaseId, response.Citations = "[]"
    Set response.Limitation = "Research and educational evidence review."
    Set sc = ..Decide(request, .response)
    If $$$ISERR(sc) Quit sc

    // The production records the validated disposition before returning its audit ID.
    // This is the local audit record for one attempt. See docs/INTEROPERABILITY.md#qualification-evidence.
    // Revalidate response-to-row equality and failure handling if persistence or retry behavior changes.
    Set response.AuditId = $Increment(^KnAIghtsReviewAudit)
    Set ^KnAIghtsReviewAudit(response.AuditId) = response.ToJSON()
    Quit $$$OK
}

Method Decide(request As KnAIghts.Review.Request, Output response As KnAIghts.Review.Response) As %Status [ Private ]
{
    // The queued worker runs outside the authenticated MCP request. SubmitCodex checks
    // the actual principal before stamping the request. The worker checks the synthetic
    // case again and assumes trusted message construction. See the Codex seat witness.
    // Test direct ingress and principal spoofing before exposing another message route.
    Set caseId = request.CaseId, principal = request.CodexPrincipal
    If principal'="" {
        If ($ZCONVERT(principal,"L")'="knaights_codex") || ('##class(KnAIghts.Review.CodexPolicy).SyntheticCase(caseId)) {
            Set response.Status = "CASE_NOT_ALLOWED"
            Quit $$$OK
        }
        Set response.CodexPrincipal = principal
    }
    Set packet = ##class(KnAIghts.Review.Cases).Resolve(caseId)
    Set response.Status = packet.%Get("error")
    If response.Status'="" Quit $$$OK
    Set response.Limitation = packet.%Get("limitation")
    If principal'="" Quit ..Apply(request.CodexProposal, packet, .response)
    If $SYSTEM.Util.GetEnviron("KNAIGHTS_LIVE")'="1" {
        Set response.Status = "LIVE_DISABLED"
        Quit $$$OK
    }

    Set url = $SYSTEM.Util.GetEnviron("KNAIGHTS_PROVIDER_BASE_URL")
    If '..LocalProvider(url) {
        Set response.Status = "PROVIDER_NOT_CONFIGURED"
        Quit $$$OK
    }

    // ReadEvidence executes synchronously in this Build 154 worker. Bind one authorized
    // projection to the job and clear it on both paths so the next queued case cannot reuse it.
    // See the native-agent and live-profile evidence in docs/INTEROPERABILITY.md#qualification-evidence.
    // Revalidate tool execution and consecutive cases after any job, timeout, or cleanup change.
    Set facts = packet.%Get("facts"), answer = "", toolRead = 0, failed = 0
    Kill ^||KnAIghtsReview
    Set ^||KnAIghtsReview("facts") = facts.%ToJSON()
    Try {
        Set settings = {"api_key":"local-only","http_config":{"request_timeout_secs":60}}
        Do settings.%Set("base_url", url)
        Set provider = ##class(%AI.Provider).Create("openai", settings)
        Set agent = ##class(%AI.Agent).%New(provider)
        Set agent.Model = "gpt-oss:20b"
        Set agent.SystemPrompt = "Call ReadEvidence before deciding. Compare the CT and SEG study identifiers and, when supplied, their frames of reference. Choose SHOW_VERIFIED for matching evidence or REQUEST_REVIEW when a source differs or is uncertain. Return only JSON with action and citations, in the exact order of evidenceRefs. Do not add diagnoses, coordinates, links, or instructions."
        Do agent.UseToolSet("KnAIghts.Review.Tools")
        Set session = agent.CreateSession({"max_iterations":3,"temperature":0,"max_tokens":1024})
        Set result = agent.Chat(session, "Review the authorized imaging evidence and choose an action.")
        Set answer = result.Content
        Set toolRead = $Get(^||KnAIghtsReview("read"))
    } Catch exception {
        Set failed = 1
    }
    Kill ^||KnAIghtsReview

    If failed {
        Set response.Status = "PROVIDER_ERROR"
        Quit $$$OK
    }
    If 'toolRead {
        Set response.Status = "EVIDENCE_TOOL_REQUIRED"
        Quit $$$OK
    }
    Quit ..Apply(answer, packet, .response)
}

/// The live profile admits a narrow operator-configured provider URL before creating the provider.
/// Network isolation must separately constrain the resolved destination. See the live-profile evidence
/// in docs/INTEROPERABILITY.md#qualification-evidence. Retest rejected URLs and actual egress on changes.
Method LocalProvider(url As %String) As %Boolean [ Private ]
{
    If $Length(url)>128 Quit 0
    Set host = $Piece(url, ":", 2), suffix = $Piece(url, ":", 3)
    Set port = $Piece(suffix, "/", 1)
    If $Piece(url, ":", 1)'="http" Quit 0
    If $ListFind($ListBuild("//127.0.0.1", "//host.docker.internal", "//knights-provider"), host)=0 Quit 0
    If port'?1.5N Quit 0
    If (+port<1)!(+port>65535) Quit 0
    Quit url=("http:"_host_":"_port_"/v1")
}

/// Both seats submit proposals. The production preserves the exact ordered citations and
/// derives the visible selection and explanation from the packet. See the Codex seat witness
/// in docs/INTEROPERABILITY.md#qualification-evidence. Revalidate rejection of wrong citations
/// and a forced selection against mismatched source evidence before changing this decision.
Method Apply(answer As %String, packet As %DynamicObject, Output response As KnAIghts.Review.Response) As %Status [ Private ]
{
    Set response.Status = "REJECTED_PROPOSAL", parsed = ""
    If $Length(answer)>4096 Quit $$$OK
    Try {
        Set parsed = ##class(%DynamicObject).%FromJSON(answer)
    } Catch exception {
        Set parsed = ""
    }
    If '$IsObject(parsed) Quit $$$OK
    If parsed.%Size()'=2 Quit $$$OK
    If parsed.%GetTypeOf("citations")'="array" Quit $$$OK

    Set actual = parsed.%Get("citations"), facts = packet.%Get("facts"), expected = facts.%Get("evidenceRefs")
    If actual.%ToJSON()'=expected.%ToJSON() Quit $$$OK
    Set action = parsed.%Get("action")
    If action="REQUEST_REVIEW" {
        Set response.Status = "REVIEW_REQUESTED"
        Set response.Explanation = "The evidence needs review before a source selection can be shown."
    } ElseIf action="SHOW_VERIFIED",packet.%Get("selectionAllowed") {
        Set response.Status = "ACCEPTED"
        Set response.SemanticId = facts.%Get("selectionId")
        Set response.Explanation = packet.%Get("explanation")
    } Else {
        Quit $$$OK
    }

    Set response.Action = action, response.Citations = expected.%ToJSON()
    Quit $$$OK
}

XData MessageMap
{
<MapItems>
  <MapItem MessageType="KnAIghts.Review.Request"><Method>Assess</Method></MapItem>
</MapItems>
}
}

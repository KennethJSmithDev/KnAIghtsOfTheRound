Class KnAIghts.Review.Cases
{
ClassMethod Resolve(caseId As %String) As %DynamicObject
{
    If caseId="synthetic-a" Quit ..Synthetic("urn:example:study-a")
    If caseId="synthetic-b" Quit ..Synthetic("urn:example:study-b")
    // This candidate admits the two synthetic cases. The retained H000 adapter
    // requires its own source-validation and browser qualification before activation.
    Quit {"error":"CASE_NOT_ALLOWED"}
}

/// Both fixtures use the same production and the same tool. The agent sees
/// source facts without the fixture name or the expected route.
ClassMethod Synthetic(segStudy As %String) As %DynamicObject [ Private ]
{
    Set facts = {"kind":"synthetic","ctStudy":"urn:example:study-a","selectionId":"synthetic.structure.001"}
    Do facts.%Set("segStudy", segStudy)
    Do facts.%Set("evidenceRefs", ["ImagingStudy/example-ct","ImagingSelection/example-segment"])
    Set packet = {"explanation":"The synthetic selection and the source image refer to the same study."}
    Do packet.%Set("facts", facts)
    Do packet.%Set("selectionAllowed", segStudy=facts.%Get("ctStudy"), "boolean")
    Do packet.%Set("limitation", "Synthetic example for workflow education.")
    Quit packet
}
}

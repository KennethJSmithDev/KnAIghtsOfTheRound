Class KnAIghts.Review.Tools Extends %AI.ToolSet
{
XData Definition [ MimeType = application/xml ]
{
<ToolSet Name="AuthorizedReviewEvidence">
  <Tool Name="ReadEvidence" Method="ReadEvidence"/>
</ToolSet>
}

/// The production worker binds one authorized projection for this synchronous
/// agent run. The tool takes no case, endpoint or resource argument. See Operation.Decide
/// and the native-agent evidence in docs/INTEROPERABILITY.md#qualification-evidence.
/// Retest unbound tool calls and consecutive cases if tool execution changes workers.
ClassMethod ReadEvidence() As %DynamicObject
{
    Set facts = $Get(^||KnAIghtsReview("facts"))
    If facts="" Quit {"error":"NO_ACTIVE_CASE"}
    Set ^||KnAIghtsReview("read") = 1
    Quit ##class(%DynamicObject).%FromJSON(facts)
}
}

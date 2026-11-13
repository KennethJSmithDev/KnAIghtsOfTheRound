Class KnAIghts.Health.Tools Extends %AI.ToolSet
{
XData Definition [ MimeType = application/xml ]
{
<ToolSet Name="KnAIghtsHealthSources">
  <Policies><Authorization Class="KnAIghts.Health.Policy"/></Policies>
  <Tool Name="ListHealthSources" Method="ListHealthSources"/>
  <Tool Name="ReadHealthSourceState" Method="ReadHealthSourceState"/>
  <Tool Name="InspectHealthSource" Method="InspectHealthSource"/>
</ToolSet>
}

/// List only this authenticated principal's configured synthetic source identities.
ClassMethod ListHealthSources() As %DynamicObject
{
    Quit ##class(KnAIghts.Health.Control).Sources()
}

/// Read a retained inspection without another source request or model call.
ClassMethod ReadHealthSourceState(sourceId As %String) As %DynamicObject
{
    Quit ##class(KnAIghts.Health.Control).State(sourceId)
}

/// Capture one named synthetic source. Reuse the request identity when reconciling a retry.
ClassMethod InspectHealthSource(sourceId As %String, requestId As %String) As %DynamicObject
{
    Quit ##class(KnAIghts.Health.Control).Inspect(sourceId,requestId)
}
}

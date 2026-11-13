Class KnAIghts.Health.Request Extends Ens.Request
{
Property SourceId As %String(MAXLEN = 64);
Property Actor As %String(MAXLEN = 128);

Property Action As %String(VALUELIST = ",inspect,catalog") [ InitialExpression = "inspect" ];
}

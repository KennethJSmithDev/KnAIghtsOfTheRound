Class KnAIghts.Seats.Request Extends Ens.Request
{
Property Owner As %String(MAXLEN=128);
Property Worker As %String(MAXLEN=128);
Property JobId As %Integer;
Property Lease As %String(MAXLEN=64);
Property Authorization As %String(MAXLEN=64);
Property Proposal As %String(MAXLEN=4096);
Property ResponseId As %String(MAXLEN=128);
Property UsageJson As %String(MAXLEN=2048);
}

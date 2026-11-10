Class KnAIghts.Bonus.NoticeRequest Extends Ens.Request
{
Property AuditId As %Integer;
Property AuditJson As %String(MAXLEN = 8192);
Property FactsJson As %String(MAXLEN = 8192);
Property TaskId As %Integer;
Property ReviewAction As %String(MAXLEN = 32);
Property Reviewer As %String(MAXLEN = 128);
Property EvidenceHash As %String(MAXLEN = 64);
}

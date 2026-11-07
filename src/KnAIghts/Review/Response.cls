Class KnAIghts.Review.Response Extends Ens.Response
{
Property CaseId As %String(MAXLEN = 48);
Property Status As %String(MAXLEN = 48);
Property Action As %String(MAXLEN = 32);
Property SemanticId As %String(MAXLEN = 128);
Property Explanation As %String(MAXLEN = 1024);
Property Citations As %String(MAXLEN = 1024);
Property Limitation As %String(MAXLEN = 512);
Property AuditId As %Integer;
Property CodexPrincipal As %String(MAXLEN = 48);

/// The audit and caller share this envelope. Keep citations as an array and carry the
/// limitation in the response so a client can display the validated evidence as returned.
/// See the response and audit witness in docs/INTEROPERABILITY.md#qualification-evidence.
/// Retest accepted and review responses if changing the serialized fields.
Method ToJSON() As %String
{
    Set view = {}
    Do view.%Set("caseId", ..CaseId)
    Do view.%Set("status", ..Status)
    Do view.%Set("action", ..Action)
    Do view.%Set("semanticId", ..SemanticId)
    Do view.%Set("explanation", ..Explanation)
    Do view.%Set("citations", ##class(%DynamicArray).%FromJSON(..Citations))
    Do view.%Set("limitation", ..Limitation)
    Do view.%Set("auditId", ..AuditId)
    If ..CodexPrincipal'="" {
        Do view.%Set("seat", "codex")
        Do view.%Set("principal", ..CodexPrincipal)
    }
    Quit view.%ToJSON()
}
}

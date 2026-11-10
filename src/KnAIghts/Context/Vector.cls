Include %occStatus

Class KnAIghts.Context.Vector
{
/// Explicitly index an existing synthetic audit; never replace an existing row.
/// The six hand-defined features describe same/different source, accepted/review,
/// exact citations, and synthetic scope. They are not model-generated embeddings.
ClassMethod IndexAudit(id As %Integer) As %Status
{
    If ($USERNAME="") || '$SYSTEM.Security.Check("%Admin_Operate", "U") Quit $$$ERROR($$$GeneralError, "Operator authorization required")
    Quit ..InsertAudit(id)
}

/// The dedicated live operator may index only a source-bound synthetic audit.
/// A pre-existing row must still match the audit and feature direction exactly;
/// this is idempotent for the live workflow and does not replace any row.
ClassMethod EnsureLiveAudit(id As %Integer) As %Status
{
    If ($ZConvert($USERNAME,"L")'="knaights_operator") || '$SYSTEM.Security.Check("KnAIghtsWorkflowUse", "U") Quit $$$ERROR($$$GeneralError, "Live workflow operator required")
    Set sc=##class(KnAIghts.Context.Audit).Capture(id,.raw,.facts,.caseId,.disposition,.vector)
    If $$$ISERR(sc) Quit sc
    Set st=##class(%SQL.Statement).%New(),sc=st.%Prepare("SELECT CaseId,Disposition,AuditJson,FactsJson,VECTOR_COSINE(Features,TO_VECTOR(?,DOUBLE)) AS Similarity FROM KnAIghtsVector.CaseV1 WHERE AuditId=?")
    If $$$ISERR(sc) Quit sc
    Set rows=st.%Execute(vector,id)
    If rows.%SQLCODE<0 Quit $$$ERROR($$$GeneralError,"Index lookup failed")
    If rows.%Next() {
        If (rows.%Get("CaseId")'=caseId)!(rows.%Get("Disposition")'=disposition)!(rows.%Get("AuditJson")'=raw)!(rows.%Get("FactsJson")'=facts)!(rows.%Get("Similarity")<0.999999999) Quit $$$ERROR($$$GeneralError,"Existing synthetic index row differs")
        Quit $$$OK
    }
    Quit ..InsertAudit(id)
}

ClassMethod InsertAudit(id As %Integer) As %Status [ Private ]
{
    Set sc=##class(KnAIghts.Context.Audit).Capture(id,.raw,.facts,.caseId,.disposition,.vector)
    If $$$ISERR(sc) Quit sc
    Set sql="INSERT INTO KnAIghtsVector.CaseV1 (AuditId,CaseId,Disposition,AuditJson,FactsJson,Features) VALUES (?,?,?,?,?,TO_VECTOR(?,DOUBLE))"
    Set statement=##class(%SQL.Statement).%New(),sc=statement.%Prepare(sql)
    If $$$ISERR(sc) Quit sc
    Set rows=statement.%Execute(id,caseId,disposition,raw,facts,vector)
    If rows.%SQLCODE<0 Quit $$$ERROR($$$GeneralError, "Index insert failed: "_rows.%Message)
    Quit $$$OK
}

/// An index hit is advisory. Before returning it, re-read its own audit and facts
/// and compare them with the indexed copies so stale rows cannot masquerade as
/// current evidence. A missing related case is a normal empty result.
ClassMethod FindRelated(id As %Integer, Output match As %DynamicObject) As %Status
{
    Set match={"found":false}
    Set sc=##class(KnAIghts.Context.Audit).Capture(id,.raw,.facts,.caseId,.disposition,.vector)
    If $$$ISERR(sc) Quit sc
    Set sql="SELECT TOP 5 AuditId,CaseId,Disposition,AuditJson,FactsJson,VECTOR_COSINE(Features,TO_VECTOR(?,DOUBLE)) AS Similarity FROM KnAIghtsVector.CaseV1 WHERE AuditId <> ? ORDER BY VECTOR_COSINE(Features,TO_VECTOR(?,DOUBLE)) DESC"
    Set statement=##class(%SQL.Statement).%New(),sc=statement.%Prepare(sql)
    If $$$ISERR(sc) Quit sc
    Set rows=statement.%Execute(vector,id,vector)
    If rows.%SQLCODE<0 Quit $$$ERROR($$$GeneralError, "Vector search failed: "_rows.%Message)
    While rows.%Next() {
        Set other=rows.%Get("AuditId")
        Set sc=##class(KnAIghts.Context.Audit).Capture(other,.currentRaw,.currentFacts,.currentCase,.currentDisposition,.unusedVector)
        If $$$ISOK(sc),(currentRaw=rows.%Get("AuditJson")),(currentFacts=rows.%Get("FactsJson")),(currentCase=rows.%Get("CaseId")),(currentDisposition=rows.%Get("Disposition")) {
            Set match={"found":true}
            Do match.%Set("auditId",other)
            Do match.%Set("caseId",currentCase)
            Do match.%Set("disposition",currentDisposition)
            Do match.%Set("similarity",rows.%Get("Similarity"))
            Quit
        }
    }
    Quit $$$OK
}
}

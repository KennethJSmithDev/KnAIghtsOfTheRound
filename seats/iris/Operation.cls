Include %occStatus
Class KnAIghts.Seats.Operation Extends KnAIghts.Review.Operation
{
/// Reuse the qualified proposal validator; identity and scheduling belong to this opt-in route.
Method Finalize(request As KnAIghts.Seats.Request, Output response As KnAIghts.Seats.Response) As %Status
{
    Set response=##class(KnAIghts.Seats.Response).%New(),result={"status":"LEASE_REJECTED"}
    Lock +^KnAIghtsSeats("lock"):2
    If '$Test { Set response.Json="{""status"":""BUSY""}" Quit $$$OK }
    Try {
        Set level=$TLevel
        If $Data(^KnAIghtsSeats("job",request.Owner,request.JobId)) {
            Set job=##class(%DynamicObject).%FromJSON(^KnAIghtsSeats("job",request.Owner,request.JobId))
            If (job.state="RUNNING"),(job.lease=request.Lease),(job.leaseUntil>##class(KnAIghts.Seats.Registry).Now()) {
                Set seat=##class(%DynamicObject).%FromJSON(^KnAIghtsSeats("seat",request.Owner,job.seatId)),connection=##class(%DynamicObject).%FromJSON(^KnAIghtsSeats("connection",request.Owner,job.connectionId))
                Set packet=##class(KnAIghts.Review.Cases).Resolve(job.caseId)
                Set authorized=(job.authorization=request.Authorization)&&(job.authorizationUntil>##class(KnAIghts.Seats.Registry).Now())
                Set current=(seat.revision=job.seatRevision)&&(connection.revision=job.connectionRevision)&&connection.enabled&&##class(KnAIghts.Seats.Registry).Allowed(seat,job.caseId,1)
                Set current=current&&(job.version=##class(KnAIghts.Seats.Registry).Fingerprint(packet))
                If authorized,current {
                    Set ruling=##class(KnAIghts.Review.Response).%New(),ruling.CaseId=job.caseId,ruling.Citations="[]",ruling.Limitation=packet.limitation,ruling.AuditId=job.id
                    Set sc=..Apply(request.Proposal,packet,.ruling)
                    If $SYSTEM.Status.IsError(sc) Throw ##class(%Exception.StatusException).CreateFromStatus(sc)
                    Set result=##class(%DynamicObject).%FromJSON(ruling.ToJSON())
                    Set result.auditDomain="seats-v1",result.principal=job.owner,result.seatId=job.seatId,result.seatLabel=job.seatLabel,result.jobId=job.id
                    Set result.connectionId=job.connectionId,result.model=job.model,result.evidenceVersion=job.version,result.providerResponseId=request.ResponseId
                    Do result.%Set("usage",##class(%DynamicObject).%FromJSON(request.UsageJson))
                    Set job.state="COMPLETED",job.result=result,job.finished=##class(KnAIghts.Seats.Registry).Now()
                    Set auditJson=result.%ToJSON(),jobJson=job.%ToJSON()
                    TStart
                    Set ^KnAIghtsSeats("audit",job.owner,job.id)=auditJson,^KnAIghtsSeats("job",job.owner,job.id)=jobJson
                    TCommit
                } Else { Set result={"status":"STALE_OR_REVOKED"},job.state="STALE_OR_REVOKED",job.finished=##class(KnAIghts.Seats.Registry).Now(),^KnAIghtsSeats("job",job.owner,job.id)=job.%ToJSON() }
            } ElseIf job.state="COMPLETED" { Set result=job.result }
        }
    } Catch exception {
        If $TLevel>$Get(level,0) TRollback 1
        Set result={"status":"VALIDATION_ERROR"}
    }
    Lock -^KnAIghtsSeats("lock")
    Set response.Json=result.%ToJSON()
    Quit $$$OK
}
XData MessageMap
{
<MapItems><MapItem MessageType="KnAIghts.Seats.Request"><Method>Finalize</Method></MapItem></MapItems>
}
}

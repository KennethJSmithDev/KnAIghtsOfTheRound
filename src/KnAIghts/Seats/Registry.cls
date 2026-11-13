Include %occStatus

Class KnAIghts.Seats.Registry
{
ClassMethod Now() As %Numeric
{
    Quit $Piece($ZTimestamp,",",1)*86400+$Piece($ZTimestamp,",",2)
}

ClassMethod Id(value As %String) As %Boolean
{
    Quit ($Length(value)>0)&&($Length(value)<65)&&($Translate(value,"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")="")
}

ClassMethod Has(values As %DynamicArray, value As %String) As %Boolean
{
    Set found=0
    For n=0:1:values.%Size()-1 { If values.%Get(n)=value Set found=1 }
    Quit found
}

ClassMethod Fingerprint(packet As %DynamicObject) As %String
{
    // The source factory owns this stable serialization; app users need no Embedded Python permission.
    Quit $SYSTEM.Encryption.Base64Encode($SYSTEM.Encryption.SHAHash(256,$ZConvert(packet.%ToJSON(),"O","UTF8")))
}

ClassMethod View(job As %DynamicObject) As %DynamicObject
{
    Set value=##class(%DynamicObject).%FromJSON(job.%ToJSON())
    For key="lease","authorization","authorizationUntil" { Do value.%Remove(key) }
    Quit value
}

ClassMethod Allowed(seat As %DynamicObject, caseId As %String, propose As %Boolean = 0) As %Boolean
{
    If 'seat.enabled Quit 0
    If '..Has(seat.cases,caseId) Quit 0
    If '..Has(seat.permissions,"ReadEvidence") Quit 0
    If propose,'..Has(seat.permissions,"ProposeDecision") Quit 0
    Quit 1
}

ClassMethod Call(op As %String, input As %DynamicObject) As %DynamicObject
{
    Set worker=$SYSTEM.Security.Check("KnAIghtsSeatWorker","U")
    If (op="claim")!(op="fail")!(op="reconcile") {
        If 'worker Quit {"status":"DENIED"}
    } Else {
        If '$SYSTEM.Security.Check("KnAIghtsSeatUse","U") Quit {"status":"DENIED"}
    }
    Lock +^KnAIghtsSeats("lock"):2
    If '$Test Quit {"status":"BUSY"}
    Try { Set result=..Dispatch(op,input,$ZConvert($USERNAME,"L")) }
    Catch exception { Set result={"status":"INVALID_REQUEST"} }
    Lock -^KnAIghtsSeats("lock")
    Quit result
}

ClassMethod Dispatch(op As %String, input As %DynamicObject, owner As %String) As %DynamicObject [ Private ]
{
    If op="reconcile" {
        Set person="",changed=0
        For {
            Set person=$Order(^KnAIghtsSeats("job",person)) Quit:person=""
            Set id=""
            For {
                Set id=$Order(^KnAIghtsSeats("job",person,id)) Quit:id=""
                Set job=##class(%DynamicObject).%FromJSON(^KnAIghtsSeats("job",person,id))
                If (job.state'="QUEUED")&&(job.state'="RUNNING") Continue
                Set seat=##class(%DynamicObject).%FromJSON(^KnAIghtsSeats("seat",person,job.seatId)),connection=##class(%DynamicObject).%FromJSON(^KnAIghtsSeats("connection",person,job.connectionId))
                Set valid=seat.enabled&&connection.enabled&&(seat.revision=job.seatRevision)&&(connection.revision=job.connectionRevision)
                If 'valid { Set job.state="STALE_OR_REVOKED",job.failure="Seat or connection changed; result withheld." }
                ElseIf job.state="RUNNING",job.leaseUntil<..Now() { Set job.state="FAILED_OR_UNCERTAIN",job.failure="Lease expired; automatic inference retry refused." }
                Else { Continue }
                Set job.finished=..Now(),^KnAIghtsSeats("job",person,id)=job.%ToJSON(),changed=changed+1
            }
        }
        Set result={"status":"OK"} Do result.%Set("changed",changed) Quit result
    }
    If op="identity" {
        Set result={"status":"OK"}
        Do result.%Set("principal",owner),result.%Set("canPropose",$SYSTEM.Security.Check("KnAIghtsSeatPropose","U"),"boolean")
        Quit result
    }
    If op="state" {
        Set result={"status":"OK"},connections=[],seats=[],jobs=[]
        For kind="connection","seat","job" {
            Set id=""
            For {
                Set id=$Order(^KnAIghtsSeats(kind,owner,id)) Quit:id=""
                Set value=##class(%DynamicObject).%FromJSON(^KnAIghtsSeats(kind,owner,id))
                If kind="connection" { Do connections.%Push(value) }
                ElseIf kind="seat" { Do seats.%Push(value) }
                Else { Do jobs.%Push(..View(value)) }
            }
        }
        Do result.%Set("principal",owner),result.%Set("connections",connections),result.%Set("seats",seats),result.%Set("jobs",jobs)
        Do result.%Set("canPropose",$SYSTEM.Security.Check("KnAIghtsSeatPropose","U"),"boolean"),result.%Set("now",..Now())
        Quit result
    }
    If op="connection" {
        Set id=input.%Get("id"),model=input.%Get("model"),parallel=input.%Get("parallel"),budget=input.%Get("budget")
        If '..Id(id)!($Length(input.label)>64)!($Length(model)>128) Quit {"status":"INVALID_CONNECTION"}
        If (input.provider'="chatgpt")&&(input.provider'="local") Quit {"status":"INVALID_CONNECTION"}
        If (parallel<1)!(parallel>2)!(parallel\1'=parallel)!(budget<1)!(budget>20)!(budget\1'=budget) Quit {"status":"INVALID_LIMIT"}
        Set value={"revision":0,"used":0}
        Set count=0,key=""
        For { Set key=$Order(^KnAIghtsSeats("connection",owner,key)) Quit:key=""  Set count=count+1 }
        If count>=8,'$Data(^KnAIghtsSeats("connection",owner,id)) Quit {"status":"CONNECTION_LIMIT"}
        If $Data(^KnAIghtsSeats("connection",owner,id)) Set value=##class(%DynamicObject).%FromJSON(^KnAIghtsSeats("connection",owner,id))
        Set value.id=id,value.owner=owner,value.label=input.label,value.provider=input.provider,value.model=model
        Set value.parallel=parallel,value.budget=budget,value.enabled=input.enabled,value.revision=value.revision+1
        If 'value.%IsDefined("window") Do value.%Set("window",..Now())
        Set ^KnAIghtsSeats("connection",owner,id)=value.%ToJSON()
        Quit {"status":"OK"}
    }
    If op="seat" {
        Set id=input.id,connection=input.connectionId
        If '..Id(id)!('..Id(connection))!($Length(input.label)>64) Quit {"status":"INVALID_SEAT"}
        If '$Data(^KnAIghtsSeats("connection",owner,connection)) Quit {"status":"CONNECTION_NOT_FOUND"}
        If input.%GetTypeOf("permissions")'="array" Quit {"status":"INVALID_PERMISSION"}
        Set valid=1
        For n=0:1:input.permissions.%Size()-1 { If '..Has(["ReadEvidence","ProposeDecision","ReadAudit"],input.permissions.%Get(n)) Set valid=0 }
        If 'valid Quit {"status":"INVALID_PERMISSION"}
        If ..Has(input.permissions,"ProposeDecision"),'$SYSTEM.Security.Check("KnAIghtsSeatPropose","U") Quit {"status":"DENIED"}
        If input.%GetTypeOf("cases")'="array" Quit {"status":"INVALID_CASE"}
        If (input.cases.%Size()<1)!(input.cases.%Size()>2) Quit {"status":"INVALID_CASE"}
        For n=0:1:input.cases.%Size()-1 { If '##class(KnAIghts.Review.CodexPolicy).SyntheticCase(input.cases.%Get(n)) Set valid=0 }
        If 'valid Quit {"status":"INVALID_CASE"}
        If '..Has(["reviewer","challenger","reader"],input.role) Quit {"status":"INVALID_ROLE"}
        Set value={"revision":0}
        Set count=0,key=""
        For { Set key=$Order(^KnAIghtsSeats("seat",owner,key)) Quit:key=""  Set count=count+1 }
        If count>=16,'$Data(^KnAIghtsSeats("seat",owner,id)) Quit {"status":"SEAT_LIMIT"}
        If $Data(^KnAIghtsSeats("seat",owner,id)) Set value=##class(%DynamicObject).%FromJSON(^KnAIghtsSeats("seat",owner,id))
        Set value.id=id,value.owner=owner,value.label=input.label,value.connectionId=connection,value.role=input.role
        Set value.permissions=input.permissions,value.cases=input.cases,value.enabled=input.enabled,value.revision=value.revision+1
        Set ^KnAIghtsSeats("seat",owner,id)=value.%ToJSON()
        Quit {"status":"OK"}
    }
    If op="readAudit" {
        Set seatId=input.seatId,id=+input.jobId
        If '$Data(^KnAIghtsSeats("seat",owner,seatId)) Quit {"status":"DENIED"}
        If '$Data(^KnAIghtsSeats("job",owner,id)) Quit {"status":"NOT_FOUND"}
        Set seat=##class(%DynamicObject).%FromJSON(^KnAIghtsSeats("seat",owner,seatId)),job=##class(%DynamicObject).%FromJSON(^KnAIghtsSeats("job",owner,id))
        If ('..Allowed(seat,job.caseId))!('..Has(seat.permissions,"ReadAudit")) Quit {"status":"DENIED"}
        Set result={"status":"OK"} Do result.%Set("job",..View(job)) Quit result
    }
    If (op="read")!(op="enqueue") {
        Set id=input.seatId,caseId=input.caseId
        If '..Id(id)!('$Data(^KnAIghtsSeats("seat",owner,id))) Quit {"status":"DENIED"}
        Set seat=##class(%DynamicObject).%FromJSON(^KnAIghtsSeats("seat",owner,id))
        If '..Allowed(seat,caseId,op="enqueue") Quit {"status":"DENIED"}
        Set packet=##class(KnAIghts.Review.Cases).Resolve(caseId),version=..Fingerprint(packet)
        If op="read" { Set result={"status":"OK"} Do result.%Set("packet",packet),result.%Set("version",version) Quit result }
        If '$SYSTEM.Security.Check("KnAIghtsSeatPropose","U") Quit {"status":"DENIED"}
        Set request=input.requestId
        If '..Id(request) Quit {"status":"INVALID_REQUEST_ID"}
        If $Data(^KnAIghtsSeats("request",owner,request)) {
            Set job=##class(%DynamicObject).%FromJSON(^KnAIghtsSeats("job",owner,^KnAIghtsSeats("request",owner,request)))
            If (job.seatId'=id)!(job.caseId'=caseId) Quit {"status":"REQUEST_ID_REUSED"}
            Set result={"status":"OK"} Do result.%Set("job",..View(job)) Quit result
        }
        Set count=0,j=""
        For { Set j=$Order(^KnAIghtsSeats("job",owner,j)) Quit:j=""  Set count=count+1 }
        If count>=256 Quit {"status":"JOB_LIMIT"}
        Set connection=##class(%DynamicObject).%FromJSON(^KnAIghtsSeats("connection",owner,seat.connectionId))
        If 'connection.enabled Quit {"status":"CONNECTION_DISABLED"}
        Set number=$Increment(^KnAIghtsSeats("jobCounter")),job={"state":"QUEUED"}
        Set job.id=number,job.owner=owner,job.seatId=id,job.seatLabel=seat.label,job.seatRevision=seat.revision,job.role=seat.role
        Set job.connectionId=connection.id,job.connectionRevision=connection.revision,job.model=connection.model,job.provider=connection.provider
        Set job.caseId=caseId,job.packet=packet,job.version=version,job.requestId=request,job.created=..Now()
        Set ^KnAIghtsSeats("job",owner,number)=job.%ToJSON(),^KnAIghtsSeats("request",owner,request)=number
        Set result={"status":"OK"} Do result.%Set("job",..View(job)) Quit result
    }
    If (op="authorize")!(op="cancel") {
        Set id=+input.jobId
        If '$Data(^KnAIghtsSeats("job",owner,id)) Quit {"status":"NOT_FOUND"}
        Set job=##class(%DynamicObject).%FromJSON(^KnAIghtsSeats("job",owner,id))
        If op="cancel" {
            If (job.state="QUEUED")!(job.state="RUNNING") Set job.state="CANCELLED",job.finished=..Now(),^KnAIghtsSeats("job",owner,id)=job.%ToJSON()
            Quit {"status":"OK"}
        }
        If '$SYSTEM.Security.Check("KnAIghtsSeatPropose","U") Quit {"status":"DENIED"}
        If '..Id(input.nonce) Quit {"status":"INVALID_REQUEST"}
        Set seat=##class(%DynamicObject).%FromJSON(^KnAIghtsSeats("seat",owner,job.seatId))
        If '..Allowed(seat,job.caseId,1) Quit {"status":"DENIED"}
        Set job.authorization=input.nonce,job.authorizationUntil=..Now()+30
        Set ^KnAIghtsSeats("job",owner,id)=job.%ToJSON()
        Quit {"status":"OK"}
    }
    If (op="claim")!(op="fail") {
        Set worker=owner,owner=input.owner,id=+input.jobId
        If '$Data(^KnAIghtsSeats("job",owner,id)) Quit {"status":"NOT_FOUND"}
        Set job=##class(%DynamicObject).%FromJSON(^KnAIghtsSeats("job",owner,id))
        If op="fail" {
            If (job.state'="RUNNING")!(job.lease'=input.lease) Quit {"status":"LEASE_REJECTED"}
            Set job.state="FAILED_OR_UNCERTAIN",job.failure="Provider request failed or its outcome is unavailable.",job.finished=..Now()
            Set ^KnAIghtsSeats("job",owner,id)=job.%ToJSON()
            Quit {"status":"OK"}
        }
        If job.state'="QUEUED" Quit {"status":"NOT_QUEUED"}
        If (job.%Get("authorization","")'=input.nonce)!(job.%Get("authorizationUntil",0)<..Now()) Quit {"status":"AUTHORIZATION_REQUIRED"}
        Set seat=##class(%DynamicObject).%FromJSON(^KnAIghtsSeats("seat",owner,job.seatId)),connection=##class(%DynamicObject).%FromJSON(^KnAIghtsSeats("connection",owner,job.connectionId))
        If ('..Allowed(seat,job.caseId,1))!('connection.enabled)!(seat.revision'=job.seatRevision)!(connection.revision'=job.connectionRevision) Quit {"status":"STALE_CONFIGURATION"}
        If job.version'=..Fingerprint(##class(KnAIghts.Review.Cases).Resolve(job.caseId)) Quit {"status":"STALE_EVIDENCE"}
        Set active=0,j=""
        For { Set j=$Order(^KnAIghtsSeats("job",owner,j)) Quit:j=""  Set other=##class(%DynamicObject).%FromJSON(^KnAIghtsSeats("job",owner,j)) If other.state="RUNNING" { If other.leaseUntil<..Now() { Set other.state="FAILED_OR_UNCERTAIN",other.failure="Lease expired; automatic inference retry refused.",^KnAIghtsSeats("job",owner,j)=other.%ToJSON() } ElseIf other.connectionId=connection.id { Set active=active+1 } } }
        If active>=connection.parallel Quit {"status":"CONNECTION_BUSY"}
        If connection.window+3600<..Now() Set connection.window=..Now(),connection.used=0
        If connection.used>=connection.budget Quit {"status":"REQUEST_BUDGET_REACHED"}
        If '..Id(input.lease) Quit {"status":"INVALID_REQUEST"}
        Set leaseSeconds=input.%Get("leaseSeconds",180)
        If (leaseSeconds<5)!(leaseSeconds>180)!(leaseSeconds\1'=leaseSeconds) Quit {"status":"INVALID_LEASE_DURATION"}
        Set connection.used=connection.used+1,^KnAIghtsSeats("connection",owner,connection.id)=connection.%ToJSON()
        Set job.state="RUNNING",job.worker=worker,job.lease=input.lease,job.leaseUntil=..Now()+leaseSeconds,job.started=..Now()
        Set ^KnAIghtsSeats("job",owner,id)=job.%ToJSON(),result={"status":"OK"}
        Do result.%Set("job",job)
        Quit result
    }
    Quit {"status":"UNKNOWN_OPERATION"}
}
}

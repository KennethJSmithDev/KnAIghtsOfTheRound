Include %occStatus

Class KnAIghts.Health.MLLPOperation Extends Ens.BusinessOperation
{
Parameter INVOCATION = "Queue";

/// AA follows a persisted synthetic transport receipt, not clinical acceptance or execution.
Method Receive(input As EnsLib.HL7.Message, Output reply As EnsLib.HL7.Message) As %Status
{
    Set code="AE",state="UNAVAILABLE",objects=[],digest="",locked=0
    Set control=input.GetValueAt("MSH:10"),sender=input.GetValueAt("MSH:3")_"|"_input.GetValueAt("MSH:4")
    Try {
        Set kind=input.GetValueAt("MSH:9"),version=input.GetValueAt("MSH:12")
        // The admitted training fixture places PID second; schema-group paths vary across native importers.
        Set patient=input.GetValueAt("2:3"),patientName=input.GetValueAt("2:5")
        Set raw=input.OutputToString(,,.sc)
        If $$$ISERR(sc) Throw ##class(%Exception.StatusException).CreateFromStatus(sc)
        Set sep=$Extract(raw,4),cr=$Char(13),layout=($Length(raw,cr)=5)&&($Piece(raw,cr,5)="")
        Set layout=layout&&($Piece($Piece(raw,cr,2),sep)="PID")&&($Piece($Piece(raw,cr,3),sep)="OBR")&&($Piece($Piece(raw,cr,4),sep)="OBX")
        Set synthetic=(sender="KOTR_SYNTH|TEST")&&(input.GetValueAt("MSH:11")="T")&&($Extract(patient,1,15)="KOTR-SYNTHETIC-")&&(patientName=("SYNTHETIC"_input.CS_"KOTR"))
        If ($Piece(kind,input.CS,1,2)'=("ORU"_input.CS_"R01"))!(version'="2.5")!(control="")!('layout)!('synthetic) {
            Set code="AR",state="PROFILE_REJECTED"
        } Else {
            Set reference=##class(%DynamicObject).%FromJSON(##class(KnAIghts.Health.Bridge).StoreHL7(raw)),digest=reference.sha256
            Do objects.%Push(reference)
            Lock +^KnAIghtsHealthMLLPKey(sender,control):1
            If '$Test Throw ##class(%Exception.General).%New("Message identity is busy")
            Set locked=1,prior=$Get(^KnAIghtsHealthMLLPKey(sender,control))
            If prior="" { Set state="COMMITTED",code="AA" }
            ElseIf prior=digest { Set state="DUPLICATE",code="AA" }
            Else { Set state="CONTROL_ID_CONFLICT",code="AE" }
        }
    } Catch ex { Set state="UNAVAILABLE",code="AE" }
    Set record={"sourceId":"mllp-ingress","kind":"hl7-mllp","operation":"ORU_R01","scope":"synthetic"}
    Do record.%Set("state",state),record.%Set("ackCode",code),record.%Set("controlId",control),record.%Set("sender",sender)
    Do record.%Set("nativeBodyClass","EnsLib.HL7.Message"),record.%Set("nativeBodyId",input.%Id()),record.%Set("objects",objects)
    Do record.%Set("observedAt",$ZDATETIME($HOROLOG,3)),record.%Set("clinicalAcceptance",0,"boolean")
    // Commit the key and receipt together before returning the ACK to the native service.
    Set level=$TLevel,sc=$$$OK
    Try {
        TStart
        Set id=$Increment(^KnAIghtsHealthTransportReceipt)
        Do record.%Set("transportRecordId",id)
        Set ^KnAIghtsHealthTransportReceipt(id)=record.%ToJSON(),^KnAIghtsHealthTransportLast("mllp-ingress")=id
        If state="COMMITTED" Set ^KnAIghtsHealthMLLPKey(sender,control)=digest
        TCommit
    } Catch ex {
        If $TLevel>level TRollback 1
        Set sc=ex.AsStatus()
    }
    If locked Lock -^KnAIghtsHealthMLLPKey(sender,control)
    If $$$ISERR(sc) Quit sc
    Set reply=input.NewReplyDocument(,"KotR:LOCAL",.sc,1)
    If $$$ISERR(sc) Quit sc
    Set sc=reply.SetValueAt(code,"MSA:1")
    If $$$ISERR(sc) Quit sc
    Set sc=reply.SetValueAt(control,"MSA:2")
    Quit sc
}

XData MessageMap
{
<MapItems><MapItem MessageType="EnsLib.HL7.Message"><Method>Receive</Method></MapItem></MapItems>
}
}

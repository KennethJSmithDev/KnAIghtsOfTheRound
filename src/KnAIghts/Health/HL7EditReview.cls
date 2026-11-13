Include %occStatus

Class KnAIghts.Health.HL7EditReview
{
/// The operator links two committed transport receipts after IRIS verifies the edit against the archived ER7.
ClassMethod Link(originalId As %Integer, editedId As %Integer, Output metadata As %DynamicObject) As %Status
{
    Set metadata="",locked=0,sc=$$$OK
    If '##class(KnAIghts.Health.Control).Allows("mllp-ingress") Quit $$$ERROR($$$GeneralError,"Health source access required")
    If '$SYSTEM.Security.Check("%Admin_Operate","U") Quit $$$ERROR($$$GeneralError,"Operator authorization required")
    Try {
        Set original=..Receipt(originalId,0),edited=..Receipt(editedId,0)
        Set sender=edited.sender,control=edited.controlId,digest=edited.objects.%Get(0).sha256
        Do ..VerifyEdit(original,edited)
        Lock +^KnAIghtsHealthMLLPEdit(sender,control,digest):1
        If '$Test Throw ##class(%Exception.General).%New("Edit metadata is busy")
        Set locked=1,existing=$Get(^KnAIghtsHealthMLLPEdit(sender,control,digest))
        If existing'="" {
            Set metadata=##class(%DynamicObject).%FromJSON(existing)
            If (metadata.originalReceiptId'=originalId)!(metadata.editedReceiptId'=editedId) Throw ##class(%Exception.General).%New("Edit already linked to another original")
        } Else {
            Set metadata={"version":1,"originalReceiptId":(originalId),"editedReceiptId":(editedId),"originalControlId":(original.controlId),"editedControlId":(control),"originalSha256":(original.objects.%Get(0).sha256),"editedSha256":(digest),"linkedBy":($USERNAME)}
            Set ^KnAIghtsHealthMLLPEdit(sender,control,digest)=metadata.%ToJSON()
        }
    } Catch ex { Set sc=ex.AsStatus(),metadata="" }
    If locked Lock -^KnAIghtsHealthMLLPEdit(sender,control,digest)
    Quit sc
}

/// A retry can retrieve the canonical link only through the admitted sender, control ID and archived payload hash.
ClassMethod Read(receiptId As %Integer, Output metadata As %DynamicObject) As %Status
{
    Set metadata="",sc=$$$OK
    If '##class(KnAIghts.Health.Control).Allows("mllp-ingress") Quit $$$ERROR($$$GeneralError,"Health source access required")
    Try {
        Set record=..Receipt(receiptId,1),digest=record.objects.%Get(0).sha256
        Set value=$Get(^KnAIghtsHealthMLLPEdit(record.sender,record.controlId,digest))
        If value="" Throw ##class(%Exception.General).%New("No verified edit metadata for this receipt")
        Set metadata=##class(%DynamicObject).%FromJSON(value)
    } Catch ex { Set sc=ex.AsStatus() }
    Quit sc
}

ClassMethod Receipt(id As %Integer, allowRetry As %Boolean) As %DynamicObject [ Private ]
{
    Set value=$Get(^KnAIghtsHealthTransportReceipt(id))
    If value="" Throw ##class(%Exception.General).%New("Transport receipt not found")
    Set record=##class(%DynamicObject).%FromJSON(value)
    If (record.sourceId'="mllp-ingress")!(record.kind'="hl7-mllp")!(record.scope'="synthetic")!(record.ackCode'="AA") Throw ##class(%Exception.General).%New("Receipt outside the edit pilot")
    If (record.state'="COMMITTED")&&((allowRetry=0)!(record.state'="DUPLICATE")) Throw ##class(%Exception.General).%New("Committed transport receipt required")
    If (record.sender'="KOTR_SYNTH|TEST")!(record.controlId="")!(record.objects.%Size()'=1) Throw ##class(%Exception.General).%New("Receipt outside the edit pilot")
    Set digest=record.objects.%Get(0).sha256
    If (digest="")!($Get(^KnAIghtsHealthMLLPKey(record.sender,record.controlId))'=digest) Throw ##class(%Exception.General).%New("Transport identity mismatch")
    Quit record
}

ClassMethod VerifyEdit(original As %DynamicObject, edited As %DynamicObject) [ Private ]
{
    If original.controlId=edited.controlId Throw ##class(%Exception.General).%New("The edit must have a new control ID")
    Set source=##class(KnAIghts.Health.Bridge).HL7Text(original.objects.%Get(0).sha256)
    Set target=##class(KnAIghts.Health.Bridge).HL7Text(edited.objects.%Get(0).sha256)
    Set before=..Parse(source),after=..Parse(target)
    Set observation=after.GetValueAt("4:5")
    If (before.GetValueAt("MSH:10")'=original.controlId)!(after.GetValueAt("MSH:10")'=edited.controlId)!(before.GetValueAt("4:5")=observation) Throw ##class(%Exception.General).%New("Edit identity or observation did not change as required")
    Set sc=before.SetValueAt(edited.controlId,"MSH:10")
    If $$$ISERR(sc) Throw ##class(%Exception.StatusException).CreateFromStatus(sc)
    Set sc=before.SetValueAt(observation,"4:5")
    If $$$ISERR(sc) Throw ##class(%Exception.StatusException).CreateFromStatus(sc)
    If before.OutputToString()'=target Throw ##class(%Exception.General).%New("Edit changed fields outside MSH-10 and OBX-5")
}

ClassMethod Parse(raw As %String) As EnsLib.HL7.Message [ Private ]
{
    If ($Length(raw)<9)!($Extract(raw,1,3)'="MSH") Throw ##class(%Exception.General).%New("Expected an MSH header")
    Set sep=$Extract(raw,4),cr=$Char(13)
    If ($Length(raw,cr)'=5)!($Piece(raw,cr,5)'="")!($Piece($Piece(raw,cr,2),sep)'="PID")!($Piece($Piece(raw,cr,3),sep)'="OBR")!($Piece($Piece(raw,cr,4),sep)'="OBX") Throw ##class(%Exception.General).%New("Expected the four-segment KotR edit fixture")
    Set msg=##class(EnsLib.HL7.Message).ImportFromString(raw,.sc)
    If $$$ISERR(sc) Throw ##class(%Exception.StatusException).CreateFromStatus(sc)
    Set msg.DocType="2.5:ORU_R01"
    If (msg.GetValueAt("MSH:9")'=("ORU"_msg.CS_"R01"_msg.CS_"ORU_R01"))!(msg.GetValueAt("MSH:12")'="2.5")!(msg.GetValueAt("MSH:11")'="T")!(msg.GetValueAt("4:2")'="TX") Throw ##class(%Exception.General).%New("Expected the synthetic ORU_R01 text profile")
    If ($Extract(msg.GetValueAt("2:3"),1,15)'="KOTR-SYNTHETIC-")!(msg.GetValueAt("2:5")'=("SYNTHETIC"_msg.CS_"KOTR")) Throw ##class(%Exception.General).%New("Expected the synthetic patient marker")
    Quit msg
}
}

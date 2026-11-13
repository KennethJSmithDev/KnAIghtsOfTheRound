Include %occStatus

Class KnAIghts.Health.Operation Extends Ens.BusinessOperation
{
Parameter INVOCATION = "Queue";

Method Inspect(request As KnAIghts.Health.Request, Output response As KnAIghts.Health.Response) As %Status
{
    Set response=##class(KnAIghts.Health.Response).%New()
    // Python stays in the owned worker; discovery grants no caller callout privilege or inspection receipt.
    If request.Action="catalog" {
        Set response.Status="OK",response.ReceiptJson=##class(KnAIghts.Health.Bridge).Catalog()
        Quit $$$OK
    }
    Try {
        Set receipt=##class(%DynamicObject).%FromJSON(##class(KnAIghts.Health.Bridge).Capture(request.SourceId))
        If receipt.status="NATIVE_TRANSPORT_REQUIRED" {
            If (receipt.kind="dicom-dimse"),(request.SourceId="dimse-ingress") {
                Set transport=..DimseState(),transportId=transport.%Get("nativeHeaderId","")
            } Else {
            Set transportId=$Get(^KnAIghtsHealthTransportLast(request.SourceId))
                If transportId'="" Set transport=##class(%DynamicObject).%FromJSON(^KnAIghtsHealthTransportReceipt(transportId))
            }
            If transportId="" {
                Do receipt.%Set("status","NO_TRANSPORT_RECEIPT")
            } Else {
                If (transport.sourceId'=request.SourceId)!(transport.kind'=receipt.kind) {
                    Do receipt.%Set("status","SOURCE_IDENTITY_MISMATCH")
                } Else {
                    Do receipt.%Set("status","CAPTURED"),receipt.%Set("transportRecordId",transportId)
                    Do receipt.%Set("projection",transport),receipt.%Set("objects",transport.objects)
                }
            }
        }
        If (receipt.%Get("kind")="hl7-v2"),(receipt.%Get("status")="CAPTURED") {
            Set projection=receipt.%Get("projection"),profile=projection.%Get("profile")
            If profile'="2.5:ORU_R01" {
                Do receipt.%Set("status","HL7_PROFILE_NOT_ADMITTED"),receipt.%Set("projection",{})
            } Else {
                Set digest=receipt.objects.%Get(0).%Get("sha256"),raw=##class(KnAIghts.Health.Bridge).HL7Text(digest)
                Set message=##class(EnsLib.HL7.Message).ImportFromString(raw,.sc)
                If $SYSTEM.Status.IsError(sc) Throw ##class(%Exception.StatusException).CreateFromStatus(sc)
                Set message.DocType=profile
                Set kind=message.GetValueAt("MSH:9"),version=message.GetValueAt("MSH:12"),control=message.GetValueAt("MSH:10")
                If ($Piece(kind,message.CS,1,2)'=("ORU"_message.CS_"R01"))!(version'="2.5")!(control="") {
                    Do receipt.%Set("status","HL7_PROFILE_MISMATCH"),receipt.%Set("projection",{})
                } Else {
                    Do projection.%Set("messageType",kind),projection.%Set("version",version),projection.%Set("controlId",control)
                    Do projection.%Set("componentSeparator",message.CS)
                    Do projection.%Set("nativeParser","EnsLib.HL7.Message"),projection.%Set("nativeParsingRequired",0,"boolean")
                }
            }
        }
    } Catch exception {
        If '$IsObject($Get(receipt)) Set receipt={}
        Do receipt.%Set("status","INSPECTION_ERROR"),receipt.%Set("projection",{}),receipt.%Set("sourceId",request.SourceId)
    }
    // This is an inspection-attempt receipt, not source acceptance or an approval.
    Do receipt.%Set("actor",request.Actor)
    Set id=$Increment(^KnAIghtsHealthReceipt),response.RecordId=id,response.Status=receipt.%Get("status")
    Do receipt.%Set("recordId",id)
    Set response.ReceiptJson=receipt.%ToJSON(),^KnAIghtsHealthReceipt(id)=response.ReceiptJson
    Quit $$$OK
}

/// Reuse completed native command records rather than keeping a second DICOM event ledger.
Method DimseState() As %DynamicObject [ Private ]
{
    Set result={},rows=##class(%SQL.Statement).%ExecDirect(,"SELECT TOP 50 ID,SessionId,MessageBodyId FROM Ens.MessageHeader WHERE MessageBodyClassName='EnsLib.DICOM.Document' AND SourceConfigName='DicomIngress' AND TargetConfigName='DicomVerification' AND Status=9 ORDER BY ID DESC")
    While rows.%Next() {
        Set body=##class(EnsLib.DICOM.Document).%OpenId(rows.%Get("MessageBodyId"))
        If '$IsObject(body) Continue
        If body.GetValueAt("CommandSet.CommandField")'=48 Continue
        Set result={"sourceId":"dimse-ingress","kind":"dicom-dimse","operation":"C-ECHO","phase":"NATIVE_REQUEST_COMPLETED","objects":[],"scope":"synthetic"}
        Do result.%Set("nativeHeaderId",rows.%Get("ID")),result.%Set("nativeSessionId",rows.%Get("SessionId"))
        Do result.%Set("nativeBodyClass","EnsLib.DICOM.Document"),result.%Set("nativeBodyId",rows.%Get("MessageBodyId"))
        Do result.%Set("callingAET",body.SourceAET),result.%Set("messageId",body.GetValueAt("CommandSet.MessageID"))
        Quit
    }
    Quit result
}

XData MessageMap
{
<MapItems><MapItem MessageType="KnAIghts.Health.Request"><Method>Inspect</Method></MapItem></MapItems>
}
}

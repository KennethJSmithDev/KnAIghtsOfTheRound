Include %occStatus
Class KnAIghts.Seats.Service Extends Ens.BusinessService
{
Method OnProcessInput(input As %RegisteredObject, Output response As %RegisteredObject) As %Status
{
    If '$SYSTEM.Security.Check("KnAIghtsSeatUse","U") Quit $$$ERROR($$$GeneralError,"Seat access required")
    If '$SYSTEM.Security.Check("KnAIghtsSeatPropose","U") Quit $$$ERROR($$$GeneralError,"Seat proposal permission required")
    If '$IsObject(input) Quit $$$ERROR($$$GeneralError,"Seat request required")
    If 'input.%IsA("KnAIghts.Seats.Request") Quit $$$ERROR($$$GeneralError,"Seat request required")
    // Reauthenticate the person at final ingress; an earlier lease does not preserve revoked rights.
    Set input.Owner=$ZConvert($USERNAME,"L")
    Quit ..SendRequestSync("ValidateSeatProposal",input,.response,40)
}
}

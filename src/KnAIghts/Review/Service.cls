Include %occStatus

Class KnAIghts.Review.Service Extends Ens.BusinessService
{
Method OnProcessInput(input As %RegisteredObject, Output response As %RegisteredObject) As %Status
{
    If '$IsObject(input) Quit $$$ERROR($$$GeneralError, "Expected KnAIghts review request")
    If 'input.%IsA("KnAIghts.Review.Request") Quit $$$ERROR($$$GeneralError, "Expected KnAIghts review request")
    Quit ..SendRequestSync("AssessEvidence", input, .response, 240)
}
}

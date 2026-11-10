Class KnAIghts.Bonus.ReviewFlow Extends Ens.BusinessProcessBPL
{
/// The Workflow Engine owns the reviewer worklist and response. A response records
/// a review choice only; no semantic selection, source acceptance or task execution
/// follows from it. NoticeOperation rechecks the source and completed workflow task.
XData BPL
{
<process request='KnAIghts.Bonus.ReviewRequest' response='Ens.Response'>
  <context>
    <property name='Action' type='%String'/>
    <property name='Reviewer' type='%String'/>
    <property name='TaskId' type='%Integer'/>
  </context>
  <sequence>
    <call name='Request review' target='KnAIghtsReviewers' async='1'>
      <request type='EnsLib.Workflow.TaskRequest'>
        <assign property='callrequest.%Actions' value='"KnAIghtsReviewed,KnAIghtsDeclined"' action='set'/>
        <assign property='callrequest.%Subject' value='"Synthetic mismatch audit "_request.AuditId' action='set'/>
        <assign property='callrequest.%Message' value='"Review the synthetic source mismatch. This choice does not approve execution or verify a source selection."' action='set'/>
      </request>
      <response type='EnsLib.Workflow.TaskResponse'>
        <assign property='context.Action' value='callresponse.%Action' action='set'/>
        <assign property='context.Reviewer' value='callresponse.%UserName' action='set'/>
        <assign property='context.TaskId' value='callresponse.%Id()' action='set'/>
      </response>
    </call>
    <sync name='Await reviewer' calls='Request review' type='all'/>
    <call name='Write notice' target='KnAIghtsNotice' async='0'>
      <request type='KnAIghts.Bonus.NoticeRequest'>
        <assign property='callrequest.AuditId' value='request.AuditId' action='set'/>
        <assign property='callrequest.AuditJson' value='request.AuditJson' action='set'/>
        <assign property='callrequest.FactsJson' value='request.FactsJson' action='set'/>
        <assign property='callrequest.TaskId' value='context.TaskId' action='set'/>
        <assign property='callrequest.ReviewAction' value='context.Action' action='set'/>
        <assign property='callrequest.Reviewer' value='context.Reviewer' action='set'/>
      </request>
      <response type='Ens.Response'/>
    </call>
  </sequence>
</process>
}
}

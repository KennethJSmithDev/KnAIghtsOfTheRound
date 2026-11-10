Class KnAIghts.Context.ReviewFlow Extends Ens.BusinessProcessBPL
{
/// Related synthetic audits provide reviewer context only. The Workflow response
/// still records a choice, while NoticeOperation independently checks the source
/// evidence and completed task before writing a notice.
XData BPL
{
<process request='KnAIghts.Bonus.ReviewRequest' response='Ens.Response'>
  <context>
    <property name='Advisory' type='%String'><parameters><parameter name='MAXLEN' value='400'/></parameters></property>
    <property name='Action' type='%String'/>
    <property name='Reviewer' type='%String'><parameters><parameter name='MAXLEN' value='128'/></parameters></property>
    <property name='TaskId' type='%Integer'/>
  </context>
  <sequence>
    <call name='Find related case' target='KnAIghtsContext' async='0'>
      <request type='KnAIghts.Context.Request'>
        <assign property='callrequest.AuditId' value='request.AuditId' action='set'/>
      </request>
      <response type='KnAIghts.Context.Response'>
        <assign property='context.Advisory' value='callresponse.Summary' action='set'/>
      </response>
    </call>
    <call name='Request review' target='KnAIghtsReviewers' async='1'>
      <request type='EnsLib.Workflow.TaskRequest'>
        <assign property='callrequest.%Actions' value='"KnAIghtsReviewed,KnAIghtsDeclined"' action='set'/>
        <assign property='callrequest.%Subject' value='"Synthetic mismatch audit "_request.AuditId' action='set'/>
        <assign property='callrequest.%Message' value='"Review the synthetic source mismatch. "_context.Advisory_" This choice does not approve execution or verify a source selection."' action='set'/>
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

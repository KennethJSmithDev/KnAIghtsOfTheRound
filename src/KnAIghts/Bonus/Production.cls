Class KnAIghts.Bonus.Production Extends Ens.Production
{
/// Opt-in local prototype. The original KnAIghts.Review.Production remains unchanged.
/// Configure a private existing directory and Workflow users before submitting a review.
XData ProductionDefinition
{
<Production Name="KnAIghts.Bonus.Production" TestingEnabled="false">
  <Item Name="KnAIghtsEntry" ClassName="KnAIghts.Review.Service" PoolSize="0" Enabled="true"/>
  <Item Name="AssessEvidence" ClassName="KnAIghts.Review.Operation" PoolSize="1" Enabled="true"/>
  <Item Name="KnAIghtsBonusEntry" ClassName="KnAIghts.Bonus.Entry" PoolSize="0" Enabled="true"/>
  <Item Name="KnAIghtsReviewFlow" ClassName="KnAIghts.Bonus.ReviewFlow" PoolSize="1" Enabled="true"/>
  <Item Name="KnAIghtsReviewers" ClassName="EnsLib.Workflow.Operation" PoolSize="1" Enabled="true">
    <Setting Target="Host" Name="AutoCreateRole">1</Setting>
  </Item>
  <Item Name="KnAIghtsNotice" ClassName="KnAIghts.Bonus.NoticeOperation" PoolSize="1" Enabled="true"/>
</Production>
}
}

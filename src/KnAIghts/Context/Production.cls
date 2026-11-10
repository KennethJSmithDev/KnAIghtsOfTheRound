Class KnAIghts.Context.Production Extends Ens.Production
{
/// Opt-in extension. The default review production and previous Bonus production
/// remain separate. Configure the Java gateway and vector schema before use.
XData ProductionDefinition
{
<Production Name="KnAIghts.Context.Production" TestingEnabled="false">
  <Item Name="KnAIghtsEntry" ClassName="KnAIghts.Review.Service" PoolSize="0" Enabled="true"/>
  <Item Name="AssessEvidence" ClassName="KnAIghts.Review.Operation" PoolSize="1" Enabled="true"/>
  <Item Name="KnAIghtsBonusEntry" ClassName="KnAIghts.Bonus.Entry" PoolSize="0" Enabled="true"/>
  <Item Name="KnAIghtsLiveWorkflow" ClassName="KnAIghts.Context.LiveEntry" PoolSize="0" Enabled="true"/>
  <Item Name="KnAIghtsReviewFlow" ClassName="KnAIghts.Context.ReviewFlow" PoolSize="1" Enabled="true"/>
  <Item Name="KnAIghtsContext" ClassName="KnAIghts.Context.Operation" PoolSize="1" Enabled="true"/>
  <Item Name="KnAIghtsPex" ClassName="EnsLib.PEX.BusinessOperation" PoolSize="1" Enabled="true">
    <Setting Target="Host" Name="%remoteClassname">knaights.pex.RelatedCaseOperation</Setting>
    <Setting Target="Host" Name="%gatewayName">KnAIghtsJava</Setting>
  </Item>
  <Item Name="KnAIghtsReviewers" ClassName="EnsLib.Workflow.Operation" PoolSize="1" Enabled="true">
    <Setting Target="Host" Name="AutoCreateRole">1</Setting>
  </Item>
  <Item Name="KnAIghtsNotice" ClassName="KnAIghts.Bonus.NoticeOperation" PoolSize="1" Enabled="true"/>
</Production>
}
}

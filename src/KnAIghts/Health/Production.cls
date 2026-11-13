Class KnAIghts.Health.Production Extends Ens.Production
{
XData ProductionDefinition
{
<Production Name="KnAIghts.Health.Production" TestingEnabled="true" LogGeneralTraceEvents="false">
  <Item Name="HealthEntry" ClassName="KnAIghts.Health.Service" Enabled="true" PoolSize="0"/>
  <Item Name="InspectHealthSource" ClassName="KnAIghts.Health.Operation" Enabled="true" PoolSize="1"/>
</Production>
}
}

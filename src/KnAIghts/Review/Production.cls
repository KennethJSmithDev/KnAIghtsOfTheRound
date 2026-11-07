Class KnAIghts.Review.Production Extends Ens.Production
{
/// Ens.Director creates this adapterless entry on demand. Keep the service at PoolSize=0
/// and route the typed request to the queued operation. See the Build 154 dispatch witness
/// in docs/INTEROPERABILITY.md#qualification-evidence. Retest direct dispatch if the pool changes.
XData ProductionDefinition
{
<Production Name="KnAIghts.Review.Production" TestingEnabled="false">
  <Item Name="KnAIghtsEntry" ClassName="KnAIghts.Review.Service" PoolSize="0" Enabled="true"/>
  <Item Name="AssessEvidence" ClassName="KnAIghts.Review.Operation" PoolSize="1" Enabled="true"/>
</Production>
}
}

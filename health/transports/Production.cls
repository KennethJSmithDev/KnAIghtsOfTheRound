Class KnAIghts.Health.TransportProduction Extends Ens.Production
{
Parameter SETTINGS = "ShutdownTimeout,UpdateTimeout,StorageLocation";

Property StorageLocation As %String;

XData ProductionDefinition
{
<Production Name="KnAIghts.Health.TransportProduction" TestingEnabled="true" LogGeneralTraceEvents="false">
  <Item Name="HealthEntry" ClassName="KnAIghts.Health.Service" Enabled="true" PoolSize="0"/>
  <Item Name="InspectHealthSource" ClassName="KnAIghts.Health.Operation" Enabled="true" PoolSize="1"/>
  <Item Name="DicomIngress" ClassName="EnsLib.DICOM.Service.TCP" Enabled="true" PoolSize="1">
    <Setting Target="Host" Name="DuplexTargetConfigName">DicomVerification</Setting>
    <Setting Target="Adapter" Name="LocalInterface">127.0.0.1</Setting>
    <Setting Target="Adapter" Name="IPPort">11112</Setting>
    <Setting Target="Adapter" Name="LocalAET">KOTR_HEALTH</Setting>
    <Setting Target="Adapter" Name="RemoteAET">KOTR_FIXTURE</Setting>
    <Setting Target="Adapter" Name="ARTIM">5</Setting>
    <Setting Target="Adapter" Name="TXTIM">5</Setting>
  </Item>
  <Item Name="DicomVerification" ClassName="EnsLib.DICOM.Process" Enabled="true" PoolSize="1"/>
  <Item Name="MLLPIngress" ClassName="EnsLib.HL7.Service.TCPService" Enabled="true" PoolSize="1">
    <Setting Target="Adapter" Name="LocalInterface">127.0.0.1</Setting>
    <Setting Target="Adapter" Name="AllowedIPAddresses">127.0.0.1</Setting>
    <Setting Target="Adapter" Name="Port">11057</Setting>
    <Setting Target="Adapter" Name="ReadTimeout">5</Setting>
    <Setting Target="Adapter" Name="JobPerConnection">1</Setting>
    <Setting Target="Adapter" Name="QSize">4</Setting>
    <Setting Target="Host" Name="Framing">MLLP</Setting>
    <Setting Target="Host" Name="AckMode">App</Setting>
    <Setting Target="Host" Name="UseAckCommitCodes">0</Setting>
    <Setting Target="Host" Name="MessageSchemaCategory">2.5</Setting>
    <Setting Target="Host" Name="TargetConfigNames">RecordMLLP</Setting>
    <Setting Target="Host" Name="SaveReplies">All</Setting>
  </Item>
  <Item Name="RecordMLLP" ClassName="KnAIghts.Health.MLLPOperation" Enabled="true" PoolSize="1"/>
</Production>
}
}

Class KnAIghts.Review.CodexMCP Extends %AI.MCP.Service
{
/// The owned MCP application maps the seat role to a USER database write grant for
/// message persistence. The grant covers the database during application execution.
/// See the Codex seat witness in docs/INTEROPERABILITY.md#qualification-evidence.
/// Recheck effective roles and cross-application write denial before changing this boundary.
Parameter SPECIFICATION As STRING = "KnAIghts.Review.CodexTools";
}

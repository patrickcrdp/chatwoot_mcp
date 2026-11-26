import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ChatwootTools } from "./chatwoot-tools.js";

interface WorkerEnv {
	CHATWOOT_BASE_URL?: string;
	CHATWOOT_API_TOKEN?: string;
	CHATWOOT_ACCOUNT_ID?: string;
	CHATWOOT_ALLOWED_INBOX_IDS?: string;
}

export class MyMCP extends McpAgent<WorkerEnv> {
	server = new McpServer({
		name: "CRDP Chatwoot MCP",
		version: "1.1.0",
	});

	async init() {
		const envVars = (this as unknown as { env?: WorkerEnv }).env ?? {};
		new ChatwootTools(this.server, {
			baseUrl: envVars.CHATWOOT_BASE_URL,
			apiToken: envVars.CHATWOOT_API_TOKEN,
			accountId: envVars.CHATWOOT_ACCOUNT_ID,
			allowedInboxIds: envVars.CHATWOOT_ALLOWED_INBOX_IDS,
		});
	}
}

export default MyMCP.mount("/sse");

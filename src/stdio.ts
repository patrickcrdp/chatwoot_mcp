import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ChatwootTools, type ChatwootConfigInput } from "./chatwoot-tools.js";

function readDotEnv(): Record<string, string> {
	const currentDir = dirname(fileURLToPath(import.meta.url));
	const envPath = resolve(currentDir, "..", ".env");
	const parsed: Record<string, string> = {};
	if (!existsSync(envPath)) return parsed;

	const raw = readFileSync(envPath, "utf8");
	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eqIdx = trimmed.indexOf("=");
		if (eqIdx === -1) continue;
		const key = trimmed.slice(0, eqIdx).trim();
		let val = trimmed.slice(eqIdx + 1).trim();
		if (
			(val.startsWith('"') && val.endsWith('"')) ||
			(val.startsWith("'") && val.endsWith("'"))
		) {
			val = val.slice(1, -1);
		}
		parsed[key] = val;
	}
	return parsed;
}

function resolveConfigFromEnv(): ChatwootConfigInput {
	const fileEnv = readDotEnv();
	return {
		baseUrl: fileEnv.CHATWOOT_BASE_URL || process.env.CHATWOOT_BASE_URL,
		apiToken: fileEnv.CHATWOOT_API_TOKEN || process.env.CHATWOOT_API_TOKEN,
		accountId: fileEnv.CHATWOOT_ACCOUNT_ID || process.env.CHATWOOT_ACCOUNT_ID || "1",
		allowedInboxIds:
			fileEnv.CHATWOOT_ALLOWED_INBOX_IDS || process.env.CHATWOOT_ALLOWED_INBOX_IDS,
	};
}

async function main() {
	const server = new McpServer({
		name: "Chatwoot MCP",
		version: "1.1.0",
	});

	new ChatwootTools(server, resolveConfigFromEnv(), resolveConfigFromEnv);

	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch((err) => {
	console.error("Fatal error starting CRDP Chatwoot MCP:", err);
	process.exit(1);
});

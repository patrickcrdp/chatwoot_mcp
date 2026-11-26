import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface ChatwootConfigInput {
	baseUrl?: string;
	apiToken?: string;
	accountId?: string;
	allowedInboxIds?: string;
}

export interface ChatwootConfig {
	baseUrl: string;
	apiToken: string;
	accountId: string;
	allowedInboxIds: Set<number> | null;
}

function parseAllowedInboxes(raw?: string): Set<number> | null {
	if (!raw || !raw.trim()) return null;
	const ids = raw
		.split(",")
		.map((s) => Number.parseInt(s.trim(), 10))
		.filter((n) => Number.isFinite(n) && n > 0);
	return ids.length > 0 ? new Set(ids) : null;
}

function normalizeBaseUrl(url: string): string {
	return url.trim().replace(/\/+$/, "");
}

export class ChatwootTools {
	private server: McpServer;
	private config: ChatwootConfig | null = null;
	private configLoader?: () => ChatwootConfigInput;

	constructor(
		server: McpServer,
		initial?: ChatwootConfigInput,
		configLoader?: () => ChatwootConfigInput
	) {
		this.server = server;
		this.configLoader = configLoader;
		this.applyInputConfig(initial);
		this.registerTools();
	}

	private applyInputConfig(input?: ChatwootConfigInput) {
		if (
			input?.baseUrl &&
			input?.apiToken &&
			input.apiToken !== "COLE_SEU_TOKEN_AQUI"
		) {
			this.config = {
				baseUrl: normalizeBaseUrl(input.baseUrl),
				apiToken: input.apiToken.trim(),
				accountId: (input.accountId || "1").trim(),
				allowedInboxIds: parseAllowedInboxes(input.allowedInboxIds),
			};
		}
	}

	private requireConfig(): ChatwootConfig {
		if ((!this.config || !this.config.apiToken) && this.configLoader) {
			this.applyInputConfig(this.configLoader());
		}
		if (!this.config || !this.config.apiToken || !this.config.baseUrl) {
			throw new Error(
				"Chatwoot não configurado. Defina CHATWOOT_BASE_URL e CHATWOOT_API_TOKEN no arquivo .env / variáveis de ambiente ou chame chatwoot_setup."
			);
		}
		return this.config;
	}

	private assertInboxAllowed(inboxId?: number) {
		const cfg = this.requireConfig();
		if (inboxId !== undefined && cfg.allowedInboxIds && !cfg.allowedInboxIds.has(inboxId)) {
			throw new Error(
				`Acesso bloqueado pela política LGPD (CHATWOOT_ALLOWED_INBOX_IDS): inbox_id ${inboxId} não está na lista permitida.`
			);
		}
	}

	private async request<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
		const cfg = this.requireConfig();
		const url = `${cfg.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

		const response = await fetch(url, {
			...options,
			headers: {
				api_access_token: cfg.apiToken,
				"Content-Type": "application/json",
				...(options.headers || {}),
			},
		});

		if (!response.ok) {
			const bodyText = await response.text().catch(() => "");
			throw new Error(
				`Erro Chatwoot HTTP ${response.status} (${response.statusText}) em ${path}: ${bodyText.slice(0, 500)}`
			);
		}

		if (response.status === 204) {
			return { ok: true } as T;
		}

		const text = await response.text();
		if (!text) return { ok: true } as T;
		try {
			return JSON.parse(text) as T;
		} catch {
			return { raw: text } as T;
		}
	}

	private okJson(data: unknown) {
		return {
			content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
		};
	}

	private summarizeConversation(conv: Record<string, any>) {
		const meta = conv.meta || {};
		const sender = meta.sender || {};
		const assignee = meta.assignee || null;
		const team = meta.team || null;
		const messages = Array.isArray(conv.messages) ? conv.messages : [];
		const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;

		return {
			id: conv.id,
			inbox_id: conv.inbox_id,
			status: conv.status,
			priority: conv.priority ?? null,
			unread_count: conv.unread_count ?? 0,
			labels: conv.labels ?? [],
			custom_attributes: conv.custom_attributes ?? {},
			created_at: conv.created_at,
			last_activity_at: conv.last_activity_at,
			waiting_since: conv.waiting_since ?? null,
			contact: {
				id: sender.id,
				name: sender.name,
				phone_number: sender.phone_number,
				email: sender.email,
				custom_attributes: sender.custom_attributes ?? {},
			},
			assignee: assignee ? { id: assignee.id, name: assignee.name, email: assignee.email } : null,
			team: team ? { id: team.id, name: team.name } : null,
			last_message: lastMsg
				? {
						id: lastMsg.id,
						message_type: lastMsg.message_type,
						private: Boolean(lastMsg.private),
						created_at: lastMsg.created_at,
						content:
							typeof lastMsg.content === "string"
								? lastMsg.content.slice(0, 280)
								: null,
					}
				: null,
		};
	}

	private registerTools() {
		// 1. Setup / Override opcional em runtime
		this.server.tool(
			"chatwoot_setup",
			"Configura ou atualiza em memória a conexão com o Chatwoot (opcional se já configurado via variáveis de ambiente).",
			{
				baseUrl: z.string(),
				apiToken: z.string(),
				accountId: z.string().default("1"),
				allowedInboxIds: z.string().optional(),
			},
			async ({ baseUrl, apiToken, accountId, allowedInboxIds }) => {
				this.config = {
					baseUrl: normalizeBaseUrl(baseUrl),
					apiToken: apiToken.trim(),
					accountId: accountId.trim(),
					allowedInboxIds: parseAllowedInboxes(allowedInboxIds),
				};
				const profile = await this.request<Record<string, any>>("/api/v1/profile");
				return this.okJson({
					configured: true,
					baseUrl: this.config.baseUrl,
					accountId: this.config.accountId,
					user: {
						id: profile.id,
						name: profile.name,
						email: profile.email,
						role: profile.role,
					},
				});
			}
		);

		// 2. Perfil e diagnóstico de autenticação
		this.server.tool(
			"chatwoot_get_profile",
			"Verifica o perfil do usuário autenticado, permissões e contas vinculadas no Chatwoot.",
			{},
			async () => {
				const profile = await this.request("/api/v1/profile");
				return this.okJson(profile);
			}
		);

		// 3. Caixas de entrada (Inboxes)
		this.server.tool(
			"chatwoot_list_inboxes",
			"Lista todas as caixas de entrada (canais) da conta Chatwoot e suas configurações.",
			{},
			async () => {
				const cfg = this.requireConfig();
				const res = await this.request<{ payload?: any[] }>(
					`/api/v1/accounts/${cfg.accountId}/inboxes`
				);
				const list = Array.isArray(res?.payload) ? res.payload : (res as any);
				const filtered =
					cfg.allowedInboxIds && Array.isArray(list)
						? list.filter((i) => cfg.allowedInboxIds!.has(i.id))
						: list;
				return this.okJson(filtered);
			}
		);

		this.server.tool(
			"chatwoot_update_inbox",
			"Atualiza configurações de uma caixa de entrada (nome, auto-assignment, saudação automática, reabertura após resolvido).",
			{
				inbox_id: z.number(),
				name: z.string().optional(),
				enable_auto_assignment: z.boolean().optional(),
				greeting_enabled: z.boolean().optional(),
				greeting_message: z.string().optional(),
				allow_messages_after_resolved: z.boolean().optional(),
				lock_to_single_conversation: z.boolean().optional(),
			},
			async ({ inbox_id, ...fields }) => {
				this.assertInboxAllowed(inbox_id);
				const cfg = this.requireConfig();
				const res = await this.request(
					`/api/v1/accounts/${cfg.accountId}/inboxes/${inbox_id}`,
					{
						method: "PATCH",
						body: JSON.stringify(fields),
					}
				);
				return this.okJson(res);
			}
		);

		// 4. Agentes Humanos
		this.server.tool(
			"chatwoot_list_agents",
			"Lista todos os agentes cadastrados na conta Chatwoot (ID, nome, e-mail, papel administrator/agent e disponibilidade).",
			{},
			async () => {
				const cfg = this.requireConfig();
				const res = await this.request(`/api/v1/accounts/${cfg.accountId}/agents`);
				return this.okJson(res);
			}
		);

		// 5. Times (Teams) e Membros
		this.server.tool(
			"chatwoot_list_teams",
			"Lista todos os times configurados no Chatwoot (ex.: Acolhimento, Administrativo, Callcenter, Parlamentares).",
			{},
			async () => {
				const cfg = this.requireConfig();
				const res = await this.request(`/api/v1/accounts/${cfg.accountId}/teams`);
				return this.okJson(res);
			}
		);

		this.server.tool(
			"chatwoot_upsert_team",
			"Cria um novo time (se team_id omitido) ou atualiza um time existente no Chatwoot.",
			{
				team_id: z.number().optional(),
				name: z.string(),
				description: z.string().optional(),
				allow_auto_assign: z.boolean().default(true),
			},
			async ({ team_id, name, description, allow_auto_assign }) => {
				const cfg = this.requireConfig();
				const path = team_id
					? `/api/v1/accounts/${cfg.accountId}/teams/${team_id}`
					: `/api/v1/accounts/${cfg.accountId}/teams`;
				const res = await this.request(path, {
					method: team_id ? "PATCH" : "POST",
					body: JSON.stringify({ name, description, allow_auto_assign }),
				});
				return this.okJson(res);
			}
		);

		this.server.tool(
			"chatwoot_manage_team_members",
			"Lista, adiciona ou remove agentes de um time no Chatwoot.",
			{
				team_id: z.number(),
				action: z.enum(["list", "add", "remove"]),
				user_ids: z.array(z.number()).optional(),
			},
			async ({ team_id, action, user_ids }) => {
				const cfg = this.requireConfig();
				const basePath = `/api/v1/accounts/${cfg.accountId}/teams/${team_id}/team_members`;
				if (action === "list") {
					return this.okJson(await this.request(basePath));
				}
				if (!user_ids || user_ids.length === 0) {
					throw new Error("Informe user_ids para adicionar ou remover membros do time.");
				}
				const res = await this.request(basePath, {
					method: action === "add" ? "POST" : "DELETE",
					body: JSON.stringify({ user_ids }),
				});
				return this.okJson(res);
			}
		);

		// 6. Etiquetas da Conta (Account Labels CRUD)
		this.server.tool(
			"chatwoot_list_labels",
			"Lista todas as etiquetas (labels) cadastradas na conta Chatwoot, com cores, descrições e visibilidade na barra lateral.",
			{},
			async () => {
				const cfg = this.requireConfig();
				const res = await this.request(`/api/v1/accounts/${cfg.accountId}/labels`);
				return this.okJson(res);
			}
		);

		this.server.tool(
			"chatwoot_upsert_label",
			"Cria uma nova etiqueta na conta (se label_id omitido) ou edita uma etiqueta existente (título snake_case, descrição, cor hex e exibição na sidebar).",
			{
				label_id: z.number().optional(),
				title: z.string(),
				description: z.string().optional(),
				color: z.string().default("#1f93ff"),
				show_on_sidebar: z.boolean().default(true),
			},
			async ({ label_id, title, description, color, show_on_sidebar }) => {
				const cfg = this.requireConfig();
				const path = label_id
					? `/api/v1/accounts/${cfg.accountId}/labels/${label_id}`
					: `/api/v1/accounts/${cfg.accountId}/labels`;
				const res = await this.request(path, {
					method: label_id ? "PATCH" : "POST",
					body: JSON.stringify({ title, description, color, show_on_sidebar }),
				});
				return this.okJson(res);
			}
		);

		this.server.tool(
			"chatwoot_delete_label",
			"Remove uma etiqueta da conta Chatwoot pelo ID.",
			{
				label_id: z.number(),
			},
			async ({ label_id }) => {
				const cfg = this.requireConfig();
				const res = await this.request(
					`/api/v1/accounts/${cfg.accountId}/labels/${label_id}`,
					{ method: "DELETE" }
				);
				return this.okJson(res);
			}
		);

		// 7. Definições de Atributos Personalizados & Respostas Rápidas (Canned Responses)
		this.server.tool(
			"chatwoot_list_custom_attributes",
			"Lista as definições de atributos personalizados da conta (0 = conversa, 1 = contato).",
			{
				attribute_model: z.enum(["conversation_attribute", "contact_attribute"]).optional(),
			},
			async ({ attribute_model }) => {
				const cfg = this.requireConfig();
				const qs = attribute_model
					? `?attribute_model=${attribute_model === "conversation_attribute" ? 0 : 1}`
					: "";
				const res = await this.request(
					`/api/v1/accounts/${cfg.accountId}/custom_attribute_definitions${qs}`
				);
				return this.okJson(res);
			}
		);

		this.server.tool(
			"chatwoot_create_custom_attribute",
			"Cria uma nova definição de atributo personalizado para conversas ou contatos (ex.: consent_status, segmento_crdp, mantenedor_carne).",
			{
				attribute_display_name: z.string(),
				attribute_key: z.string(),
				attribute_description: z.string().optional(),
				attribute_model: z.enum(["conversation_attribute", "contact_attribute"]),
				attribute_display_type: z
					.enum(["text", "number", "currency", "percent", "link", "date", "list", "checkbox"])
					.default("text"),
				attribute_values: z.array(z.string()).optional(),
			},
			async (input) => {
				const cfg = this.requireConfig();
				const modelCode = input.attribute_model === "conversation_attribute" ? 0 : 1;
				const typeMap: Record<string, number> = {
					text: 0,
					number: 1,
					currency: 2,
					percent: 3,
					link: 4,
					date: 5,
					list: 6,
					checkbox: 7,
				};
				const res = await this.request(
					`/api/v1/accounts/${cfg.accountId}/custom_attribute_definitions`,
					{
						method: "POST",
						body: JSON.stringify({
							attribute_display_name: input.attribute_display_name,
							attribute_key: input.attribute_key,
							attribute_description: input.attribute_description,
							attribute_model: modelCode,
							attribute_display_type: typeMap[input.attribute_display_type],
							attribute_values: input.attribute_values,
						}),
					}
				);
				return this.okJson(res);
			}
		);

		this.server.tool(
			"chatwoot_list_canned_responses",
			"Lista todas as respostas rápidas (atalhos '/') cadastradas no Chatwoot.",
			{},
			async () => {
				const cfg = this.requireConfig();
				const res = await this.request(
					`/api/v1/accounts/${cfg.accountId}/canned_responses`
				);
				return this.okJson(res);
			}
		);

		this.server.tool(
			"chatwoot_upsert_canned_response",
			"Cria ou atualiza uma resposta rápida (atalho short_code e texto content) para padronizar o atendimento da equipe.",
			{
				canned_response_id: z.number().optional(),
				short_code: z.string(),
				content: z.string(),
			},
			async ({ canned_response_id, short_code, content }) => {
				const cfg = this.requireConfig();
				const path = canned_response_id
					? `/api/v1/accounts/${cfg.accountId}/canned_responses/${canned_response_id}`
					: `/api/v1/accounts/${cfg.accountId}/canned_responses`;
				const res = await this.request(path, {
					method: canned_response_id ? "PATCH" : "POST",
					body: JSON.stringify({ short_code, content }),
				});
				return this.okJson(res);
			}
		);

		// 8. Regras de Automação (Automation Rules)
		this.server.tool(
			"chatwoot_list_automation_rules",
			"Lista todas as regras de automação nativas configuradas no Chatwoot (roteamento por canal, etiquetagem automática, atribuição a times).",
			{},
			async () => {
				const cfg = this.requireConfig();
				const res = await this.request(
					`/api/v1/accounts/${cfg.accountId}/automation_rules`
				);
				return this.okJson(res);
			}
		);

		this.server.tool(
			"chatwoot_upsert_automation_rule",
			"Cria ou atualiza uma regra de automação nativa no Chatwoot (eventos conversation_created, conversation_updated, message_created).",
			{
				rule_id: z.number().optional(),
				name: z.string(),
				description: z.string().optional(),
				event_name: z.enum([
					"conversation_created",
					"conversation_updated",
					"message_created",
					"conversation_opened",
				]),
				active: z.boolean().default(true),
				conditions: z.array(
					z.object({
						attribute_key: z.string(),
						filter_operator: z.string(),
						values: z.array(z.any()),
						query_operator: z.enum(["AND", "OR"]).nullable().optional(),
					})
				),
				actions: z.array(
					z.object({
						action_name: z.string(),
						action_params: z.array(z.any()).optional(),
					})
				),
			},
			async ({ rule_id, ...payload }) => {
				const cfg = this.requireConfig();
				const path = rule_id
					? `/api/v1/accounts/${cfg.accountId}/automation_rules/${rule_id}`
					: `/api/v1/accounts/${cfg.accountId}/automation_rules`;
				const res = await this.request(path, {
					method: rule_id ? "PATCH" : "POST",
					body: JSON.stringify(payload),
				});
				return this.okJson(res);
			}
		);

		// 9. Métricas / Contadores e Listagem de Conversas
		this.server.tool(
			"chatwoot_get_conversation_counts",
			"Retorna os contadores exatos de conversas (minhas, não atribuídas, atribuídas e todas) filtrando por status, inbox_id, team_id ou etiquetas.",
			{
				status: z.enum(["open", "resolved", "pending", "snoozed", "all"]).default("open"),
				inbox_id: z.number().optional(),
				team_id: z.number().optional(),
				labels: z.array(z.string()).optional(),
			},
			async ({ status, inbox_id, team_id, labels }) => {
				this.assertInboxAllowed(inbox_id);
				const cfg = this.requireConfig();
				const params = new URLSearchParams({ status });
				if (inbox_id) params.append("inbox_id", String(inbox_id));
				if (team_id) params.append("team_id", String(team_id));
				if (labels) {
					for (const lbl of labels) params.append("labels[]", lbl);
				}
				const res = await this.request(
					`/api/v1/accounts/${cfg.accountId}/conversations/meta?${params.toString()}`
				);
				return this.okJson(res);
			}
		);

		this.server.tool(
			"chatwoot_list_conversations",
			"Lista conversas com paginação e filtros (status, assignee_type: me/unassigned/all/assigned, inbox_id, team_id, labels, busca q). Usa resumo compacto por padrão para facilitar auditoria de centenas de conversas.",
			{
				status: z.enum(["open", "resolved", "pending", "snoozed", "all"]).default("open"),
				assignee_type: z.enum(["me", "unassigned", "all", "assigned"]).default("all"),
				inbox_id: z.number().optional(),
				team_id: z.number().optional(),
				labels: z.array(z.string()).optional(),
				q: z.string().optional(),
				sort_by: z
					.enum([
						"last_activity_at_desc",
						"last_activity_at_asc",
						"created_at_desc",
						"created_at_asc",
						"priority_desc",
						"waiting_since_asc",
					])
					.optional(),
				page: z.number().int().min(1).default(1),
				compact: z.boolean().default(true),
			},
			async ({ status, assignee_type, inbox_id, team_id, labels, q, sort_by, page, compact }) => {
				this.assertInboxAllowed(inbox_id);
				const cfg = this.requireConfig();
				const params = new URLSearchParams({
					status,
					assignee_type,
					page: String(page),
				});
				if (inbox_id) params.append("inbox_id", String(inbox_id));
				if (team_id) params.append("team_id", String(team_id));
				if (q) params.append("q", q);
				if (sort_by) params.append("sort_by", sort_by);
				if (labels) {
					for (const lbl of labels) params.append("labels[]", lbl);
				}

				const res = await this.request<Record<string, any>>(
					`/api/v1/accounts/${cfg.accountId}/conversations?${params.toString()}`
				);
				const data = res?.data || res;
				const rawPayload: any[] = Array.isArray(data?.payload) ? data.payload : [];
				const visiblePayload = cfg.allowedInboxIds
					? rawPayload.filter((c) => cfg.allowedInboxIds!.has(c.inbox_id))
					: rawPayload;

				if (!compact) {
					return this.okJson({ meta: data?.meta, payload: visiblePayload });
				}

				return this.okJson({
					page,
					meta: data?.meta,
					count_in_page: visiblePayload.length,
					conversations: visiblePayload.map((c) => this.summarizeConversation(c)),
				});
			}
		);

		// 10. Detalhes e Histórico de Mensagens de uma Conversa
		this.server.tool(
			"chatwoot_get_conversation_messages",
			"Obtém os metadados completos de uma conversa e todo o histórico de mensagens (incluindo notas privadas internas).",
			{
				conversation_id: z.number(),
			},
			async ({ conversation_id }) => {
				const cfg = this.requireConfig();
				const conv = await this.request<Record<string, any>>(
					`/api/v1/accounts/${cfg.accountId}/conversations/${conversation_id}`
				);
				this.assertInboxAllowed(conv.inbox_id);
				const msgs = await this.request<Record<string, any>>(
					`/api/v1/accounts/${cfg.accountId}/conversations/${conversation_id}/messages`
				);
				const list = Array.isArray(msgs?.payload) ? msgs.payload : [];
				return this.okJson({
					conversation: this.summarizeConversation(conv),
					messages: list.map((m: any) => ({
						id: m.id,
						created_at: m.created_at,
						message_type: m.message_type,
						private: Boolean(m.private),
						sender_type: m.sender_type,
						sender_name: m.sender?.name ?? null,
						content: m.content,
						attachments: Array.isArray(m.attachments)
							? m.attachments.map((a: any) => ({
									file_type: a.file_type,
									data_url: a.data_url,
								}))
							: [],
					})),
				});
			}
		);

		// 11. Enviar Mensagem ou Nota Interna Privada
		this.server.tool(
			"chatwoot_send_message",
			"Envia uma mensagem na conversa ou cria uma nota privada amarela interna (private: true, invisível ao contato no WhatsApp).",
			{
				conversation_id: z.number(),
				message: z.string(),
				private: z.boolean().default(false),
				message_type: z.enum(["outgoing", "incoming"]).default("outgoing"),
			},
			async ({ conversation_id, message, private: isPrivate, message_type }) => {
				const cfg = this.requireConfig();
				if (cfg.allowedInboxIds) {
					const conv = await this.request<Record<string, any>>(
						`/api/v1/accounts/${cfg.accountId}/conversations/${conversation_id}`
					);
					this.assertInboxAllowed(conv.inbox_id);
				}
				const res = await this.request(
					`/api/v1/accounts/${cfg.accountId}/conversations/${conversation_id}/messages`,
					{
						method: "POST",
						body: JSON.stringify({
							content: message,
							message_type,
							private: isPrivate,
						}),
					}
				);
				return this.okJson(res);
			}
		);

		// 12. Alterar Status, Atribuição, Etiquetas e Triagem em Lote
		this.server.tool(
			"chatwoot_update_conversation",
			"Atualiza o status de uma conversa via endpoint oficial toggle_status (open, resolved, pending, snoozed) e/ou sua prioridade.",
			{
				conversation_id: z.number(),
				status: z.enum(["open", "resolved", "pending", "snoozed"]).optional(),
				snoozed_until: z.number().optional(),
				priority: z.enum(["none", "low", "medium", "high", "urgent"]).optional(),
			},
			async ({ conversation_id, status, snoozed_until, priority }) => {
				const cfg = this.requireConfig();
				const results: Record<string, unknown> = {};
				if (status) {
					results.status_update = await this.request(
						`/api/v1/accounts/${cfg.accountId}/conversations/${conversation_id}/toggle_status`,
						{
							method: "POST",
							body: JSON.stringify({
								status,
								...(snoozed_until ? { snoozed_until } : {}),
							}),
						}
					);
				}
				if (priority) {
					results.priority_update = await this.request(
						`/api/v1/accounts/${cfg.accountId}/conversations/${conversation_id}`,
						{
							method: "PATCH",
							body: JSON.stringify({
								priority: priority === "none" ? null : priority,
							}),
						}
					);
				}
				return this.okJson(results);
			}
		);

		this.server.tool(
			"chatwoot_assign_conversation",
			"Atribui ou desatribui uma conversa a um agente humano (assignee_id) e/ou a um time (team_id).",
			{
				conversation_id: z.number(),
				assignee_id: z.number().nullable().optional(),
				team_id: z.number().nullable().optional(),
			},
			async ({ conversation_id, assignee_id, team_id }) => {
				const cfg = this.requireConfig();
				const body: Record<string, unknown> = {};
				if (assignee_id !== undefined) body.assignee_id = assignee_id ?? 0;
				if (team_id !== undefined) body.team_id = team_id ?? 0;

				const res = await this.request(
					`/api/v1/accounts/${cfg.accountId}/conversations/${conversation_id}/assignments`,
					{
						method: "POST",
						body: JSON.stringify(body),
					}
				);
				return this.okJson(res);
			}
		);

		this.server.tool(
			"chatwoot_set_conversation_labels",
			"Define ou adiciona etiquetas a uma conversa específica (se append: true, preserva as etiquetas atuais).",
			{
				conversation_id: z.number(),
				labels: z.array(z.string()),
				append: z.boolean().default(true),
			},
			async ({ conversation_id, labels, append }) => {
				const cfg = this.requireConfig();
				let finalLabels = labels;
				if (append) {
					const existing = await this.request<{ payload?: string[] }>(
						`/api/v1/accounts/${cfg.accountId}/conversations/${conversation_id}/labels`
					);
					const current = Array.isArray(existing?.payload) ? existing.payload : [];
					finalLabels = Array.from(new Set([...current, ...labels]));
				}
				const res = await this.request(
					`/api/v1/accounts/${cfg.accountId}/conversations/${conversation_id}/labels`,
					{
						method: "POST",
						body: JSON.stringify({ labels: finalLabels }),
					}
				);
				return this.okJson(res);
			}
		);

		this.server.tool(
			"chatwoot_bulk_triage_conversations",
			"Executa organização em lote em múltiplas conversas (até 50 por chamada): alterar status (ex.: resolved), atribuir team_id/assignee_id, adicionar etiquetas e/ou registrar nota privada de auditoria.",
			{
				conversation_ids: z.array(z.number()).min(1).max(50),
				status: z.enum(["open", "resolved", "pending", "snoozed"]).optional(),
				assignee_id: z.number().nullable().optional(),
				team_id: z.number().nullable().optional(),
				add_labels: z.array(z.string()).optional(),
				private_note: z.string().optional(),
			},
			async ({ conversation_ids, status, assignee_id, team_id, add_labels, private_note }) => {
				const cfg = this.requireConfig();
				const summary: Array<{ id: number; ok: boolean; error?: string }> = [];

				for (const id of conversation_ids) {
					try {
						if (private_note) {
							await this.request(
								`/api/v1/accounts/${cfg.accountId}/conversations/${id}/messages`,
								{
									method: "POST",
									body: JSON.stringify({
										content: private_note,
										message_type: "outgoing",
										private: true,
									}),
								}
							);
						}
						if (add_labels && add_labels.length > 0) {
							const existing = await this.request<{ payload?: string[] }>(
								`/api/v1/accounts/${cfg.accountId}/conversations/${id}/labels`
							);
							const current = Array.isArray(existing?.payload) ? existing.payload : [];
							const merged = Array.from(new Set([...current, ...add_labels]));
							await this.request(
								`/api/v1/accounts/${cfg.accountId}/conversations/${id}/labels`,
								{
									method: "POST",
									body: JSON.stringify({ labels: merged }),
								}
							);
						}
						if (assignee_id !== undefined || team_id !== undefined) {
							const assignBody: Record<string, unknown> = {};
							if (assignee_id !== undefined) assignBody.assignee_id = assignee_id ?? 0;
							if (team_id !== undefined) assignBody.team_id = team_id ?? 0;
							await this.request(
								`/api/v1/accounts/${cfg.accountId}/conversations/${id}/assignments`,
								{
									method: "POST",
									body: JSON.stringify(assignBody),
								}
							);
						}
						if (status) {
							await this.request(
								`/api/v1/accounts/${cfg.accountId}/conversations/${id}/toggle_status`,
								{
									method: "POST",
									body: JSON.stringify({ status }),
								}
							);
						}
						summary.push({ id, ok: true });
					} catch (err: any) {
						summary.push({ id, ok: false, error: err?.message || String(err) });
					}
				}

				return this.okJson({
					total: conversation_ids.length,
					succeeded: summary.filter((s) => s.ok).length,
					failed: summary.filter((s) => !s.ok).length,
					details: summary,
				});
			}
		);

		// 13. Contatos (Busca, Atualização, Atributos e Etiquetas)
		this.server.tool(
			"chatwoot_search_contacts",
			"Busca contatos no Chatwoot por nome, telefone, e-mail ou identificador (ou lista todos se q omitido).",
			{
				q: z.string().optional(),
				page: z.number().int().min(1).default(1),
			},
			async ({ q, page }) => {
				const cfg = this.requireConfig();
				const path = q
					? `/api/v1/accounts/${cfg.accountId}/contacts/search?q=${encodeURIComponent(q)}&page=${page}`
					: `/api/v1/accounts/${cfg.accountId}/contacts?page=${page}`;
				const res = await this.request(path);
				return this.okJson(res);
			}
		);

		this.server.tool(
			"chatwoot_update_contact",
			"Atualiza dados cadastrais, custom_attributes (ex.: consent_status, segmento_crdp) e etiquetas de um contato no Chatwoot.",
			{
				contact_id: z.number(),
				name: z.string().optional(),
				email: z.string().optional(),
				phone_number: z.string().optional(),
				custom_attributes: z.record(z.any()).optional(),
				labels: z.array(z.string()).optional(),
				append_labels: z.boolean().default(true),
			},
			async ({ contact_id, labels, append_labels, ...fields }) => {
				const cfg = this.requireConfig();
				const out: Record<string, unknown> = {};
				if (Object.keys(fields).length > 0) {
					out.contact = await this.request(
						`/api/v1/accounts/${cfg.accountId}/contacts/${contact_id}`,
						{
							method: "PUT",
							body: JSON.stringify(fields),
						}
					);
				}
				if (labels) {
					let finalLabels = labels;
					if (append_labels) {
						const existing = await this.request<{ payload?: string[] }>(
							`/api/v1/accounts/${cfg.accountId}/contacts/${contact_id}/labels`
						);
						const current = Array.isArray(existing?.payload) ? existing.payload : [];
						finalLabels = Array.from(new Set([...current, ...labels]));
					}
					out.labels = await this.request(
						`/api/v1/accounts/${cfg.accountId}/contacts/${contact_id}/labels`,
						{
							method: "POST",
							body: JSON.stringify({ labels: finalLabels }),
						}
					);
				}
				return this.okJson(out);
			}
		);
	}
}

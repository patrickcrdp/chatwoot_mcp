# Chatwoot MCP Server (`v1.1.0`)

Servidor **Model Context Protocol (MCP)** completo para organizar, auditar e gerenciar instâncias do **Chatwoot** via clientes MCP locais (**Antigravity**, **Claude Desktop**, **Cursor**) ou remotos (**Cloudflare Workers**, **Docker**, **n8n**).

## Destaques da Versão `1.1.0`

- **Autenticação segura por variáveis de ambiente (`.env`)** com recarregamento automático (sem expor tokens no prompt da IA).
- **Transporte `Stdio` nativo em Node.js** (`dist/stdio.js`) para execução local imediata, mantendo compatibilidade com **Cloudflare Workers** (`src/index.ts`) e **Docker** (`Dockerfile` / `docker-compose.yml`).
- **27 ferramentas administrativas e operacionais** cobrindo canais, agentes, times, etiquetas, atributos personalizados, respostas rápidas, regras de automação, notas privadas internas (`private: true`) e triagem de conversas em lote.
- **Governança e LGPD (`CHATWOOT_ALLOWED_INBOX_IDS`)**: trava opcional para limitar quais caixas de entrada um agente automatizado pode acessar.

---

## Catálogo de 27 Ferramentas MCP

### Diagnóstico, Canais e Equipes
- `chatwoot_get_profile` — Verifica perfil, permissões e contas vinculadas ao token.
- `chatwoot_setup` — Override opcional de credenciais em memória (`baseUrl`, `apiToken`, `accountId`).
- `chatwoot_list_inboxes` — Lista caixas de entrada e suas configurações.
- `chatwoot_update_inbox` — Atualiza nome, `enable_auto_assignment`, saudação automática e `lock_to_single_conversation`.
- `chatwoot_list_agents` — Lista todos os atendentes humanos, papéis (`administrator`/`agent`) e disponibilidade.
- `chatwoot_list_teams` / `chatwoot_upsert_team` / `chatwoot_manage_team_members` — Cria/atualiza times e adiciona ou remove agentes.

### Taxonomia, Atributos, Respostas Rápidas e Regras Automáticas
- `chatwoot_list_labels` / `chatwoot_upsert_label` / `chatwoot_delete_label` — Gerencia etiquetas da conta, cores, descrições e exibição na sidebar.
- `chatwoot_list_custom_attributes` / `chatwoot_create_custom_attribute` — Gerencia definições de atributos personalizados para conversas e contatos.
- `chatwoot_list_canned_responses` / `chatwoot_upsert_canned_response` — Gerencia respostas rápidas (`/atalho`).
- `chatwoot_list_automation_rules` / `chatwoot_upsert_automation_rule` — Lista, cria e edita regras nativas de automação e roteamento do Chatwoot.

### Triagem de Conversas (Individual e em Lote) e Contatos
- `chatwoot_get_conversation_counts` — Contadores exatos (`mine_count`, `unassigned_count`, `assigned_count`, `all_count`) por status, caixa, time ou etiquetas.
- `chatwoot_list_conversations` — Listagem paginada e resumida com filtros (`status`, `assignee_type`, `inbox_id`, `team_id`, `labels`, `q`, `sort_by`).
- `chatwoot_get_conversation_messages` — Obtém metadados e histórico completo de mensagens e notas privadas de uma conversa.
- `chatwoot_send_message` — Envia mensagem pública ao contato ou cria **nota privada interna** (`private: true`).
- `chatwoot_update_conversation` — Altera status (`open`, `resolved`, `pending`, `snoozed`) via `toggle_status` e/ou prioridade.
- `chatwoot_assign_conversation` — Atribui ou desatribui conversa a agente e/ou time.
- `chatwoot_set_conversation_labels` — Define ou acrescenta etiquetas (`append: true`) em uma conversa.
- `chatwoot_bulk_triage_conversations` — Executa triagem em lote (até 50 conversas por chamada: nota privada + etiquetas + atribuição + mudança de status).
- `chatwoot_search_contacts` / `chatwoot_update_contact` — Pesquisa e atualiza cadastro, `custom_attributes` e etiquetas de contatos.

---

## Instalação e Uso Local (`Stdio`)

1. Instale as dependências e compile o servidor:
   ```bash
   npm install
   npm run build
   ```

2. Crie seu arquivo `.env` a partir do `.env.example`:
   ```bash
   cp .env.example .env
   ```
   Preencha `CHATWOOT_BASE_URL`, `CHATWOOT_ACCOUNT_ID` e `CHATWOOT_API_TOKEN` (obtido no Chatwoot em **Configurações do Perfil → Token de Acesso**).

3. Registre no seu cliente MCP (`mcp_config.json` / `claude_desktop_config.json`):
   ```json
   {
     "mcpServers": {
       "chatwoot": {
         "command": "node",
         "args": ["/caminho/absoluto/para/chatwoot-mcp/dist/stdio.js"],
         "env": {
           "CHATWOOT_BASE_URL": "https://chatwoot.seudominio.com.br",
           "CHATWOOT_ACCOUNT_ID": "1",
           "CHATWOOT_API_TOKEN": "SEU_TOKEN_AQUI"
         }
       }
     }
   }
   ```

---

## Uso com Docker ou Cloudflare Workers

- **Docker:**
  ```bash
  docker compose up -d --build
  ```
- **Cloudflare Workers:**
  Configure as variáveis/secrets (`wrangler secret put CHATWOOT_API_TOKEN`, etc.) e publique com:
  ```bash
  npm run deploy
  ```

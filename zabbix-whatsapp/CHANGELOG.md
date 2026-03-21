# Changelog

**Autor:** Eduardo Fontoura  
**Projeto:** ZabbixWA — Integração Zabbix → WhatsApp via WAHA

Todas as mudanças notáveis neste projeto serão documentadas neste arquivo.  
O formato segue o padrão [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/) e [Semantic Versioning](https://semver.org/lang/pt-BR/).

---

## [1.3.1] — 2026-03-19

### Corrigido
- **Frontend:** aba "👤 Menções" não aparecia por o botão da tab não ter sido salvo no arquivo (código HTML da aba existia mas o botão estava ausente)
- **Frontend:** `get mentionTagNames()` e `get mentionTagFilters()` estavam declarados com sintaxe de getter JavaScript nativo dentro do bloco `methods:{}` do Vue Options API, causando tela em branco ao clicar na aba Menções — movidos para bloco `computed:{}`
- **backup.sh:** credenciais WAHA não eram encontradas quando o `.env` foi gerado pelo `init-waha` e não existe como arquivo no host — script agora busca em 3 locais: (a) pasta do projeto, (b) variáveis de ambiente ativas do container via `docker exec env`, (c) arquivo `.env` dentro do container em paths alternativos
- **Frontend:** campo de valor de TAG ficava vazio ao selecionar TAG no dropdown — `tagValuesFor()` agora busca valores em mapeamentos TAGs→Menções, filtros existentes e campo descrição das TAGs globais; modal garante carregamento de dados antes de abrir
- **Frontend:** opção "Digitar manualmente" movida para o topo de todos os dropdowns de TAG e valor

### Adicionado
- **Frontend:** aba **👤 Menções** no modal de configuração de destino com tabela de referência dos mapeamentos cadastrados, chips clicáveis para adicionar filtros diretamente e formulário dedicado para gerenciar quem será mencionado por alerta
- **Frontend:** `<select>` com valores conhecidos para campo de valor de TAG, populado automaticamente ao selecionar a TAG, com fallback para campo livre
- `tagValuesFor()` busca valores em mapeamentos de menção, filtros de outros destinos e descrição das TAGs globais

---

## [1.3.0] — 2026-03-19

### Adicionado
- **3 Regras de envio** em ordem de prioridade por destino:
  - **Regra 1 — notificar-todos:** switch por destino; quando ativo e alerta contiver `notificar-todos=1`, menciona todos os participantes do grupo e ignora demais regras
  - **Regra 2 — Horário + TAG:** janelas de horário por severidade com filtro de TAG opcional por regra (com negação `!`)
  - **Regra 3 — TAGs + Severidade:** lista de TAGs com opção `!` para ignorar filtro de severidade por TAG específica
- **Tela "Cadastro de TAGs":** repositório global de TAGs com nome, cor e descrição; autocomplete disponível em todos os campos de TAG do sistema
- **`services/logCleanupService.js`:** limpeza automática de logs a cada hora configurável pelo painel
- **Limites de logs:** configurações `log_max_rows`, `log_retention_days`, `queue_max_sent_rows` — controla crescimento do banco; logs Docker limitados a 200MB × 3 arquivos por container no `docker-compose.yml`
- **Múltiplos valores por TAG no alerta:** quando Zabbix envia `RESPONSAVEL=joao.silva,maria.souza`, o sistema divide por vírgula e menciona cada pessoa individualmente — cadastro continua sendo um registro por pessoa
- **`routes/globalTags.js`:** CRUD completo de TAGs globais
- **`newMentionFilter`:** formulário dedicado para filtros de menção na nova aba Menções
- **Crédito do autor** em todos os arquivos do sistema (tela de login, rodapé da sidebar, package.json, LEGAL.md, PDF)

### Corrigido
- **Menções:** sistema agora menciona diretamente quando endpoint de participantes do grupo não está disponível no WAHA free tier (antes silenciava a menção)
- **`buildAlertTagMap()`:** valores com vírgula no alerta (`joao.silva,maria.souza`) são divididos e indexados individualmente para correspondência com mapeamentos

### Alterado
- `alertService.js` completamente reescrito com lógica das 3 regras em sequência
- `queueService.js` atualizado com suporte a `notify_all` e fallback de menção
- `database.js`: novas colunas (`notify_all_enabled`, `negate_severity`, `tag_filter_*`), nova tabela `global_tags`, migrations automáticas para instalações existentes
- `docker-compose.yml`: limites de log Docker configurados (`max-size: 200m`, `max-file: 3`)

---

## [1.2.0] — 2026-03-18

### Adicionado
- Script `backup.sh` com menu interativo: exportar, importar e listar backups
- Suporte a argumento direto: `./backup.sh exportar /caminho`
- Listagem de backups com data, tamanho e seleção por número
- Criação automática do diretório de backup
- Confirmação antes de sobrescrever `.env` e `docker-compose.yml` na restauração
- `LEGAL.md` com conformidade LGPD, Marco Civil da Internet e MIT License
- `CHANGELOG.md` com histórico completo

### Corrigido
- `docker-compose.yml`: removida diretiva `version` obsoleta
- `env_file` corrigido de `waha.env` para `.env` (nome gerado pelo `init-waha`)
- Dockerfile: `npm ci` substituído por `npm install`
- Fluxo de instalação reordenado: `init-waha` antes do `docker compose up`

---

## [1.1.0] — 2026-03-17

### Corrigido
- **Bug crítico na fila:** alertas ficavam presos em `pending`/`held` para sempre
  - **Causa:** `new Date().toISOString()` retorna `2024-01-15T10:30:00.000Z` (ISO 8601), mas SQLite `CURRENT_TIMESTAMP` usa `2024-01-15 10:30:00` (sem `T`). Comparação de strings falhava silenciosamente: `T` (ASCII 84) > ` ` (ASCII 32)
  - **Fix `queueService.js`:** queries usam `datetime(scheduled_at) <= datetime('now')` para normalizar ambos os formatos
  - **Fix `alertService.js`:** `scheduled_at` gravado no formato compatível com SQLite

### Adicionado
- Documentação do tipo de mídia Webhook para Zabbix 7.0 LTS com script JavaScript
- Fluxo completo de inicialização do WAHA via `init-waha`

---

## [1.0.0] — 2026-03-16

### Adicionado
- Painel de administração SPA (Vue 3) com autenticação JWT
- Suporte a múltiplos usuários (`admin` e `operator`)
- Webhook para receber alertas do Zabbix (`POST /api/webhook/zabbix`)
- Normalização automática de payload Zabbix (múltiplos formatos)
- Múltiplos destinos (grupos e contatos) com configuração independente
- Filtro de severidade por destino
- Filtro de TAGs Zabbix por destino
- Mapeamento TAG → telefone para menção automática em grupos
- Verificação de participação no grupo antes de mencionar
- Filtros de horário por severidade (dias da semana + janela de horário)
- Ação "reter": alerta aguarda na fila até o próximo horário permitido
- Ação "descartar": alerta ignorado silenciosamente fora do horário
- Fila de alertas com processamento assíncrono em background
- Rate limiting por destino configurável
- Deduplicação por `event_id` com janela configurável
- Retry automático com backoff exponencial
- Comandos de fila: pausar, retomar, flush, retry, force, clear
- Integração com WAHA free tier via API REST
- Gerenciamento de sessões WAHA (criar, iniciar, parar, status, listar chats)
- Banco de dados SQLite com criação automática e migrations
- Docker Compose com WAHA + sistema integrado
- Histórico de alertas com filtros
- Dashboard com estatísticas em tempo real
- Configurações globais via painel

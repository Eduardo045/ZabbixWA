<div align="center">

# ZabbixWA

### Integração Zabbix → WhatsApp via WAHA

**Receba alertas do Zabbix diretamente no WhatsApp — com menção automática de responsáveis, fila inteligente e painel administrativo completo.**

[![Version](https://img.shields.io/badge/versão-1.3.1-00d4ff?style=flat-square)](CHANGELOG.md)
[![License](https://img.shields.io/badge/licença-MIT-green?style=flat-square)](LEGAL.md)
[![Node](https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square&logo=node.js)](https://nodejs.org)
[![SQLite](https://img.shields.io/badge/banco-SQLite-003B57?style=flat-square&logo=sqlite)](https://sqlite.org)
[![Docker](https://img.shields.io/badge/Docker-CE-2496ED?style=flat-square&logo=docker)](https://docs.docker.com/engine/install/)
[![Author](https://img.shields.io/badge/autor-Eduardo%20Fontoura-blueviolet?style=flat-square)](https://github.com/seu-usuario)

</div>

---

## 📋 Índice

1. [Funcionalidades](#-funcionalidades)
2. [Arquitetura](#-arquitetura)
3. [Pré-requisitos](#-pré-requisitos)
4. [Instalação](#-instalação)
5. [Configuração do WAHA](#-configuração-do-waha)
6. [Configuração do ZabbixWA](#-configuração-do-zabbixwa)
7. [Configuração do Zabbix](#-configuração-do-zabbix)
8. [Regras de Envio](#-regras-de-envio)
9. [Fila de Alertas](#-fila-de-alertas)
10. [Backup e Restauração](#-backup-e-restauração)
11. [Volumes e Dados](#-volumes-e-dados)
12. [Rebuild sem Perda de Dados](#-rebuild-sem-perda-de-dados)
13. [Segurança em Produção](#-segurança-em-produção)
14. [Diagnóstico](#-diagnóstico)
15. [Informações Legais](#-informações-legais)
16. [Histórico de Versões](#-histórico-de-versões)

---

## ✨ Funcionalidades

| Funcionalidade | Descrição |
|---|---|
| 📢 **Notificação em Grupos e Contatos** | Envio para múltiplos grupos e contatos WhatsApp, cada um com configurações independentes |
| 👤 **Menção Automática** | Mapeia TAGs do Zabbix para números de telefone e menciona os responsáveis no grupo |
| 🏷️ **Múltiplos valores por TAG** | `RESPONSAVEL=joao,maria` menciona ambos automaticamente |
| 📢 **Notificar Todos** | TAG `notificar-todos=1` menciona todos os participantes do grupo |
| ⏰ **Filtros de Horário** | Alertas médios só em horário comercial; disasters sempre; regras por dia da semana |
| 🔴 **Filtros de Severidade** | Cada destino recebe apenas as severidades configuradas |
| 🏷️ **Filtros de TAG** | Roteamento por TAGs do Zabbix com opção de ignorar filtro de severidade (`!`) |
| 📦 **Fila Inteligente** | Rate limiting, deduplicação, retry com backoff, pausa e comandos de controle |
| 🧹 **Limpeza automática** | Logs e fila com limites configuráveis; rotação de logs Docker |
| 👥 **Multi-usuário** | Perfis `admin` e `operator` com controle de acesso |
| 🔒 **Segurança** | JWT, bcrypt, token de webhook, HTTPS via Nginx |
| 📊 **Dashboard** | Estatísticas em tempo real, histórico de alertas, status da fila |
| 💾 **Backup completo** | Script interativo para exportar/importar banco, sessões e configurações |

---

## 🏗️ Arquitetura

```
Zabbix Trigger
     │
     ▼ POST /api/webhook/zabbix
┌─────────────────────────────┐
│        ZabbixWA             │
│  ┌──────────────────────┐   │
│  │   alertService.js    │   │  ← Normaliza payload, aplica 3 regras
│  │   3 Regras em ordem: │   │
│  │   1. notificar-todos │   │
│  │   2. horário + TAG   │   │
│  │   3. TAGs + sev.     │   │
│  └──────────┬───────────┘   │
│             │               │
│  ┌──────────▼───────────┐   │
│  │   alert_queue        │   │  ← SQLite: pending/held/sent/failed
│  │   (SQLite)           │   │
│  └──────────┬───────────┘   │
│             │               │
│  ┌──────────▼───────────┐   │
│  │   queueService.js    │   │  ← Rate limit, retry, backoff
│  └──────────┬───────────┘   │
└─────────────┼───────────────┘
              │ HTTP POST /api/sendText
              ▼
        WAHA (auto-hospedado)
              │
              ▼
          WhatsApp
```

### Fluxo das 3 Regras

```
Alerta recebido
      │
      ▼
┌─────────────────────────────────────┐
│ REGRA 1: notificar-todos=1 ?        │──── SIM ──► Menciona TODOS do grupo
│ (switch ativo no destino?)          │            (ignora regras 2 e 3)
└──────────────────┬──────────────────┘
                   │ NÃO
                   ▼
┌─────────────────────────────────────┐
│ REGRA 2: Dentro da janela de        │──── NÃO ──► Reter ou Descartar
│ horário? (+ filtro TAG opcional)    │            (conforme config)
└──────────────────┬──────────────────┘
                   │ SIM
                   ▼
┌─────────────────────────────────────┐
│ REGRA 3: TAG do alerta bate com     │──── NÃO ──► Bloqueia
│ filtros? Severidade permitida?      │
│ (! = ignora severidade para a TAG) │
└──────────────────┬──────────────────┘
                   │ SIM
                   ▼
              Enfileira → WAHA → WhatsApp
```

### Estrutura de Arquivos

```
zabbix-whatsapp/
├── server.js                  ← Express + rotas + serviços
├── database.js                ← SQLite + migrations automáticas
├── backup.sh                  ← Script de backup/restauração interativo
├── Dockerfile
├── docker-compose.yml
├── middleware/
│   └── auth.js                ← JWT + controle de perfil
├── routes/
│   ├── auth.js                ← Login / me
│   ├── users.js               ← CRUD usuários
│   ├── waha.js                ← Sessões WAHA
│   ├── destinations.js        ← Destinos + filtros + horários
│   ├── tagMappings.js         ← TAG → telefone (menções)
│   ├── globalTags.js          ← Cadastro global de TAGs
│   ├── queue.js               ← Comandos da fila
│   ├── webhook.js             ← Receiver do Zabbix
│   └── misc.js                ← Dashboard, logs, settings
├── services/
│   ├── alertService.js        ← 3 regras, normalização, menções
│   ├── queueService.js        ← Rate limit, retry, backoff, notify-all
│   ├── wahaService.js         ← Cliente HTTP para API WAHA
│   └── logCleanupService.js   ← Limpeza automática de logs (horária)
└── public/
    └── index.html             ← SPA Vue 3 (painel admin completo)
```

---

## 🔧 Pré-requisitos

| Requisito | Versão | Observação |
|---|---|---|
| **Docker CE** | 24.x+ | **NÃO use a versão snap** — causa erros de `permission denied` |
| **Docker Compose** | v2 (plugin) | Incluído no Docker CE |
| **SO** | Ubuntu 22.04+ / Debian 12+ | Linux recomendado para produção |

### Instalar Docker CE

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
  sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
```

---

## 🚀 Instalação

### 1. Extrair o pacote

```bash
tar -xzf zabbix-whatsapp.tar.gz
cd zabbix-whatsapp
```

### 2. Gerar credenciais do WAHA

> ⚠️ **Execute ANTES do `docker compose up`.**

```bash
docker run --rm -v "$(pwd)":/app/env devlikeapro/waha init-waha /app/env
```

Saída esperada — **anote esses valores:**

```
Credentials generated.

Dashboard and Swagger:
  - Username: admin
  - Password: 3edc7f3b...    ← senha do Dashboard WAHA

API key:
  - ff25e09fd2...             ← API Key (usar no painel ZabbixWA)
```

> Consulte a qualquer momento: `cat .env` ou `docker exec waha env | grep WAHA`

### 3. Definir o JWT_SECRET

```bash
# Gerar chave segura
openssl rand -hex 32
```

Edite `docker-compose.yml` e substitua:
```yaml
JWT_SECRET: "cole-aqui-a-chave-gerada"
```

### 4. Subir os containers

```bash
docker compose up -d
```

### 5. Verificar

```bash
docker compose ps
docker compose logs -f
```

---

## 📲 Configuração do WAHA

> Execute **todos** estes passos no WAHA antes do ZabbixWA.

### 1. Acessar o Dashboard

```
http://SEU_SERVIDOR:3001/dashboard
```

- **Usuário:** `admin`
- **Senha:** valor de `WAHA_DASHBOARD_PASSWORD` do `.env`

### 2. Conectar com a API Key

Informe o valor de `WAHA_API_KEY` do `.env` quando solicitado.

### 3. Iniciar sessão e escanear QR

1. Clique em **Start** na sessão `default`
2. Aguarde status `SCAN_QR`
3. Clique no ícone de câmera
4. No celular: **WhatsApp → Aparelhos conectados → Conectar um aparelho**
5. Aguarde status **`WORKING`**

> ⚠️ Use um **número dedicado** (chip exclusivo) para não perder a sessão.

### 4. Obter Chat IDs dos grupos

```bash
curl -H "X-Api-Key: SUA_API_KEY" http://SEU_SERVIDOR:3001/api/default/chats
```

| Tipo | Formato |
|------|---------|
| Grupo | `120363025123456789@g.us` |
| Contato | `5511999999999@c.us` |

---

## ⚙️ Configuração do ZabbixWA

```
http://SEU_SERVIDOR:3000
Login padrão: admin / admin123  ← MUDE IMEDIATAMENTE
```

### 1. Cadastro de TAGs Globais (opcional mas recomendado)

**Menu: Cadastro de TAGs → Nova TAG**

Repositório central de TAGs disponíveis como autocomplete em todo o sistema. Informe nome, descrição (usada como sugestão de valor) e cor.

### 2. Sessão WAHA

**Menu: Sessões WAHA → Nova Sessão**

| Campo | Valor |
|---|---|
| URL da API WAHA | `http://waha:3000` (Docker interno) |
| API Key | valor de `WAHA_API_KEY` do `.env` |
| Nome da Sessão | `default` |

### 3. Destinos

**Menu: Destinos → Novo Destino**

| Campo | Exemplo |
|---|---|
| Chat ID | `120363025@g.us` (grupo) |
| Tipo | Grupo ou Contato |
| Notificar Todos | Ativa menção de todos quando TAG `notificar-todos=1` presente |

### 4. Regras por destino (botão ⚙️)

- **Severidade:** quais severidades o destino recebe
- **Regra 3 — TAGs:** filtra por TAG com opção `!` para ignorar severidade
- **Regra 2 — Horários:** janelas de horário com filtro de TAG opcional
- **Menções:** configura quais pessoas serão mencionadas com base nos mapeamentos

### 5. Mapeamento TAG → Menção

**Menu: TAGs → Menções → Novo Mapeamento**

| TAG Nome | TAG Valor | Telefone |
|---|---|---|
| `RESPONSAVEL` | `joao.silva` | `5511999999999` |
| `RESPONSAVEL` | `maria.souza` | `5521888888888` |

> Quando o Zabbix envia `RESPONSAVEL=joao.silva,maria.souza`, o sistema divide por vírgula e menciona ambos.

---

## 📡 Configuração do Zabbix

### Tipo de Mídia (Zabbix 7.x)

**Administração → Tipos de mídia → Criar → Webhook**

#### Parâmetros

| Nome | Valor |
|---|---|
| `URL` | `http://SEU_SERVIDOR:3000/api/webhook/zabbix` |
| `eventid` | `{EVENT.ID}` |
| `eventname` | `{EVENT.NAME}` |
| `severity` | `{EVENT.SEVERITY}` |
| `status` | `{EVENT.STATUS}` |
| `hostname` | `{HOST.NAME}` |
| `hostip` | `{HOST.IP}` |
| `triggerid` | `{TRIGGER.ID}` |
| `triggername` | `{TRIGGER.NAME}` |
| `tags` | `{EVENT.TAGSJSON}` |
| `recovery` | `{EVENT.RECOVERY.ID}` |

#### Script

```javascript
var params = JSON.parse(value);
var req = new HttpRequest();
req.addHeader('Content-Type: application/json');
var payload = {
    eventid: params.eventid, eventname: params.eventname,
    severity: params.severity, status: params.status,
    hostname: params.hostname, hostip: params.hostip,
    triggerid: params.triggerid, triggername: params.triggername,
    tags: params.tags, recovery: params.recovery
};
var response = req.post(params.URL, JSON.stringify(payload));
if (req.getStatus() != 200) throw 'HTTP ' + req.getStatus() + ': ' + response;
return response;
```

#### Modelos de mensagem (obrigatório no Zabbix 7.x)

| Tipo | Assunto | Mensagem |
|---|---|---|
| Problema | `Problema` | `{EVENT.NAME}` |
| Recuperação de problema | `Recuperado` | `{EVENT.NAME}` |

### Teste rápido

```bash
curl -X POST http://SEU_SERVIDOR:3000/api/webhook/zabbix \
  -H 'Content-Type: application/json' \
  -d '{
    "eventid": "99999", "severity": "high", "status": "PROBLEM",
    "hostname": "servidor-teste", "hostip": "192.168.1.1",
    "triggername": "Teste Manual", "tags": [{"tag":"RESPONSAVEL","value":"joao.silva"}]
  }'
# Esperado: {"success":true,"queued":1,"skipped":0}
```

---

## 📐 Regras de Envio

### Lógica AND entre filtros

Os filtros de Severidade e TAG são verificados em sequência (**AND**). A severidade é verificada primeiro:

| Destino: `disaster` + TAG `FGTS=1` | Resultado |
|---|---|
| Alerta `disaster` com TAG `FGTS=1` | ✅ Envia com menção |
| Alerta `disaster` sem TAG `FGTS=1` | ❌ Bloqueado pela TAG |
| Alerta `high` com TAG `FGTS=1` | ❌ Bloqueado pela severidade |
| Alerta `high` sem TAG | ❌ Bloqueado pela severidade |

### Ignorar severidade por TAG (`!`)

Marque `!` em uma TAG para que alertas com aquela TAG **ignorem o filtro de severidade**:

```
TAG: FGTS=1  [! Ignorar Sev.]  → alerta passa independente da severidade
```

### Lógica OR — dois destinos

Para receber alertas de uma TAG em qualquer severidade use dois destinos:

| Destino | Severidade | TAG |
|---|---|---|
| Plantão Crítico | disaster | (sem filtro) |
| FGTS — Qualquer Sev. | (sem filtro) | FGTS=1 |

---

## 📦 Fila de Alertas

### Status

| Status | Significado |
|---|---|
| `pending` | Aguardando envio |
| `held` | Retido por regra de horário — liberado automaticamente |
| `sending` | Em envio |
| `sent` | Enviado com sucesso |
| `failed` | Falhou após esgotar tentativas |
| `skipped` | Ignorado (horário/dedup) |

### Configurações (Settings → admin)

| Configuração | Padrão | Descrição |
|---|---|---|
| `log_max_rows` | 50.000 | Máx. registros em `alert_logs` |
| `log_retention_days` | 30 | Remove logs mais velhos que N dias |
| `queue_max_sent_rows` | 10.000 | Máx. itens sent/skipped na fila |
| `queue_rate_limit` | 10 | Mensagens por janela |
| `queue_rate_window_ms` | 60.000 | Janela do rate limit (ms) |
| `dedup_window_minutes` | 5 | Janela de deduplicação |
| `max_retries` | 3 | Tentativas antes de `failed` |

---

## 💾 Backup e Restauração

```bash
chmod +x backup.sh

./backup.sh                           # menu interativo
./backup.sh exportar                  # pasta padrão ~/zabbix-whatsapp-backups
./backup.sh exportar /mnt/backup      # pasta customizada
./backup.sh importar                  # lista e restaura
./backup.sh listar                    # lista disponíveis
```

### O que é incluído

| Item | Fonte |
|---|---|
| Banco SQLite | container `zabbix-whatsapp:/app/data/` |
| Sessões WAHA | container `waha:/app/.sessions/` |
| Credenciais WAHA | `.env` do projeto ou variáveis do container |
| Configuração | `docker-compose.yml` |

### Migração entre servidores

```bash
# Origem
./backup.sh exportar

# Transferir
scp zabbix-whatsapp-backups/backup-*.tar.gz usuario@NOVO_SERVIDOR:/destino/

# Destino — instale Docker CE, extraia o projeto e:
./backup.sh importar
```

---

## 🗄️ Volumes e Dados

```bash
# Listar volumes
docker volume ls

# Inspecionar volume específico
docker volume inspect zabbix-whatsapp_app_data
docker volume inspect zabbix-whatsapp_waha_sessions

# Tamanho dos volumes
docker system df -v

# Localização no disco
docker volume inspect zabbix-whatsapp_app_data --format '{{ .Mountpoint }}'
```

Os volumes são independentes dos containers — **rebuild e atualizações não apagam os dados**.

---

## 🔄 Rebuild sem Perda de Dados

```bash
cd /home/usuario/zabbix-whatsapp

# 1. Extrair novo código (sobrescreve apenas arquivos de código)
tar -xzf zabbix-whatsapp.tar.gz --strip-components=1

# 2. Rebuild só do container da aplicação
docker compose up -d --build zabbix-whatsapp

# Verificar integridade dos dados após rebuild
docker exec zabbix-whatsapp node -e "
const db = require('./database');
const d = db.prepare('SELECT COUNT(*) as c FROM destinations').get();
const u = db.prepare('SELECT COUNT(*) as c FROM users').get();
const q = db.prepare('SELECT COUNT(*) as c FROM alert_queue').get();
console.log('Destinos:', d.c, '| Usuários:', u.c, '| Fila:', q.c);
"
```

> O WAHA usa imagem do registry — para atualizar: `docker compose pull waha && docker compose up -d waha`

---

## 🔒 Segurança em Produção

```bash
# JWT_SECRET forte
openssl rand -hex 32   # cole no docker-compose.yml

# Token do webhook (no docker-compose.yml)
WEBHOOK_TOKEN: "outro-valor-aleatorio"
# URL Zabbix: .../api/webhook/zabbix?token=VALOR
```

### Nginx com HTTPS

```nginx
server {
    listen 443 ssl http2;
    server_name zabbix-wa.empresa.com;
    ssl_certificate     /etc/letsencrypt/live/zabbix-wa.empresa.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/zabbix-wa.empresa.com/privkey.pem;

    # Painel admin — restrito à rede interna
    location / {
        allow 10.0.0.0/8;
        deny  all;
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Webhook — acessível pelo Zabbix externo
    location /api/webhook/ {
        allow all;
        proxy_pass http://localhost:3000;
    }
}
```

### Checklist

- [ ] `JWT_SECRET` com 64+ caracteres aleatórios
- [ ] `WEBHOOK_TOKEN` definido
- [ ] HTTPS configurado (porta 3001 do WAHA não exposta externamente)
- [ ] Senha padrão `admin123` alterada
- [ ] Backup agendado via cron

---

## 🔍 Diagnóstico

```bash
# Logs em tempo real
docker compose logs -f zabbix-whatsapp

# Status da fila no banco
docker exec zabbix-whatsapp node -e "
const db = require('./database');
const r = db.prepare('SELECT status, COUNT(*) as c FROM alert_queue GROUP BY status').all();
console.table(r);
"

# Liberar itens retidos manualmente
docker exec zabbix-whatsapp node -e "
const db = require('./database');
const r = db.prepare(\"UPDATE alert_queue SET status='pending', scheduled_at=datetime('now') WHERE status='held'\").run();
console.log('Liberados:', r.changes);
"

# Status da sessão WAHA
curl -H "X-Api-Key: SUA_API_KEY" http://localhost:3001/api/sessions/default

# Credenciais WAHA dentro do container
docker exec waha env | grep -i waha
```

---

## ⚖️ Informações Legais

Este software é distribuído sob a **Licença MIT**.  
Veja [`LEGAL.md`](zabbix-whatsapp/LEGAL.md) para informações completas sobre:

- Licença MIT (texto completo)
- **LGPD** — Lei nº 13.709/2018 (dados tratados, bases legais, medidas de segurança)
- **Marco Civil da Internet** — Lei nº 12.965/2014
- Termos de Serviço do WhatsApp/WAHA

> ⚠️ O uso do WAHA pode violar os Termos de Serviço do WhatsApp (Meta). A organização é responsável por avaliar os riscos antes de usar em produção.

---

## 📝 Histórico de Versões

| Versão | Data | Destaque |
|---|---|---|
| **1.3.1** | Mar/2026 | Fix aba Menções, bug Vue computed, backup .env do container |
| **1.3.0** | Mar/2026 | 3 Regras de envio, Cadastro de TAGs, limpeza de logs, múltiplos valores por TAG |
| **1.2.0** | Mar/2026 | Script backup.sh, LEGAL.md, .env fix, Dockerfile fix |
| **1.1.0** | Mar/2026 | Fix crítico da fila (ISO 8601 vs SQLite) |
| **1.0.0** | Mar/2026 | Versão inicial completa |

Veja o [`CHANGELOG.md`](CHANGELOG.md) para detalhes completos de cada versão.

---

<div align="center">

Desenvolvido por **Eduardo Fontoura** · Licença MIT · 2026

</div>

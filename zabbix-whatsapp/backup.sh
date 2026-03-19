#!/usr/bin/env bash
# =============================================================================
#  ZabbixWA — Script de Backup e Restauração
#  Uso: ./backup.sh [exportar|importar] [caminho_opcional]
# =============================================================================

set -euo pipefail

# ── Cores ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BLUE='\033[0;34m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m' # No Color

# ── Configurações ─────────────────────────────────────────────────────────────
CONTAINER_APP="zabbix-whatsapp"
CONTAINER_WAHA="waha"
DEFAULT_BACKUP_DIR="${HOME}/zabbix-whatsapp-backups"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATE=$(date +%Y%m%d_%H%M%S)

# ── Helpers ───────────────────────────────────────────────────────────────────
info()    { echo -e "${CYAN}${BOLD}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}${BOLD}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}${BOLD}[AVISO]${NC} $*"; }
error()   { echo -e "${RED}${BOLD}[ERRO]${NC}  $*" >&2; }
step()    { echo -e "\n${BLUE}${BOLD}▶ $*${NC}"; }
die()     { error "$*"; exit 1; }

line() {
  echo -e "${DIM}──────────────────────────────────────────────────────────────${NC}"
}

banner() {
  echo ""
  echo -e "${CYAN}${BOLD}"
  echo "  ███████╗ █████╗ ██████╗ ██████╗ ██╗██╗  ██╗██╗    ██╗ █████╗ "
  echo "  ╚══███╔╝██╔══██╗██╔══██╗██╔══██╗██║╚██╗██╔╝██║    ██║██╔══██╗"
  echo "    ███╔╝ ███████║██████╔╝██████╔╝██║ ╚███╔╝ ██║ █╗ ██║███████║"
  echo "   ███╔╝  ██╔══██║██╔══██╗██╔══██╗██║ ██╔██╗ ██║███╗██║██╔══██║"
  echo "  ███████╗██║  ██║██████╔╝██████╔╝██║██╔╝ ██╗╚███╔███╔╝██║  ██║"
  echo "  ╚══════╝╚═╝  ╚═╝╚═════╝ ╚═════╝ ╚═╝╚═╝  ╚═╝ ╚══╝╚══╝ ╚═╝  ╚═╝"
  echo -e "${NC}"
  echo -e "  ${DIM}Backup & Restauração — Zabbix WhatsApp Integration${NC}"
  line
  echo ""
}

# ── Verificações de dependências ──────────────────────────────────────────────
check_deps() {
  for cmd in docker tar; do
    command -v "$cmd" &>/dev/null || die "Comando '$cmd' não encontrado. Instale e tente novamente."
  done
}

check_containers() {
  local mode="$1"
  if [[ "$mode" == "exportar" ]]; then
    if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_APP}$"; then
      warn "Container '${CONTAINER_APP}' não está em execução."
      warn "Os arquivos do projeto serão incluídos, mas o banco pode estar desatualizado."
      return 1
    fi
  fi
  return 0
}

# ── Seleção de diretório ──────────────────────────────────────────────────────
prompt_backup_dir() {
  local mode="$1"
  local suggested="${2:-$DEFAULT_BACKUP_DIR}"

  echo -e "  ${BOLD}Diretório de backup:${NC} ${DIM}[Enter para usar o padrão]${NC}"
  echo -e "  Padrão: ${CYAN}${suggested}${NC}"
  echo -n "  Caminho: "
  read -r user_input

  if [[ -z "$user_input" ]]; then
    BACKUP_DIR="$suggested"
  else
    # Expande ~ manualmente
    BACKUP_DIR="${user_input/#\~/$HOME}"
  fi

  echo ""
}

# ── Garantir diretório de backup ──────────────────────────────────────────────
ensure_backup_dir() {
  if [[ -d "$BACKUP_DIR" ]]; then
    info "Diretório de backup já existe: ${CYAN}${BACKUP_DIR}${NC}"
  else
    info "Criando diretório: ${CYAN}${BACKUP_DIR}${NC}"
    mkdir -p "$BACKUP_DIR" || die "Não foi possível criar o diretório: ${BACKUP_DIR}"
    success "Diretório criado."
  fi
}

# ── EXPORTAR ──────────────────────────────────────────────────────────────────
do_export() {
  local containers_running=true
  check_containers "exportar" || containers_running=false

  local backup_file="${BACKUP_DIR}/zabbix-whatsapp-backup_${DATE}.tar.gz"
  local tmp_dir
  tmp_dir=$(mktemp -d)
  trap "rm -rf '$tmp_dir'" EXIT

  step "Iniciando exportação..."

  # 1. Banco de dados
  step "Exportando banco de dados SQLite..."
  if $containers_running && docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_APP}$"; then
    docker cp "${CONTAINER_APP}:/app/data/zabbix-whatsapp.db" "${tmp_dir}/zabbix-whatsapp.db" \
      && success "Banco exportado do container (dados ao vivo)." \
      || { warn "Falha ao copiar do container. Tentando arquivo local..."; \
           cp "${PROJECT_DIR}/data/zabbix-whatsapp.db" "${tmp_dir}/zabbix-whatsapp.db" 2>/dev/null \
           && success "Banco exportado do arquivo local." \
           || warn "Banco de dados não encontrado — será omitido."; }
  else
    if [[ -f "${PROJECT_DIR}/data/zabbix-whatsapp.db" ]]; then
      cp "${PROJECT_DIR}/data/zabbix-whatsapp.db" "${tmp_dir}/zabbix-whatsapp.db"
      success "Banco exportado do arquivo local."
    else
      warn "Banco de dados não encontrado — será omitido do backup."
    fi
  fi

  # 2. Sessões WAHA
  step "Exportando sessões WAHA..."
  if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_WAHA}$"; then
    mkdir -p "${tmp_dir}/waha-sessions"
    docker cp "${CONTAINER_WAHA}:/app/.sessions/." "${tmp_dir}/waha-sessions/" 2>/dev/null \
      && success "Sessões WAHA exportadas do container." \
      || warn "Sem sessões ativas no WAHA — ignorado."
  else
    warn "Container WAHA não está em execução — sessões não incluídas."
  fi

  # 3. Credenciais WAHA (.env)
  # O .env pode estar: (a) na pasta do projeto ou (b) apenas como variáveis
  # de ambiente do container WAHA (criado pelo init-waha sem volume local)
  step "Exportando credenciais WAHA (.env)..."
  local env_exported=false

  # (a) Pasta do projeto
  if [[ -f "${PROJECT_DIR}/.env" ]]; then
    cp "${PROJECT_DIR}/.env" "${tmp_dir}/waha.env"
    success "Arquivo .env exportado da pasta do projeto."
    env_exported=true
  fi

  # (b) Variáveis de ambiente ativas no container WAHA
  if [[ "$env_exported" == "false" ]] && docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_WAHA}$"; then
    local waha_env
    waha_env=$(docker exec "${CONTAINER_WAHA}" sh -c 'env | grep -E "^WAHA_|^WHATSAPP_SWAGGER_"' 2>/dev/null)
    if [[ -n "$waha_env" ]]; then
      echo "$waha_env" > "${tmp_dir}/waha.env"
      success "Credenciais WAHA exportadas das variáveis de ambiente do container."
      env_exported=true
    fi
  fi

  # (c) Arquivo .env dentro do container WAHA (path alternativo)
  if [[ "$env_exported" == "false" ]] && docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_WAHA}$"; then
    for env_path in "/app/env/.env" "/app/.env" "/.env"; do
      if docker exec "${CONTAINER_WAHA}" test -f "$env_path" 2>/dev/null; then
        docker cp "${CONTAINER_WAHA}:${env_path}" "${tmp_dir}/waha.env" 2>/dev/null           && { success "Arquivo .env exportado de ${env_path} no container WAHA."; env_exported=true; break; }
      fi
    done
  fi

  if [[ "$env_exported" == "false" ]]; then
    warn "Credenciais WAHA não encontradas. O backup continua sem elas."
    warn "Na restauração, execute 'init-waha' novamente e configure a API Key manualmente."
  fi

  # 4. docker-compose.yml
  step "Exportando docker-compose.yml..."
  if [[ -f "${PROJECT_DIR}/docker-compose.yml" ]]; then
    cp "${PROJECT_DIR}/docker-compose.yml" "${tmp_dir}/docker-compose.yml"
    success "docker-compose.yml exportado."
  fi

  # 5. Metadados do backup
  cat > "${tmp_dir}/backup-info.txt" << EOF
Backup ZabbixWA
Data: $(date '+%d/%m/%Y %H:%M:%S')
Hostname: $(hostname)
Usuário: $(whoami)
Containers rodando: ${containers_running}
Versão do backup: 1.0
EOF

  # 6. Compactar tudo
  step "Compactando backup..."
  tar -czf "$backup_file" -C "$tmp_dir" . \
    && success "Backup criado: ${CYAN}${backup_file}${NC}" \
    || die "Falha ao criar o arquivo de backup."

  # Tamanho
  local size
  size=$(du -sh "$backup_file" | cut -f1)
  echo ""
  line
  echo -e "  ${GREEN}${BOLD}✅ Backup concluído!${NC}"
  echo -e "  ${BOLD}Arquivo:${NC} ${backup_file}"
  echo -e "  ${BOLD}Tamanho:${NC} ${size}"
  line
}

# ── LISTAR BACKUPS ────────────────────────────────────────────────────────────
list_backups() {
  local files=()
  while IFS= read -r -d '' f; do
    files+=("$f")
  done < <(find "$BACKUP_DIR" -maxdepth 1 -name "zabbix-whatsapp-backup_*.tar.gz" -print0 2>/dev/null | sort -z -r)

  if [[ ${#files[@]} -eq 0 ]]; then
    warn "Nenhum arquivo de backup encontrado em: ${BACKUP_DIR}"
    return 1
  fi

  echo -e "\n  ${BOLD}Backups disponíveis:${NC}\n"

  local i=1
  for f in "${files[@]}"; do
    local fname size date_str
    fname=$(basename "$f")
    size=$(du -sh "$f" | cut -f1)

    # Extrai data do nome do arquivo
    local raw_date
    raw_date=$(echo "$fname" | grep -oP '\d{8}_\d{6}' || echo "")
    if [[ -n "$raw_date" ]]; then
      date_str=$(date -d "${raw_date:0:8} ${raw_date:9:2}:${raw_date:11:2}:${raw_date:13:2}" '+%d/%m/%Y %H:%M:%S' 2>/dev/null || echo "$raw_date")
    else
      date_str=$(stat -c '%y' "$f" | cut -d'.' -f1)
    fi

    echo -e "  ${CYAN}${BOLD}[$i]${NC} ${fname}"
    echo -e "      ${DIM}Data: ${date_str} | Tamanho: ${size}${NC}"
    echo ""
    i=$((i + 1))
  done

  BACKUP_FILES=("${files[@]}")
  return 0
}

# ── IMPORTAR ──────────────────────────────────────────────────────────────────
do_import() {
  step "Verificando backups disponíveis em: ${CYAN}${BACKUP_DIR}${NC}"

  if ! list_backups; then
    echo ""
    die "Nenhum backup para restaurar. Execute a exportação primeiro."
  fi

  echo -n "  Escolha o número do backup para restaurar: "
  read -r choice

  if ! [[ "$choice" =~ ^[0-9]+$ ]] || \
     [[ "$choice" -lt 1 ]] || \
     [[ "$choice" -gt "${#BACKUP_FILES[@]}" ]]; then
    die "Opção inválida: $choice"
  fi

  local selected_file="${BACKUP_FILES[$((choice - 1))]}"
  echo ""
  info "Backup selecionado: ${CYAN}$(basename "$selected_file")${NC}"

  # Confirmação
  echo -e "\n  ${YELLOW}${BOLD}⚠ ATENÇÃO!${NC}"
  echo -e "  Esta operação irá ${RED}${BOLD}sobrescrever${NC} os dados atuais dos containers."
  echo -e "  Os containers serão ${YELLOW}reiniciados${NC} durante o processo.\n"
  echo -n "  Confirma a restauração? [s/N]: "
  read -r confirm
  [[ "${confirm,,}" == "s" ]] || { warn "Restauração cancelada."; exit 0; }

  local tmp_dir
  tmp_dir=$(mktemp -d)
  trap "rm -rf '$tmp_dir'" EXIT

  # Extrair backup
  step "Extraindo backup..."
  tar -xzf "$selected_file" -C "$tmp_dir" \
    || die "Falha ao extrair o backup."
  success "Backup extraído."

  # Mostrar info do backup
  if [[ -f "${tmp_dir}/backup-info.txt" ]]; then
    echo ""
    echo -e "  ${DIM}$(cat "${tmp_dir}/backup-info.txt")${NC}"
    echo ""
  fi

  # 1. Restaurar banco de dados
  step "Restaurando banco de dados..."
  if [[ -f "${tmp_dir}/zabbix-whatsapp.db" ]]; then
    # Garantir que a pasta data existe
    mkdir -p "${PROJECT_DIR}/data"
    cp "${tmp_dir}/zabbix-whatsapp.db" "${PROJECT_DIR}/data/zabbix-whatsapp.db"

    # Se o container estiver rodando, copiar para dentro
    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_APP}$"; then
      docker cp "${tmp_dir}/zabbix-whatsapp.db" "${CONTAINER_APP}:/app/data/zabbix-whatsapp.db" \
        && success "Banco restaurado no container."
    else
      success "Banco restaurado em: ${PROJECT_DIR}/data/ (container não está rodando)"
    fi
  else
    warn "Banco de dados não encontrado no backup — ignorado."
  fi

  # 2. Restaurar .env do WAHA
  step "Restaurando credenciais WAHA (.env)..."
  if [[ -f "${tmp_dir}/waha.env" ]]; then
    # Detecta se o waha.env foi exportado como env vars (KEY=VALUE sem export)
    # ou como arquivo .env padrão — ambos formatos são compatíveis com env_file do docker-compose
    if [[ -f "${PROJECT_DIR}/.env" ]]; then
      echo -n "  Arquivo .env já existe. Sobrescrever? [s/N]: "
      read -r overwrite_env
      if [[ "${overwrite_env,,}" == "s" ]]; then
        cp "${tmp_dir}/waha.env" "${PROJECT_DIR}/.env"
        success ".env restaurado."
      else
        warn ".env mantido sem alterações."
      fi
    else
      cp "${tmp_dir}/waha.env" "${PROJECT_DIR}/.env"
      success ".env restaurado em: ${PROJECT_DIR}/.env"
      info "Verifique o conteúdo: cat ${PROJECT_DIR}/.env"
    fi
  else
    warn ".env não encontrado no backup."
    warn "Execute: docker run --rm -v $(pwd):/app/env devlikeapro/waha init-waha /app/env"
    warn "Depois atualize a API Key no painel em Sessões WAHA."
  fi

  # 3. Restaurar docker-compose.yml
  step "Restaurando docker-compose.yml..."
  if [[ -f "${tmp_dir}/docker-compose.yml" ]]; then
    if [[ -f "${PROJECT_DIR}/docker-compose.yml" ]]; then
      echo -n "  docker-compose.yml já existe. Sobrescrever? [s/N]: "
      read -r overwrite_compose
      if [[ "${overwrite_compose,,}" == "s" ]]; then
        cp "${tmp_dir}/docker-compose.yml" "${PROJECT_DIR}/docker-compose.yml"
        success "docker-compose.yml restaurado."
      else
        warn "docker-compose.yml mantido sem alterações."
      fi
    else
      cp "${tmp_dir}/docker-compose.yml" "${PROJECT_DIR}/docker-compose.yml"
      success "docker-compose.yml restaurado."
    fi
  fi

  # 4. Restaurar sessões WAHA
  step "Restaurando sessões WAHA..."
  if [[ -d "${tmp_dir}/waha-sessions" ]] && [[ -n "$(ls -A "${tmp_dir}/waha-sessions" 2>/dev/null)" ]]; then
    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_WAHA}$"; then
      docker cp "${tmp_dir}/waha-sessions/." "${CONTAINER_WAHA}:/app/.sessions/" \
        && success "Sessões WAHA restauradas no container."
    else
      warn "Container WAHA não está rodando. Suba os containers antes de restaurar as sessões."
      warn "Depois execute: docker cp backup-sessions/. waha:/app/.sessions/"
    fi
  else
    warn "Sessões WAHA não encontradas no backup."
  fi

  # 5. Reiniciar containers
  step "Reiniciando containers para aplicar as mudanças..."
  local restarted=false
  if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_APP}$"; then
    docker restart "$CONTAINER_APP" &>/dev/null && success "Container '${CONTAINER_APP}' reiniciado." || warn "Falha ao reiniciar '${CONTAINER_APP}'."
    restarted=true
  fi
  if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_WAHA}$"; then
    docker restart "$CONTAINER_WAHA" &>/dev/null && success "Container '${CONTAINER_WAHA}' reiniciado." || warn "Falha ao reiniciar '${CONTAINER_WAHA}'."
    restarted=true
  fi

  if ! $restarted; then
    warn "Nenhum container estava rodando. Suba com: cd ${PROJECT_DIR} && docker compose up -d"
  fi

  echo ""
  line
  echo -e "  ${GREEN}${BOLD}✅ Restauração concluída!${NC}"
  if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_WAHA}$"; then
    echo -e "  ${DIM}Verifique o status do WAHA em: http://localhost:3001/dashboard${NC}"
    echo -e "  ${DIM}Se a sessão mostrar SCAN_QR, o número precisará ser reconectado.${NC}"
  fi
  line
}

# ── MENU PRINCIPAL ────────────────────────────────────────────────────────────
show_menu() {
  echo -e "  ${BOLD}O que deseja fazer?${NC}\n"
  echo -e "  ${CYAN}${BOLD}[1]${NC} ${BOLD}Exportar${NC} — Fazer backup dos dados atuais"
  echo -e "  ${CYAN}${BOLD}[2]${NC} ${BOLD}Importar${NC} — Restaurar um backup existente"
  echo -e "  ${CYAN}${BOLD}[3]${NC} ${BOLD}Listar${NC}   — Ver backups disponíveis"
  echo -e "  ${DIM}[0]  Sair${NC}"
  echo ""
  echo -n "  Escolha uma opção: "
  read -r menu_choice
  echo ""

  case "$menu_choice" in
    1) MODE="exportar" ;;
    2) MODE="importar" ;;
    3) MODE="listar"   ;;
    0) echo -e "  ${DIM}Saindo...${NC}\n"; exit 0 ;;
    *) die "Opção inválida: '$menu_choice'" ;;
  esac
}

# ── PONTO DE ENTRADA ──────────────────────────────────────────────────────────
main() {
  banner
  check_deps

  # Aceita argumento direto ou exibe menu
  if [[ $# -ge 1 ]]; then
    MODE="$1"
    ARG_PATH="${2:-}"
  else
    show_menu
    ARG_PATH=""
  fi

  # Definir diretório de backup
  case "$MODE" in
    exportar|importar|listar)
      if [[ -n "${ARG_PATH:-}" ]]; then
        BACKUP_DIR="${ARG_PATH/#\~/$HOME}"
        info "Usando diretório: ${CYAN}${BACKUP_DIR}${NC}"
        echo ""
      else
        prompt_backup_dir "$MODE" "$DEFAULT_BACKUP_DIR"
      fi
      ;;
    *)
      die "Modo inválido: '$MODE'. Use: exportar | importar | listar"
      ;;
  esac

  # Garantir que o diretório existe
  ensure_backup_dir

  # Executar ação escolhida
  case "$MODE" in
    exportar) do_export  ;;
    importar) do_import  ;;
    listar)
      if ! list_backups; then
        echo ""
        warn "Nenhum backup encontrado em: ${BACKUP_DIR}"
      fi
      echo ""
      ;;
  esac
}

main "$@"

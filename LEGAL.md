# Informações Legais — ZabbixWA

**Software:** ZabbixWA — Integração Zabbix → WhatsApp via WAHA
**Autor:** Eduardo Fontoura  
**Versão:** 1.2.0  
**Repositório:** https://github.com/seu-usuario/zabbix-whatsapp *(atualize conforme seu repositório)*

---

## 1. Licença de Uso

Este software é distribuído sob a **Licença MIT** (Massachusetts Institute of Technology):

```
MIT License

Copyright (c) 2026 Eduardo Fontoura

É concedida permissão, gratuitamente, a qualquer pessoa que obtenha uma cópia
deste software e dos arquivos de documentação associados (o "Software"), para
lidar com o Software sem restrições, incluindo, sem limitação, os direitos de
usar, copiar, modificar, mesclar, publicar, distribuir, sublicenciar e/ou vender
cópias do Software, e para permitir que as pessoas a quem o Software é fornecido
o façam, sujeito às seguintes condições:

O aviso de copyright acima e este aviso de permissão devem ser incluídos em todas
as cópias ou partes substanciais do Software.

O SOFTWARE É FORNECIDO "NO ESTADO EM QUE SE ENCONTRA", SEM GARANTIA DE QUALQUER
TIPO, EXPRESSA OU IMPLÍCITA, INCLUINDO, MAS NÃO SE LIMITANDO ÀS GARANTIAS DE
COMERCIALIZAÇÃO, ADEQUAÇÃO A UM DETERMINADO FIM E NÃO VIOLAÇÃO. EM NENHUM CASO
OS AUTORES OU DETENTORES DE DIREITOS AUTORAIS SERÃO RESPONSÁVEIS POR QUALQUER
RECLAMAÇÃO, DANO OU OUTRA RESPONSABILIDADE, SEJA EM AÇÃO DE CONTRATO, ATO ILÍCITO
OU DE OUTRA FORMA, DECORRENTE DE, FORA DE OU EM CONEXÃO COM O SOFTWARE OU O USO
OU OUTRAS NEGOCIAÇÕES NO SOFTWARE.
```

---

## 2. Conformidade com a Lei Geral de Proteção de Dados (LGPD)

**Lei nº 13.709, de 14 de agosto de 2018**

### 2.1 Dados Tratados pelo Sistema

Este software, em sua operação, pode processar os seguintes dados pessoais:

| Dado | Finalidade | Base Legal (LGPD Art. 7º) |
|------|-----------|--------------------------|
| Números de telefone | Envio de notificações e menções em grupos | Legítimo interesse (inciso IX) |
| Nomes de usuários (login) | Autenticação no painel administrativo | Execução de contrato (inciso V) |
| Senhas (hash bcrypt) | Controle de acesso | Execução de contrato (inciso V) |
| Endereços IP de hosts | Identificação de equipamentos em alertas | Legítimo interesse (inciso IX) |
| Conteúdo de alertas | Notificação de eventos de infraestrutura | Legítimo interesse (inciso IX) |

### 2.2 Responsabilidades do Operador

Na qualidade de **operador** (Art. 5º, VII da LGPD), a organização que instala e utiliza este software é responsável por:

- Designar um **Encarregado de Proteção de Dados (DPO)** quando aplicável (Art. 41)
- Obter consentimento ou identificar a base legal adequada para o tratamento dos dados (Art. 7º)
- Garantir que números de telefone cadastrados no sistema correspondam a titulares que consentiram com o recebimento das notificações
- Implementar medidas técnicas e administrativas para proteção dos dados (Art. 46)
- Não armazenar dados pessoais por período superior ao necessário para a finalidade (Art. 15)
- Atender às solicitações de titulares (acesso, correção, exclusão) nos prazos legais (Art. 18)
- Notificar a ANPD e os titulares em caso de incidente de segurança que possa causar risco (Art. 48)

### 2.3 Medidas de Segurança Implementadas

Este software implementa as seguintes medidas técnicas de segurança, em conformidade com o Art. 46 da LGPD:

- **Hashing de senhas** com bcrypt (salt 10 rounds) — senhas nunca são armazenadas em texto puro
- **Autenticação JWT** com expiração de 24 horas
- **Token opcional** para autenticação do webhook
- **Banco de dados local** (SQLite) — dados não são transmitidos a terceiros pelo sistema
- **Sem telemetria** — o software não envia dados de uso para servidores externos

### 2.4 Dados de Terceiros — WhatsApp e WAHA

- O envio de mensagens é realizado através do **WAHA** (auto-hospedado), sem transmissão de dados ao Meta/WhatsApp exceto o conteúdo da mensagem em si
- Os **Termos de Serviço do WhatsApp** proíbem o uso de APIs não oficiais para automação. A organização é responsável por avaliar os riscos legais e operacionais decorrentes desse uso
- O WAHA é um software de terceiros sob sua própria licença. Verifique os termos em: https://waha.devlike.pro

---

## 3. Marco Civil da Internet

**Lei nº 12.965, de 23 de abril de 2014**

### 3.1 Guarda de Registros

Em conformidade com o Art. 13 do Marco Civil, conexões e acessos ao sistema são registrados nos logs da aplicação. Recomenda-se:

- Manter logs de acesso ao painel administrativo por período mínimo de **6 meses** (Art. 13, §1º)
- Manter logs de atividades de usuários por período mínimo de **6 meses** (Art. 15, aplicável por analogia)
- Proteger os logs contra acesso não autorizado e adulteração

### 3.2 Neutralidade e Sigilo

As mensagens transmitidas pelo sistema são de natureza operacional (alertas de infraestrutura). O operador deve garantir que o conteúdo não viole:

- O sigilo das comunicações (Art. 7º, II)
- A privacidade dos usuários (Art. 7º, I)
- A inviolabilidade e sigilo do fluxo de comunicações (Art. 7º, III)

---

## 4. Código de Defesa do Consumidor

**Lei nº 8.078, de 11 de setembro de 1990**

Este software é disponibilizado **gratuitamente e sem garantias**. Caso seja utilizado como componente de um produto ou serviço comercializado a consumidores finais, o fornecedor do produto/serviço assume integralmente as responsabilidades previstas no CDC, incluindo:

- Garantia de adequação do produto ao uso (Art. 18)
- Responsabilidade por vícios e defeitos (Art. 12 e 14)
- Dever de informação ao consumidor (Art. 6º, III)

---

## 5. Direitos Autorais

**Lei nº 9.610, de 19 de fevereiro de 1998 (Lei de Direitos Autorais)**

O código-fonte deste software é protegido pela lei de direitos autorais brasileira. A redistribuição é permitida sob os termos da Licença MIT descrita na Seção 1, desde que:

- O aviso de copyright seja mantido em todas as cópias
- A licença MIT seja incluída em todas as redistribuições
- O software não seja apresentado como de autoria de terceiros sem crédito aos autores originais

---

## 6. Isenção de Responsabilidade

O software é fornecido "no estado em que se encontra" (as-is), sem garantias de qualquer natureza. Os autores e contribuidores **não se responsabilizam** por:

- Perdas de dados, interrupções de serviço ou danos indiretos decorrentes do uso
- Violações dos Termos de Serviço do WhatsApp resultantes do uso do WAHA
- Banimento ou suspensão de números de telefone pelo WhatsApp
- Falhas no envio de alertas críticos que resultem em prejuízos operacionais
- Uso indevido do sistema por terceiros que obtenham acesso não autorizado

**Recomendações para uso em produção:**

- Implemente HTTPS em todos os endpoints
- Defina um `JWT_SECRET` forte e único
- Utilize `WEBHOOK_TOKEN` para autenticar o Zabbix
- Realize backups regulares conforme documentado em `README.md`
- Restrinja o acesso ao painel administrativo à rede interna
- Utilize um número de telefone dedicado para o WAHA

---

## 7. Uso Aceitável

Este software **não deve** ser utilizado para:

- Envio de comunicações não solicitadas (spam) — Art. 37 do CDC e Art. 6º da LGPD
- Coleta de dados pessoais sem base legal adequada — Art. 7º da LGPD
- Monitoramento ou vigilância não autorizada de indivíduos
- Qualquer finalidade que viole a legislação brasileira vigente

---

## 8. Dependências de Terceiros

Este software utiliza pacotes de terceiros, cada um sob sua própria licença:

| Pacote | Licença | Repositório |
|--------|---------|-------------|
| express | MIT | https://github.com/expressjs/express |
| better-sqlite3 | MIT | https://github.com/WiseLibs/better-sqlite3 |
| bcryptjs | MIT | https://github.com/dcodeIO/bcrypt.js |
| jsonwebtoken | MIT | https://github.com/auth0/node-jsonwebtoken |
| axios | MIT | https://github.com/axios/axios |
| node-cron | ISC | https://github.com/node-cron/node-cron |
| cors | MIT | https://github.com/expressjs/cors |
| dotenv | BSD-2-Clause | https://github.com/motdotla/dotenv |
| uuid | MIT | https://github.com/uuidjs/uuid |
| WAHA | Proprietária (free tier) | https://waha.devlike.pro |
| Vue.js 3 | MIT | https://github.com/vuejs/core |

---

## 9. Contato e Suporte

Para questões relacionadas a privacidade, proteção de dados ou conformidade legal, entre em contato com o administrador do sistema responsável pela instalação e operação deste software em sua organização.

Para questões técnicas ou contribuições ao projeto, utilize os canais do repositório.

---

*Documento atualizado em: Março de 2026*  
*Versão do documento: 1.2.0*  
*Este documento não constitui aconselhamento jurídico. Consulte um advogado especializado para orientações específicas à sua organização.*

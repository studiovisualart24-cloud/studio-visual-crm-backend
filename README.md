# Backend de Integrações — Studio Visual CRM AI

Servidor Node/Express que cuida da parte que o CRM (front-end em HTML/React) não pode fazer sozinho:
autenticar com serviços externos (OAuth2) e receber eventos deles (webhooks), guardando tudo com segurança
num banco Postgres.

## Como rodar

```bash
npm install
cp .env.example .env        # preencha com suas credenciais reais
npx prisma migrate dev      # cria as tabelas no Postgres
npm run dev
```

## O que já está pronto

- **`prisma/schema.prisma`** — tabelas `IntegrationToken` (tokens criptografados por conta+provedor),
  `WebhookEvent` (log de tudo que chega), `Automacao` (os fluxos da aba Automação) e
  `AutomationRun` (cada execução real de um fluxo, passo a passo).
- **`src/services/crypto.js`** — criptografa/descriptografa tokens (AES-256-GCM) antes de salvar no banco.
- **`src/services/tokenService.js`** — salvar, buscar e renovar tokens automaticamente.
- **`src/services/automationEngine.js`** — o motor de automação: dispara fluxos quando um gatilho
  acontece de verdade (novo lead, mudança de etapa, tag adicionada, formulário externo) e executa
  os passos (email, WhatsApp, tarefa, IA, condição, esperar X dias). Veja a seção "Automação" abaixo.
- **`src/routes/oauth.js`** — fluxo `/oauth/:provider/connect` e `/oauth/:provider/callback`, já configurado
  para Meta e Google (adicionar outro provedor é só adicionar uma entrada no objeto `PROVIDERS`).
- **`src/routes/webhooks.js`** — recebe eventos do Stripe (com verificação de assinatura), Mercado Pago e
  de automações externas (N8N/Zapier), além de uma função para você notificar o N8N a partir do CRM.
- **`src/services/metaPublish.js`** — exemplo de uso real: publicar um post no Instagram usando o token salvo.

## Como ligar ao módulo "Integrações" do CRM

No botão "Ativar" de cada card de integração no CRM, aponte para:

```
GET {SEU_BACKEND}/oauth/meta/connect?accountId=SEU_ACCOUNT_ID
GET {SEU_BACKEND}/oauth/google/connect?accountId=SEU_ACCOUNT_ID
```

Isso redireciona o usuário para autorizar, e ao voltar, o CRM já mostra "conectado" (o backend redireciona
de volta para `FRONTEND_URL/integracoes?connected=meta`).

## Automação (aba "Automação" do CRM)

Os fluxos que você monta na aba Automação do CRM vivem neste backend, não mais só no navegador —
por isso funcionam mesmo com o CRM fechado.

- **`prisma/schema.prisma`** — `Automacao` guarda cada fluxo (nome, gatilho, passos, ativo/pausado).
  `AutomationRun` guarda cada execução real: para qual lead, em que passo está, o log completo e,
  se estiver num passo "Esperar X dias", quando deve retomar (`waitUntil`).
- **`src/services/automationEngine.js`** — o motor: dispara fluxos por gatilho
  (`dispararAutomacoes`), executa os passos um a um (`executarProximoPasso`) e retoma execuções
  que estavam esperando (`retomarAutomacoesPendentes`).
- **`src/routes/automacoes.js`** — CRUD dos fluxos (`GET/POST/PUT/DELETE /api/automacoes`),
  histórico de execuções (`GET /api/automacoes/execucoes`) e um endpoint para testar um fluxo na
  hora sem precisar de um lead real (`POST /api/automacoes/:id/testar`).
- **`src/routes/leads.js`** — `POST /api/leads/formulario`, um endpoint público para plugar um
  formulário externo (site, landing page) e disparar o gatilho "Formulário preenchido" com um lead
  de verdade.
- **Gatilhos já ligados aos eventos reais** (em `src/routes/crm.js` e `src/routes/leads.js`):
  - "Novo lead criado" → ao criar um contato pelo CRM (`POST /api/contatos`).
  - "Proposta enviada" / "Contrato fechado" → quando a etapa do contato muda para "Proposta" ou
    "Fechado" (pelo Pipeline ou editando o contato).
  - "Tag adicionada" → ao adicionar uma tag nova a um contato (`POST /api/contatos/:id/tags`).
  - "Formulário preenchido" → ao receber um lead em `POST /api/leads/formulario`.
- **Agendador** (`src/server.js`) — a cada `AUTOMATION_POLL_INTERVAL_MS` (padrão 5 min), verifica
  se alguma execução "aguardando" já pode continuar. É isso que faz o passo "Esperar X dias"
  funcionar de verdade, mesmo que o servidor reinicie no meio do caminho.
- **Limite conhecido**: um "Mover no pipeline" ou "Adicionar tag" feito *pela própria automação*
  não dispara outra automação em cadeia (evita loop infinito). Só ações feitas pelas rotas normais
  do CRM disparam automações.

## Próximos passos sugeridos

1. Registrar os apps em developers.facebook.com e console.cloud.google.com para conseguir client_id/secret reais.
2. Trocar o banco local por uma instância Postgres real (Supabase, Neon, RDS etc.) e atualizar `DATABASE_URL`.
3. Adicionar autenticação de usuários no próprio backend (JWT), para que `accountId` venha de uma sessão
   validada em vez de vir aberto na URL como neste exemplo simplificado.
4. Fazer o deploy (Railway, Render, Fly.io ou similar) e usar a URL pública como `APP_URL`.
5. `POST /api/leads/formulario` é público (sem autenticação) de propósito, para um formulário de
   site conseguir chamá-lo direto. Se isso virar alvo de spam, vale colocar um captcha no
   formulário ou um limite de requisições (rate limit) nessa rota.

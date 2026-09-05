require('dotenv').config();
const express = require('express');
const app = express();

const oauthRoutes = require('./routes/oauth');
const webhookRoutes = require('./routes/webhooks');
const crmRoutes = require('./routes/crm');
const calendarRoutes = require('./routes/calendar');
const emailRoutes = require('./routes/email');
const whatsappRoutes = require('./routes/whatsapp');
const driveRoutes = require('./routes/drive');
const iaRoutes = require('./routes/ia');
const linkedinRoutes = require('./routes/linkedin');
const metaRoutes = require('./routes/meta');
const automacoesRoutes = require('./routes/automacoes');
const leadsRoutes = require('./routes/leads');
const { retomarAutomacoesPendentes } = require('./services/automationEngine');

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  // Faltava autorizar os métodos PUT/DELETE aqui — sem isso o navegador bloqueia (CORS)
  // qualquer requisição PUT (ex: salvar edições de automação) ou DELETE antes mesmo de
  // ela ser enviada de verdade, mesmo o servidor tratando '*' como origem liberada.
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use('/webhooks', webhookRoutes);
app.use(express.json());
app.use('/oauth', oauthRoutes);
app.use('/api', crmRoutes);
app.use('/api', calendarRoutes);
app.use('/api', emailRoutes);
app.use('/api', whatsappRoutes);
app.use('/api', driveRoutes);
app.use('/api', iaRoutes);
app.use('/api', linkedinRoutes);
app.use('/api', metaRoutes);
app.use('/api', automacoesRoutes);
app.use('/api', leadsRoutes);

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend de integrações rodando em http://localhost:${PORT}`));

// Agendador da automação: verifica periodicamente se alguma execução que estava "aguardando"
// (passo "Esperar X dias") já pode ser retomada. Roda no mesmo processo do servidor — funciona
// enquanto o backend estiver de pé (Railway, Render etc. mantêm o processo rodando 24h).
const INTERVALO_AGENDADOR_MS = Number(process.env.AUTOMATION_POLL_INTERVAL_MS) || 5 * 60 * 1000; // 5 min por padrão
setInterval(() => {
  retomarAutomacoesPendentes()
    .then((quantidade) => { if (quantidade > 0) console.log(`Agendador: retomou ${quantidade} automação(ões) pendente(s).`); })
    .catch((err) => console.error('Erro no agendador de automações:', err));
}, INTERVALO_AGENDADOR_MS);

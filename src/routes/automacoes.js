const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { executarProximoPasso } = require('../services/automationEngine');

// Lista os fluxos de automação de uma conta (aba "Automação" do CRM).
router.get('/automacoes', async (req, res) => {
  const { accountId } = req.query;
  if (!accountId) return res.status(400).json({ error: 'accountId é obrigatório' });
  const flows = await prisma.automacao.findMany({ where: { accountId }, orderBy: { createdAt: 'asc' } });
  res.json(flows);
});

router.post('/automacoes', async (req, res) => {
  const { accountId, nome, gatilho, ativo, steps } = req.body;
  if (!accountId || !nome || !gatilho) return res.status(400).json({ error: 'accountId, nome e gatilho são obrigatórios' });
  const flow = await prisma.automacao.create({
    data: { accountId, nome, gatilho, ativo: ativo !== false, steps: steps || [] },
  });
  res.json(flow);
});

router.put('/automacoes/:id', async (req, res) => {
  const { nome, gatilho, ativo, steps } = req.body;
  const flow = await prisma.automacao.update({
    where: { id: req.params.id },
    data: {
      ...(nome !== undefined && { nome }),
      ...(gatilho !== undefined && { gatilho }),
      ...(ativo !== undefined && { ativo }),
      ...(steps !== undefined && { steps }),
    },
  });
  res.json(flow);
});

router.delete('/automacoes/:id', async (req, res) => {
  await prisma.automacao.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// Histórico real de execuções — o que de fato rodou, para qual lead, e o log passo a passo.
// GET /api/automacoes/execucoes?accountId=...&flowId=... (flowId é opcional, filtra por fluxo)
router.get('/automacoes/execucoes', async (req, res) => {
  const { accountId, flowId } = req.query;
  if (!accountId) return res.status(400).json({ error: 'accountId é obrigatório' });
  const execucoes = await prisma.automationRun.findMany({
    where: { accountId, ...(flowId && { flowId }) },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json(execucoes);
});

// Roda o fluxo agora mesmo, sem um lead real associado — para testar o conteúdo dos passos
// (o botão "Executar agora" da aba Automação chama isto). Passa pelo motor de verdade, então
// se o fluxo tiver um passo "Esperar", a execução vai realmente ficar "aguardando" e retomar
// sozinha depois — não é mais uma simulação.
router.post('/automacoes/:id/testar', async (req, res) => {
  const { accountId } = req.body;
  const flow = await prisma.automacao.findUnique({ where: { id: req.params.id } });
  if (!flow) return res.status(404).json({ error: 'Fluxo não encontrado' });

  const run = await prisma.automationRun.create({
    data: {
      flowId: flow.id,
      flowNome: flow.nome,
      accountId: accountId || flow.accountId,
      gatilho: 'Teste manual',
      status: 'rodando',
      currentStepIndex: 0,
      log: [`[${new Date().toISOString()}] Execução de teste iniciada manualmente (sem lead associado).`],
    },
  });

  await executarProximoPasso(run.id);
  const runFinal = await prisma.automationRun.findUnique({ where: { id: run.id } });
  res.json(runFinal);
});

module.exports = router;

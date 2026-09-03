const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { notificarN8N } = require('./webhooks');
const { dispararAutomacoes } = require('../services/automationEngine');

async function avisarN8NSeConfigurado(evento, dados) {
  if (!process.env.N8N_INBOUND_WEBHOOK_URL) return;
  try { await notificarN8N(evento, dados); } catch (e) { console.error('Falha ao notificar N8N:', e); }
}

router.get('/pagamentos', async (req, res) => {
  const pagamentos = await prisma.pagamento.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  res.json(pagamentos);
});

router.get('/resumo-financeiro', async (req, res) => {
  const inicioMes = new Date();
  inicioMes.setDate(1);
  inicioMes.setHours(0, 0, 0, 0);
  const pagos = await prisma.pagamento.findMany({ where: { status: 'pago', createdAt: { gte: inicioMes } } });
  const receitaMensal = pagos.reduce((soma, p) => soma + p.valor, 0);
  res.json({ receitaMensal, quantidadePagamentos: pagos.length });
});

router.get('/contatos', async (req, res) => {
  const { accountId } = req.query;
  if (!accountId) return res.status(400).json({ error: 'accountId é obrigatório' });
  const contatos = await prisma.contato.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' } });
  res.json(contatos);
});

router.post('/contatos', async (req, res) => {
  const { accountId, ...dados } = req.body;
  if (!accountId) return res.status(400).json({ error: 'accountId é obrigatório' });
  const contato = await prisma.contato.create({ data: { accountId, ...dados } });
  avisarN8NSeConfigurado('novo_lead', { nome: contato.nome, empresa: contato.empresa, origem: contato.origem, stage: contato.stage });
  dispararAutomacoes(accountId, 'Novo lead criado', contato).catch((e) => console.error('Falha ao disparar automação de novo lead:', e));
  res.json(contato);
});

router.put('/contatos/:id', async (req, res) => {
  const { accountId, id, ...dados } = req.body;

  const antes = await prisma.contato.findUnique({ where: { id: req.params.id } });
  if (!antes) return res.status(404).json({ error: 'Contato não encontrado' });

  const contato = await prisma.contato.update({ where: { id: req.params.id }, data: dados });

  // accountId às vezes não vem no corpo (ex: quando só se arrasta o card no Pipeline) —
  // nesse caso usamos o accountId que o próprio contato já tinha salvo.
  const accountIdEfetivo = accountId || antes.accountId;
  const etapaMudou = dados.stage && dados.stage !== antes.stage;

  if (etapaMudou && dados.stage === 'Fechado') {
    avisarN8NSeConfigurado('negocio_fechado', { nome: contato.nome, empresa: contato.empresa, valorMensal: contato.valorMensal, valorContrato: contato.valorContrato });
    dispararAutomacoes(accountIdEfetivo, 'Contrato fechado', contato).catch((e) => console.error('Falha ao disparar automação de contrato fechado:', e));
  } else if (etapaMudou && dados.stage === 'Proposta') {
    dispararAutomacoes(accountIdEfetivo, 'Proposta enviada', contato).catch((e) => console.error('Falha ao disparar automação de proposta enviada:', e));
  }

  res.json(contato);
});

router.delete('/contatos/:id', async (req, res) => {
  await prisma.contato.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// Adiciona uma tag a um contato e dispara os fluxos com gatilho "Tag adicionada".
// POST /api/contatos/:id/tags  body: { tag }
router.post('/contatos/:id/tags', async (req, res) => {
  const { tag } = req.body;
  if (!tag || !tag.trim()) return res.status(400).json({ error: 'Campo "tag" é obrigatório' });

  const contato = await prisma.contato.findUnique({ where: { id: req.params.id } });
  if (!contato) return res.status(404).json({ error: 'Contato não encontrado' });

  if ((contato.tags || []).includes(tag)) {
    return res.json(contato); // já tinha essa tag, não duplica nem dispara de novo
  }

  const atualizado = await prisma.contato.update({
    where: { id: req.params.id },
    data: { tags: { push: tag } },
  });

  dispararAutomacoes(contato.accountId, 'Tag adicionada', atualizado).catch((e) => console.error('Falha ao disparar automação de tag:', e));

  res.json(atualizado);
});

router.delete('/contatos/:id/tags/:tag', async (req, res) => {
  const contato = await prisma.contato.findUnique({ where: { id: req.params.id } });
  if (!contato) return res.status(404).json({ error: 'Contato não encontrado' });
  const tags = (contato.tags || []).filter((t) => t !== req.params.tag);
  const atualizado = await prisma.contato.update({ where: { id: req.params.id }, data: { tags } });
  res.json(atualizado);
});

router.get('/tarefas', async (req, res) => {
  const { accountId } = req.query;
  if (!accountId) return res.status(400).json({ error: 'accountId é obrigatório' });
  const tarefas = await prisma.tarefa.findMany({ where: { accountId }, orderBy: { data: 'asc' } });
  res.json(tarefas);
});

router.post('/tarefas', async (req, res) => {
  const { accountId, titulo, data, responsavel } = req.body;
  if (!accountId) return res.status(400).json({ error: 'accountId é obrigatório' });
  const tarefa = await prisma.tarefa.create({
    data: { accountId, titulo, data: data ? new Date(data) : null, responsavel },
  });
  res.json(tarefa);
});

router.put('/tarefas/:id', async (req, res) => {
  const { feita, titulo, data } = req.body;
  const tarefa = await prisma.tarefa.update({
    where: { id: req.params.id },
    data: { ...(feita !== undefined && { feita }), ...(titulo && { titulo }), ...(data && { data: new Date(data) }) },
  });
  res.json(tarefa);
});

router.delete('/tarefas/:id', async (req, res) => {
  await prisma.tarefa.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

router.get('/integracoes/status', async (req, res) => {
  const { accountId } = req.query;
  if (!accountId) return res.status(400).json({ error: 'accountId é obrigatório' });

  const tokens = await prisma.integrationToken.findMany({ where: { accountId }, select: { provider: true, updatedAt: true } });
  const pagamentoStripe = await prisma.pagamento.findFirst({ where: { provider: 'stripe' } });

  const conectados = {};
  tokens.forEach((t) => { conectados[t.provider] = { conectado: true, atualizadoEm: t.updatedAt }; });
  if (pagamentoStripe) conectados['stripe'] = { conectado: true, atualizadoEm: pagamentoStripe.createdAt };

  res.json(conectados);
});

module.exports = router;

// Endpoint público para receber leads de um formulário externo (site, landing page, etc).
// Sem autenticação de propósito: é feito para o <form> de uma página pública chamar direto
// via fetch. Isso é o que liga o gatilho "Formulário preenchido" da aba Automação a um lead real.
//
// Exemplo de uso no site do cliente:
//   fetch('https://SEU_BACKEND/api/leads/formulario', {
//     method: 'POST', headers: {'Content-Type':'application/json'},
//     body: JSON.stringify({ accountId: 'studiovisual', nome, email, telefone, origem: 'Site' })
//   })

const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { dispararAutomacoes } = require('../services/automationEngine');

router.post('/leads/formulario', async (req, res) => {
  const { accountId, nome, empresa, telefone, whatsapp, email, tipo, segmento, cidade, estado, notas, origem } = req.body;
  if (!accountId || !nome) return res.status(400).json({ error: 'accountId e nome são obrigatórios' });

  const contato = await prisma.contato.create({
    data: {
      accountId,
      nome,
      empresa,
      telefone,
      whatsapp,
      email,
      tipo: tipo || 'PF',
      segmento,
      cidade,
      estado,
      notas,
      origem: origem || 'Formulário do site',
      status: 'Lead',
      stage: 'Lead',
    },
  });

  dispararAutomacoes(accountId, 'Formulário preenchido', contato).catch((e) => console.error('Falha ao disparar automação de formulário:', e));

  res.json({ ok: true, id: contato.id });
});

module.exports = router;

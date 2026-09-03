const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = verifyStripeSignature(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Assinatura Stripe inválida:', err.message);
    return res.status(400).send('Assinatura inválida.');
  }

  const savedEvent = await prisma.webhookEvent.create({
    data: { provider: 'stripe', eventType: event.type, payload: event },
  });

  try {
    switch (event.type) {
      case 'invoice.paid': {
        const invoice = event.data.object;
        await prisma.pagamento.upsert({
          where: { provider_referenciaId: { provider: 'stripe', referenciaId: invoice.id } },
          update: { status: 'pago' },
          create: {
            provider: 'stripe',
            clienteEmail: invoice.customer_email || null,
            clienteNome: invoice.customer_name || null,
            valor: (invoice.amount_paid || 0) / 100,
            moeda: (invoice.currency || 'brl').toUpperCase(),
            status: 'pago',
            referenciaId: invoice.id,
          },
        });
        if (process.env.N8N_INBOUND_WEBHOOK_URL) {
          try {
            await notificarN8N('pagamento_confirmado', {
              cliente: invoice.customer_email || invoice.customer_name || 'desconhecido',
              valor: (invoice.amount_paid || 0) / 100,
              moeda: (invoice.currency || 'brl').toUpperCase(),
            });
          } catch (e) { console.error('Falha ao notificar N8N:', e); }
        }
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        await prisma.pagamento.upsert({
          where: { provider_referenciaId: { provider: 'stripe', referenciaId: invoice.id } },
          update: { status: 'falhou' },
          create: {
            provider: 'stripe',
            clienteEmail: invoice.customer_email || null,
            clienteNome: invoice.customer_name || null,
            valor: (invoice.amount_due || 0) / 100,
            moeda: (invoice.currency || 'brl').toUpperCase(),
            status: 'falhou',
            referenciaId: invoice.id,
          },
        });
        break;
      }
      case 'customer.subscription.deleted':
        break;
    }
    await prisma.webhookEvent.update({ where: { id: savedEvent.id }, data: { processed: true } });
  } catch (err) {
    console.error('Erro ao processar evento Stripe:', err);
    await prisma.webhookEvent.update({ where: { id: savedEvent.id }, data: { error: String(err) } });
  }

  res.json({ received: true });
});

function verifyStripeSignature(rawBody, signatureHeader, secret) {
  const parts = Object.fromEntries(signatureHeader.split(',').map((p) => p.split('=')));
  const signedPayload = `${parts.t}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  if (expected !== parts.v1) throw new Error('assinatura não confere');
  return JSON.parse(rawBody);
}

router.post('/mercadopago', express.json(), async (req, res) => {
  await prisma.webhookEvent.create({
    data: { provider: 'mercadopago', eventType: req.body.type, payload: req.body },
  });
  res.sendStatus(200);
});

// --- WHATSAPP ---
router.get('/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

router.post('/whatsapp', express.json(), async (req, res) => {
  await prisma.webhookEvent.create({
    data: { provider: 'whatsapp', eventType: 'mensagem', payload: req.body },
  });
  res.sendStatus(200);
});

// --- N8N genérico ---
router.post('/n8n', express.json(), async (req, res) => {
  const token = req.headers['x-webhook-token'];
  if (token !== process.env.N8N_WEBHOOK_TOKEN) return res.sendStatus(401);

  await prisma.webhookEvent.create({
    data: { provider: 'n8n', eventType: req.body.event || null, payload: req.body },
  });
  res.sendStatus(200);
});

async function notificarN8N(evento, dados) {
  await fetch(process.env.N8N_INBOUND_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: evento, data: dados, timestamp: new Date().toISOString() }),
  });
}

router.post('/n8n/testar', express.json(), async (req, res) => {
  if (!process.env.N8N_INBOUND_WEBHOOK_URL) {
    return res.status(200).json({ enviado: false, aviso: 'N8N_INBOUND_WEBHOOK_URL não configurada nas variáveis de ambiente.' });
  }
  try {
    await notificarN8N('teste_manual', { origem: 'CRM Studio Visual', mensagem: 'Teste de conexão com o N8N' });
    res.json({ enviado: true });
  } catch (err) {
    console.error('Erro ao notificar N8N:', err);
    res.status(500).json({ enviado: false, error: String(err) });
  }
});

module.exports = router;
module.exports.notificarN8N = notificarN8N;

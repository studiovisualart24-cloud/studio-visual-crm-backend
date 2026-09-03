// Chama a API do Google Gemini usando uma chave de API gratuita/de baixo custo.
// Isso existe porque chamadas diretas do navegador para IA só funcionam dentro do
// ambiente de artefatos do Claude.ai — fora dali (como no CRM publicado no Netlify), é preciso
// passar pelo backend com uma API key de verdade.

const express = require('express');
const router = express.Router();
const { gerarTexto, conversar } = require('../services/iaService');

router.post('/ia/gerar', async (req, res) => {
  const { prompt, sistema, maxTokens } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Campo "prompt" é obrigatório.' });

  const resultado = await gerarTexto({ prompt, sistema, maxTokens });
  res.status(resultado.error ? 500 : 200).json(resultado);
});

router.post('/ia/conversar', async (req, res) => {
  const { mensagens, sistema, maxTokens } = req.body;
  if (!mensagens || !Array.isArray(mensagens)) return res.status(400).json({ error: 'Campo "mensagens" (array) é obrigatório.' });

  const resultado = await conversar({ mensagens, sistema, maxTokens });
  res.status(resultado.error ? 500 : 200).json(resultado);
});

module.exports = router;

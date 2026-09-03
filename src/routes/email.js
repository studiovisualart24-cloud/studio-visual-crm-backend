const express = require('express');
const router = express.Router();
const { enviarEmail } = require('../services/emailService');

router.post('/enviar-email', async (req, res) => {
  const { para, assunto, corpo, replyTo } = req.body;
  if (!para || !assunto) return res.status(400).json({ error: 'Campos "para" e "assunto" são obrigatórios.' });

  const resultado = await enviarEmail({ para, assunto, corpo, replyTo });
  res.status(resultado.error ? 500 : 200).json(resultado);
});

module.exports = router;

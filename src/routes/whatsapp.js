const express = require('express');
const router = express.Router();
const { enviarWhatsapp } = require('../services/whatsappService');

router.post('/enviar-whatsapp', async (req, res) => {
  const { para, mensagem, templateName, templateParams } = req.body;
  if (!para) return res.status(400).json({ error: 'Campo "para" (número do destinatário) é obrigatório.' });

  const resultado = await enviarWhatsapp({ para, mensagem, templateName, templateParams });
  res.status(resultado.error ? 500 : 200).json(resultado);
});

module.exports = router;

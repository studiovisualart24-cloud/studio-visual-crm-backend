// Publica posts de verdade no Instagram usando a conexão feita em /oauth/instagram/connect
// (login direto com o Instagram, sem depender da Página do Facebook).

const express = require('express');
const router = express.Router();
const { publicarNoInstagramDireto } = require('../services/instagramPublish');

// POST /api/instagram/publicar
// body: { accountId, imageUrl, caption }
router.post('/instagram/publicar', async (req, res) => {
  const { accountId, imageUrl, caption } = req.body;
  if (!accountId || !imageUrl) {
    return res.status(400).json({ error: 'accountId e imageUrl são obrigatórios' });
  }

  try {
    const resultado = await publicarNoInstagramDireto(accountId, { imageUrl, caption: caption || '' });
    if (!resultado.id) throw new Error(JSON.stringify(resultado));
    res.json({ publicado: true, id: resultado.id });
  } catch (err) {
    console.error('Erro ao publicar no Instagram:', err);
    res.status(500).json({ publicado: false, error: String(err.message || err) });
  }
});

module.exports = router;

// Publica posts com imagem no Instagram usando a conexão do Meta (Facebook/Instagram Ads)
// já feita em /oauth/meta/connect, e descobre automaticamente a conta comercial do Instagram
// ligada à Página do Facebook conectada.

const express = require('express');
const router = express.Router();
const tokenService = require('../services/tokenService');
const { publicarNoInstagram, publicarNoFacebook, refreshMetaToken } = require('../services/metaPublish');

// GET /api/meta/contas-instagram?accountId=studiovisual
// Lista as Páginas do Facebook administradas pela conta conectada e, para cada uma, a conta
// comercial do Instagram ligada a ela (se houver).
router.get('/meta/contas-instagram', async (req, res) => {
  const { accountId } = req.query;
  if (!accountId) return res.status(400).json({ error: 'accountId é obrigatório' });

  try {
    const accessToken = await tokenService.getValidAccessToken(accountId, 'meta', refreshMetaToken);

    const paginasRes = await fetch(
      `https://graph.facebook.com/v19.0/me/accounts?fields=name,instagram_business_account{id,username}&access_token=${accessToken}`
    );
    const paginas = await paginasRes.json();
    if (!paginasRes.ok) return res.status(paginasRes.status).json({ error: 'Erro ao consultar Páginas do Facebook', detalhes: paginas });

    const contas = (paginas.data || [])
      .filter((p) => p.instagram_business_account)
      .map((p) => ({
        paginaNome: p.name,
        igUserId: p.instagram_business_account.id,
        igUsername: p.instagram_business_account.username,
      }));

    res.json(contas);
  } catch (err) {
    console.error('Erro ao listar contas do Instagram:', err);
    res.status(500).json({ error: 'Não foi possível listar as contas do Instagram conectadas. Verifique a conexão do Meta em Integrações.' });
  }
});

// POST /api/meta/publicar
// body: { accountId, igUserId, imageUrl, caption }
router.post('/meta/publicar', async (req, res) => {
  const { accountId, igUserId, imageUrl, caption } = req.body;
  if (!accountId || !igUserId || !imageUrl) {
    return res.status(400).json({ error: 'accountId, igUserId e imageUrl são obrigatórios' });
  }

  try {
    const resultado = await publicarNoInstagram(accountId, { imageUrl, caption: caption || '', igUserId });
    if (!resultado.id) throw new Error(JSON.stringify(resultado));
    res.json({ publicado: true, id: resultado.id });
  } catch (err) {
    console.error('Erro ao publicar no Instagram:', err);
    res.status(500).json({ publicado: false, error: String(err.message || err) });
  }
});

// POST /api/meta/publicar-facebook
// body: { accountId, imageUrl, caption, nomePagina? }
router.post('/meta/publicar-facebook', async (req, res) => {
  const { accountId, imageUrl, caption, nomePagina } = req.body;
  if (!accountId || !imageUrl) {
    return res.status(400).json({ error: 'accountId e imageUrl são obrigatórios' });
  }

  try {
    const resultado = await publicarNoFacebook(accountId, { imageUrl, caption: caption || '', nomePagina });
    res.json({ publicado: true, id: resultado.id, paginaNome: resultado.paginaNome });
  } catch (err) {
    console.error('Erro ao publicar no Facebook:', err);
    res.status(500).json({ publicado: false, error: String(err.message || err) });
  }
});

module.exports = router;

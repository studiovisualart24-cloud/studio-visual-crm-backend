// Publica posts (com ou sem imagem) no LinkedIn usando o token já conectado (via /oauth/linkedin/connect).

const express = require('express');
const router = express.Router();
const tokenService = require('../services/tokenService');

// Registra o upload de uma imagem no LinkedIn, baixa a imagem da URL informada (ex: link do
// Google Drive) e envia os bytes pro LinkedIn. Retorna o "asset" (urn) pra usar no post.
async function enviarImagemParaLinkedIn(accessToken, author, imageUrl) {
  const registerRes = await fetch('https://api.linkedin.com/v2/assets?action=registerUpload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify({
      registerUploadRequest: {
        recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
        owner: author,
        serviceRelationships: [
          { relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' },
        ],
      },
    }),
  });
  const registerData = await registerRes.json();
  if (!registerRes.ok) throw new Error('Falha ao registrar upload de imagem no LinkedIn: ' + JSON.stringify(registerData));

  const uploadUrl = registerData.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl;
  const asset = registerData.value.asset;

  const imagemRes = await fetch(imageUrl);
  if (!imagemRes.ok) throw new Error('Não foi possível baixar a imagem da URL informada.');
  const imagemBuffer = Buffer.from(await imagemRes.arrayBuffer());

  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: imagemBuffer,
  });
  if (!uploadRes.ok) throw new Error('Falha ao enviar os bytes da imagem pro LinkedIn.');

  return asset;
}

router.post('/linkedin/publicar', async (req, res) => {
  const { accountId, texto, organizationId, imageUrl } = req.body;
  if (!accountId || !texto) return res.status(400).json({ error: 'accountId e texto são obrigatórios' });

  try {
    const accessToken = await tokenService.getValidAccessToken(accountId, 'linkedin');

    let author;
    if (organizationId) {
      // Publica em nome da Company Page (ex: Studio Visual MKT)
      author = `urn:li:organization:${organizationId}`;
    } else {
      // Publica em nome do perfil pessoal conectado
      const perfilRes = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const perfil = await perfilRes.json();
      if (!perfilRes.ok || !perfil.sub) throw new Error('Não foi possível identificar o perfil do LinkedIn conectado.');
      author = `urn:li:person:${perfil.sub}`;
    }

    let shareContent = {
      shareCommentary: { text: texto },
      shareMediaCategory: 'NONE',
    };

    if (imageUrl) {
      const asset = await enviarImagemParaLinkedIn(accessToken, author, imageUrl);
      shareContent = {
        shareCommentary: { text: texto },
        shareMediaCategory: 'IMAGE',
        media: [{ status: 'READY', media: asset }],
      };
    }

    const postRes = await fetch('https://api.linkedin.com/v2/ugcPosts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify({
        author,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': shareContent,
        },
        visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
      }),
    });

    const data = await postRes.json();
    if (!postRes.ok) throw new Error(JSON.stringify(data));

    res.json({ publicado: true, id: postRes.headers.get('x-restli-id') || data.id });
  } catch (err) {
    console.error('Erro ao publicar no LinkedIn:', err);
    res.status(500).json({ publicado: false, error: String(err.message || err) });
  }
});

// Lista as Company Pages que a conta conectada administra, para descobrir o ID a usar.
router.get('/linkedin/organizacoes', async (req, res) => {
  const { accountId } = req.query;
  if (!accountId) return res.status(400).json({ error: 'accountId é obrigatório' });

  try {
    const accessToken = await tokenService.getValidAccessToken(accountId, 'linkedin');
    const resp = await fetch(
      'https://api.linkedin.com/v2/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&projection=(elements*(organization~(id,localizedName)))',
      { headers: { Authorization: `Bearer ${accessToken}`, 'X-Restli-Protocol-Version': '2.0.0' } }
    );
    const data = await resp.json();
    if (!resp.ok) return res.status(resp.status).json({ error: 'Erro ao buscar páginas', detalhes: data });

    const organizacoes = (data.elements || []).map((el) => ({
      id: el['organization~']?.id,
      nome: el['organization~']?.localizedName,
    }));
    res.json(organizacoes);
  } catch (err) {
    console.error('Erro ao listar organizações do LinkedIn:', err);
    res.status(500).json({ error: 'Não foi possível listar as páginas administradas.' });
  }
});

module.exports = router;

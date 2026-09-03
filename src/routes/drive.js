// Usa o mesmo token do Google que já conectamos (Calendar + Drive compartilham a mesma autorização
// concedida na tela de consentimento) para listar arquivos e criar pastas no Google Drive do usuário.

const express = require('express');
const router = express.Router();
const tokenService = require('../services/tokenService');

async function refreshGoogleToken(refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  return res.json();
}

// GET /api/drive/arquivos?accountId=studiovisual — lista os arquivos mais recentes
router.get('/drive/arquivos', async (req, res) => {
  const { accountId } = req.query;
  if (!accountId) return res.status(400).json({ error: 'accountId é obrigatório' });

  try {
    const accessToken = await tokenService.getValidAccessToken(accountId, 'google', refreshGoogleToken);

    const url = 'https://www.googleapis.com/drive/v3/files?pageSize=30&orderBy=modifiedTime desc&fields=files(id,name,mimeType,webViewLink,modifiedTime,iconLink)';
    const driveRes = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = await driveRes.json();

    if (!driveRes.ok) return res.status(driveRes.status).json({ error: 'Erro ao consultar o Drive', detalhes: data });

    res.json(data.files || []);
  } catch (err) {
    console.error('Erro ao listar arquivos do Drive:', err);
    res.status(500).json({ error: 'Não foi possível acessar o Drive. Verifique se a conta Google está conectada.' });
  }
});

// POST /api/drive/pasta — cria uma pasta nova (ex: uma pasta por cliente)
// body: { accountId, nome, pastaPaiId? }
router.post('/drive/pasta', async (req, res) => {
  const { accountId, nome, pastaPaiId } = req.body;
  if (!accountId || !nome) return res.status(400).json({ error: 'accountId e nome são obrigatórios' });

  try {
    const accessToken = await tokenService.getValidAccessToken(accountId, 'google', refreshGoogleToken);

    const body = {
      name: nome,
      mimeType: 'application/vnd.google-apps.folder',
      ...(pastaPaiId && { parents: [pastaPaiId] }),
    };

    const driveRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await driveRes.json();
    if (!driveRes.ok) return res.status(driveRes.status).json({ error: 'Erro ao criar pasta', detalhes: data });

    res.json(data);
  } catch (err) {
    console.error('Erro ao criar pasta no Drive:', err);
    res.status(500).json({ error: 'Não foi possível criar a pasta.' });
  }
});

module.exports = router;

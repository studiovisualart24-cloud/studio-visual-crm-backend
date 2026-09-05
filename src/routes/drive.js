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

// POST /api/drive/upload-imagem?accountId=studiovisual&nome=foto.jpg
// Corpo da requisição: os bytes crus da imagem (Content-Type: image/jpeg, image/png etc, não JSON).
// Sobe a imagem pro Google Drive do usuário, deixa ela pública ("qualquer pessoa com o link") e
// devolve um link direto — é esse link que a Meta usa pra buscar a imagem na hora de publicar
// no Instagram (a API do Instagram exige uma URL pública da imagem, não aceita upload direto).
router.post('/drive/upload-imagem', express.raw({ type: () => true, limit: '15mb' }), async (req, res) => {
  const { accountId, nome } = req.query;
  if (!accountId) return res.status(400).json({ error: 'accountId é obrigatório' });
  if (!Buffer.isBuffer(req.body) || !req.body.length) {
    return res.status(400).json({ error: 'Nenhuma imagem recebida.' });
  }

  try {
    const accessToken = await tokenService.getValidAccessToken(accountId, 'google', refreshGoogleToken);
    const mimeType = req.headers['content-type'] || 'image/jpeg';
    const nomeArquivo = nome || `post-${Date.now()}.jpg`;

    // Upload "multipart" simples: metadados (nome do arquivo) + os bytes da imagem, num único
    // envio pra API do Drive.
    const boundary = 'crmboundary' + Date.now();
    const cabecalho =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: nomeArquivo })}\r\n` +
      `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
    const corpoCompleto = Buffer.concat([
      Buffer.from(cabecalho, 'utf-8'),
      req.body,
      Buffer.from(`\r\n--${boundary}--`, 'utf-8'),
    ]);

    const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: corpoCompleto,
    });
    const arquivo = await uploadRes.json();
    if (!uploadRes.ok || !arquivo.id) throw new Error('Falha no upload: ' + JSON.stringify(arquivo));

    // Sem isso o link fica privado e a Meta não consegue baixar a imagem pra publicar.
    await fetch(`https://www.googleapis.com/drive/v3/files/${arquivo.id}/permissions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    });

    const urlDireta = `https://drive.google.com/thumbnail?id=${arquivo.id}&sz=w1600`;
    res.json({ ok: true, fileId: arquivo.id, url: urlDireta });
  } catch (err) {
    console.error('Erro ao subir imagem pro Drive:', err);
    res.status(500).json({ error: 'Não foi possível enviar a imagem. Verifique se a conta Google está conectada em Integrações.' });
  }
});

module.exports = router;

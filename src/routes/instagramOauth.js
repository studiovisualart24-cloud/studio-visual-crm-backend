// Login DIRETO com o Instagram ("Instagram API com Login do Instagram") — diferente do fluxo
// "Meta" (Login do Facebook) usado em oauth.js. Aqui a autorização acontece direto com a conta
// profissional do Instagram, em instagram.com, e já devolve o ID da conta do Instagram junto
// com o token — sem precisar descobrir a Página do Facebook nem passar por revisão da Meta.
//
// Usa credenciais próprias (INSTAGRAM_CLIENT_ID / INSTAGRAM_CLIENT_SECRET), diferentes do
// META_CLIENT_ID / META_CLIENT_SECRET usados pra anúncios.

const express = require('express');
const router = express.Router();
const tokenService = require('../services/tokenService');

const IG_CLIENT_ID = process.env.INSTAGRAM_CLIENT_ID;
const IG_CLIENT_SECRET = process.env.INSTAGRAM_CLIENT_SECRET;

router.get('/instagram/connect', (req, res) => {
  const accountId = req.query.accountId || req.session?.accountId;
  if (!accountId) return res.status(400).send('accountId é obrigatório.');

  const redirectUri = `${process.env.APP_URL}/oauth/instagram/callback`;
  const state = Buffer.from(JSON.stringify({ accountId })).toString('base64url');

  const params = new URLSearchParams({
    client_id: IG_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'instagram_business_basic,instagram_business_content_publish',
    response_type: 'code',
    state,
  });

  res.redirect(`https://www.instagram.com/oauth/authorize?${params.toString()}`);
});

router.get('/instagram/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.status(400).send('Autorização negada ou code ausente.');

  let accountId;
  try {
    accountId = JSON.parse(Buffer.from(state, 'base64url').toString()).accountId;
  } catch {
    return res.status(400).send('State inválido.');
  }

  const redirectUri = `${process.env.APP_URL}/oauth/instagram/callback`;

  try {
    // Passo 1: troca o código pelo token de curta duração — a resposta já vem com o ID da
    // conta do Instagram (user_id), sem precisar consultar nenhuma Página do Facebook.
    const tokenRes = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: IG_CLIENT_ID,
        client_secret: IG_CLIENT_SECRET,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(JSON.stringify(tokenData));

    const item = Array.isArray(tokenData.data) ? tokenData.data[0] : tokenData;
    const shortLivedToken = item.access_token;
    const igUserId = item.user_id;
    if (!shortLivedToken || !igUserId) throw new Error('Resposta inesperada do Instagram: ' + JSON.stringify(tokenData));

    // Passo 2: troca pelo token de longa duração (~60 dias, renovável automaticamente depois).
    const longLivedRes = await fetch(
      `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${IG_CLIENT_SECRET}&access_token=${shortLivedToken}`
    );
    const longLivedData = await longLivedRes.json();
    if (!longLivedRes.ok) throw new Error(JSON.stringify(longLivedData));

    await tokenService.saveToken({
      accountId,
      provider: 'instagram',
      accessToken: longLivedData.access_token,
      refreshToken: null,
      expiresIn: longLivedData.expires_in,
      scope: 'instagram_business_basic,instagram_business_content_publish',
      raw: { igUserId },
    });

    res.redirect(`${process.env.FRONTEND_URL}/?connected=instagram`);
  } catch (err) {
    console.error('Erro no OAuth do Instagram:', err);
    res.status(500).send('Erro ao concluir a conexão com o Instagram. Veja os logs do servidor.');
  }
});

module.exports = router;

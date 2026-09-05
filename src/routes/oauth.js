const express = require('express');
const router = express.Router();
const tokenService = require('../services/tokenService');

const PROVIDERS = {
  meta: {
    authUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
    clientId: process.env.META_CLIENT_ID,
    clientSecret: process.env.META_CLIENT_SECRET,
    scope: 'instagram_content_publish,pages_show_list,ads_management,ads_read',  },
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    scope: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive.file',
    extraParams: { access_type: 'offline', prompt: 'consent' },
  },
  linkedin: {
    authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    clientId: process.env.LINKEDIN_CLIENT_ID,
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
    scope: 'openid profile w_member_social',
  },
};

function getAccountId(req) {
  return req.query.accountId || req.session?.accountId;
}

router.get('/:provider/connect', (req, res) => {
  const cfg = PROVIDERS[req.params.provider];
  if (!cfg) return res.status(404).send('Provedor não suportado.');
  const accountId = getAccountId(req);
  if (!accountId) return res.status(400).send('accountId é obrigatório.');

  const redirectUri = `${process.env.APP_URL}/oauth/${req.params.provider}/callback`;
  const state = Buffer.from(JSON.stringify({ accountId })).toString('base64url');

  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    scope: cfg.scope,
    response_type: 'code',
    state,
    ...(cfg.extraParams || {}),
  });

  res.redirect(`${cfg.authUrl}?${params.toString()}`);
});

router.get('/:provider/callback', async (req, res) => {
  const cfg = PROVIDERS[req.params.provider];
  if (!cfg) return res.status(404).send('Provedor não suportado.');
  const { code, state } = req.query;
  if (!code) return res.status(400).send('Autorização negada ou code ausente.');

  let accountId;
  try {
    accountId = JSON.parse(Buffer.from(state, 'base64url').toString()).accountId;
  } catch {
    return res.status(400).send('State inválido.');
  }

  const redirectUri = `${process.env.APP_URL}/oauth/${req.params.provider}/callback`;

  try {
    const tokenRes = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: redirectUri,
        code,
        grant_type: 'authorization_code',
      }),
    });
    const data = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(JSON.stringify(data));

    await tokenService.saveToken({
      accountId,
      provider: req.params.provider,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      scope: data.scope,
      raw: data,
    });

    res.redirect(`${process.env.FRONTEND_URL}/integracoes?connected=${req.params.provider}`);
  } catch (err) {
    console.error('Erro no OAuth callback:', err);
    res.status(500).send('Erro ao concluir a conexão. Veja os logs do servidor.');
  }
});

router.post('/:provider/disconnect', async (req, res) => {
  const accountId = getAccountId(req);
  await tokenService.disconnect(accountId, req.params.provider);
  res.json({ ok: true });
});

module.exports = router;

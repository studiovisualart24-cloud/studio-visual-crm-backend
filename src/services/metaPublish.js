// Exemplo de uso prático: publicar um post no Instagram usando o token salvo do cliente.
// Mostra o padrão que você repete para qualquer chamada autenticada (Google Calendar, Ads, etc).

const tokenService = require('./tokenService');

async function refreshMetaToken(refreshToken) {
  // A Graph API da Meta usa "long-lived tokens" (~60 dias) em vez de refresh_token clássico.
  // Aqui simplificado; o fluxo exato depende do tipo de token (usuário vs página).
  const res = await fetch(
    `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${process.env.META_CLIENT_ID}&client_secret=${process.env.META_CLIENT_SECRET}&fb_exchange_token=${refreshToken}`
  );
  return res.json();
}

async function publicarNoInstagram(accountId, { imageUrl, caption, igUserId }) {
  const accessToken = await tokenService.getValidAccessToken(accountId, 'meta', refreshMetaToken);

  // Passo 1: cria o "container" de mídia
  const container = await fetch(
    `https://graph.facebook.com/v19.0/${igUserId}/media?image_url=${encodeURIComponent(imageUrl)}&caption=${encodeURIComponent(caption)}&access_token=${accessToken}`,
    { method: 'POST' }
  ).then((r) => r.json());

  if (!container.id) throw new Error('Falha ao criar mídia: ' + JSON.stringify(container));

  // Passo 2: publica o container
  const publish = await fetch(
    `https://graph.facebook.com/v19.0/${igUserId}/media_publish?creation_id=${container.id}&access_token=${accessToken}`,
    { method: 'POST' }
  ).then((r) => r.json());

  return publish; // { id: "..." } do post publicado
}

module.exports = { publicarNoInstagram };

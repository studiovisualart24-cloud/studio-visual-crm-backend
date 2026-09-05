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

// Publica uma foto de verdade na Página do Facebook. Diferente do Instagram, aqui não existe um
// "ID fixo" salvo na conexão — a gente descobre a Página certa toda vez consultando as Páginas
// que a conta autorizou (/me/accounts), porque cada Página tem seu próprio "token de Página"
// (diferente do token do usuário) que é quem realmente tem permissão pra publicar nela.
async function publicarNoFacebook(accountId, { imageUrl, caption, nomePagina }) {
  const accessToken = await tokenService.getValidAccessToken(accountId, 'meta', refreshMetaToken);

  const paginasRes = await fetch(
    `https://graph.facebook.com/v19.0/me/accounts?fields=name,access_token&access_token=${accessToken}`
  );
  const paginasData = await paginasRes.json();
  if (!paginasRes.ok) throw new Error('Erro ao consultar Páginas do Facebook: ' + JSON.stringify(paginasData));

  const paginas = paginasData.data || [];
  if (paginas.length === 0) throw new Error('Nenhuma Página do Facebook encontrada nessa conexão. Confira a conexão do Meta em Integrações.');

  // Se um nome específico foi passado, procura por ele; senão usa a primeira Página encontrada.
  const pagina = nomePagina
    ? paginas.find((p) => p.name.toLowerCase().includes(nomePagina.toLowerCase())) || paginas[0]
    : paginas[0];

  const publish = await fetch(
    `https://graph.facebook.com/v19.0/${pagina.id}/photos?url=${encodeURIComponent(imageUrl)}&caption=${encodeURIComponent(caption || '')}&access_token=${pagina.access_token}`,
    { method: 'POST' }
  ).then((r) => r.json());

  if (!publish.id && !publish.post_id) throw new Error('Falha ao publicar: ' + JSON.stringify(publish));

  return { id: publish.post_id || publish.id, paginaNome: pagina.name };
}

module.exports = { publicarNoInstagram, publicarNoFacebook, refreshMetaToken };

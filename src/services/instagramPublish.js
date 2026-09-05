// Publica fotos no Instagram usando o login DIRETO com o Instagram ("Instagram API com Login do
// Instagram"), sem passar pela Página do Facebook. Esse fluxo evita a exigência de revisão da
// Meta que o fluxo antigo (via Facebook Login) pedia só pra descobrir a conta do Instagram ligada
// à Página — aqui a gente já recebe o ID da conta direto na hora de conectar.

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const tokenService = require('./tokenService');

const IG_CLIENT_SECRET = process.env.INSTAGRAM_CLIENT_SECRET;

// O Instagram não usa um "refresh_token" separado: você troca o token de longa duração atual
// por um novo token de longa duração (também válido por ~60 dias). Por isso aqui o "refreshToken"
// guardado é o próprio access_token.
async function refreshInstagramToken(currentToken) {
  const res = await fetch(
    `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${currentToken}`
  );
  const data = await res.json();
  return { access_token: data.access_token, refresh_token: data.access_token, expires_in: data.expires_in };
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// O Instagram processa a imagem em segundo plano depois de criar o "container" (baixa a foto da
// URL, converte etc). Se a gente tentar publicar cedo demais, ele responde com o erro "Media ID
// is not available" / "not ready for publishing". Por isso esperamos o status_code virar
// "FINISHED" antes do passo 2 — geralmente leva só 1-3 segundos, raramente mais que isso.
async function esperarMidiaFicarPronta(containerId, accessToken, tentativas = 10) {
  for (let i = 0; i < tentativas; i++) {
    const status = await fetch(
      `https://graph.instagram.com/v21.0/${containerId}?fields=status_code&access_token=${accessToken}`
    ).then((r) => r.json());

    if (status.status_code === 'FINISHED') return;
    if (status.status_code === 'ERROR') throw new Error('O Instagram não conseguiu processar a imagem: ' + JSON.stringify(status));

    await esperar(1500); // espera um pouco e checa de novo
  }
  throw new Error('A imagem demorou demais pra ficar pronta no Instagram. Tenta publicar de novo em alguns segundos.');
}

async function publicarNoInstagramDireto(accountId, { imageUrl, caption }) {
  const row = await prisma.integrationToken.findUnique({
    where: { accountId_provider: { accountId, provider: 'instagram' } },
  });
  if (!row) throw new Error('Instagram não conectado para esta conta. Conecte em Integrações primeiro.');

  const igUserId = row.raw?.igUserId;
  if (!igUserId) throw new Error('Não foi possível identificar a conta do Instagram conectada.');

  const accessToken = await tokenService.getValidAccessToken(accountId, 'instagram', refreshInstagramToken);

  // Passo 1: cria o "container" de mídia com a foto e a legenda.
  const container = await fetch(
    `https://graph.instagram.com/v21.0/${igUserId}/media?image_url=${encodeURIComponent(imageUrl)}&caption=${encodeURIComponent(caption || '')}&access_token=${accessToken}`,
    { method: 'POST' }
  ).then((r) => r.json());
  if (!container.id) throw new Error('Falha ao criar mídia: ' + JSON.stringify(container));

  // Passo 2: espera o Instagram terminar de processar a imagem.
  await esperarMidiaFicarPronta(container.id, accessToken);

  // Passo 3: publica o container de verdade no perfil.
  const publish = await fetch(
    `https://graph.instagram.com/v21.0/${igUserId}/media_publish?creation_id=${container.id}&access_token=${accessToken}`,
    { method: 'POST' }
  ).then((r) => r.json());

  return publish; // { id: "..." } do post publicado
}

module.exports = { publicarNoInstagramDireto, refreshInstagramToken };

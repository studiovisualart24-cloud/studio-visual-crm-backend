const { PrismaClient } = require('@prisma/client');
const { encrypt, decrypt } = require('./crypto');
const prisma = new PrismaClient();

async function saveToken({ accountId, provider, accessToken, refreshToken, expiresIn, scope, raw }) {
  const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;
  return prisma.integrationToken.upsert({
    where: { accountId_provider: { accountId, provider } },
    update: {
      accessToken: encrypt(accessToken),
      refreshToken: refreshToken ? encrypt(refreshToken) : undefined,
      expiresAt,
      scope,
      raw,
    },
    create: {
      accountId,
      provider,
      accessToken: encrypt(accessToken),
      refreshToken: refreshToken ? encrypt(refreshToken) : null,
      expiresAt,
      scope,
      raw,
    },
  });
}

async function getValidAccessToken(accountId, provider, refreshFn) {
  const row = await prisma.integrationToken.findUnique({
    where: { accountId_provider: { accountId, provider } },
  });
  if (!row) throw new Error(`Nenhuma conexão encontrada para ${provider} nesta conta.`);

  const expired = row.expiresAt && row.expiresAt.getTime() < Date.now() + 60_000;
  if (expired && row.refreshToken && refreshFn) {
    const refreshed = await refreshFn(decrypt(row.refreshToken));
    await saveToken({
      accountId,
      provider,
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token || decrypt(row.refreshToken),
      expiresIn: refreshed.expires_in,
      scope: row.scope,
      raw: refreshed,
    });
    return refreshed.access_token;
  }

  return decrypt(row.accessToken);
}

async function isConnected(accountId, provider) {
  const row = await prisma.integrationToken.findUnique({
    where: { accountId_provider: { accountId, provider } },
  });
  return !!row;
}

async function disconnect(accountId, provider) {
  return prisma.integrationToken.deleteMany({ where: { accountId, provider } });
}

module.exports = { saveToken, getValidAccessToken, isConnected, disconnect };

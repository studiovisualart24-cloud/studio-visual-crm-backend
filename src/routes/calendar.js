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

router.get('/calendar/events', async (req, res) => {
  const { accountId } = req.query;
  if (!accountId) return res.status(400).json({ error: 'accountId é obrigatório' });

  try {
    const accessToken = await tokenService.getValidAccessToken(accountId, 'google', refreshGoogleToken);
    const now = new Date().toISOString();
    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(now)}&maxResults=20&singleEvents=true&orderBy=startTime`;

    const calRes = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = await calRes.json();

    if (!calRes.ok) return res.status(calRes.status).json({ error: 'Erro ao consultar o Google Calendar', detalhes: data });

    const eventos = (data.items || []).map((ev) => ({
      id: ev.id,
      titulo: ev.summary || '(Sem título)',
      inicio: ev.start?.dateTime || ev.start?.date,
      fim: ev.end?.dateTime || ev.end?.date,
      local: ev.location || null,
      link: ev.htmlLink,
    }));

    res.json(eventos);
  } catch (err) {
    console.error('Erro ao buscar eventos do Calendar:', err);
    res.status(500).json({ error: 'Não foi possível buscar os eventos. Verifique se a conta Google está conectada.' });
  }
});

module.exports = router;

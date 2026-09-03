// Chama a API do Google Gemini. Separado da rota HTTP para poder ser usado tanto por
// /api/ia/gerar e /api/ia/conversar quanto pelo motor de automação (passo "Disparar IA").

const GEMINI_MODEL = 'gemini-2.0-flash';

async function chamarGemini(mensagens, sistema, maxTokens) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const body = {
    contents: mensagens.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    ...(sistema && { systemInstruction: { parts: [{ text: sistema }] } }),
    generationConfig: { maxOutputTokens: maxTokens || 800 },
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(JSON.stringify(data));

  return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('\n').trim();
}

async function gerarTexto({ prompt, sistema, maxTokens }) {
  if (!process.env.GEMINI_API_KEY) {
    return { ok: false, aviso: 'GEMINI_API_KEY não configurada. Crie uma chave grátis em aistudio.google.com/apikey e adicione nas variáveis de ambiente.' };
  }
  try {
    const texto = await chamarGemini([{ role: 'user', content: prompt }], sistema, maxTokens);
    return { ok: true, texto };
  } catch (err) {
    console.error('Erro ao chamar a IA:', err);
    return { ok: false, error: String(err) };
  }
}

async function conversar({ mensagens, sistema, maxTokens }) {
  if (!process.env.GEMINI_API_KEY) {
    return { ok: false, aviso: 'GEMINI_API_KEY não configurada. Crie uma chave grátis em aistudio.google.com/apikey e adicione nas variáveis de ambiente.' };
  }
  try {
    const texto = await chamarGemini(mensagens, sistema, maxTokens);
    return { ok: true, texto };
  } catch (err) {
    console.error('Erro ao chamar a IA:', err);
    return { ok: false, error: String(err) };
  }
}

module.exports = { gerarTexto, conversar };

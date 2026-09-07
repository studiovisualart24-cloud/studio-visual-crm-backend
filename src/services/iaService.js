// Chama a API do Google Gemini (tem camada gratuita, sem custo pra esse tipo de uso — geração
// de posts, legendas, e-mails curtos) em vez da API paga da Anthropic. Precisa de uma chave
// grátis criada em aistudio.google.com/apikey, salva na variável de ambiente GEMINI_API_KEY.
//
// As funções gerarTexto() e conversar() mantêm a mesma assinatura de antes — quem chama (rotas
// e automação) não precisa saber qual provedor de IA está por trás.

const GEMINI_MODEL = 'gemini-3.6-flash';

async function chamarGemini(mensagens, sistema, maxTokens) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const body = {
    contents: mensagens.map((m) => ({
      // O Gemini usa "model" em vez de "assistant" pro papel da IA na conversa.
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    generationConfig: { maxOutputTokens: maxTokens || 800 },
    ...(sistema && { systemInstruction: { parts: [{ text: sistema }] } }),
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(JSON.stringify(data));

  const partes = data.candidates?.[0]?.content?.parts || [];
  return partes.map((p) => p.text || '').join('\n').trim();
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

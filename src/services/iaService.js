// Chama a API da Anthropic (Claude) usando uma chave de API paga (sem plano grátis, mas
// custo por mensagem costuma ser baixo). Isso existe porque chamadas diretas do navegador
// para IA só funcionam dentro do ambiente de artefatos do Claude.ai — fora dali (como no CRM
// publicado no Netlify), é preciso passar pelo backend com uma API key de verdade.

const CLAUDE_MODEL = 'claude-sonnet-5';

async function chamarClaude(mensagens, sistema, maxTokens) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.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,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens || 800,
      ...(sistema && { system: sistema }),
      messages: mensagens.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(JSON.stringify(data));

  return (data.content || []).map((bloco) => bloco.text || '').join('\n').trim();
}

async function gerarTexto({ prompt, sistema, maxTokens }) {
  if (!process.env.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) {
    return { ok: false, aviso: 'ANTHROPIC_API_KEY não configurada. Crie uma chave em console.anthropic.com/settings/keys e adicione nas variáveis de ambiente.' };
  }
  try {
    const texto = await chamarClaude([{ role: 'user', content: prompt }], sistema, maxTokens);
    return { ok: true, texto };
  } catch (err) {
    console.error('Erro ao chamar a IA:', err);
    return { ok: false, error: String(err) };
  }
}

async function conversar({ mensagens, sistema, maxTokens }) {
  if (!process.env.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) {
    return { ok: false, aviso: 'ANTHROPIC_API_KEY não configurada. Crie uma chave em console.anthropic.com/settings/keys e adicione nas variáveis de ambiente.' };
  }
  try {
    const texto = await chamarClaude(mensagens, sistema, maxTokens);
    return { ok: true, texto };
  } catch (err) {
    console.error('Erro ao chamar a IA:', err);
    return { ok: false, error: String(err) };
  }
}

module.exports = { gerarTexto, conversar };

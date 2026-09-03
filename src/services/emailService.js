// Lógica de envio de email (Resend), separada da rota HTTP para poder ser chamada
// tanto por /api/enviar-email quanto pelo motor de automação (src/services/automationEngine.js).

async function enviarEmail({ para, assunto, corpo, replyTo }) {
  if (!process.env.RESEND_API_KEY) {
    return {
      enviado: false,
      aviso: 'RESEND_API_KEY não configurada — email não foi enviado de verdade. Crie uma conta grátis em resend.com e adicione a chave nas variáveis de ambiente.',
    };
  }

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
        to: para,
        subject: assunto,
        text: corpo || '',
        reply_to: replyTo || process.env.RESEND_REPLY_TO || undefined,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(JSON.stringify(data));
    return { enviado: true, id: data.id };
  } catch (err) {
    console.error('Erro ao enviar email:', err);
    return { enviado: false, error: String(err) };
  }
}

module.exports = { enviarEmail };

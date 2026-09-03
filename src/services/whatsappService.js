// Lógica de envio de WhatsApp (WhatsApp Business Cloud API), separada da rota HTTP para poder
// ser chamada tanto por /api/enviar-whatsapp quanto pelo motor de automação.

async function enviarWhatsapp({ para, mensagem, templateName, templateParams }) {
  if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_ID) {
    return {
      enviado: false,
      aviso: 'WHATSAPP_TOKEN ou WHATSAPP_PHONE_ID não configurados nas variáveis de ambiente.',
    };
  }

  const numeroLimpo = String(para).replace(/\D/g, '');

  const body = templateName
    ? {
        messaging_product: 'whatsapp',
        to: numeroLimpo,
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'pt_BR' },
          components: templateParams
            ? [{ type: 'body', parameters: templateParams.map((p) => ({ type: 'text', text: p })) }]
            : [],
        },
      }
    : {
        messaging_product: 'whatsapp',
        to: numeroLimpo,
        type: 'text',
        text: { body: mensagem || '' },
      };

  try {
    const resp = await fetch(`https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(JSON.stringify(data));
    return { enviado: true, id: data.messages?.[0]?.id };
  } catch (err) {
    console.error('Erro ao enviar WhatsApp:', err);
    return { enviado: false, error: String(err) };
  }
}

module.exports = { enviarWhatsapp };

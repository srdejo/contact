const GRAPH_VERSION = 'v20.0';

export async function sendWhatsAppMessage({ to, text }) {
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const token = process.env.WHATSAPP_TOKEN;
  const recipient = to || process.env.WHATSAPP_TO_NUMBER;

  if (!phoneId || !token) {
    throw new Error('WHATSAPP_PHONE_ID o WHATSAPP_TOKEN no configurados en .env');
  }
  if (!recipient) {
    throw new Error('Número destino no configurado (WHATSAPP_TO_NUMBER o parámetro "to")');
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}/messages`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: recipient,
      type: 'text',
      text: { body: text },
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Error de WhatsApp API: ${JSON.stringify(data)}`);
  }
  return data;
}

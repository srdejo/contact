/**
 * Controlador de las rutas de WhatsApp.
 *
 * Recibe un `whatsappService` (adaptador sobre el cliente de Baileys) en vez de
 * importar el cliente: la ruta queda testeable con un doble y el controlador no
 * conoce el transporte.
 */
export function createWhatsAppController({ whatsappService }) {
  return {
    send: async (req, res) => {
      const { jid, phone, text } = req.body || {};

      if (!text || (!jid && !phone)) {
        return res.status(400).json({
          error: 'text y phone o jid son requeridos',
        });
      }

      // `jid` (respuesta de PERLA a un chat) gana sobre `phone` y va tal cual.
      const destination = jid ? { jid } : { phone };

      try {
        const result = await whatsappService.send({ ...destination, text });

        return res.json({
          status: 'ok',
          messageId: result?.key?.id ?? null,
        });
      } catch (error) {
        return res.status(502).json({
          error: error.message,
        });
      }
    },

    status: (_req, res) => {
      return res.json(whatsappService.status());
    },
  };
}

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
      const { phone, text } = req.body || {};

      if (!phone || !text) {
        return res.status(400).json({
          error: 'phone y text son requeridos',
        });
      }

      try {
        const result = await whatsappService.send({ phone, text });

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

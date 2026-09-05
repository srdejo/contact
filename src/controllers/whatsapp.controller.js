export function createWhatsAppController({
  whatsappService,
}) {
  return {

    send: async (req, res) => {
      const {
        phone,
        message,
      } = req.body || {};

      if (!phone || !message) {
        return res.status(400).json({
          error:
            'phone y message son requeridos',
        });
      }

      try {
        const result =
          await whatsappService.send({
            phone,
            message,
          });

        return res.json({
          status: 'ok',
          messageId:
            result?.key?.id ?? null,
        });

      } catch (error) {
        return res.status(502).json({
          error: error.message,
        });
      }
    },

    status: (_req, res) => {
      return res.json(
        whatsappService.status()
      );
    },

    qr: (_req, res) => {
      const qr =
        whatsappService.qr();

      if (!qr) {
        return res.status(404).json({
          error: 'QR no disponible',
        });
      }

      return res.json({
        qr,
      });
    },
  };
}
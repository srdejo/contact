/**
 * Controlador del envío de correo interno (`POST /api/send`).
 *
 * `fromName` es opcional y sirve para que cada servicio consumidor firme con su
 * propio nombre. La dirección no se recibe: la resuelve el cliente de Gmail, que es
 * el único que conoce la cuenta que envía.
 */
export function createGmailController({ gmailService }) {
  return {
    send: async (req, res) => {
      const { to, subject, html, from, fromName } = req.body || {};

      if (!to || !subject || !html) {
        return res.status(400).json({
          error: 'to, subject y html son requeridos',
        });
      }

      try {
        await gmailService.send({ to, subject, html, from, fromName });

        return res.json({
          status: 'ok',
        });
      } catch (error) {
        return res.status(502).json({
          error: error.message,
        });
      }
    },
  };
}

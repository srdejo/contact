/**
 * Controlador del formulario público de contacto.
 *
 * Notifica por dos canales independientes (email y WhatsApp) y responde 207
 * cuando alguno falla: el contrato que ya consumen los frontends. Un canal caído
 * no debe tumbar al otro, por eso cada envío va en su propio try/catch.
 */
export function createContactController({
  emailService,
  whatsappService,
  whatsappToNumber,
}) {
  return {
    send: async (req, res) => {
      const { name, email, message } = req.body || {};

      if (!name || !email || !message) {
        return res.status(400).json({
          error: 'name, email y message son requeridos',
        });
      }

      const html = `
    <p><strong>Nombre:</strong> ${name}</p>
    <p><strong>Email:</strong> ${email}</p>
    <p><strong>Mensaje:</strong></p>
    <p>${message}</p>
  `;

      const results = { email: null, whatsapp: null };
      const errors = {};

      try {
        results.email = await emailService.send({
          subject: `Nuevo contacto de ${name}`,
          html,
        });
      } catch (err) {
        errors.email = err.message;
      }

      try {
        results.whatsapp = await whatsappService.send({
          phone: whatsappToNumber(),
          text: `Nuevo contacto:\nNombre: ${name}\nEmail: ${email}\nMensaje: ${message}`,
        });
      } catch (err) {
        errors.whatsapp = err.message;
      }

      const hasErrors = Object.keys(errors).length > 0;

      return res.status(hasErrors ? 207 : 200).json({
        results,
        errors: hasErrors ? errors : undefined,
      });
    },
  };
}

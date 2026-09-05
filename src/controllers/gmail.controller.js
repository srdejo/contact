export function createGmailController({
  gmailService,
}) {
  return {
    send: async (req, res) => {
      const {
        to,
        subject,
        html,
        from,
      } = req.body || {};

      if (!to || !subject || !html) {
        return res.status(400).json({
          error: 'to, subject y html son requeridos',
        });
      }

      try {
        await gmailService.send({
          to,
          subject,
          html,
          from,
        });

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
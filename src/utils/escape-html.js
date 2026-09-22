/**
 * Escapa los cinco caracteres con significado en HTML.
 *
 * El formulario de contacto es publico: cualquiera puede mandar `name`, `email` y
 * `message`. Esos valores se interpolan en el cuerpo HTML del correo, asi que sin
 * escapar un `<img onerror=...>` o un `</p><a href=...>` llega intacto al buzon y
 * se renderiza como marcado, no como texto. Escapar en el punto de interpolacion
 * (no al recibir) mantiene el dato crudo para los demas canales —WhatsApp va en
 * texto plano y no necesita esto—.
 *
 * @param {unknown} valor
 * @returns {string} el valor como texto seguro de interpolar en HTML
 */
export function escaparHtml(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

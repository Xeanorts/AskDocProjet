/**
 * Email Template - HTML MVP
 *
 * Simple, professional HTML template for PPTX delivery emails.
 */

/**
 * Build HTML email body
 *
 * @param {string} originalSubject - Subject of the original email request
 * @returns {string} HTML string
 */
export function buildEmailHtml(originalSubject) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Votre présentation est prête</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f4f4f4;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f4f4;">
    <tr>
      <td align="center" style="padding: 20px 0;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="background-color: #2563eb; padding: 30px 40px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">
                Votre présentation est prête
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 16px 0; color: #374151; font-size: 16px; line-height: 1.5;">
                Bonjour,
              </p>
              <p style="margin: 0 0 16px 0; color: #374151; font-size: 16px; line-height: 1.5;">
                Votre présentation générée par intelligence artificielle est prête.
              </p>
              <div style="background-color: #f9fafb; border-left: 4px solid #2563eb; padding: 16px; margin: 24px 0;">
                <p style="margin: 0; color: #6b7280; font-size: 14px; font-weight: 600;">
                  SUJET DE VOTRE DEMANDE
                </p>
                <p style="margin: 8px 0 0 0; color: #1f2937; font-size: 16px;">
                  ${escapeHtml(originalSubject)}
                </p>
              </div>
              <p style="margin: 24px 0 0 0; color: #374151; font-size: 16px; line-height: 1.5;">
                Vous trouverez le fichier PowerPoint en pièce jointe de cet email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 30px 40px; background-color: #f9fafb; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0 0 8px 0; color: #374151; font-size: 14px; line-height: 1.5;">
                Cordialement,
              </p>
              <p style="margin: 0; color: #2563eb; font-size: 14px; font-weight: 600;">
                L'equipe Project Name
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Build plain text email body
 */
export function buildEmailText(originalSubject) {
  return `Votre présentation est prête

Bonjour,

Votre présentation générée par intelligence artificielle est prête.

Sujet de votre demande : ${originalSubject}

Vous trouverez le fichier PowerPoint en pièce jointe de cet email.

Cordialement,
L'equipe Project Name`;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

export default {
  buildEmailHtml,
  buildEmailText
};

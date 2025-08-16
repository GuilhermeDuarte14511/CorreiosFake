// /api/quote.js
export const config = { runtime: 'nodejs' }; // Vercel aceita "nodejs"

import sgMail from '@sendgrid/mail';

// helpers
const onlyDigits = (v = '') => String(v).replace(/\D/g, '');
const addrLine = (o = {}) => {
  const linha1 = [o.logradouro, o.numero ? `nº ${o.numero}` : null, o.complemento]
    .filter(Boolean).join(' ');
  const linha2 = [o.bairro, o.cidade].filter(Boolean).join(', ');
  const uf = o.uf ? ` - ${o.uf}` : '';
  return [linha1, linha2 ? linha2 + uf : null].filter(Boolean).join(' | ');
};
const mapsFromGeo = (geo) => `https://maps.google.com/?q=${geo.lat},${geo.lng}`;
const mapsFromAddr = (o = {}, cep) => {
  const q = [
    o.logradouro, o.numero, o.complemento, o.bairro, o.cidade, o.uf,
    cep ? `CEP ${cep}` : null,
  ].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // valida envs cedo para erros mais claros
  const { SENDGRID_API_KEY, MAIL_TO, MAIL_FROM, LOGO_URL } = process.env;
  if (!SENDGRID_API_KEY || !MAIL_TO || !MAIL_FROM) {
    return res.status(500).json({
      error: 'Variáveis de ambiente ausentes: verifique SENDGRID_API_KEY, MAIL_TO e MAIL_FROM.',
    });
  }

  // configura a API Key somente após validar envs
  sgMail.setApiKey(SENDGRID_API_KEY);

  try {
    const body = req.body || {};

    // Novo payload
    const {
      codigo,            // ex.: SG-20250101-ABC123
      retirada = {},     // { cep, logradouro, numero, complemento, bairro, cidade, uf }
      entrega = {},      // { cep, logradouro, numero, complemento, bairro, cidade, uf }
      geoRetirada,       // { lat, lng, accuracy } (opcional)

      // Campos antigos (compat):
      cep,               // cep de retirada
      endereco,          // endereço de retirada formatado
      geo,               // geo antigo

      detalhes,
      nome,
      email,
      telefone,
      consentLocalizacao,
    } = body;

    // Compat: se não vier retirada.cep, usa o "cep" legado
    const rCep = onlyDigits(retirada.cep || cep || '');
    const eCep = onlyDigits(entrega.cep || '');

    if (!nome || !email || !rCep) {
      return res.status(400).json({
        error: 'Campos obrigatórios: nome, email e CEP de retirada.',
      });
    }

    // Monta strings úteis
    const rAddrStr = (retirada.logradouro || retirada.bairro || retirada.cidade || retirada.uf)
      ? addrLine(retirada)
      : (endereco || '—');

    const eAddrStr = (entrega.logradouro || entrega.bairro || entrega.cidade || entrega.uf)
      ? addrLine(entrega)
      : (eCep ? `CEP ${eCep}` : '—');

    const geoObj = geoRetirada || geo || null;
    const hasGeo = Boolean(geoObj);

    const mapaRetirada = hasGeo ? mapsFromGeo(geoObj) : mapsFromAddr(retirada, rCep);
    const mapaEntrega = (eCep || eAddrStr !== '—') ? mapsFromAddr(entrega, eCep) : null;

    const assunto = `Nova cotação — ${nome} — ${rCep}${eCep ? ' ➜ ' + eCep : ''}${codigo ? ` [${codigo}]` : ''}`;

    const texto = `
Nova solicitação de cotação (SG Transportes)

Código: ${codigo || '—'}

[Solicitante]
Nome: ${nome}
E-mail: ${email}
Telefone: ${telefone || '—'}

[Retirada]
CEP: ${rCep}
Endereço: ${rAddrStr}
Localização consentida: ${consentLocalizacao ? 'Sim' : 'Não'}
Geo: ${geoObj ? `lat=${geoObj.lat} lng=${geoObj.lng} (±${Math.round(geoObj.accuracy || 0)}m)` : '—'}
Mapa: ${mapaRetirada}

[Entrega]
CEP: ${eCep || '—'}
Endereço: ${eAddrStr}
${mapaEntrega ? `Mapa: ${mapaEntrega}` : ''}

[Detalhes]
${detalhes || '—'}
`.trim();

    // Resolve logo (usa LOGO_URL ou infere a partir do host)
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host;
    const baseUrl = host ? `${proto}://${host}` : null;
    const logoSrc = LOGO_URL || (baseUrl ? `${baseUrl}/logo-sg-transporte.png` : null);

    // HTML estilizado, compatível com e-mail
    const brand = 'SG Transportes';
    const primary = '#0d6efd';

    const html = `
<!— Preheader (texto de preview) —>
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
  Nova cotação — ${brand}. Código: ${codigo || '—'}.
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f9fc;padding:24px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #eaeaea;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#111;">
        <!-- Header -->
        <tr>
          <td style="background:${primary};padding:18px 24px;color:#ffffff;">
            <table width="100%" role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td style="vertical-align:middle;">
                  ${logoSrc
                    ? `<img src="${logoSrc}" width="36" height="36" alt="${brand}" style="display:inline-block;border:0;vertical-align:middle;border-radius:6px;background:#ffffff;padding:4px;">`
                    : `<span style="display:inline-block;font-weight:700;">${brand}</span>`}
                  <span style="font-size:18px;font-weight:700;vertical-align:middle;margin-left:10px;display:inline-block;">${brand}</span>
                </td>
                <td align="right" style="vertical-align:middle;">
                  <span style="display:inline-block;background:rgba(255,255,255,.18);padding:6px 10px;border-radius:999px;font-size:12px;">Nova cotação</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:24px;">
            <!-- Código -->
            <div style="margin:0 0 14px;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;">Código da cotação</div>
            <div style="background:#f3f6ff;border:1px dashed ${primary};padding:12px 16px;border-radius:8px;font-family:Consolas,Menlo,monospace;font-size:18px;font-weight:700;color:#101828;display:inline-block;">
              ${codigo || '—'}
            </div>

            <!-- Solicitante -->
            <div style="margin:22px 0 8px;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;">Solicitante</div>
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #eee;border-radius:8px;">
              <tr>
                <td style="padding:10px 12px;width:160px;background:#fafafa;color:#475467;font-size:13px;">Nome</td>
                <td style="padding:10px 12px;font-size:14px;color:#111;">${nome}</td>
              </tr>
              <tr>
                <td style="padding:10px 12px;background:#fafafa;color:#475467;font-size:13px;">E-mail</td>
                <td style="padding:10px 12px;font-size:14px;"><a href="mailto:${email}" style="color:${primary};text-decoration:none;">${email}</a></td>
              </tr>
              <tr>
                <td style="padding:10px 12px;background:#fafafa;color:#475467;font-size:13px;">Telefone</td>
                <td style="padding:10px 12px;font-size:14px;">${telefone || '—'}</td>
              </tr>
            </table>

            <!-- Retirada -->
            <div style="margin:22px 0 8px;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;">Retirada (origem)</div>
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #eee;border-radius:8px;">
              <tr>
                <td style="padding:10px 12px;width:160px;background:#fafafa;color:#475467;font-size:13px;">CEP</td>
                <td style="padding:10px 12px;font-size:14px;">${rCep}</td>
              </tr>
              <tr>
                <td style="padding:10px 12px;background:#fafafa;color:#475467;font-size:13px;">Endereço</td>
                <td style="padding:10px 12px;font-size:14px;">${rAddrStr}</td>
              </tr>
              <tr>
                <td style="padding:10px 12px;background:#fafafa;color:#475467;font-size:13px;">Localização</td>
                <td style="padding:10px 12px;font-size:14px;">
                  ${hasGeo ? `lat=${geoObj.lat} &nbsp; lng=${geoObj.lng} &nbsp; (±${Math.round(geoObj.accuracy || 0)}m)` : '—'}
                </td>
              </tr>
            </table>
            <div style="margin:10px 0 0;">
              <a href="${mapaRetirada}" target="_blank" style="display:inline-block;background:${primary};color:#fff;text-decoration:none;padding:10px 14px;border-radius:6px;font-weight:700;font-size:14px;">Abrir retirada no mapa</a>
            </div>

            <!-- Entrega -->
            <div style="margin:22px 0 8px;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;">Entrega (destino)</div>
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #eee;border-radius:8px;">
              <tr>
                <td style="padding:10px 12px;width:160px;background:#fafafa;color:#475467;font-size:13px;">CEP</td>
                <td style="padding:10px 12px;font-size:14px;">${eCep || '—'}</td>
              </tr>
              <tr>
                <td style="padding:10px 12px;background:#fafafa;color:#475467;font-size:13px;">Endereço</td>
                <td style="padding:10px 12px;font-size:14px;">${eAddrStr}</td>
              </tr>
            </table>
            ${mapaEntrega ? `
            <div style="margin:10px 0 0;">
              <a href="${mapaEntrega}" target="_blank" style="display:inline-block;background:#0ea5e9;color:#fff;text-decoration:none;padding:10px 14px;border-radius:6px;font-weight:700;font-size:14px;">Abrir entrega no mapa</a>
            </div>` : ''}

            <!-- Detalhes -->
            <div style="margin:22px 0 8px;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;">Detalhes</div>
            <div style="background:#f8fafc;border:1px solid #eee;border-radius:8px;padding:12px 14px;font-size:14px;white-space:pre-wrap;">
${(detalhes || '—').toString().replace(/</g,'&lt;').replace(/>/g,'&gt;')}
            </div>

            <div style="margin-top:18px;font-size:12px;color:#6b7280;">
              Envie este código de cotação ao anunciante: <strong>${codigo || '—'}</strong>.
            </div>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#fafafa;border-top:1px solid #eee;padding:14px 24px;color:#6b7280;font-size:12px;">
            Este e-mail foi gerado por um endpoint protegido. Dados utilizados exclusivamente para cotação (LGPD).<br/>
            © ${new Date().getFullYear()} ${brand}. Todos os direitos reservados.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
    `;

    await sgMail.send({
      to: MAIL_TO,
      from: MAIL_FROM,  // remetente verificado no SendGrid
      replyTo: email,
      subject: assunto,
      text: texto,
      html,
    });

    return res.status(200).json({ ok: true, codigo: codigo || null });
  } catch (err) {
    console.error('Erro ao enviar e-mail:', err?.response?.body || err);
    return res.status(500).json({ error: 'Falha interna ao enviar e-mail.' });
  }
}

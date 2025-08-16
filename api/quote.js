// /api/quote.js
export const config = { runtime: 'nodejs18.x' }; // garante Node (não Edge)

import sgMail from '@sendgrid/mail';

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// helpers
const onlyDigits = (v = '') => String(v).replace(/\D/g, '');
const join = (arr) => arr.filter(Boolean).join(', ');
const addrLine = (o = {}) => {
  const linha1 = [o.logradouro, o.numero ? `nº ${o.numero}` : null, o.complemento].filter(Boolean).join(' ');
  const linha2 = [o.bairro, o.cidade].filter(Boolean).join(', ');
  const uf = o.uf ? ` - ${o.uf}` : '';
  return [linha1, linha2 ? linha2 + uf : null].filter(Boolean).join(' | ');
};
const mapsFromGeo = (geo) => `https://maps.google.com/?q=${geo.lat},${geo.lng}`;
const mapsFromAddr = (o = {}, cep) => {
  const q = [
    o.logradouro, o.numero, o.complemento, o.bairro, o.cidade, o.uf, cep ? `CEP ${cep}` : null,
  ].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // valida envs cedo para erros mais claros
  const { SENDGRID_API_KEY, MAIL_TO, MAIL_FROM } = process.env;
  if (!SENDGRID_API_KEY || !MAIL_TO || !MAIL_FROM) {
    return res.status(500).json({
      error: 'Variáveis de ambiente ausentes: verifique SENDGRID_API_KEY, MAIL_TO e MAIL_FROM.',
    });
  }

  try {
    const body = req.body || {};

    // Novo payload
    const {
      codigo,            // ex.: SG-20250101-ABC123
      retirada = {},     // { cep, logradouro, numero, complemento, bairro, cidade, uf }
      entrega = {},      // { cep, logradouro, numero, complemento, bairro, cidade, uf }
      geoRetirada,       // { lat, lng, accuracy } (opcional)
      // Campos antigos (compatibilidade):
      cep,               // cep de retirada
      endereco,          // endereço de retirada formatado
      geo,               // geo antigo
      detalhes,
      nome,
      email,
      telefone,
      consentLocalizacao,
    } = body;

    // Compatibilidade: se não vier retirada.cep, usa o "cep" legado
    const rCep = onlyDigits(retirada.cep || cep || '');
    const eCep = onlyDigits(entrega.cep || '');

    if (!nome || !email || !rCep) {
      return res.status(400).json({
        error: 'Campos obrigatórios: nome, email e CEP de retirada.',
      });
    }

    // Monta strings úteis
    const rAddrStr = retirada.logradouro || retirada.bairro || retirada.cidade || retirada.uf
      ? addrLine(retirada)
      : (endereco || '—');

    const eAddrStr = entrega.logradouro || entrega.bairro || entrega.cidade || entrega.uf
      ? addrLine(entrega)
      : (eCep ? `CEP ${eCep}` : '—');

    const hasGeo = Boolean(geoRetirada || geo);
    const geoObj = geoRetirada || geo || null;
    const mapaRetirada = hasGeo
      ? mapsFromGeo(geoObj)
      : mapsFromAddr(retirada, rCep);

    const mapaEntrega = eCep || eAddrStr !== '—'
      ? mapsFromAddr(entrega, eCep)
      : null;

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

    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.55;color:#111">
        <h2 style="margin:0 0 12px">Nova cotação — SG Transportes</h2>
        <p><strong>Código:</strong> ${codigo || '—'}</p>

        <h3 style="margin:16px 0 6px;font-size:16px">Solicitante</h3>
        <p style="margin:0">
          <strong>Nome:</strong> ${nome}<br>
          <strong>E-mail:</strong> ${email}<br>
          <strong>Telefone:</strong> ${telefone || '—'}
        </p>

        <h3 style="margin:16px 0 6px;font-size:16px">Retirada (origem)</h3>
        <p style="margin:0">
          <strong>CEP:</strong> ${rCep}<br>
          <strong>Endereço:</strong> ${rAddrStr}<br>
          <strong>Localização consentida:</strong> ${consentLocalizacao ? 'Sim' : 'Não'}<br>
          <strong>Geo:</strong> ${geoObj ? `lat=${geoObj.lat} lng=${geoObj.lng} (±${Math.round(geoObj.accuracy || 0)}m)` : '—'}
        </p>
        <p style="margin:6px 0">
          <a href="${mapaRetirada}" target="_blank" rel="noreferrer">Abrir retirada no mapa</a>
        </p>

        <h3 style="margin:16px 0 6px;font-size:16px">Entrega (destino)</h3>
        <p style="margin:0">
          <strong>CEP:</strong> ${eCep || '—'}<br>
          <strong>Endereço:</strong> ${eAddrStr}
        </p>
        ${mapaEntrega ? `<p style="margin:6px 0"><a href="${mapaEntrega}" target="_blank" rel="noreferrer">Abrir entrega no mapa</a></p>` : ''}

        <h3 style="margin:16px 0 6px;font-size:16px">Detalhes</h3>
        <pre style="white-space:pre-wrap;background:#f6f7fb;padding:8px;border-radius:6px;border:1px solid #eee;margin:0">${(detalhes || '—')
          .toString()
          .replace(/</g,'&lt;')
          .replace(/>/g,'&gt;')}</pre>

        <hr style="margin:16px 0;border:none;border-top:1px solid #eee">
        <p style="font-size:12px;color:#555;margin:0">
          Este e-mail foi gerado por um endpoint protegido. Dados utilizados exclusivamente para cotação (LGPD).
        </p>
      </div>
    `;

    await sgMail.send({
      to: MAIL_TO,
      from: MAIL_FROM,          // remetente verificado no SendGrid
      replyTo: email,           // facilita responder direto ao solicitante
      subject: assunto,
      text: texto,
      html,
    });

    // responde também o código para o front (útil se quiser exibir/confirmar)
    return res.status(200).json({ ok: true, codigo: codigo || null });
  } catch (err) {
    console.error('Erro ao enviar e-mail:', err?.response?.body || err);
    return res.status(500).json({ error: 'Falha interna ao enviar e-mail.' });
  }
}

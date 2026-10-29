import { NextResponse } from 'next/server';
import { scanCamara } from '../../../lib/crawler.js';
import { UF_SET } from '../../../lib/text.js';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const preferredRegion = 'gru1';

/**
 * POST /api/scan  { uf, city, fast?, hint? }
 * `hint` é o registro do cadastro Interlegis carregado pelo painel; apenas URLs .leg.br/.gov.br são aceitas.
 * O endpoint nunca aceita URL arbitrária para navegação (proteção contra SSRF).
 */
export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }); }
  const city = String(body?.city || '').trim();
  const uf = String(body?.uf || '').toUpperCase();
  if (!UF_SET.has(uf) || city.length < 2 || city.length > 90) return NextResponse.json({ error: 'Estado ou município inválido' }, { status: 400 });
  try {
    const result = await scanCamara(city, uf, { fast: !!body.fast, hint: body.hint });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: 'Erro na coleta: ' + e.message, city, uf }, { status: 500 });
  }
}

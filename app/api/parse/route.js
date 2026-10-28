import { NextResponse } from 'next/server';
import { extractContacts, extractFromText, mergeContacts } from '../../../lib/extract.js';

export const runtime = 'nodejs';
const MAX = 400_000;
/**
 * POST /api/parse { text, sourceUrl, officialHost? } — coleta assistida.
 * Um usuário abre a página no próprio navegador e cola o conteúdo; nenhuma requisição é feita ao site.
 */
export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }); }
  const text = String(body?.text || '');
  if (text.trim().length < 5) return NextResponse.json({ error: 'Cole o conteúdo da página' }, { status: 400 });
  if (text.length > MAX) return NextResponse.json({ error: 'Conteúdo grande demais (máx. 400 mil caracteres)' }, { status: 413 });
  let source = 'coleta manual';
  try { const u = new URL(String(body.sourceUrl || '')); if (/^https?:$/.test(u.protocol)) source = u.href; } catch {}
  const isHtml = /<\s*(html|body|table|div|p|li)\b/i.test(text);
  const found = (isHtml ? extractContacts(text, source) : extractFromText(text, source)).map(c => ({ ...c, type: 'manual' }));
  const hosts = [];
  try { hosts.push(new URL(source).hostname); } catch {}
  if (body.officialHost) hosts.push(String(body.officialHost).slice(0, 120));
  return NextResponse.json({ contacts: mergeContacts(found, hosts) });
}

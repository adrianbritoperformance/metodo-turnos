import { headers } from 'next/headers';
import QRCode from 'qrcode';
import { requireOwner } from '@/lib/supabase';
import { PrintOnLoad } from './PrintOnLoad';

export const dynamic = 'force-dynamic';

/** Hoja A4 imprimible con el QR del local. */
export default async function QrPrint() {
  const { sb } = await requireOwner();
  const { data } = await sb.rpc('get_admin_codes');
  const code = (data as { qr_secret: string }[] | null)?.[0];
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const svg = code
    ? await QRCode.toString(`${proto}://${host}/fichar?c=${code.qr_secret}`, { type: 'svg', margin: 1, color: { dark: '#49271A', light: '#FFFFFF' } })
    : '';
  return (
    <div style={{ minHeight: '100vh', background: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 28, padding: 40 }}>
      <img src="/logo.png" alt="Método Café" style={{ width: 260 }} />
      <div style={{ width: 380, height: 380 }} dangerouslySetInnerHTML={{ __html: svg }} />
      <div style={{ fontFamily: 'var(--titulo)', fontWeight: 700, fontSize: 30, letterSpacing: '.1em', color: '#49271A' }}>ESCANEA PARA FICHAR</div>
      <div style={{ fontSize: 16, color: '#5E4536' }}>Abre la app y pulsa “Escanear QR”, o usa la cámara del móvil.</div>
      <PrintOnLoad />
    </div>
  );
}

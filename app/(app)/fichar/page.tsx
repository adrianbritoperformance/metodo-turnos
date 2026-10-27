import { Home } from '../Home';

export const dynamic = 'force-dynamic';

/** Destino del QR impreso: https://tu-app/fichar?c=SECRETO — ficha nada más abrirse. */
export default async function FicharPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  return <Home autoCode={c} />;
}

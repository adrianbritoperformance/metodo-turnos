import { requireProfile } from '@/lib/supabase';
import { fmtLongDay } from '@/lib/time';
import { Nav } from './Nav';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireProfile();
  return (
    <div className="app">
      <header className="top">
        <img src="/logo.png" alt="Método Café" />
        <div className="meta">
          <div>{fmtLongDay(new Date())}</div>
          <a href="/perfil" style={{ display: 'inline-block', padding: '6px 0', color: 'var(--suave)', fontSize: 13 }}>Mi perfil</a>
        </div>
      </header>
      <main className="main">{children}</main>
      <Nav owner={profile.role === 'owner'} />
    </div>
  );
}

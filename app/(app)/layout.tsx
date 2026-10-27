import { requireProfile } from '@/lib/supabase';
import { fmtLongDay } from '@/lib/time';
import { Nav } from './Nav';
import { logout } from '../login/actions';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireProfile();
  return (
    <div className="app">
      <header className="top">
        <img src="/logo.png" alt="Método Café" />
        <div className="meta">
          <div>{fmtLongDay(new Date())}</div>
          <form action={logout}>
            <button className="small" style={{ background: 'none', border: 0, padding: '6px 0', color: 'var(--suave)', textDecoration: 'underline', cursor: 'pointer' }}>
              Salir
            </button>
          </form>
        </div>
      </header>
      <main className="main">{children}</main>
      <Nav owner={profile.role === 'owner'} />
    </div>
  );
}

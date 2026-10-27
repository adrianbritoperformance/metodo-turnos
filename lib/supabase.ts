import { createServerClient, type CookieOptions } from '@supabase/ssr';

type CookieList = { name: string; value: string; options: CookieOptions }[];
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list: CookieList) => {
          try {
            list.forEach(({ name, value, options }) => store.set(name, value, options));
          } catch {
            // Llamado desde un Server Component: el middleware ya refresca la sesión.
          }
        },
      },
    }
  );
}

export type Profile = {
  id: string;
  business_id: string;
  full_name: string;
  role: 'owner' | 'worker';
  active: boolean;
};

/** Sesión + perfil. Si no hay sesión, a /login. */
export async function requireProfile() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await sb.from('profiles').select('id, business_id, full_name, role, active').eq('id', user.id).single<Profile>();
  if (!profile) redirect('/login?e=perfil');
  return { sb, user, profile };
}

export async function requireOwner() {
  const ctx = await requireProfile();
  if (ctx.profile.role !== 'owner') redirect('/');
  return ctx;
}

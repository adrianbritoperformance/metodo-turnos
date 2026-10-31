import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase';
import { NewPasswordForm } from '../login/LoginForm';

export const dynamic = 'force-dynamic';

export default async function NuevaContrasena() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/recuperar?e=caducado');
  return (
    <div className="auth">
      <img src="/logo.png" alt="Método Café" />
      <h1>Contraseña nueva</h1>
      <p className="muted" style={{ margin: 0 }}>{user.email}</p>
      <NewPasswordForm afterSave="home" />
    </div>
  );
}

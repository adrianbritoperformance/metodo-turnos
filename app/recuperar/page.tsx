import Link from 'next/link';
import { ResetRequestForm } from '../login/LoginForm';

/**
 * ¿Olvidaste tu contraseña?
 * Plan B (activo): el administrador central pone una contraseña temporal desde Central.
 * El envío por correo está preparado pero apagado: se activa poniendo
 * NEXT_PUBLIC_RESET_EMAIL=1 en Vercel cuando Supabase tenga un servicio de correo (SMTP) configurado.
 */
export default async function Recuperar({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const { e } = await searchParams;
  const emailOn = process.env.NEXT_PUBLIC_RESET_EMAIL === '1';
  return (
    <div className="auth">
      <img src="/logo.png" alt="Método Café" />
      <h1>¿Olvidaste tu contraseña?</h1>
      {e === 'caducado' && <div className="alert err">El enlace ha caducado o ya se usó.</div>}

      <div className="card" style={{ gap: 10 }}>
        <div style={{ fontWeight: 700 }}>Así se recupera:</div>
        <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 15 }}>
          <li>Avisa a tu encargada o al administrador de la app.</li>
          <li>Te dará una <b>contraseña temporal</b>.</li>
          <li>Entra con tu correo y esa contraseña.</li>
          <li>Ve a <b>Mi perfil → Cambiar contraseña</b> y pon una tuya.</li>
        </ol>
      </div>

      {emailOn && (
        <>
          <p className="muted" style={{ margin: 0 }}>O recibe un enlace en tu correo:</p>
          <ResetRequestForm />
        </>
      )}
      <p className="muted"><Link href="/login">Volver a entrar</Link></p>
    </div>
  );
}

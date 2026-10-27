import Link from 'next/link';
import { LoginForm } from './LoginForm';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="auth">
      <img src="/logo.png" alt="Método Café" />
      <h1>Entrar</h1>
      <LoginForm next={next ?? '/'} />
      <p className="muted">
        ¿Primera vez? <Link href={`/registro${next ? `?next=${encodeURIComponent(next)}` : ''}`}>Crea tu cuenta</Link>
      </p>
    </div>
  );
}

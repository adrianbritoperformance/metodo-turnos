import Link from 'next/link';
import { RegisterForm } from '../login/LoginForm';

export default function RegisterPage() {
  return (
    <div className="auth">
      <img src="/logo.png" alt="Método Café" />
      <h1>Crear cuenta</h1>
      <p className="muted">Pide el código del local a la encargada.</p>
      <RegisterForm />
      <p className="muted">¿Ya tienes cuenta? <Link href="/login">Entra</Link></p>
    </div>
  );
}

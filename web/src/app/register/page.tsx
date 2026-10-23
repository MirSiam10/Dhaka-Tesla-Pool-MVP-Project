'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ErrorBanner } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' });
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register({
        name: form.name,
        email: form.email,
        password: form.password,
        phone: form.phone.trim() || undefined,
      });
      router.replace('/passenger');
    } catch (err) {
      // Surface the first field-level validation message when the API sends one.
      const details = err instanceof ApiError ? (err.details as { message: string }[] | undefined) : undefined;
      setError(details?.[0] ? new Error(details[0].message) : (err as Error));
      setBusy(false);
    }
  }

  return (
    <main className="container stack">
      <form className="card form" onSubmit={onSubmit} style={{ maxWidth: 460, margin: '24px auto', width: '100%' }}>
        <h1>Create your account</h1>
        <p className="small muted">New accounts get ৳500 of simulated TeslaPay credit. No real money moves.</p>
        <label>
          Full name
          <input required autoComplete="name" value={form.name} onChange={set('name')} />
        </label>
        <label>
          Email
          <input required type="email" autoComplete="email" value={form.email} onChange={set('email')} />
        </label>
        <label>
          Phone (optional)
          <input type="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} />
        </label>
        <label>
          Password (8+ characters)
          <input required type="password" minLength={8} autoComplete="new-password" value={form.password} onChange={set('password')} />
        </label>
        <ErrorBanner error={error} />
        <button className="btn primary" disabled={busy} type="submit">
          {busy ? 'Creating…' : 'Create account'}
        </button>
        <p className="small muted">
          Already registered? <Link href="/">Sign in</Link>
        </p>
      </form>
    </main>
  );
}

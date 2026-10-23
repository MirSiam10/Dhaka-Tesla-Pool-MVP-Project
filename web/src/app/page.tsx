'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { homeFor } from '@/components/Shell';
import { ErrorBanner } from '@/components/ui';
import { useAuth } from '@/lib/auth';

// Public demo credentials from the seed data (README lists the same). Not secrets.
const DEMO_PASSWORD = 'Tesla@1234';
const DEMO = [
  { name: 'Nusrat', email: 'nusrat@example.com', note: 'Banani to Mohakhali' },
  { name: 'Rafiq', email: 'rafiq@example.com', note: 'Banani to Gulshan 1' },
  { name: 'Shirin', email: 'shirin@example.com', note: 'Wants the last seat' },
  { name: 'Jashim', email: 'jashim@example.com', note: 'Drives Bullet (3 seats)' },
];

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace(homeFor(user.role));
  }, [loading, user, router]);

  async function signIn(e: string, p: string) {
    setBusy(true);
    setError(null);
    try {
      const u = await login(e, p);
      router.replace(homeFor(u.role));
    } catch (err) {
      setError(err as Error);
      setBusy(false);
    }
  }

  function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    void signIn(email, password);
  }

  return (
    <main className="container stack">
      <section className="hero">
        <h1>
          Dhaka <span style={{ color: 'var(--brand)' }}>Tesla</span> Pool
        </h1>
        <p>Share a seat. Split the fare. Survive Dhaka traffic. Book a three-seat Tesla and pay less when a stranger rides along.</p>
      </section>

      <div className="two-col">
        <form className="card form" onSubmit={onSubmit}>
          <h2>Sign in</h2>
          <label>
            Email
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <ErrorBanner error={error} />
          <button className="btn primary" disabled={busy} type="submit">
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="small muted">
            New passenger? <Link href="/register">Create an account</Link>. Drivers are onboarded by the Tesla Pool team.
          </p>
        </form>

        <section className="card">
          <h2>Try the Banani story</h2>
          <p className="small muted">One click signs in as a character from the brief. Password for all: {DEMO_PASSWORD}</p>
          <div className="demo-grid">
            {DEMO.map((d) => (
              <button key={d.email} className="btn" disabled={busy} onClick={() => void signIn(d.email, DEMO_PASSWORD)}>
                <span>
                  <strong>{d.name}</strong>
                  <br />
                  <span className="small muted">{d.note}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

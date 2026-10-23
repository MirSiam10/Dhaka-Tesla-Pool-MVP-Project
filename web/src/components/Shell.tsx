'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import { taka } from '@/lib/format';
import type { Role } from '@/lib/types';
import { Skeleton } from './ui';

export const homeFor = (role: Role) => (role === 'DRIVER' ? '/driver' : '/passenger');

/** Page frame for signed-in screens. Redirects anonymous users to login and wrong-role users home. */
export function Shell({ role, children }: { role: Role; children: ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/');
    else if (user.role !== role) router.replace(homeFor(user.role));
  }, [loading, user, role, router]);

  if (loading || !user || user.role !== role) {
    return (
      <main className="container">
        <Skeleton lines={4} />
      </main>
    );
  }

  return (
    <>
      <header className="header">
        <div className="container">
          <Link href={homeFor(user.role)} className="brand">
            Dhaka <span>Tesla</span> Pool
          </Link>
          <span className="grow" />
          {user.role === 'PASSENGER' && (
            <span className="pill matched" title="Simulated TeslaPay wallet">
              TeslaPay {taka(user.walletPaisa)}
            </span>
          )}
          <span className="small muted">
            {user.name} · {user.role === 'DRIVER' ? 'Driver' : 'Passenger'}
          </span>
          <button
            className="btn small"
            onClick={() => {
              logout();
              router.replace('/');
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="container stack">{children}</main>
    </>
  );
}

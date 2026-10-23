'use client';

import { useState } from 'react';
import { Shell } from '@/components/Shell';
import { EmptyState, ErrorBanner, Notice, SeatMeter, Skeleton, StatusPill } from '@/components/ui';
import { api } from '@/lib/api';
import { clock, REASON_TEXT, taka, timeAgo } from '@/lib/format';
import type { DriverProfile, Pool } from '@/lib/types';
import { usePolling } from '@/lib/usePolling';

export default function DriverPage() {
  return (
    <Shell role="DRIVER">
      <DriverHome />
    </Shell>
  );
}

function DriverHome() {
  const profile = usePolling(() => api.driverProfile(), 3000);
  const requests = usePolling(() => api.openRequests(), 3000);
  const history = usePolling(() => api.driverHistory(), 8000);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(key: string, action: () => Promise<unknown>, onDone?: (result: unknown) => string | null) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const result = await action();
      setNotice(onDone?.(result) ?? null);
    } catch (err) {
      setError(err as Error);
    } finally {
      // Always re-read: after a failure the server's truth (e.g. "already taken") is what matters.
      await Promise.all([profile.refresh(), requests.refresh(), history.refresh()]);
      setBusy(null);
    }
  }

  const p = profile.data;
  const pool = p?.activePool ?? null;

  return (
    <>
      <h1>Driver console</h1>
      {profile.error && !p && <ErrorBanner error={profile.error} />}
      {profile.error && p && <Notice tone="warn">Connection problem, retrying. Showing the last known state.</Notice>}
      <ErrorBanner error={error} />
      {notice && <Notice>{notice}</Notice>}

      {profile.loading || !p ? (
        <div className="card">
          <Skeleton lines={3} />
        </div>
      ) : (
        <>
          <VehicleCard profile={p} busy={busy} onToggle={() => run('online', () => api.setOnline(!p.online))} />
          {pool && <PoolCard pool={pool} busy={busy} run={run} />}
          <RequestsCard
            online={p.online}
            loading={requests.loading}
            data={requests.data}
            busy={busy}
            onAccept={(id, name) => run(`accept:${id}`, () => api.accept(id), () => `Accepted ${name}.`)}
          />
          <HistoryCard history={history.data} loading={history.loading} />
        </>
      )}
    </>
  );
}

function VehicleCard({ profile, busy, onToggle }: { profile: DriverProfile; busy: string | null; onToggle: () => void }) {
  const locked = profile.online && profile.activePool !== null;
  return (
    <section className="card">
      <div className="card-title">
        <div>
          <h2>
            {profile.vehicle.name} <span className="muted small">{profile.vehicle.plate}</span>
          </h2>
          <p className="small muted">{profile.vehicle.capacity} seats</p>
        </div>
        <div className="switch">
          <span className={`dot ${profile.online ? 'on' : ''}`} aria-hidden />
          <strong>{profile.online ? 'Online' : 'Offline'}</strong>
          <button className={`btn ${profile.online ? '' : 'primary'}`} disabled={busy !== null || locked} onClick={onToggle}>
            {profile.online ? 'Go offline' : 'Go online'}
          </button>
        </div>
      </div>
      {locked && <p className="small muted">Finish or cancel the current pool before going offline.</p>}
    </section>
  );
}

type Run = (key: string, action: () => Promise<unknown>, onDone?: (result: unknown) => string | null) => Promise<void>;

function PoolCard({ pool, busy, run }: { pool: Pool; busy: string | null; run: Run }) {
  const canArrive = pool.status === 'OPEN' && pool.passengers.length > 0;
  return (
    <section className="card" aria-label="Current pool">
      <div className="card-title">
        <h2>Current pool · pickup {pool.pickup.name}</h2>
        <StatusPill status={pool.status} kind="pool" />
      </div>
      <div className="row">
        <SeatMeter capacity={pool.seatCapacity} taken={pool.occupiedSeats} />
        <span className="small muted">
          {pool.occupiedSeats} of {pool.seatCapacity} seats taken · {pool.corridor} corridor
        </span>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Passenger</th>
              <th>Seats</th>
              <th>Drop-off</th>
              <th>Fare</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {pool.passengers.map((x) => (
              <tr key={x.rideId}>
                <td>
                  <strong>{x.passengerName}</strong>
                  <div className="small muted">{x.paymentMethod === 'CASH' ? 'Cash' : 'TeslaPay'}</div>
                </td>
                <td>{x.seats}</td>
                <td>{x.destination.name}</td>
                <td className="mono">
                  {taka(x.farePaisa)}
                  {x.poolDiscountPaisa > 0 && <div className="small muted">shared</div>}
                </td>
                <td>
                  <StatusPill status={x.status} />
                </td>
                <td className="right">
                  {pool.status === 'STARTED' && x.status === 'STARTED' && (
                    <button
                      className="btn small primary"
                      disabled={busy !== null}
                      onClick={() =>
                        run(
                          `complete:${x.rideId}`,
                          () => api.completeRide(x.rideId),
                          (r) => {
                            const after = r as Pool;
                            return after.status === 'COMPLETED'
                              ? `Pool complete. Collected ${taka(after.totalFarePaisa)} from ${after.passengers.length} ${after.passengers.length === 1 ? 'rider' : 'riders'}.`
                              : `${x.passengerName} dropped at ${x.destination.name}.`;
                          },
                        )
                      }
                    >
                      Drop off
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="small muted">
        {pool.status === 'OPEN' &&
          'Boarding is open: compatible riders on this corridor join automatically while seats are free. Mark arrival to close boarding and lock the fares.'}
        {pool.status === 'DRIVER_ARRIVED' && 'Boarding is closed and fares are final. Start the trip when everyone is aboard.'}
        {pool.status === 'STARTED' && 'Drop each passenger at their stop. The pool completes after the last drop-off.'}
      </p>

      <div className="row">
        {pool.status === 'OPEN' && (
          <button className="btn primary" disabled={!canArrive || busy !== null} onClick={() => run('arrive', () => api.arrive(), () => 'Arrival marked. Boarding is closed.')}>
            I have arrived at {pool.pickup.name}
          </button>
        )}
        {pool.status === 'DRIVER_ARRIVED' && (
          <button className="btn primary" disabled={busy !== null} onClick={() => run('start', () => api.start(), () => 'Trip started.')}>
            Start trip
          </button>
        )}
        {(pool.status === 'OPEN' || pool.status === 'DRIVER_ARRIVED') && (
          <button
            className="btn danger"
            disabled={busy !== null}
            onClick={() => {
              if (!window.confirm('Cancel this pool? Passengers go back to waiting for another Tesla.')) return;
              void run('cancel', () => api.cancelPool(), (r) => `Pool cancelled. ${(r as { requeuedRides: number }).requeuedRides} riders returned to the queue.`);
            }}
          >
            Cancel pool
          </button>
        )}
        <span className="grow" />
        <strong className="mono">Total {taka(pool.totalFarePaisa)}</strong>
      </div>
    </section>
  );
}

function RequestsCard({
  online,
  loading,
  data,
  busy,
  onAccept,
}: {
  online: boolean;
  loading: boolean;
  data: import('@/lib/types').OpenRequest[] | undefined;
  busy: string | null;
  onAccept: (rideId: string, name: string) => void;
}) {
  return (
    <section className="card" aria-label="Waiting requests">
      <h2>Waiting requests</h2>
      {!online ? (
        <EmptyState title="You are offline" hint="Go online to see passengers waiting for a Tesla." />
      ) : loading ? (
        <Skeleton lines={2} />
      ) : !data || data.length === 0 ? (
        <EmptyState title="No one is waiting" hint="New requests appear here within a few seconds." />
      ) : (
        <ul className="list">
          {data.map((r) => (
            <li key={r.rideId}>
              <div className="card-title">
                <strong>
                  {r.passengerName} · {r.pickup.name} → {r.destination.name}
                </strong>
                <span className="mono">{taka(r.farePaisa)}</span>
              </div>
              <div className="row">
                <span className="small muted">
                  {r.seats} {r.seats === 1 ? 'seat' : 'seats'} · requested {timeAgo(r.requestedAt)}
                </span>
                <span className="grow" />
                {r.reason && <span className="small muted">{REASON_TEXT[r.reason] ?? r.reason}</span>}
                <button className="btn primary small" disabled={!r.canAccept || busy !== null} onClick={() => onAccept(r.rideId, r.passengerName)}>
                  Accept
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function HistoryCard({ history, loading }: { history: import('@/lib/types').DriverHistory | undefined; loading: boolean }) {
  return (
    <section className="card" aria-label="Trip history">
      <div className="card-title">
        <h2>Trip history</h2>
        {history && (
          <span className="small muted">
            {history.completedTrips} paid rides · {taka(history.earningsPaisa)} collected
          </span>
        )}
      </div>
      {loading || !history ? (
        <Skeleton lines={2} />
      ) : history.pools.length === 0 ? (
        <EmptyState title="No finished pools yet" hint="Completed and cancelled pools are listed here." />
      ) : (
        <ul className="list">
          {history.pools.map((h) => (
            <li key={h.id}>
              <div className="card-title">
                <strong>
                  {h.pickup.name} · {h.passengers.map((x) => x.passengerName).join(' + ') || 'no riders'}
                </strong>
                <StatusPill status={h.status} kind="pool" />
              </div>
              <div className="small muted">
                {clock(h.createdAt)} · {h.passengers.map((x) => `${x.passengerName} to ${x.destination.name} ${taka(x.farePaisa)}`).join(' · ')}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

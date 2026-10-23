import type {
  DriverHistory,
  DriverProfile,
  FareEstimate,
  OpenRequest,
  PaymentMethod,
  Pool,
  Ride,
  RideEvent,
  User,
  Zone,
} from './types';

// The browser only talks to this Next.js origin. app/api/[...path]/route.ts forwards to Express.
const BASE = '/api';
const TOKEN_KEY = 'tesla.token';

// Browser storage can throw (private windows, blocked cookies), so every access is guarded.
export function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: the session just will not survive a reload */
  }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.');
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      /* non-JSON body, handled below */
    }
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    if (res.status === 401 && token) window.dispatchEvent(new Event('tesla:unauthorized'));
    throw new ApiError(res.status, err?.code ?? 'ERROR', err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  return data as T;
}

const post = <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body ?? {} });

export const api = {
  login: (email: string, password: string) => post<{ token: string; user: User }>('/auth/login', { email, password }),
  register: (input: { name: string; email: string; password: string; phone?: string }) =>
    post<{ token: string; user: User }>('/auth/register', input),
  me: () => request<{ user: User }>('/auth/me').then((r) => r.user),

  zones: () => request<{ zones: Zone[] }>('/zones').then((r) => r.zones),
  estimate: (pickup: string, destination: string, seats: number) =>
    request<FareEstimate>(`/fare/estimate?pickup=${encodeURIComponent(pickup)}&destination=${encodeURIComponent(destination)}&seats=${seats}`),

  rides: () => request<{ rides: Ride[] }>('/rides').then((r) => r.rides),
  requestRide: (input: { pickupZone: string; destinationZone: string; seats: number; paymentMethod: PaymentMethod }) =>
    post<{ ride: Ride }>('/rides', input).then((r) => r.ride),
  cancelRide: (id: string) => post<{ ride: Ride }>(`/rides/${id}/cancel`).then((r) => r.ride),
  rideEvents: (id: string) => request<{ events: RideEvent[] }>(`/rides/${id}/events`).then((r) => r.events),

  driverProfile: () => request<DriverProfile>('/driver/me'),
  setOnline: (online: boolean) => post<{ online: boolean }>('/driver/status', { online }),
  openRequests: () => request<{ requests: OpenRequest[] }>('/driver/requests').then((r) => r.requests),
  accept: (rideId: string) => post<{ pool: Pool }>(`/driver/requests/${rideId}/accept`).then((r) => r.pool),
  arrive: () => post<{ pool: Pool }>('/driver/pool/arrive').then((r) => r.pool),
  start: () => post<{ pool: Pool }>('/driver/pool/start').then((r) => r.pool),
  completeRide: (rideId: string) => post<{ pool: Pool }>(`/driver/pool/rides/${rideId}/complete`).then((r) => r.pool),
  cancelPool: () => post<{ requeuedRides: number }>('/driver/pool/cancel'),
  driverHistory: () => request<DriverHistory>('/driver/history'),
};

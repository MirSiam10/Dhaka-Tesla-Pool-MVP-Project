// Mirrors the JSON the Express API returns (backend/src/services/*). Money is integer paisa.

export type Role = 'PASSENGER' | 'DRIVER';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  phone: string | null;
  walletPaisa: number;
}

export interface Zone {
  code: string;
  name: string;
  corridor: string;
  lat: number;
  lng: number;
}

export type RideStatus = 'REQUESTED' | 'MATCHED' | 'DRIVER_ARRIVED' | 'STARTED' | 'COMPLETED' | 'CANCELLED';
export type PoolStatus = 'OPEN' | 'DRIVER_ARRIVED' | 'STARTED' | 'COMPLETED' | 'CANCELLED';
export type PaymentMethod = 'CASH' | 'TESLAPAY';

export interface ZoneRef {
  code: string;
  name: string;
}

export interface FareBreakdown {
  baseFarePaisa: number;
  distanceChargePaisa: number;
  poolDiscountPaisa: number;
  totalFarePaisa: number;
}

export interface Ride {
  id: string;
  status: RideStatus;
  seats: number;
  paymentMethod: PaymentMethod;
  pickup: ZoneRef;
  destination: ZoneRef;
  distanceM: number;
  fare: FareBreakdown & { ifSharedTotalPaisa: number | null };
  pool: null | {
    id: string;
    status: PoolStatus;
    vehicleName: string;
    vehiclePlate: string;
    driverName: string;
    coPassengers: number;
  };
  timestamps: Record<'requestedAt' | 'matchedAt' | 'arrivedAt' | 'startedAt' | 'completedAt' | 'cancelledAt', string | null>;
}

export interface RideEvent {
  type: string;
  from: string | null;
  to: string | null;
  at: string;
  metadata: Record<string, unknown>;
}

export interface FareEstimate {
  pickup: string;
  destination: string;
  seats: number;
  distanceM: number;
  solo: FareBreakdown;
  shared: FareBreakdown;
}

export interface PoolPassenger {
  rideId: string;
  passengerName: string;
  seats: number;
  status: RideStatus;
  pickup: ZoneRef;
  destination: ZoneRef;
  farePaisa: number;
  poolDiscountPaisa: number;
  paymentMethod: PaymentMethod;
}

export interface Pool {
  id: string;
  status: PoolStatus;
  pickup: ZoneRef;
  corridor: string;
  seatCapacity: number;
  occupiedSeats: number;
  freeSeats: number;
  vehicle: { name: string; plate: string };
  passengers: PoolPassenger[];
  totalFarePaisa: number;
  createdAt: string;
  completedAt: string | null;
}

export interface DriverProfile {
  vehicle: { id: string; name: string; plate: string; capacity: number };
  online: boolean;
  activePool: Pool | null;
}

export interface OpenRequest {
  rideId: string;
  passengerName: string;
  seats: number;
  pickup: ZoneRef;
  destination: ZoneRef;
  farePaisa: number;
  requestedAt: string;
  canAccept: boolean;
  reason: string | null;
}

export interface DriverHistory {
  pools: Pool[];
  completedTrips: number;
  earningsPaisa: number;
}

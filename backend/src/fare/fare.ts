/**
 * Fare model (see docs/fare-model.md). Pure functions, integer paisa only: no floats, no I/O.
 *
 *   perSeat        = baseFare + distanceKm * perKmRate
 *   poolDiscount   = floor(perSeat * seats * 20%)       only when 2+ passengers share the Tesla
 *   passengerFare  = perSeat * seats - poolDiscount
 */
export const FARE_RULES = {
  baseFarePaisa: 4_000, // 40.00 taka
  perKmPaisa: 1_500, // 15.00 taka per km
  poolDiscountBps: 2_000, // 20.00 % in basis points (1 bp = 0.01 %)
} as const;

export interface FareBreakdown {
  baseFarePaisa: number;
  distanceChargePaisa: number;
  poolDiscountPaisa: number;
  totalFarePaisa: number;
}

export interface FareInput {
  distanceM: number;
  seats: number;
  /** True when at least one other passenger shares the Tesla. */
  shared: boolean;
}

export function calculateFare({ distanceM, seats, shared }: FareInput): FareBreakdown {
  if (!Number.isInteger(distanceM) || distanceM <= 0) throw new RangeError('distanceM must be a positive integer');
  if (!Number.isInteger(seats) || seats < 1) throw new RangeError('seats must be a positive integer');

  const baseFarePaisa = FARE_RULES.baseFarePaisa * seats;
  // Metres x paisa-per-km / 1000. Zone distances are whole kilometres so this is exact;
  // Math.round keeps it an integer if a future distance is not.
  const distanceChargePaisa = Math.round((distanceM * FARE_RULES.perKmPaisa * seats) / 1000);
  const subtotal = baseFarePaisa + distanceChargePaisa;
  // floor(subtotal * bps / 10000): rounding down is deterministic and never over-discounts.
  const poolDiscountPaisa = shared ? Math.floor((subtotal * FARE_RULES.poolDiscountBps) / 10_000) : 0;

  return {
    baseFarePaisa,
    distanceChargePaisa,
    poolDiscountPaisa,
    totalFarePaisa: subtotal - poolDiscountPaisa,
  };
}

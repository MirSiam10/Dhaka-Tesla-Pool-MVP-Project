import { describe, expect, it } from 'vitest';
import { calculateFare } from '../src/fare/fare';

// Hand-checkable numbers from docs/fare-model.md
//   base 4000 + 1500/km, 20% pool discount (floor), integer paisa.
describe('fare model', () => {
  it("Nusrat, Banani to Mohakhali (2 km): solo 7000, pooled 5600", () => {
    expect(calculateFare({ distanceM: 2000, seats: 1, shared: false })).toEqual({
      baseFarePaisa: 4000,
      distanceChargePaisa: 3000,
      poolDiscountPaisa: 0,
      totalFarePaisa: 7000,
    });
    expect(calculateFare({ distanceM: 2000, seats: 1, shared: true })).toEqual({
      baseFarePaisa: 4000,
      distanceChargePaisa: 3000,
      poolDiscountPaisa: 1400,
      totalFarePaisa: 5600,
    });
  });

  it("Rafiq, Banani to Gulshan 1 (3 km): solo 8500, pooled 6800", () => {
    expect(calculateFare({ distanceM: 3000, seats: 1, shared: false }).totalFarePaisa).toBe(8500);
    expect(calculateFare({ distanceM: 3000, seats: 1, shared: true })).toMatchObject({
      distanceChargePaisa: 4500,
      poolDiscountPaisa: 1700,
      totalFarePaisa: 6800,
    });
  });

  it('scales base and distance by seats before discounting', () => {
    // 2 seats, 2 km: (4000 + 3000) * 2 = 14000 solo, 20% = 2800 off
    expect(calculateFare({ distanceM: 2000, seats: 2, shared: true })).toEqual({
      baseFarePaisa: 8000,
      distanceChargePaisa: 6000,
      poolDiscountPaisa: 2800,
      totalFarePaisa: 11200,
    });
  });

  it('rounds the discount down, never up', () => {
    // 1007 m: distance charge 1510.5 rounds to 1511, subtotal 5511, 20% = 1102.2 -> 1102 (not 1103)
    const f = calculateFare({ distanceM: 1007, seats: 1, shared: true });
    expect(f.distanceChargePaisa).toBe(1511);
    expect(f.poolDiscountPaisa).toBe(1102);
    expect(f.totalFarePaisa).toBe(5511 - 1102);
  });

  it('always returns integers and a total that equals base + distance - discount', () => {
    for (const distanceM of [1000, 1234, 2000, 3000, 17000]) {
      for (const seats of [1, 2, 3]) {
        for (const shared of [true, false]) {
          const f = calculateFare({ distanceM, seats, shared });
          expect(Object.values(f).every(Number.isInteger)).toBe(true);
          expect(f.totalFarePaisa).toBe(f.baseFarePaisa + f.distanceChargePaisa - f.poolDiscountPaisa);
        }
      }
    }
  });

  it('rejects nonsense input', () => {
    expect(() => calculateFare({ distanceM: 0, seats: 1, shared: false })).toThrow(RangeError);
    expect(() => calculateFare({ distanceM: 1000, seats: 0, shared: false })).toThrow(RangeError);
    expect(() => calculateFare({ distanceM: 10.5, seats: 1, shared: false })).toThrow(RangeError);
  });
});

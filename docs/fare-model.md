# Fare model

```
perSeatSubtotal = baseFare + distanceCharge
distanceCharge  = distanceKm * perKmRate
poolDiscount    = floor(perSeatSubtotal * seats * 20%)   only if pool has 2+ passengers
passengerFare   = perSeatSubtotal * seats - poolDiscount
```

| Constant | Value |
|---|---|
| `baseFare` | 4000 paisa (৳40) |
| `perKmRate` | 1500 paisa (৳15) per km |
| `poolDiscount` | 20% (2000 basis points), applied when 2 or more passengers share the Tesla |

Distances come from the hand-set `zone_distances` table, not from maps.

## Money storage

Integer **paisa** (1 taka = 100 paisa) in `INTEGER` columns. Floats cannot represent most
decimal amounts exactly, and decimals invite rounding differences between Postgres, JS
and the UI. Integers add, compare and split exactly. The one non-exact step is the discount
percentage, which is computed in integer arithmetic and rounded **down** (`floor`), so
the rule is deterministic and testable.

## Worked example: Nusrat and Rafiq (1 seat each)

| | Nusrat | Rafiq |
|---|---|---|
| Trip | Banani to Mohakhali | Banani to Gulshan 1 |
| Distance | 2 km | 3 km |
| Base | 4000 | 4000 |
| Distance charge | 2 x 1500 = 3000 | 3 x 1500 = 4500 |
| Subtotal (solo fare) | **7000** (৳70) | **8500** (৳85) |
| Pool discount (20%) | 1400 | 1700 |
| **Pooled fare** | **5600** (৳56) | **6800** (৳68) |

If Rafiq never joins, Nusrat pays the solo 7000. If one of them cancels before the driver
arrives, the remaining passenger's fare is recomputed back to solo.

## When fares change

Fares are recalculated inside the same transaction whenever pool membership changes
(join or cancel). Once the driver marks arrival, membership is frozen, so the fare shown
at that point is final. Each completed ride keeps its fare components on the row and in
`ride_events`.

## Payment

- `CASH`: recorded as paid on completion.
- `TESLAPAY`: simulated wallet. The passenger's `wallet_paisa` must cover the solo fare at
  request time, and the final fare is debited on completion. No real gateway.

-- Reference data: predefined Dhaka zones and hand-set road distances (see docs/fare-model.md).
-- Corridors drive the pooling rule: same pickup zone + destinations in the same corridor.

INSERT INTO zones (code, name, corridor, lat, lng) VALUES
  ('BANANI',      'Banani',      'EAST',    23.793700, 90.406600),
  ('MOHAKHALI',   'Mohakhali',   'EAST',    23.777600, 90.405400),
  ('GULSHAN_1',   'Gulshan 1',   'EAST',    23.780600, 90.416600),
  ('BASHUNDHARA', 'Bashundhara', 'EAST',    23.819300, 90.452600),
  ('UTTARA',      'Uttara',      'NORTH',   23.875900, 90.379500),
  ('MIRPUR',      'Mirpur',      'NORTH',   23.822300, 90.365400),
  ('FARMGATE',    'Farmgate',    'CENTRAL', 23.756100, 90.387200),
  ('DHANMONDI',   'Dhanmondi',   'CENTRAL', 23.746100, 90.374200);

-- Distances in kilometres, converted to metres. LEAST/GREATEST store each unordered pair once.
INSERT INTO zone_distances (zone_a, zone_b, distance_m)
SELECT LEAST(a, b), GREATEST(a, b), km * 1000
FROM (VALUES
  ('BANANI',      'MOHAKHALI',   2),
  ('BANANI',      'GULSHAN_1',   3),
  ('BANANI',      'FARMGATE',    4),
  ('BANANI',      'BASHUNDHARA', 6),
  ('BANANI',      'DHANMONDI',   8),
  ('BANANI',      'MIRPUR',      9),
  ('BANANI',      'UTTARA',      10),
  ('MOHAKHALI',   'GULSHAN_1',   3),
  ('MOHAKHALI',   'FARMGATE',    3),
  ('MOHAKHALI',   'BASHUNDHARA', 7),
  ('MOHAKHALI',   'DHANMONDI',   7),
  ('MOHAKHALI',   'MIRPUR',      8),
  ('MOHAKHALI',   'UTTARA',      11),
  ('GULSHAN_1',   'BASHUNDHARA', 4),
  ('GULSHAN_1',   'FARMGATE',    6),
  ('GULSHAN_1',   'DHANMONDI',   9),
  ('GULSHAN_1',   'UTTARA',      10),
  ('GULSHAN_1',   'MIRPUR',      11),
  ('BASHUNDHARA', 'FARMGATE',    9),
  ('BASHUNDHARA', 'UTTARA',      9),
  ('BASHUNDHARA', 'DHANMONDI',   12),
  ('BASHUNDHARA', 'MIRPUR',      12),
  ('FARMGATE',    'DHANMONDI',   3),
  ('FARMGATE',    'MIRPUR',      8),
  ('FARMGATE',    'UTTARA',      14),
  ('DHANMONDI',   'MIRPUR',      10),
  ('DHANMONDI',   'UTTARA',      17),
  ('MIRPUR',      'UTTARA',      9)
) AS v (a, b, km);

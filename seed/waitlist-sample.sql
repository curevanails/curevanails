-- Sample waitlist rows for testing the /admin/waitlist view on production.
-- All ids are prefixed `sample-` so they can be removed in one statement:
--   DELETE FROM waitlist WHERE id LIKE 'sample-%';
-- email_norm = lowercased email, phone_norm = digits only (matches the API).

INSERT OR REPLACE INTO waitlist
  (id, created_at, email, phone, email_norm, phone_norm, source, status, discount_code, claimed_at, notes)
VALUES
  ('sample-001', '2026-06-09T17:42:00.000Z', 'ava.mitchell@example.com',   '(801) 555-0142', 'ava.mitchell@example.com',   '8015550142', 'getready-hero', 'waiting',  NULL,        NULL,                       NULL),
  ('sample-002', '2026-06-09T15:08:00.000Z', 'noah.tran@example.com',      '(385) 555-0188', 'noah.tran@example.com',      '3855550188', 'getready-cta',  'waiting',  NULL,        NULL,                       NULL),
  ('sample-003', '2026-06-08T21:15:00.000Z', 'mia.rodriguez@example.com',  '(435) 555-0177', 'mia.rodriguez@example.com',  '4355550177', 'getready-hero', 'invited',  NULL,        NULL,                       'Texted opening invite 6/9'),
  ('sample-004', '2026-06-08T13:30:00.000Z', 'liam.nguyen@example.com',    '(801) 555-0210', 'liam.nguyen@example.com',    '8015550210', 'instagram-bio', 'waiting',  NULL,        NULL,                       NULL),
  ('sample-005', '2026-06-07T19:05:00.000Z', 'sofia.patel@example.com',    '(801) 555-0199', 'sofia.patel@example.com',    '8015550199', 'getready-cta',  'redeemed', 'CUREVA15',  '2026-06-09T18:00:00.000Z', 'Booked Signature mani — used code'),
  ('sample-006', '2026-06-07T11:20:00.000Z', 'ethan.brooks@example.com',   '(385) 555-0166', 'ethan.brooks@example.com',   '3855550166', 'getready-hero', 'waiting',  NULL,        NULL,                       NULL),
  ('sample-007', '2026-06-06T09:48:00.000Z', 'isabella.kim@example.com',   '(435) 555-0133', 'isabella.kim@example.com',   '4355550133', 'getready-cta',  'invited',  NULL,        NULL,                       'Lives in Provo — opening preview list'),
  ('sample-008', '2026-06-05T22:10:00.000Z', 'james.carter@example.com',   '(801) 555-0124', 'james.carter@example.com',   '8015550124', 'getready-hero', 'redeemed', 'CUREVA15',  '2026-06-08T16:30:00.000Z', NULL);

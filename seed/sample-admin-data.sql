-- Sample data for LOCAL admin-dashboard testing only.
-- Load with:  npx wrangler d1 execute curevanails --local --file=seed/sample-admin-data.sql
-- Safe to re-run (INSERT OR IGNORE keyed on id / unique email).
--
-- Tables are created lazily by the app, but we CREATE IF NOT EXISTS here so the
-- seed works even on a brand-new local DB before the form has ever been hit.

CREATE TABLE IF NOT EXISTS job_applications (
  id                  TEXT PRIMARY KEY,
  created_at          TEXT NOT NULL,
  full_name           TEXT NOT NULL,
  phone               TEXT NOT NULL,
  email               TEXT NOT NULL,
  city                TEXT NOT NULL,
  license_types       TEXT NOT NULL,
  dopl_license_number TEXT NOT NULL,
  license_expiration  TEXT NOT NULL,
  work_authorized     TEXT NOT NULL,
  skills              TEXT NOT NULL,
  english_proficiency TEXT NOT NULL,
  employment_type     TEXT NOT NULL,
  days_available      TEXT NOT NULL,
  start_date          TEXT NOT NULL,
  resume_key          TEXT,
  resume_filename     TEXT,
  license_photo_key   TEXT,
  portfolio_link      TEXT,
  status              TEXT NOT NULL DEFAULT 'new',
  notes               TEXT
);

CREATE TABLE IF NOT EXISTS waitlist (
  id            TEXT PRIMARY KEY,
  created_at    TEXT NOT NULL,
  email         TEXT NOT NULL,
  phone         TEXT NOT NULL,
  email_norm    TEXT NOT NULL,
  phone_norm    TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'getready',
  status        TEXT NOT NULL DEFAULT 'waiting',
  discount_code TEXT,
  claimed_at    TEXT,
  notes         TEXT,
  unsubscribe_token TEXT,
  email_status  TEXT NOT NULL DEFAULT 'active'
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist (email_norm);

-- ─────────────────────────────  Recruit applications  ─────────────────────────────
INSERT OR IGNORE INTO job_applications
  (id, created_at, full_name, phone, email, city, license_types, dopl_license_number,
   license_expiration, work_authorized, skills, english_proficiency, employment_type,
   days_available, start_date, resume_key, resume_filename, license_photo_key,
   portfolio_link, status, notes)
VALUES
  ('app_0001', '2026-06-15T15:42:00.000Z', 'Mai Tran', '(801) 555-0142', 'mai.tran@example.com', 'Salt Lake City',
   '["nail_tech"]', 'NT-204881', '2027-03-31', 'yes',
   '["manicure_pedicure","gel_shellac","acrylic_full_set","nail_art_3d"]', 'fluent', 'full_time',
   '["tuesday","wednesday","thursday","friday","saturday"]', '2026-07-01', NULL, NULL, NULL,
   'https://instagram.com/mai.nails', 'new', NULL),

  ('app_0002', '2026-06-14T19:05:00.000Z', 'Sophia Nguyen', '(385) 555-0198', 'sophia.n@example.com', 'West Valley City',
   '["nail_tech","cosmetologist_barber"]', 'CB-118245', '2026-12-15', 'yes',
   '["gel_x_soft_gel","dip_powder","nail_art_3d"]', 'native', 'full_time',
   '["monday","tuesday","wednesday","thursday","friday"]', '2026-06-22', NULL, NULL, NULL,
   'https://sophianails.myportfolio.com', 'pending', 'Strong portfolio — phone screen scheduled Thu.'),

  ('app_0003', '2026-06-13T13:18:00.000Z', 'Linh Pham', '(801) 555-0177', 'linh.pham@example.com', 'Sandy',
   '["nail_tech"]', 'NT-209910', '2028-01-31', 'yes',
   '["manicure_pedicure","dip_powder"]', 'conversational', 'part_time',
   '["friday","saturday","sunday"]', '2026-08-01', NULL, NULL, NULL,
   NULL, 'contacted', 'Available weekends only. Wants part-time around school.'),

  ('app_0004', '2026-06-12T10:47:00.000Z', 'Jasmine Carter', '(435) 555-0163', 'jasmine.carter@example.com', 'Provo',
   '["other"]', 'XX-000000', '2026-09-30', 'no',
   '["manicure_pedicure"]', 'native', 'part_time',
   '["saturday","sunday"]', '2026-09-15', NULL, NULL, NULL,
   NULL, 'new', NULL),

  ('app_0005', '2026-06-10T17:30:00.000Z', 'Yuki Tanaka', '(801) 555-0121', 'yuki.tanaka@example.com', 'Draper',
   '["nail_tech"]', 'NT-198432', '2027-07-31', 'yes',
   '["acrylic_full_set","gel_x_soft_gel","nail_art_3d"]', 'fluent', 'full_time',
   '["monday","wednesday","thursday","friday","saturday"]', '2026-07-15', NULL, NULL, NULL,
   'https://behance.net/yukinails', 'deal', 'Offer accepted! Starts Jul 15. Onboarding paperwork sent.'),

  ('app_0006', '2026-06-09T09:12:00.000Z', 'Camila Reyes', '(385) 555-0150', 'camila.reyes@example.com', 'Murray',
   '["cosmetologist_barber"]', 'CB-220117', '2027-11-30', 'yes',
   '["gel_shellac","dip_powder"]', 'conversational', 'full_time',
   '["tuesday","wednesday","thursday","friday"]', '2026-08-10', NULL, NULL, NULL,
   NULL, 'pending', NULL),

  ('app_0007', '2026-06-07T14:55:00.000Z', 'Hannah Lee', '(801) 555-0188', 'hannah.lee@example.com', 'South Jordan',
   '["nail_tech"]', 'NT-201556', '2026-08-31', 'yes',
   '["manicure_pedicure","gel_shellac","gel_x_soft_gel","acrylic_full_set","dip_powder","nail_art_3d"]', 'native', 'full_time',
   '["monday","tuesday","wednesday","thursday","friday","saturday"]', '2026-06-20', NULL, NULL, NULL,
   'https://hannahleenails.com', 'contacted', '6+ years experience. Very responsive. Loop in owner for 2nd interview.'),

  ('app_0008', '2026-06-05T11:23:00.000Z', 'Aaliyah Brooks', '(435) 555-0109', 'aaliyah.brooks@example.com', 'Lehi',
   '["nail_tech","other"]', 'NT-211002', '2028-04-30', 'yes',
   '["manicure_pedicure","nail_art_3d"]', 'fluent', 'part_time',
   '["thursday","friday","saturday"]', '2026-09-01', NULL, NULL, NULL,
   NULL, 'new', NULL);

-- ──────────────────────────────────  Waitlist  ──────────────────────────────────
INSERT OR IGNORE INTO waitlist
  (id, created_at, email, phone, email_norm, phone_norm, source, status,
   discount_code, claimed_at, notes, unsubscribe_token, email_status)
VALUES
  ('wl_0001', '2026-06-16T08:14:00.000Z', 'grace.kim@example.com', '(801) 555-0211', 'grace.kim@example.com', '8015550211', 'getready', 'waiting', NULL, NULL, NULL, 'unsub_grace_0001', 'active'),
  ('wl_0002', '2026-06-15T20:41:00.000Z', 'olivia.martin@example.com', '(385) 555-0233', 'olivia.martin@example.com', '3855550233', 'getready', 'waiting', NULL, NULL, NULL, 'unsub_olivia_0002', 'active'),
  ('wl_0003', '2026-06-15T12:09:00.000Z', 'emma.wilson@example.com', '(801) 555-0245', 'emma.wilson@example.com', '8015550245', 'getready', 'invited', 'CUREVA-WELCOME15', NULL, 'Sent invite email 6/15.', 'unsub_emma_0003', 'active'),
  ('wl_0004', '2026-06-14T16:52:00.000Z', 'noah.davis@example.com', '(435) 555-0267', 'noah.davis@example.com', '4355550267', 'getready', 'invited', 'CUREVA-WELCOME15', NULL, NULL, 'unsub_noah_0004', 'active'),
  ('wl_0005', '2026-06-13T18:30:00.000Z', 'ava.garcia@example.com', '(801) 555-0289', 'ava.garcia@example.com', '8015550289', 'getready', 'redeemed', 'CUREVA-VIP20', '2026-06-14T15:00:00.000Z', 'Booked first appointment.', 'unsub_ava_0005', 'active'),
  ('wl_0006', '2026-06-12T09:05:00.000Z', 'mia.rodriguez@example.com', '(385) 555-0290', 'mia.rodriguez@example.com', '3855550290', 'getready', 'waiting', NULL, NULL, NULL, 'unsub_mia_0006', 'active'),
  ('wl_0007', '2026-06-10T21:47:00.000Z', 'isabella.lopez@example.com', '(801) 555-0312', 'isabella.lopez@example.com', '8015550312', 'getready', 'redeemed', 'CUREVA-VIP20', '2026-06-12T11:30:00.000Z', NULL, 'unsub_isabella_0007', 'active'),
  ('wl_0008', '2026-06-08T07:38:00.000Z', 'charlotte.lee@example.com', '(435) 555-0334', 'charlotte.lee@example.com', '4355550334', 'getready', 'waiting', NULL, NULL, 'Asked about gel-X pricing.', 'unsub_charlotte_0008', 'active');

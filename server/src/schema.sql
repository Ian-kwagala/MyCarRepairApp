-- MyCarRepair schema. The seven domain tables are the web platform's tables, same columns and types
-- (blueprint §5, Appendix A). The tables after them are additive and independent (§5.3).
-- Timestamps are UTC (also enforced per connection); best effort for connection poolers that drop startup options.
DO $$ BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'UTC');
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE job_status AS ENUM ('pending', 'accepted', 'diagnosing', 'fixing', 'ready', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password TEXT NOT NULL,
  phone VARCHAR(20),
  role VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'mechanic', 'admin')),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'suspended')),
  location_lat DECIMAL(9, 6),
  location_lng DECIMAL(9, 6),
  is_online BOOLEAN NOT NULL DEFAULT false,
  garage_name VARCHAR(100),
  garage_location VARCHAR(100),
  expertise TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_phone_idx ON users (phone);
CREATE INDEX IF NOT EXISTS users_online_mechanics_idx ON users (role, status, is_online);

CREATE TABLE IF NOT EXISTS vehicles (
  id SERIAL PRIMARY KEY,
  owner_id INT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  make VARCHAR(50) NOT NULL,
  model VARCHAR(50) NOT NULL,
  year INTEGER NOT NULL,
  plate_number VARCHAR(20) NOT NULL,
  fuel_type VARCHAR(20),
  transmission VARCHAR(20),
  tyre_size VARCHAR(20),
  color VARCHAR(30),
  mileage INTEGER,
  last_service_date DATE,
  photos TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vehicles_owner_idx ON vehicles (owner_id);

CREATE TABLE IF NOT EXISTS jobs (
  id SERIAL PRIMARY KEY,
  owner_id INT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  mechanic_id INT REFERENCES users (id) ON DELETE SET NULL,
  vehicle_id INT REFERENCES vehicles (id) ON DELETE SET NULL,
  service_type VARCHAR(50) NOT NULL,
  status job_status NOT NULL DEFAULT 'pending',
  total_price DECIMAL(12, 2) NOT NULL DEFAULT 0,
  sos_active BOOLEAN NOT NULL DEFAULT false,
  start_code VARCHAR(4),
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_owner_idx ON jobs (owner_id);
CREATE INDEX IF NOT EXISTS jobs_mechanic_idx ON jobs (mechanic_id);
CREATE INDEX IF NOT EXISTS jobs_open_idx ON jobs (status) WHERE mechanic_id IS NULL;

CREATE TABLE IF NOT EXISTS job_checklists (
  id SERIAL PRIMARY KEY,
  job_id INT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  task_description VARCHAR(255) NOT NULL,
  is_completed BOOLEAN NOT NULL DEFAULT false,
  photo_url TEXT,
  completed_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS job_checklists_job_idx ON job_checklists (job_id);

CREATE TABLE IF NOT EXISTS parts_quotes (
  id SERIAL PRIMARY KEY,
  job_id INT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  part_name VARCHAR(100) NOT NULL,
  price DECIMAL(12, 2) NOT NULL,
  photo_evidence TEXT,
  is_approved BOOLEAN,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS parts_quotes_job_idx ON parts_quotes (job_id);

CREATE TABLE IF NOT EXISTS reviews (
  id SERIAL PRIMARY KEY,
  job_id INT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  mechanic_id INT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  owner_id INT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  feedback TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
-- Business rule "1 review per job" enforced in the database as well.
CREATE UNIQUE INDEX IF NOT EXISTS reviews_one_per_job ON reviews (job_id);

CREATE TABLE IF NOT EXISTS system_config (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT
);

-- ── Additive tables (not part of the shared domain model) ─────────────────────────────────────────

-- §5.3 option A: device push tokens.
CREATE TABLE IF NOT EXISTS device_tokens (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users (id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  platform VARCHAR(10),
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Booking date/notes and the diagnostic photo: the jobs table has no columns for them.
CREATE TABLE IF NOT EXISTS job_extras (
  job_id INT PRIMARY KEY REFERENCES jobs (id) ON DELETE CASCADE,
  scheduled_date DATE,
  notes TEXT,
  photo TEXT
);

-- Uploaded photos (vehicle, part, task, diagnostic). Swap for S3/Cloudinary later (§6 task 6);
-- the domain tables only ever hold the "media/<key>" paths.
CREATE TABLE IF NOT EXISTS media (
  key VARCHAR(64) PRIMARY KEY,
  owner_id INT REFERENCES users (id) ON DELETE SET NULL,
  mime VARCHAR(50) NOT NULL,
  bytes BYTEA NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Refresh tokens (stored hashed) for rotation and logout.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  token_hash CHAR(64) PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- One-time password-reset codes (stored hashed).
CREATE TABLE IF NOT EXISTS password_resets (
  user_id INT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  code_hash CHAR(64) NOT NULL,
  -- Shown to support staff on /admin until used, when no SMS provider is configured.
  code_hint VARCHAR(6),
  attempts INT NOT NULL DEFAULT 0,
  expires_at TIMESTAMP NOT NULL
);

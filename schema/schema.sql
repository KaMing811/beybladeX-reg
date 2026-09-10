CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT DEFAULT '',
  venue TEXT DEFAULT '',
  address TEXT DEFAULT '',
  event_date TEXT NOT NULL,
  start_time TEXT DEFAULT '',
  end_time TEXT DEFAULT '',
  description TEXT DEFAULT '',
  rules TEXT DEFAULT '',
  categories TEXT DEFAULT '["公開組"]',
  capacity INTEGER DEFAULT 32,
  entry_fee INTEGER DEFAULT 0,
  currency TEXT DEFAULT 'HKD',
  payme_id TEXT DEFAULT '',
  payme_link TEXT DEFAULT '',
  fps_id TEXT DEFAULT '',
  fps_name TEXT DEFAULT '',
  payment_note TEXT DEFAULT '',
  whatsapp TEXT DEFAULT '',
  registration_open INTEGER DEFAULT 1,
  registration_deadline TEXT DEFAULT '',
  show_public_list INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  token TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  real_name TEXT DEFAULT '',
  whatsapp TEXT NOT NULL,
  category TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  admin_note TEXT DEFAULT '',
  paid_ref TEXT DEFAULT '',
  paid_at TEXT,
  confirmed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE INDEX IF NOT EXISTS idx_reg_event ON registrations(event_id);
CREATE INDEX IF NOT EXISTS idx_reg_status ON registrations(status);
CREATE INDEX IF NOT EXISTS idx_reg_token ON registrations(token);
CREATE INDEX IF NOT EXISTS idx_events_slug ON events(slug);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);

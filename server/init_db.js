import sqlite3 from 'sqlite3';

// Initialize and populate the SQLite database with a simplified schema and some seed data.
const dbFile = new URL('database.sqlite', import.meta.url).pathname;

const db = new sqlite3.Database(dbFile);

function run(query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

async function init() {
  // Drop tables if they exist for a fresh start
  const dropQueries = [
    'DROP TABLE IF EXISTS reservation_players;',
    'DROP TABLE IF EXISTS reservations;',
    'DROP TABLE IF EXISTS waitlist;',
    'DROP TABLE IF EXISTS event_registrations;',
    'DROP TABLE IF EXISTS events;',
    'DROP TABLE IF EXISTS memberships;',
    'DROP TABLE IF EXISTS membership_plans;',
    'DROP TABLE IF EXISTS payments;',
    'DROP TABLE IF EXISTS notifications;',
    'DROP TABLE IF EXISTS messages;',
    'DROP TABLE IF EXISTS courts;',
    'DROP TABLE IF EXISTS players;'
  ];
  for (const q of dropQueries) {
    await run(q).catch(() => {});
  }

  // Create tables
  await run(`
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      status TEXT CHECK (status IN ('active','expired','none')) DEFAULT 'none',
      expiry TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS courts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      location TEXT,
      surface TEXT,
      indoor INTEGER DEFAULT 0,
      lights INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      court_id INTEGER NOT NULL,
      player_id INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      status TEXT CHECK (status IN ('booked','cancelled','completed')) DEFAULT 'booked',
      price_cents INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (court_id) REFERENCES courts(id),
      FOREIGN KEY (player_id) REFERENCES players(id)
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS reservation_players (
      reservation_id INTEGER NOT NULL,
      player_id INTEGER NOT NULL,
      role TEXT CHECK (role IN ('host','guest')) DEFAULT 'guest',
      PRIMARY KEY (reservation_id, player_id),
      FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE,
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS waitlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      court_id INTEGER NOT NULL,
      player_id INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      priority INTEGER DEFAULT 0,
      status TEXT CHECK (status IN ('waiting','notified','booked','cancelled','expired')) DEFAULT 'waiting',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (court_id) REFERENCES courts(id),
      FOREIGN KEY (player_id) REFERENCES players(id)
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      court_id INTEGER,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      max_participants INTEGER,
      fee_cents INTEGER DEFAULT 0,
      status TEXT CHECK (status IN ('draft','open','full','closed','cancelled')) DEFAULT 'open',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (court_id) REFERENCES courts(id)
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS event_registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      player_id INTEGER NOT NULL,
      registered_at TEXT DEFAULT (datetime('now')),
      payment_status TEXT CHECK (payment_status IN ('unpaid','paid','refunded','waived')) DEFAULT 'unpaid',
      status TEXT CHECK (status IN ('registered','waitlisted','cancelled','attended','no_show')) DEFAULT 'registered',
      FOREIGN KEY (event_id) REFERENCES events(id),
      FOREIGN KEY (player_id) REFERENCES players(id)
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS membership_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      period_months INTEGER,
      price_cents INTEGER,
      description TEXT
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS memberships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL,
      plan_id INTEGER NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      status TEXT CHECK (status IN ('active','expired','pending','cancelled')) DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (player_id) REFERENCES players(id),
      FOREIGN KEY (plan_id) REFERENCES membership_plans(id)
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT DEFAULT 'VND',
      source_type TEXT,
      source_id INTEGER,
      method TEXT,
      status TEXT CHECK (status IN ('pending','succeeded','failed','refunded','partial')) DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (player_id) REFERENCES players(id)
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER,
      channel TEXT,
      subject TEXT,
      body TEXT,
      scheduled_at TEXT,
      sent_at TEXT,
      status TEXT CHECK (status IN ('queued','sent','failed','cancelled')) DEFAULT 'queued',
      FOREIGN KEY (player_id) REFERENCES players(id)
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER,
      channel TEXT,
      subject TEXT,
      body TEXT,
      tags TEXT,
      sent_at TEXT DEFAULT (datetime('now')),
      status TEXT CHECK (status IN ('sent','failed')) DEFAULT 'sent',
      FOREIGN KEY (player_id) REFERENCES players(id)
    );
  `);

  // Seed some sample data
  const players = [
    ['Nguyen Van A', '0901002001', 'a@example.com', 'active', '2025-12-31'],
    ['Tran Thi B',   '0901002002', 'b@example.com', 'expired', '2024-10-15'],
    ['Le Van C',     '0901002003', 'c@example.com', 'active', '2026-01-10'],
    ['Pham Thi D',   '0901002004', 'd@example.com', 'none', null],
    ['Hoang Van E',  '0901002005', 'e@example.com', 'active', '2025-07-20']
  ];
  for (const p of players) {
    await run('INSERT INTO players (name, phone, email, status, expiry) VALUES (?,?,?,?,?)', p);
  }

  const courts = [
    ['Court 1', 'Main hall', 'hard', 0, 1, 1],
    ['Court 2', 'Outdoor', 'acrylic', 0, 0, 1],
    ['Court 3', 'Indoor', 'wood', 1, 1, 1]
  ];
  for (const c of courts) {
    await run('INSERT INTO courts (name, location, surface, indoor, lights, is_active) VALUES (?,?,?,?,?,?)', c);
  }

  const membershipPlans = [
    ['Monthly', 1, 500000, 'One month membership'],
    ['Quarterly', 3, 1200000, 'Three months membership'],
    ['Annual', 12, 4000000, 'One year membership']
  ];
  for (const m of membershipPlans) {
    await run('INSERT INTO membership_plans (name, period_months, price_cents, description) VALUES (?,?,?,?)', m);
  }

  // Create some memberships: players 1 and 3 have active membership plan 1, players 2 expired
  await run('INSERT INTO memberships (player_id, plan_id, start_date, end_date, status) VALUES (1, 1, "2025-01-01", "2025-12-31", "active")');
  await run('INSERT INTO memberships (player_id, plan_id, start_date, end_date, status) VALUES (2, 2, "2024-01-01", "2024-03-31", "expired")');

  // Reservations (include both completed and booked)
  const now = new Date();
  const isoNow = now.toISOString().slice(0,10);
  await run('INSERT INTO reservations (court_id, player_id, start_time, end_time, status, price_cents) VALUES (1, 1, ? || " 09:00", ? || " 10:00", "booked", 100000)', [isoNow, isoNow]);
  await run('INSERT INTO reservations (court_id, player_id, start_time, end_time, status, price_cents) VALUES (2, 2, ? || " 11:00", ? || " 12:00", "completed", 100000)', [isoNow, isoNow]);

  // Event and registrations
  const eventStart = isoNow + ' 15:00';
  const eventEnd = isoNow + ' 18:00';
  await run('INSERT INTO events (name, description, court_id, start_time, end_time, max_participants, fee_cents, status) VALUES (?,?,?,?,?,?,?,?)', [
    'Summer Tournament', 'Annual summer event', 1, eventStart, eventEnd, 16, 200000, 'open'
  ]);
  await run('INSERT INTO event_registrations (event_id, player_id, payment_status, status) VALUES (1, 1, "paid", "registered")');
  await run('INSERT INTO event_registrations (event_id, player_id, payment_status, status) VALUES (1, 3, "unpaid", "registered")');

  // Sample payments
  await run('INSERT INTO payments (player_id, amount_cents, source_type, source_id, method, status) VALUES (1, 4000000, "membership", 1, "card", "succeeded")');
  await run('INSERT INTO payments (player_id, amount_cents, source_type, source_id, method, status) VALUES (1, 100000, "reservation", 1, "cash", "succeeded")');

  console.log('Database initialized');
  db.close();
}

init().catch((err) => {
  console.error(err);
  db.close();
});
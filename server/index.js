import express from 'express';
import sqlite3 from 'sqlite3';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize express
const app = express();
app.use(express.json());
app.use(cors());

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, '../public')));

// SQLite database connection
const dbFile = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbFile);

function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}
function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}
function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

/*
  CRUD endpoints
*/

// Players
app.get('/api/players', async (req, res) => {
  try {
    const rows = await allAsync('SELECT id, name, phone, email, status, expiry FROM players ORDER BY id');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/players', async (req, res) => {
  const { name, phone, email, status, expiry } = req.body;
  try {
    const result = await runAsync('INSERT INTO players (name, phone, email, status, expiry) VALUES (?,?,?,?,?)', [name, phone, email, status || 'none', expiry || null]);
    const row = await getAsync('SELECT id, name, phone, email, status, expiry FROM players WHERE id = ?', [result.lastID]);
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/players/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const fields = req.body;
  const setClauses = [];
  const values = [];
  Object.keys(fields).forEach((key) => {
    setClauses.push(`${key} = ?`);
    values.push(fields[key]);
  });
  values.push(id);
  const sql = `UPDATE players SET ${setClauses.join(', ')} WHERE id = ?`;
  try {
    await runAsync(sql, values);
    const updated = await getAsync('SELECT id, name, phone, email, status, expiry FROM players WHERE id = ?', [id]);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/players/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await runAsync('DELETE FROM players WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Courts
app.get('/api/courts', async (req, res) => {
  try {
    const rows = await allAsync('SELECT id, name, location, surface, indoor, lights, is_active FROM courts ORDER BY id');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/courts', async (req, res) => {
  const { name, location, surface, indoor, lights, is_active } = req.body;
  try {
    const result = await runAsync('INSERT INTO courts (name, location, surface, indoor, lights, is_active) VALUES (?,?,?,?,?,?)', [name, location, surface, indoor ? 1 : 0, lights ? 1 : 0, is_active ? 1 : 0]);
    const row = await getAsync('SELECT id, name, location, surface, indoor, lights, is_active FROM courts WHERE id = ?', [result.lastID]);
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/courts/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const fields = req.body;
  const setClauses = [];
  const values = [];
  for (const key of Object.keys(fields)) {
    setClauses.push(`${key} = ?`);
    values.push(fields[key]);
  }
  values.push(id);
  try {
    await runAsync(`UPDATE courts SET ${setClauses.join(', ')} WHERE id = ?`, values);
    const updated = await getAsync('SELECT id, name, location, surface, indoor, lights, is_active FROM courts WHERE id = ?', [id]);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/courts/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await runAsync('DELETE FROM courts WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reservations
app.get('/api/reservations', async (req, res) => {
  const { date } = req.query;
  try {
    let rows;
    if (date) {
      rows = await allAsync(
        `SELECT r.id, r.court_id, c.name AS court_name, r.player_id, p.name AS player_name, r.start_time, r.end_time, r.status, r.price_cents, r.payment_status
         FROM reservations r
         JOIN courts c ON c.id = r.court_id
         JOIN players p ON p.id = r.player_id
         WHERE date(r.start_time) = date(?)
         ORDER BY r.start_time`,
        [date]
      );
    } else {
      rows = await allAsync(
        `SELECT r.id, r.court_id, c.name AS court_name, r.player_id, p.name AS player_name, r.start_time, r.end_time, r.status, r.price_cents, r.payment_status
         FROM reservations r
         JOIN courts c ON c.id = r.court_id
         JOIN players p ON p.id = r.player_id
         ORDER BY r.start_time`
      );
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/reservations', async (req, res) => {
  const { court_id, player_id, start_time, end_time, price_cents, status } = req.body;
  // check for conflicts: if existing reservation for same court overlaps
  try {
    const conflicts = await allAsync(
      `SELECT id FROM reservations
       WHERE court_id = ?
         AND status IN ('booked','completed')
         AND NOT (datetime(end_time) <= datetime(?) OR datetime(start_time) >= datetime(?))`,
      [court_id, start_time, end_time]
    );
    if (conflicts.length > 0) {
      // push to waitlist automatically
      await runAsync(
        'INSERT INTO waitlist (court_id, player_id, start_time, end_time, priority, status) VALUES (?,?,?,?,0, "waiting")',
        [court_id, player_id, start_time, end_time]
      );
      return res.status(409).json({ error: 'Court is already booked at this time. Added to waitlist.' });
    }
    const result = await runAsync(
      'INSERT INTO reservations (court_id, player_id, start_time, end_time, status, price_cents, payment_status) VALUES (?,?,?,?,?,?,?)',
      [court_id, player_id, start_time, end_time, status || 'booked', price_cents || 0, payment_status || 'unpaid']
    );
    const row = await getAsync(
      `SELECT r.id, r.court_id, c.name AS court_name, r.player_id, p.name AS player_name, r.start_time, r.end_time, r.status, r.price_cents
       FROM reservations r
       JOIN courts c ON c.id = r.court_id
       JOIN players p ON p.id = r.player_id
       WHERE r.id = ?`,
      [result.lastID]
    );
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/reservations/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const fields = req.body;
  const setClauses = [];
  const values = [];
  for (const key of Object.keys(fields)) {
    setClauses.push(`${key} = ?`);
    values.push(fields[key]);
  }
  values.push(id);
  try {
    await runAsync(`UPDATE reservations SET ${setClauses.join(', ')} WHERE id = ?`, values);
    const updated = await getAsync(
      `SELECT r.id, r.court_id, c.name AS court_name, r.player_id, p.name AS player_name, r.start_time, r.end_time, r.status, r.price_cents
       FROM reservations r
       JOIN courts c ON c.id = r.court_id
       JOIN players p ON p.id = r.player_id
       WHERE r.id = ?`,
      [id]
    );
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/reservations/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await runAsync('DELETE FROM reservations WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Waitlist
app.get('/api/waitlist', async (req, res) => {
  try {
    const rows = await allAsync(
      `SELECT w.id, w.court_id, c.name AS court_name, w.player_id, p.name AS player_name, w.start_time, w.end_time, w.priority, w.status
       FROM waitlist w
       JOIN courts c ON c.id = w.court_id
       JOIN players p ON p.id = w.player_id
       ORDER BY w.created_at`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/waitlist', async (req, res) => {
  const { court_id, player_id, start_time, end_time, priority, status } = req.body;
  try {
    const result = await runAsync(
      'INSERT INTO waitlist (court_id, player_id, start_time, end_time, priority, status) VALUES (?,?,?,?,?,?)',
      [court_id, player_id, start_time, end_time, priority || 0, status || 'waiting']
    );
    const row = await getAsync(
      `SELECT w.id, w.court_id, c.name AS court_name, w.player_id, p.name AS player_name, w.start_time, w.end_time, w.priority, w.status
       FROM waitlist w
       JOIN courts c ON c.id = w.court_id
       JOIN players p ON p.id = w.player_id
       WHERE w.id = ?`,
      [result.lastID]
    );
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/waitlist/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const fields = req.body;
  const setClauses = [];
  const values = [];
  for (const key of Object.keys(fields)) {
    setClauses.push(`${key} = ?`);
    values.push(fields[key]);
  }
  values.push(id);
  try {
    await runAsync(`UPDATE waitlist SET ${setClauses.join(', ')} WHERE id = ?`, values);
    // fetch updated waitlist entry
    const updated = await getAsync(
      `SELECT w.id, w.court_id, c.name AS court_name, w.player_id, p.name AS player_name, w.start_time, w.end_time, w.priority, w.status
       FROM waitlist w
       JOIN courts c ON c.id = w.court_id
       JOIN players p ON p.id = w.player_id
       WHERE w.id = ?`,
      [id]
    );
    // Check for conflicts: if no conflict, convert to reservation and delete from waitlist
    const { court_id, player_id, start_time, end_time } = updated;
    const conflicts = await allAsync(
      `SELECT id FROM reservations
       WHERE court_id = ?
         AND status IN ('booked','completed')
         AND NOT (datetime(end_time) <= datetime(?) OR datetime(start_time) >= datetime(?))`,
      [court_id, start_time, end_time]
    );
    if (conflicts.length === 0) {
      // Create a new reservation with default status 'booked' and price 0
      const result = await runAsync(
        'INSERT INTO reservations (court_id, player_id, start_time, end_time, status, price_cents) VALUES (?,?,?,?,?,?)',
        [court_id, player_id, start_time, end_time, 'booked', 0]
      );
      // Remove from waitlist
      await runAsync('DELETE FROM waitlist WHERE id = ?', [id]);
      // return the newly created reservation
      const row = await getAsync(
        `SELECT r.id, r.court_id, c.name AS court_name, r.player_id, p.name AS player_name, r.start_time, r.end_time, r.status, r.price_cents
         FROM reservations r
         JOIN courts c ON c.id = r.court_id
         JOIN players p ON p.id = r.player_id
         WHERE r.id = ?`,
        [result.lastID]
      );
      return res.status(201).json(row);
    }
    // still in waitlist
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/waitlist/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await runAsync('DELETE FROM waitlist WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Events
app.get('/api/events', async (req, res) => {
  try {
    const rows = await allAsync(
      `SELECT e.id, e.name, e.description, e.court_id, c.name AS court_name, e.start_time, e.end_time, e.max_participants, e.fee_cents, e.status
       FROM events e
       LEFT JOIN courts c ON c.id = e.court_id
       ORDER BY e.start_time`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/events', async (req, res) => {
  const { name, description, court_id, start_time, end_time, max_participants, fee_cents, status } = req.body;
  try {
    const result = await runAsync(
      'INSERT INTO events (name, description, court_id, start_time, end_time, max_participants, fee_cents, status) VALUES (?,?,?,?,?,?,?,?)',
      [name, description, court_id || null, start_time, end_time, max_participants || null, fee_cents || 0, status || 'open']
    );
    const row = await getAsync(
      `SELECT e.id, e.name, e.description, e.court_id, c.name AS court_name, e.start_time, e.end_time, e.max_participants, e.fee_cents, e.status
       FROM events e
       LEFT JOIN courts c ON c.id = e.court_id
       WHERE e.id = ?`,
      [result.lastID]
    );
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/events/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const fields = req.body;
  const setClauses = [];
  const values = [];
  for (const key of Object.keys(fields)) {
    setClauses.push(`${key} = ?`);
    values.push(fields[key]);
  }
  values.push(id);
  try {
    await runAsync(`UPDATE events SET ${setClauses.join(', ')} WHERE id = ?`, values);
    const updated = await getAsync(
      `SELECT e.id, e.name, e.description, e.court_id, c.name AS court_name, e.start_time, e.end_time, e.max_participants, e.fee_cents, e.status
       FROM events e
       LEFT JOIN courts c ON c.id = e.court_id
       WHERE e.id = ?`,
      [id]
    );
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/events/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await runAsync('DELETE FROM event_registrations WHERE event_id = ?', [id]);
    await runAsync('DELETE FROM events WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Event registrations
app.get('/api/events/:eventId/registrations', async (req, res) => {
  const eventId = parseInt(req.params.eventId, 10);
  try {
    const rows = await allAsync(
      `SELECT er.id, er.event_id, er.player_id, p.name AS player_name, er.registered_at, er.payment_status, er.status
       FROM event_registrations er
       JOIN players p ON p.id = er.player_id
       WHERE er.event_id = ?
       ORDER BY er.registered_at`,
      [eventId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/events/:eventId/registrations', async (req, res) => {
  const eventId = parseInt(req.params.eventId, 10);
  const { player_id, payment_status, status } = req.body;
  try {
    const result = await runAsync(
      'INSERT INTO event_registrations (event_id, player_id, payment_status, status) VALUES (?,?,?,?)',
      [eventId, player_id, payment_status || 'unpaid', status || 'registered']
    );
    const row = await getAsync(
      `SELECT er.id, er.event_id, er.player_id, p.name AS player_name, er.registered_at, er.payment_status, er.status
       FROM event_registrations er
       JOIN players p ON p.id = er.player_id
       WHERE er.id = ?`,
      [result.lastID]
    );
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/event-registrations/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const fields = req.body;
  const setClauses = [];
  const values = [];
  for (const key of Object.keys(fields)) {
    setClauses.push(`${key} = ?`);
    values.push(fields[key]);
  }
  values.push(id);
  try {
    await runAsync(`UPDATE event_registrations SET ${setClauses.join(', ')} WHERE id = ?`, values);
    const row = await getAsync(
      `SELECT er.id, er.event_id, er.player_id, p.name AS player_name, er.registered_at, er.payment_status, er.status
       FROM event_registrations er
       JOIN players p ON p.id = er.player_id
       WHERE er.id = ?`,
      [id]
    );
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/event-registrations/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await runAsync('DELETE FROM event_registrations WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Membership plans
app.get('/api/membership-plans', async (req, res) => {
  try {
    const rows = await allAsync('SELECT id, name, period_months, price_cents, description FROM membership_plans');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/membership-plans', async (req, res) => {
  const { name, period_months, price_cents, description } = req.body;
  try {
    const result = await runAsync('INSERT INTO membership_plans (name, period_months, price_cents, description) VALUES (?,?,?,?)', [name, period_months, price_cents, description]);
    const row = await getAsync('SELECT id, name, period_months, price_cents, description FROM membership_plans WHERE id = ?', [result.lastID]);
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/membership-plans/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const fields = req.body;
  const setClauses = [];
  const values = [];
  Object.keys(fields).forEach((key) => {
    setClauses.push(`${key} = ?`);
    values.push(fields[key]);
  });
  values.push(id);
  try {
    await runAsync(`UPDATE membership_plans SET ${setClauses.join(', ')} WHERE id = ?`, values);
    const row = await getAsync('SELECT id, name, period_months, price_cents, description FROM membership_plans WHERE id = ?', [id]);
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/membership-plans/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await runAsync('DELETE FROM membership_plans WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Memberships
app.get('/api/memberships', async (req, res) => {
  try {
    const rows = await allAsync(
      `SELECT m.id, m.player_id, p.name AS player_name, m.plan_id, mp.name AS plan_name,
              m.start_date, m.end_date, m.status
       FROM memberships m
       JOIN players p ON p.id = m.player_id
       JOIN membership_plans mp ON mp.id = m.plan_id
       ORDER BY m.start_date`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/memberships', async (req, res) => {
  const { player_id, plan_id, start_date, end_date, status } = req.body;
  try {
    const result = await runAsync(
      'INSERT INTO memberships (player_id, plan_id, start_date, end_date, status) VALUES (?,?,?,?,?)',
      [player_id, plan_id, start_date, end_date, status || 'active']
    );
    const row = await getAsync(
      `SELECT m.id, m.player_id, p.name AS player_name, m.plan_id, mp.name AS plan_name, m.start_date, m.end_date, m.status
       FROM memberships m
       JOIN players p ON p.id = m.player_id
       JOIN membership_plans mp ON mp.id = m.plan_id
       WHERE m.id = ?`,
      [result.lastID]
    );
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/memberships/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const fields = req.body;
  const setClauses = [];
  const values = [];
  for (const key of Object.keys(fields)) {
    setClauses.push(`${key} = ?`);
    values.push(fields[key]);
  }
  values.push(id);
  try {
    await runAsync(`UPDATE memberships SET ${setClauses.join(', ')} WHERE id = ?`, values);
    const row = await getAsync(
      `SELECT m.id, m.player_id, p.name AS player_name, m.plan_id, mp.name AS plan_name, m.start_date, m.end_date, m.status
       FROM memberships m
       JOIN players p ON p.id = m.player_id
       JOIN membership_plans mp ON mp.id = m.plan_id
       WHERE m.id = ?`,
      [id]
    );
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/memberships/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await runAsync('DELETE FROM memberships WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Payments
app.get('/api/payments', async (req, res) => {
  try {
    const rows = await allAsync(
      `SELECT pay.id, pay.player_id, p.name AS player_name, pay.amount_cents, pay.currency, pay.source_type, pay.source_id, pay.method, pay.status, pay.created_at
       FROM payments pay
       JOIN players p ON p.id = pay.player_id
       ORDER BY pay.created_at DESC`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/payments', async (req, res) => {
  const { player_id, amount_cents, currency, source_type, source_id, method, status } = req.body;
  try {
    const result = await runAsync(
      'INSERT INTO payments (player_id, amount_cents, currency, source_type, source_id, method, status) VALUES (?,?,?,?,?,?,?)',
      [player_id, amount_cents, currency || 'VND', source_type, source_id, method, status || 'pending']
    );
    // If payment relates to a reservation and succeeded, update reservation payment_status
    if (source_type === 'reservation' && source_id) {
      // If no status provided or status is not provided, treat pending; but if status is 'succeeded' then update
      const payStatus = status || 'pending';
      if (payStatus === 'succeeded' || payStatus === 'paid') {
        await runAsync('UPDATE reservations SET payment_status = "paid" WHERE id = ?', [source_id]);
      }
    }
    const row = await getAsync(
      `SELECT pay.id, pay.player_id, p.name AS player_name, pay.amount_cents, pay.currency, pay.source_type, pay.source_id, pay.method, pay.status, pay.created_at
       FROM payments pay
       JOIN players p ON p.id = pay.player_id
       WHERE pay.id = ?`,
      [result.lastID]
    );
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/payments/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const fields = req.body;
  const setClauses = [];
  const values = [];
  for (const key of Object.keys(fields)) {
    setClauses.push(`${key} = ?`);
    values.push(fields[key]);
  }
  values.push(id);
  try {
    await runAsync(`UPDATE payments SET ${setClauses.join(', ')} WHERE id = ?`, values);
    const row = await getAsync(
      `SELECT pay.id, pay.player_id, p.name AS player_name, pay.amount_cents, pay.currency, pay.source_type, pay.source_id, pay.method, pay.status, pay.created_at
       FROM payments pay
       JOIN players p ON p.id = pay.player_id
       WHERE pay.id = ?`,
      [id]
    );
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/payments/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await runAsync('DELETE FROM payments WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Notifications
app.get('/api/notifications-queue', async (req, res) => {
  try {
    const rows = await allAsync(
      `SELECT n.id, n.player_id, p.name AS player_name, n.channel, n.subject, n.body, n.scheduled_at, n.sent_at, n.status
       FROM notifications n
       LEFT JOIN players p ON p.id = n.player_id
       ORDER BY n.scheduled_at`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/notifications-queue', async (req, res) => {
  const { player_id, channel, subject, body, scheduled_at, status } = req.body;
  try {
    const result = await runAsync(
      'INSERT INTO notifications (player_id, channel, subject, body, scheduled_at, status) VALUES (?,?,?,?,?,?)',
      [player_id || null, channel, subject, body, scheduled_at, status || 'queued']
    );
    const row = await getAsync(
      `SELECT n.id, n.player_id, p.name AS player_name, n.channel, n.subject, n.body, n.scheduled_at, n.sent_at, n.status
       FROM notifications n
       LEFT JOIN players p ON p.id = n.player_id
       WHERE n.id = ?`,
      [result.lastID]
    );
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/notifications-queue/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const fields = req.body;
  const setClauses = [];
  const values = [];
  Object.keys(fields).forEach((key) => {
    setClauses.push(`${key} = ?`);
    values.push(fields[key]);
  });
  values.push(id);
  try {
    await runAsync(`UPDATE notifications SET ${setClauses.join(', ')} WHERE id = ?`, values);
    const row = await getAsync(
      `SELECT n.id, n.player_id, p.name AS player_name, n.channel, n.subject, n.body, n.scheduled_at, n.sent_at, n.status
       FROM notifications n
       LEFT JOIN players p ON p.id = n.player_id
       WHERE n.id = ?`,
      [id]
    );
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/notifications-queue/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await runAsync('DELETE FROM notifications WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Messages (log)
app.get('/api/messages', async (req, res) => {
  try {
    const rows = await allAsync(
      `SELECT m.id, m.player_id, p.name AS player_name, m.channel, m.subject, m.body, m.tags, m.sent_at, m.status
       FROM messages m
       LEFT JOIN players p ON p.id = m.player_id
       ORDER BY m.sent_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/messages', async (req, res) => {
  const { player_id, channel, subject, body, tags, status } = req.body;
  try {
    const result = await runAsync(
      'INSERT INTO messages (player_id, channel, subject, body, tags, status) VALUES (?,?,?,?,?,?)',
      [player_id || null, channel, subject, body, tags ? JSON.stringify(tags) : null, status || 'sent']
    );
    const row = await getAsync(
      `SELECT m.id, m.player_id, p.name AS player_name, m.channel, m.subject, m.body, m.tags, m.sent_at, m.status
       FROM messages m
       LEFT JOIN players p ON p.id = m.player_id
       WHERE m.id = ?`,
      [result.lastID]
    );
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reports

// Membership report: players with expiry and days to expiry
app.get('/api/report/membership', async (req, res) => {
  try {
    const rows = await allAsync(
      `SELECT p.id, p.name, p.email, p.status, p.expiry,
              CASE WHEN p.expiry IS NULL THEN NULL ELSE (julianday(p.expiry) - julianday(date('now'))) END AS days_to_expire
       FROM players p
       ORDER BY p.name`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reservation usage report: minutes used per court per day
app.get('/api/report/reservations-usage', async (req, res) => {
  try {
    const rows = await allAsync(
      `SELECT r.court_id, c.name AS court_name, date(r.start_time) AS date,
              SUM((julianday(r.end_time) - julianday(r.start_time)) * 24 * 60) AS minutes_used,
              COUNT(*) AS reservations_count
       FROM reservations r
       JOIN courts c ON c.id = r.court_id
       WHERE r.status IN ('booked','completed')
       GROUP BY r.court_id, date(r.start_time)
       ORDER BY date(r.start_time) DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Revenue report: monthly totals
app.get('/api/report/revenue', async (req, res) => {
  try {
    const rows = await allAsync(
      `SELECT substr(created_at,1,7) AS month,
              SUM(CASE WHEN status IN ('succeeded','partial') THEN amount_cents ELSE 0 END) AS total_cents,
              SUM(CASE WHEN source_type='membership' AND status IN ('succeeded','partial') THEN amount_cents ELSE 0 END) AS membership_cents,
              SUM(CASE WHEN source_type='reservation' AND status IN ('succeeded','partial') THEN amount_cents ELSE 0 END) AS court_cents,
              SUM(CASE WHEN source_type='event' AND status IN ('succeeded','partial') THEN amount_cents ELSE 0 END) AS event_cents
       FROM payments
       GROUP BY substr(created_at,1,7)
       ORDER BY month DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Events calendar with counts
app.get('/api/report/events-calendar', async (req, res) => {
  try {
    const rows = await allAsync(
      `SELECT e.id, e.name, e.start_time, e.end_time, e.max_participants, e.fee_cents, e.status,
              COUNT(CASE WHEN er.status IN ('registered','attended') THEN 1 END) AS registered_count,
              SUM(CASE WHEN er.payment_status='paid' THEN 1 ELSE 0 END) AS paid_count
       FROM events e
       LEFT JOIN event_registrations er ON er.event_id = e.id
       WHERE datetime(e.start_time) >= datetime('now')
       GROUP BY e.id
       ORDER BY e.start_time`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Messages history
app.get('/api/report/messages-history', async (req, res) => {
  try {
    const rows = await allAsync(
      `SELECT m.id, m.player_id, p.name AS player_name, m.channel, m.subject, m.sent_at, m.status, m.tags
       FROM messages m
       LEFT JOIN players p ON p.id = m.player_id
       ORDER BY m.sent_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Schedule: upcoming reservations and waitlist (next 7 days)
app.get('/api/report/schedule', async (req, res) => {
  try {
    const now = new Date();
    const seven = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const start = now.toISOString().slice(0, 10);
    const end = seven.toISOString().slice(0, 10);
    const reservations = await allAsync(
      `SELECT r.id, r.court_id, c.name AS court_name, r.player_id, p.name AS player_name, r.start_time, r.end_time, r.status
       FROM reservations r
       JOIN courts c ON c.id = r.court_id
       JOIN players p ON p.id = r.player_id
       WHERE date(r.start_time) BETWEEN date(?) AND date(?)
       ORDER BY r.start_time`,
      [start, end]
    );
    const wait = await allAsync(
      `SELECT w.id, w.court_id, c.name AS court_name, w.player_id, p.name AS player_name, w.start_time, w.end_time, w.priority, w.status
       FROM waitlist w
       JOIN courts c ON c.id = w.court_id
       JOIN players p ON p.id = w.player_id
       WHERE date(w.start_time) BETWEEN date(?) AND date(?)
       ORDER BY w.start_time`,
      [start, end]
    );
    res.json({ reservations, waitlist: wait });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fallback to serve index.html for SPA-like experience
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
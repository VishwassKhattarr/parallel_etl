import { config } from 'dotenv';
config();
import express from 'express';
import pkg from "pg";
import cors from 'cors';
import { spawn } from 'child_process';
import dns from 'dns';
import { randomUUID } from 'crypto';

dns.setDefaultResultOrder('ipv4first');

// Short-lived pipeline token store (token -> { dbUrl, numTransformers, batchSize, expiresAt })
const pipelineTokens = new Map();

// Clean up expired tokens every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of pipelineTokens.entries()) {
    if (data.expiresAt < now) pipelineTokens.delete(token);
  }
}, 60000);

const { Client } = pkg;
const app = express();

app.use(cors());
app.use(express.json());

// Engine configuration
const ENGINE_PATH = process.env.ENGINE_PATH || './etl_engine';
const ENGINE_CWD = process.env.ENGINE_CWD || '.';

// Helper to construct dynamic postgres connection string
const getConnectionString = (req) => {
  const dbUrl = req.headers['x-db-url'] || (req.body && req.body.dbUrl);
  if (dbUrl) return dbUrl;

  // Fallback to local .env configuration
  const host = process.env.DB_HOST;
  const dbName = process.env.DB_NAME;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  const port = process.env.DB_PORT || '5432';

  if (host && dbName && user && password) {
    return `postgresql://${user}:${password}@${host}:${port}/${dbName}?sslmode=require`;
  }

  return '';
};

// Generic query runner that connects, queries, and closes client to prevent leaks
const runQuery = async (req, sql, params = []) => {
  const connectionString = getConnectionString(req);
  if (!connectionString) {
    throw new Error('Database connection details not configured.');
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  try {
    const res = await client.query(sql, params);
    return res;
  } finally {
    await client.end();
  }
};

// Seeding function to populate source_data and clear processed_data
const seedData = async (client) => {
  // Clear any existing tables
  await client.query('DROP TABLE IF EXISTS processed_data CASCADE');
  await client.query('DROP TABLE IF EXISTS source_data CASCADE');

  // Create tables
  await client.query(`
    CREATE TABLE source_data (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      department VARCHAR(100) NOT NULL,
      salary NUMERIC(12, 2) NOT NULL,
      bonus NUMERIC(12, 2) NOT NULL,
      join_date DATE NOT NULL
    )
  `);

  await client.query(`
    CREATE TABLE processed_data (
      id INT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      department VARCHAR(100) NOT NULL,
      total_compensation NUMERIC(12, 2) NOT NULL,
      experience_years INT NOT NULL,
      salary_category VARCHAR(10) NOT NULL
    )
  `);

  const firstNames = ["James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael", "Linda", "William", "Elizabeth", "David", "Barbara", "Richard", "Susan", "Joseph", "Jessica", "Thomas", "Sarah", "Charles", "Karen", "Christopher", "Nancy", "Matthew", "Lisa", "Daniel", "Betty", "Mark", "Sandra", "Donald", "Ashley", "Paul", "Dorothy", "Steven", "Kimberly", "Andrew", "Emily", "Kenneth", "Donna", "Joshua", "Michelle"];
  const lastNames = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson", "Walker", "Young", "Allen", "King", "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores"];
  const departments = ["Engineering", "Sales", "Marketing", "HR", "Finance"];

  // Generate 1,000 records
  const rows = [];
  for (let i = 0; i < 1000; i++) {
    const name = `${firstNames[Math.floor(Math.random() * firstNames.length)]} ${lastNames[Math.floor(Math.random() * lastNames.length)]}`;
    const department = departments[Math.floor(Math.random() * departments.length)];
    const salary = Math.round(40000 + Math.random() * 110000);
    const bonus = Math.round(2000 + Math.random() * 18000);
    const joinYear = Math.floor(2010 + Math.random() * 16);
    const joinMonth = String(Math.floor(1 + Math.random() * 12)).padStart(2, '0');
    const joinDay = String(Math.floor(1 + Math.random() * 28)).padStart(2, '0');
    const joinDate = `${joinYear}-${joinMonth}-${joinDay}`;
    rows.push({ name, department, salary, bonus, joinDate });
  }

  // Insert batch wise
  const batchSize = 200;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const valuePlaceholders = batch.map((_, idx) => `($${idx * 5 + 1}, $${idx * 5 + 2}, $${idx * 5 + 3}, $${idx * 5 + 4}, $${idx * 5 + 5})`).join(', ');
    const flatValues = batch.reduce((acc, r) => {
      acc.push(r.name, r.department, r.salary, r.bonus, r.joinDate);
      return acc;
    }, []);

    await client.query(`
      INSERT INTO source_data (name, department, salary, bonus, join_date)
      VALUES ${valuePlaceholders}
    `, flatValues);
  }
};

// API Endpoints

// 1. Data queries
app.get('/api/data', async (req, res) => {
  try {
    const result = await runQuery(req, 'SELECT * FROM processed_data ORDER BY id');
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const result = await runQuery(req, `
      SELECT
        COUNT(*) as total_employees,
        ROUND(AVG(total_compensation), 2) as avg_compensation,
        MAX(total_compensation) as max_compensation,
        MIN(total_compensation) as min_compensation,
        ROUND(AVG(experience_years), 1) as avg_experience
      FROM processed_data
    `);
    res.json(result.rows[0] || {
      total_employees: 0,
      avg_compensation: 0,
      max_compensation: 0,
      min_compensation: 0,
      avg_experience: 0
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/by-department', async (req, res) => {
  try {
    const result = await runQuery(req, `
      SELECT
        department,
        COUNT(*) as count,
        ROUND(AVG(total_compensation), 2) as avg_compensation,
        ROUND(AVG(experience_years), 1) as avg_experience
      FROM processed_data
      GROUP BY department
      ORDER BY avg_compensation DESC
    `);
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/by-category', async (req, res) => {
  try {
    const result = await runQuery(req, `
      SELECT salary_category, COUNT(*) as count
      FROM processed_data
      GROUP BY salary_category
    `);
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 2. Diagnostics and DB Admin
app.get('/api/test-connection', async (req, res) => {
  try {
    const connectionString = getConnectionString(req);
    if (!connectionString) {
      return res.status(400).json({ success: false, error: 'Database connection URL is empty.' });
    }

    const client = new Client({
      connectionString,
      ssl: { rejectUnauthorized: false }
    });

    await client.connect();
    await client.query('SELECT 1');
    await client.end();
    res.json({ success: true, message: 'Database connection tested successfully!' });
  } catch (e) {
    console.error('Test Connection Error:', e);
    res.status(500).json({ success: false, error: e.message || String(e) });
  }
});

app.post('/api/initialize-db', async (req, res) => {
  try {
    const connectionString = getConnectionString(req);
    if (!connectionString) {
      return res.status(400).json({ success: false, error: 'Database connection URL is empty.' });
    }

    const client = new Client({
      connectionString,
      ssl: { rejectUnauthorized: false }
    });

    await client.connect();
    try {
      await seedData(client);
    } finally {
      await client.end();
    }
    res.json({ success: true, message: 'Database initialized and seeded with 1,000 records successfully!' });
  } catch (e) {
    console.error('Initialize DB Error:', e);
    res.status(500).json({ success: false, error: e.message || String(e) });
  }
});

// 3a. Create a short-lived pipeline token (POST so credentials stay in request body, off URL)
app.post('/api/pipeline-token', (req, res) => {
  const connectionString = getConnectionString(req);
  if (!connectionString) {
    return res.status(400).json({ success: false, error: 'Database connection URL is required.' });
  }

  const { numTransformers = '4', batchSize = '30' } = req.body || {};
  const token = randomUUID();
  pipelineTokens.set(token, {
    dbUrl: connectionString,
    numTransformers: String(numTransformers),
    batchSize: String(batchSize),
    expiresAt: Date.now() + 30000 // 30-second window to open SSE
  });

  res.json({ success: true, token });
});

// 3b. Pipeline execution (SSE) — uses token, never raw credentials in query string
app.get('/api/run-pipeline', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendEvent = (type, data) => {
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const { token } = req.query;
  const session = token ? pipelineTokens.get(token) : null;

  if (!session || session.expiresAt < Date.now()) {
    sendEvent('status', { status: 'error', message: 'Invalid or expired pipeline session token. Please try again.' });
    res.end();
    return;
  }

  // Consume the token immediately (single-use)
  pipelineTokens.delete(token);

  const { dbUrl, numTransformers, batchSize } = session;

  sendEvent('status', { status: 'running', message: 'Spawning ETL pipeline child process...' });

  const child = spawn(ENGINE_PATH, [], {
    cwd: ENGINE_CWD,
    env: {
      ...process.env,
      NEON_DB_URL: dbUrl,
      NUM_TRANSFORMERS: numTransformers,
      BATCH_SIZE: batchSize
    }
  });

  child.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        sendEvent('log', { text: trimmed, stream: 'stdout' });
      }
    }
  });

  child.stderr.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        sendEvent('log', { text: trimmed, stream: 'stderr' });
      }
    }
  });

  child.on('close', (code) => {
    if (code === 0) {
      sendEvent('status', { status: 'success', message: 'ETL Pipeline execution completed successfully!' });
    } else {
      sendEvent('status', { status: 'error', message: `ETL Pipeline execution failed with exit code ${code}` });
    }
    res.end();
  });

  child.on('error', (err) => {
    sendEvent('status', { status: 'error', message: `Failed to start ETL pipeline executable: ${err.message}` });
    res.end();
  });

  req.on('close', () => {
    child.kill();
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json());

const ROOT = path.join(__dirname, '..');
const COLLECTION = 'transactions';

// ---------------------------------------------------------------------------
// Pemuatan konfigurasi
// Vercel mengisi process.env, sedangkan `npm start` di lokal tidak memakai
// dotenv. Jadi .env dibaca manual (tanpa dependency tambahan) dan isinya boleh
// berupa pasangan KEY=VALUE maupun JSON service account mentah.
// ---------------------------------------------------------------------------
function loadDotEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;

  const raw = fs.readFileSync(envPath, 'utf8').trim();
  if (!raw) return;

  // Kasus: .env hanya berisi JSON service account
  if (raw.startsWith('{')) {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
      process.env.FIREBASE_SERVICE_ACCOUNT = raw;
    }
    return;
  }

  // Kasus: format KEY=VALUE biasa
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (!key) continue;

    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) value = value.slice(1, -1);

    if (!process.env[key]) process.env[key] = value;
  }
}

loadDotEnv();

function resolveServiceAccount() {
  const problems = [];

  function parseJson(text, label) {
    try {
      return JSON.parse(text);
    } catch (error) {
      problems.push(`${label}: ${error.message}`);
      return null;
    }
  }

  const sources = [
    ['FIREBASE_SERVICE_ACCOUNT', process.env.FIREBASE_SERVICE_ACCOUNT],
    ['FIREBASE_KEY', process.env.FIREBASE_KEY],
    ['GOOGLE_SERVICE_ACCOUNT', process.env.GOOGLE_SERVICE_ACCOUNT]
  ];

  for (const [name, raw] of sources) {
    const value = String(raw || '').trim();
    if (!value) continue;

    // Nilai bisa berupa JSON langsung atau JSON yang di-encode base64.
    const candidates = value.startsWith('{')
      ? [value]
      : [Buffer.from(value, 'base64').toString('utf8')];

    for (const text of candidates) {
      if (!text.trim().startsWith('{')) continue;
      const parsed = parseJson(text, name);
      if (parsed) return parsed;
    }
  }

  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credentialPath && fs.existsSync(credentialPath)) {
    const parsed = parseJson(fs.readFileSync(credentialPath, 'utf8'), 'GOOGLE_APPLICATION_CREDENTIALS');
    if (parsed) return parsed;
  }

  // Fallback: file service account yang ikut di folder proyek
  const files = fs
    .readdirSync(ROOT)
    .filter((name) => name.endsWith('.json') && name.includes('firebase-adminsdk'))
    .sort();

  for (const file of files) {
    const parsed = parseJson(fs.readFileSync(path.join(ROOT, file), 'utf8'), file);
    if (parsed) return parsed;
  }

  if (problems.length > 0) {
    throw new Error(`Kredensial Firebase tidak valid -> ${problems.join('; ')}`);
  }

  return null;
}

let firestore = null;

function getDb() {
  if (firestore) return firestore;

  if (!admin.apps.length) {
    const serviceAccount = resolveServiceAccount();
    if (!serviceAccount) {
      throw new Error(
        'Kredensial Firebase tidak ditemukan. Set environment variable FIREBASE_SERVICE_ACCOUNT (isi JSON service account) atau letakkan file *-firebase-adminsdk-*.json di folder proyek.'
      );
    }
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }

  firestore = admin.firestore();
  return firestore;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
app.get('/api/transactions', async (req, res) => {
  try {
    // Tanpa orderBy('date') agar transaksi lama yang belum punya field date
    // tetap ikut termuat (Firestore melewatkan dokumen tanpa field order).
    const snapshot = await getDb().collection(COLLECTION).get();
    const transactions = [];
    snapshot.forEach((doc) => {
      transactions.push({ id: doc.id, ...doc.data() });
    });

    transactions.sort((a, b) => {
      const dateA = String(a.date || '');
      const dateB = String(b.date || '');
      if (dateA === dateB) return 0;
      return dateA < dateB ? 1 : -1;
    });

    res.status(200).json({ success: true, data: transactions });
  } catch (error) {
    console.error('[GET /api/transactions]', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/transactions', async (req, res) => {
  try {
    const { title, amount, type, category, date } = req.body || {};
    const nominal = Number.parseFloat(amount);

    if (!title || !date || !['income', 'expense'].includes(type) || !Number.isFinite(nominal)) {
      return res.status(400).json({ success: false, error: 'Data tidak lengkap' });
    }

    const newTx = {
      title: String(title).trim(),
      amount: nominal,
      type,
      category: (category && String(category).trim()) || 'Umum',
      date,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const docRef = await getDb().collection(COLLECTION).add(newTx);
    res.status(201).json({ success: true, data: { id: docRef.id, ...newTx } });
  } catch (error) {
    console.error('[POST /api/transactions]', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/transactions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await getDb().collection(COLLECTION).doc(id).delete();
    res.status(200).json({ success: true, message: 'Berhasil dihapus' });
  } catch (error) {
    console.error('[DELETE /api/transactions/:id]', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = app;
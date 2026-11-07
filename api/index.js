const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json());

// Inisialisasi Firebase Admin dengan Environment Variable Vercel
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();
const COLLECTION = 'transactions';

// API GET: Ambil Semua Transaksi
app.get('/api/transactions', async (req, res) => {
  try {
    const snapshot = await db.collection(COLLECTION).orderBy('date', 'desc').get();
    const transactions = [];
    snapshot.forEach(doc => {
      transactions.push({ id: doc.id, ...doc.data() });
    });
    res.status(200).json({ success: true, data: transactions });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API POST: Tambah Transaksi Baru
app.post('/api/transactions', async (req, res) => {
  try {
    const { title, amount, type, category, date } = req.body;
    if (!title || !amount || !type || !date) {
      return res.status(400).json({ success: false, error: 'Data tidak lengkap' });
    }

    const newTx = {
      title,
      amount: parseFloat(amount),
      type, // 'income' atau 'expense'
      category: category || 'Umum',
      date,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const docRef = await db.collection(COLLECTION).add(newTx);
    res.status(201).json({ success: true, data: { id: docRef.id, ...newTx } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API DELETE: Hapus Transaksi
app.delete('/api/transactions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.collection(COLLECTION).doc(id).delete();
    res.status(200).json({ success: true, message: 'Berhasil dihapus' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = app;
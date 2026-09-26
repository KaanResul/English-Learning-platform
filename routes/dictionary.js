const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');
const { db, admin } = require('../firebaseConfig');

// Kelime Ekleme
router.post('/', verifyToken, async (req, res) => {
  try {
    const { word, turkish } = req.body;
    const userId = req.user.uid;

    if (!word || !turkish) {
      return res.status(400).json({ success: false, error: "word ve turkish parametreleri zorunludur." });
    }

    const normalizedWord = word.trim().toLowerCase();

    // Bu kullanıcının sözlüğünde kelime zaten var mı?
    const existingWordQuery = await db.collection('user_dictionary_words')
      .where('userId', '==', userId)
      .where('normalizedWord', '==', normalizedWord)
      .limit(1)
      .get();

    if (!existingWordQuery.empty) {
      return res.status(400).json({ success: false, error: "Bu kelime zaten sözlüğünüzde mevcut." });
    }

    // Yeni kelimeyi ekle
    const newDoc = {
      userId,
      word: word.trim(),
      turkish: turkish.trim(),
      normalizedWord,
      isLearned: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const docRef = await db.collection('user_dictionary_words').add(newDoc);

    res.json({ success: true, data: { id: docRef.id, ...newDoc } });

  } catch (error) {
    console.error("Sözlük ekleme hatası:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Kelime Listeleme
router.get('/', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const page = parseInt(req.query.page) || 1;
    const limitVal = parseInt(req.query.limit) || 10;
    const offsetVal = (page - 1) * limitVal;

    let words = [];
    let totalItems = 0;

    try {
        const countSnap = await db.collection('user_dictionary_words').where('userId', '==', userId).count().get();
        totalItems = countSnap.data().count;

        const wordsSnapshot = await db.collection('user_dictionary_words')
          .where('userId', '==', userId)
          .orderBy('createdAt', 'desc')
          .limit(limitVal)
          .offset(offsetVal)
          .get();

        wordsSnapshot.forEach(doc => {
          words.push({ id: doc.id, ...doc.data() });
        });
    } catch (err) {
        console.warn("Index missing, falling back to in-memory pagination:", err.message);
        const snapshot = await db.collection('user_dictionary_words').where('userId', '==', userId).get();
        const allDocs = [];
        snapshot.forEach(doc => allDocs.push({ id: doc.id, ...doc.data() }));
        allDocs.sort((a, b) => {
          const timeA = a.createdAt ? a.createdAt._seconds : 0;
          const timeB = b.createdAt ? b.createdAt._seconds : 0;
          return timeB - timeA;
        });
        totalItems = allDocs.length;
        words = allDocs.slice(offsetVal, offsetVal + limitVal);
    }

    res.json({ 
        success: true, 
        data: words,
        pagination: {
            page,
            limit: limitVal,
            totalItems,
            totalPages: Math.ceil(totalItems / limitVal)
        }
    });

  } catch (error) {
    console.error("Sözlük listeleme hatası:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Öğrenildi İşaretleme
router.put('/:id/learned', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const wordId = req.params.id;

    const docRef = db.collection('user_dictionary_words').doc(wordId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ success: false, error: "Kelime bulunamadı." });
    }

    if (doc.data().userId !== userId) {
      return res.status(403).json({ success: false, error: "Bu işlemi yapmak için yetkiniz yok." });
    }

    const { isLearned } = req.body;

    await docRef.update({
      isLearned: typeof isLearned === 'boolean' ? isLearned : true
    });

    res.json({ success: true, message: "Kelime durumu güncellendi." });

  } catch (error) {
    console.error("Kelime güncelleme hatası:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

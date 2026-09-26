const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');
const { db, admin } = require('../firebaseConfig');

// Kullanıcıyı senkronize et (Yoksa oluştur)
router.post('/sync', verifyToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const userRef = db.collection('users').doc(userId);
        const doc = await userRef.get();

        if (!doc.exists) {
            // Başlangıç hediyesi 0 token
            await userRef.set({
                email: req.user.email,
                tokens: 0,
                role: 'user', // Varsayılan yetki
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
            res.json({ success: true, data: { tokens: 0, role: 'user', nickname: null } });
        } else {
            res.json({ success: true, data: { tokens: doc.data().tokens, role: doc.data().role || 'user', nickname: doc.data().nickname || null } });
        }
    } catch (error) {
        console.error("User sync hatası:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Kullanıcı token bakiyesini getir
router.get('/me', verifyToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const userRef = db.collection('users').doc(userId);
        const doc = await userRef.get();

        if (doc.exists) {
            res.json({ success: true, data: { tokens: doc.data().tokens, role: doc.data().role || 'user', nickname: doc.data().nickname || null } });
        } else {
            res.status(404).json({ success: false, error: 'User not found' });
        }
    } catch (error) {
        console.error("User get hatası:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Kullanıcı nickname güncelle
router.put('/nickname', verifyToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const { nickname } = req.body;
        
        if (!nickname || nickname.trim().length < 3) {
            return res.status(400).json({ success: false, error: 'Nickname must be at least 3 characters long.' });
        }

        const userRef = db.collection('users').doc(userId);
        await userRef.update({ nickname: nickname.trim() });
        
        res.json({ success: true, data: { nickname: nickname.trim() } });
    } catch (error) {
        console.error("Nickname update hatası:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;

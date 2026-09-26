const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../middleware/authMiddleware');
const { db } = require('../firebaseConfig');

// Tüm kullanıcıları getir (Sayfalama ve arama destekli)
router.get('/users', verifyToken, isAdmin, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limitVal = parseInt(req.query.limit) || 10;
        const offsetVal = (page - 1) * limitVal;
        const search = req.query.search ? req.query.search.toLowerCase().trim() : '';

        let users = [];
        let totalItems = 0;

        // Firestore does not natively support substring search.
        // We will perform an in-memory filter if search is provided.
        const snapshot = await db.collection('users').orderBy('createdAt', 'desc').get();
        const allDocs = [];
        snapshot.forEach(doc => allDocs.push({ id: doc.id, ...doc.data() }));

        let filteredDocs = allDocs;
        if (search) {
            filteredDocs = allDocs.filter(d => {
                const email = (d.email || '').toLowerCase();
                const nickname = (d.nickname || '').toLowerCase();
                return email.includes(search) || nickname.includes(search);
            });
        }

        totalItems = filteredDocs.length;
        const paginatedDocs = filteredDocs.slice(offsetVal, offsetVal + limitVal);

        paginatedDocs.forEach(data => {
            users.push({
                id: data.id,
                email: data.email,
                nickname: data.nickname || '',
                tokens: data.tokens || 0,
                role: data.role || 'user',
                currentStreak: data.currentStreak || 0,
                createdAt: data.createdAt,
                lastDailyChallengeDate: data.lastDailyChallengeDate || '-'
            });
        });

        res.json({ 
            success: true, 
            data: users,
            pagination: {
                page,
                limit: limitVal,
                totalItems,
                totalPages: Math.ceil(totalItems / limitVal)
            }
        });
    } catch (error) {
        console.error("Admin get users error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Bir kullanıcının detaylı istatistiklerini getir
router.get('/user/:uid/details', verifyToken, isAdmin, async (req, res) => {
    try {
        const { uid } = req.params;
        
        // Temel kullanıcı bilgisi
        const userDoc = await db.collection('users').doc(uid).get();
        if (!userDoc.exists) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        
        // Metin Sayısı
        const textsSnap = await db.collection('generated_texts').where('userId', '==', uid).count().get();
        const generatedTextsCount = textsSnap.data().count;

        // Sözlükteki kelimeler
        const dictSnap = await db.collection('user_dictionary_words').where('userId', '==', uid).count().get();
        const dictionaryWordsCount = dictSnap.data().count;
        
        // Günlük görev katılımları
        const submissionsSnap = await db.collection('daily_submissions').where('userId', '==', uid).count().get();
        const dailySubmissionsCount = submissionsSnap.data().count;

        res.json({ 
            success: true, 
            data: {
                user: userDoc.data(),
                stats: {
                    generatedTextsCount,
                    dictionaryWordsCount,
                    dailySubmissionsCount
                }
            } 
        });
    } catch (error) {
        console.error("Admin user details error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Kullanıcı bilgilerini topluca güncelle
router.put('/user/:uid/update', verifyToken, isAdmin, async (req, res) => {
    try {
        const { uid } = req.params;
        const { nickname, tokens, role, currentStreak } = req.body;
        
        const updates = {};
        
        if (typeof tokens === 'number') updates.tokens = tokens;
        if (typeof currentStreak === 'number') updates.currentStreak = currentStreak;
        if (nickname !== undefined) updates.nickname = nickname.trim();
        if (['admin', 'user'].includes(role)) updates.role = role;

        const userRef = db.collection('users').doc(uid);
        await userRef.update(updates);

        res.json({ success: true });
    } catch (error) {
        console.error("Admin update user error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Global Sistem İstatistikleri
router.get('/stats', verifyToken, isAdmin, async (req, res) => {
    try {
        // Not: Çok büyük veritabanlarında tüm dokümanları çekmek maliyetlidir.
        // Şimdilik küçük ölçekli olduğu için basit tutulmuştur.
        const usersSnapshot = await db.collection('users').get();
        const textsSnapshot = await db.collection('generated_texts').get();
        
        res.json({
            success: true,
            data: {
                totalUsers: usersSnapshot.size,
                totalTexts: textsSnapshot.size
            }
        });
    } catch (error) {
        console.error("Admin get stats error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Admin Send Notification
router.post('/notifications', verifyToken, isAdmin, async (req, res) => {
    try {
        const { audience, targetEmail, title, message } = req.body;
        
        if (!title || !message) {
            return res.status(400).json({ success: false, error: 'Title and message are required.' });
        }

        let finalAudience = 'global';

        if (audience === 'private') {
            if (!targetEmail) {
                return res.status(400).json({ success: false, error: 'Target email is required for private messages.' });
            }
            // Find user by email
            const snapshot = await db.collection('users').where('email', '==', targetEmail).limit(1).get();
            if (snapshot.empty) {
                return res.status(404).json({ success: false, error: 'User with this email not found.' });
            }
            finalAudience = snapshot.docs[0].id;
        }

        const notifDoc = {
            audience: finalAudience,
            title: title.trim(),
            message: message.trim(),
            isActive: true,
            createdAt: require('../firebaseConfig').admin.firestore.FieldValue.serverTimestamp()
        };

        await db.collection('notifications').add(notifDoc);

        res.json({ success: true });
    } catch (error) {
        console.error("Admin send notification error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Admin Get All Notifications
router.get('/notifications/list', verifyToken, isAdmin, async (req, res) => {
    try {
        const snapshot = await db.collection('notifications').get();
        const notifications = [];
        snapshot.forEach(doc => {
            notifications.push({ id: doc.id, ...doc.data() });
        });
        
        notifications.sort((a, b) => {
            const timeA = a.createdAt ? a.createdAt._seconds : 0;
            const timeB = b.createdAt ? b.createdAt._seconds : 0;
            return timeB - timeA;
        });

        res.json({ success: true, data: notifications });
    } catch (error) {
        console.error("Admin list notifications error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Admin Toggle Notification Status
router.put('/notifications/:id/toggle', verifyToken, isAdmin, async (req, res) => {
    try {
        const notifId = req.params.id;
        const { isActive } = req.body;
        await db.collection('notifications').doc(notifId).update({
            isActive: !!isActive
        });
        res.json({ success: true });
    } catch (error) {
        console.error("Admin toggle notification error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Admin Get User Texts
router.get('/users/:uid/texts', verifyToken, isAdmin, async (req, res) => {
    try {
        const targetUid = req.params.uid;
        const snapshot = await db.collection('generated_texts')
            .where('userId', '==', targetUid)
            .get();

        const texts = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            texts.push({ id: doc.id, ...data });
        });

        // In-memory sort by createdAt desc
        texts.sort((a, b) => {
            const timeA = a.createdAt ? a.createdAt._seconds : 0;
            const timeB = b.createdAt ? b.createdAt._seconds : 0;
            return timeB - timeA;
        });

        res.json({ success: true, data: texts });
    } catch (error) {
        console.error("Admin get user texts error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');
const { db, admin } = require('../firebaseConfig');

// Kullanıcının bildirimlerini getir
router.get('/', verifyToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        
        // Firestore 'in' operatörü ile hem global hem de kullanıcıya özel bildirimleri çek
        const snapshot = await db.collection('notifications')
            .where('audience', 'in', ['global', userId])
            .get();

        const userDoc = await db.collection('users').doc(userId).get();
        const readNotifications = userDoc.exists && userDoc.data().readNotifications ? userDoc.data().readNotifications : [];

        const notifications = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.isActive !== false) {
                notifications.push({
                    id: doc.id,
                    title: data.title,
                    message: data.message,
                    audience: data.audience,
                    createdAt: data.createdAt,
                    isRead: readNotifications.includes(doc.id)
                });
            }
        });

        // In-memory sort (in case index is missing for orderBy with 'in' query)
        notifications.sort((a, b) => {
            const timeA = a.createdAt ? a.createdAt._seconds : 0;
            const timeB = b.createdAt ? b.createdAt._seconds : 0;
            return timeB - timeA;
        });

        res.json({ success: true, data: notifications });
    } catch (error) {
        console.error("Notifications get error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Bildirimleri okundu olarak işaretle (birden fazla olabilir)
router.post('/read', verifyToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const { notificationIds } = req.body;

        if (!notificationIds || !Array.isArray(notificationIds) || notificationIds.length === 0) {
            return res.json({ success: true });
        }

        const userRef = db.collection('users').doc(userId);
        
        // document exists check
        const userDoc = await userRef.get();
        if(!userDoc.exists) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        await userRef.update({
            readNotifications: admin.firestore.FieldValue.arrayUnion(...notificationIds)
        });

        res.json({ success: true });
    } catch (error) {
        console.error("Notification read error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;

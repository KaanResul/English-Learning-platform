const { auth, db } = require('../firebaseConfig');

const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization?.split('Bearer ')[1];
  
  if (!token) {
    return res.status(401).json({ success: false, message: 'Yetkisiz erişim. Token bulunamadı.' });
  }

  try {
    const decodedToken = await auth.verifyIdToken(token);
    req.user = decodedToken; // Artık req.user.uid ile kullanıcı id'sine ulaşılabilir.
    next();
  } catch (error) {
    console.error("Token verification error:", error);
    res.status(401).json({ success: false, message: 'Geçersiz token.' });
  }
};

const isAdmin = async (req, res, next) => {
    try {
        if (!req.user || !req.user.uid) {
            return res.status(401).json({ success: false, message: 'Önce giriş yapmalısınız.' });
        }
        const userDoc = await db.collection('users').doc(req.user.uid).get();
        if (!userDoc.exists || userDoc.data().role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Bu işlem için admin yetkisine sahip olmalısınız.' });
        }
        next();
    } catch (error) {
        console.error("Admin check error:", error);
        res.status(500).json({ success: false, message: 'Sunucu hatası.' });
    }
};

module.exports = { verifyToken, isAdmin };

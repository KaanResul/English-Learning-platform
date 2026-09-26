const admin = require("firebase-admin");
require("dotenv").config();
const fs = require("fs");
const path = require("path");

// Vercel / production ortamında environment variable'dan, local'de JSON dosyasından oku
if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  // Vercel ortamı: environment variable'dan parse et
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log("Firebase initialized via environment variable.");
} else {
  const serviceAccountPath = path.join(__dirname, "serviceAccountKey.json");

  if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log("Firebase initialized via serviceAccountKey.json.");
  } else {
    console.warn("WARNING: serviceAccountKey.json bulunamadı! Firebase Auth ve Firestore işlemleri hata verecektir.");
    admin.initializeApp({
      projectId: "demo-project"
    });
  }
}

const db = admin.firestore();
const auth = admin.auth();

module.exports = { admin, db, auth };

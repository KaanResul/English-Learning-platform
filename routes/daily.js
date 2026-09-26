const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');
const { db, admin } = require('../firebaseConfig');
const { OpenAI } = require('openai');
require('dotenv').config();

const openai = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",
});

const TOPICS = [
    "The future of space exploration",
    "Artificial intelligence in daily life",
    "The impact of climate change on oceans",
    "History of the Internet",
    "Healthy eating habits and nutrition",
    "The psychology of habit formation",
    "Renewable energy sources",
    "The evolution of public transportation",
    "Benefits of learning a second language",
    "The mystery of black holes"
];

const LEVEL = "B1";

// Yardımcı: Bugünün tarihini YYYY-MM-DD olarak döndürür
function getTodayString() {
    const today = new Date();
    return today.toISOString().split('T')[0];
}

function getYesterdayString() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday.toISOString().split('T')[0];
}

router.get('/challenge', verifyToken, async (req, res) => {
    try {
        const todayStr = getTodayString();
        const docRef = db.collection('daily_challenges').doc(todayStr);
        const docSnap = await docRef.get();

        if (docSnap.exists) {
            // Bugün için zaten üretilmiş, doğrudan dön
            return res.json({ success: true, data: docSnap.data() });
        }

        // Dünkü konuyu öğren
        const yesterdayStr = getYesterdayString();
        const yesterdayDocRef = db.collection('daily_challenges').doc(yesterdayStr);
        const yesterdayDocSnap = await yesterdayDocRef.get();
        let yesterdayTopic = null;
        if (yesterdayDocSnap.exists) {
            yesterdayTopic = yesterdayDocSnap.data().topic;
        }

        // Dünkü konuyla aynı olmayan rastgele bir konu seç
        let randomTopic;
        do {
            randomTopic = TOPICS[Math.floor(Math.random() * TOPICS.length)];
        } while (randomTopic === yesterdayTopic && TOPICS.length > 1);
        
        // 1. Metni Üret
        const systemPromptText = `You are a language-learning text generator. Your primary directive: ALWAYS generate EXACTLY the word count requested in the "content" field. Never go below the requested word count. Count the words before returning. Return only valid JSON with exactly: title, content, keywords.`;
        const userPromptText = `Generate text about: ${randomTopic}
CEFR Level: ${LEVEL}

Return JSON with:
- title: short natural English title about the topic
- content: 200 WORD STORY. CRITICAL: The "content" field must contain EXACTLY 200 words — not a single word less. This is a strict requirement. Count carefully.
  * Use exactly 200 words of natural, engaging English text at ${LEVEL} CEFR level.
  * Keywords, title, questions, JSON structure do NOT count toward the 200 words — ONLY the "content" field counts.
  * Never use filler summaries, meta-commentary, or phrases like "and so on". Write the full story completely without shortcuts.
  * If needed, expand with rich descriptions, dialogue, sensory details, and concrete examples to fill the word count naturally.
- keywords: array of exactly 16 diverse {word, turkish} objects. VOCABULARY RULE: Every keyword MUST be a word that a ${LEVEL} level learner would find challenging but learnable. For B2 pick upper-intermediate words — not too basic, not too obscure. Do NOT pick words that are too easy or too hard for ${LEVEL}. Ensure keywords appear naturally spread throughout the content.`;

        const textCompletion = await openai.chat.completions.create({
            model: "deepseek-chat",
            messages: [
                { role: "system", content: systemPromptText },
                { role: "user", content: userPromptText }
            ],
            response_format: { type: "json_object" }
        });

        const aiResponseText = JSON.parse(textCompletion.choices[0].message.content);

        // 2. Soruları Üret
        const systemPromptQ = `You are a language teacher. Return only valid JSON. Format: {"questions": [{"question": "...", "options": ["A", "B", "C", "D"], "correctAnswerIndex": 0}]}`;
        const userPromptQ = `Based on the following text, create exactly 5 multiple-choice reading comprehension questions appropriate for ${LEVEL} learners.

Text:
${aiResponseText.content}

Return JSON with exactly 5 questions. Options must be an array of 4 strings. correctAnswerIndex must be 0, 1, 2, or 3.`;

        const qCompletion = await openai.chat.completions.create({
            model: "deepseek-chat",
            messages: [
                { role: "system", content: systemPromptQ },
                { role: "user", content: userPromptQ }
            ],
            response_format: { type: "json_object" }
        });

        const aiResponseQ = JSON.parse(qCompletion.choices[0].message.content);

        const challengeData = {
            date: todayStr,
            topic: randomTopic,
            level: LEVEL,
            title: aiResponseText.title,
            content: aiResponseText.content,
            keywords: aiResponseText.keywords,
            questions: aiResponseQ.questions,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        // Veritabanına kaydet (Eğer iki kişi aynı anda tetiklerse diye set veya transaction yapılabilir ama şimdilik set iş görür)
        await docRef.set(challengeData);

        res.json({ success: true, data: challengeData });

    } catch (error) {
        console.error("Daily challenge generation error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Günlük çalışma sonucunu gönder
router.post('/submit', verifyToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const todayStr = getTodayString();
        const { correctCount, wrongCount } = req.body;

        // Kullanıcının daha önce gönderip göndermediğini kontrol et
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        let userData = userDoc.exists ? userDoc.data() : {};
        
        if (userData.lastDailyChallengeDate === todayStr) {
            return res.status(400).json({ success: false, error: 'Bugün için günlük çalışmanızı zaten tamamladınız.' });
        }

        // Streak hesapla
        let newStreak = 1;
        if (userData.lastDailyChallengeDate === getYesterdayString()) {
            newStreak = (userData.currentStreak || 0) + 1;
        }

        // Submissions koleksiyonuna kaydet
        await db.collection('daily_submissions').add({
            userId,
            date: todayStr,
            correctCount,
            wrongCount,
            submittedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Başarı oranı hesapla — %50 üstüyse +2 token ödülü
        const totalQuestions = correctCount + wrongCount;
        const successRate = totalQuestions > 0 ? correctCount / totalQuestions : 0;
        let tokensEarned = 0;

        if (successRate > 0.50) {
            tokensEarned = 2;
        }

        // Kullanıcı güncellemesi (streak + varsa token)
        const updateData = {
            lastDailyChallengeDate: todayStr,
            currentStreak: newStreak
        };
        if (tokensEarned > 0) {
            updateData.tokens = admin.firestore.FieldValue.increment(tokensEarned);
        }
        await userRef.update(updateData);

        // Güncel token sayısını al
        const updatedUserDoc = await userRef.get();
        const newTokenBalance = updatedUserDoc.exists ? (updatedUserDoc.data().tokens || 0) : 0;

        // Sıralamayı hesapla (Yeni streak değerinden büyük olan kaç kişi var?)
        const snapshot = await db.collection('users').where('currentStreak', '>', newStreak).get();
        const rank = snapshot.size + 1;

        res.json({ success: true, data: { currentStreak: newStreak, rank, tokensEarned, newTokenBalance } });

    } catch (error) {
        console.error("Daily challenge submit error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Kullanıcının bugünkü durumu öğrenmesi için
router.get('/status', verifyToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const todayStr = getTodayString();
        const userDoc = await db.collection('users').doc(userId).get();
        
        const isCompleted = userDoc.exists && userDoc.data().lastDailyChallengeDate === todayStr;
        const currentStreak = userDoc.exists ? (userDoc.data().currentStreak || 0) : 0;
        
        // Sadece güncel rank hesapla
        let rank = 1;
        if (currentStreak > 0) {
            const snapshot = await db.collection('users').where('currentStreak', '>', currentStreak).get();
            rank = snapshot.size + 1;
        }

        res.json({ success: true, data: { isCompleted, currentStreak, rank } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Liderlik tablosu
router.get('/leaderboard', verifyToken, async (req, res) => {
    try {
        const snapshot = await db.collection('users')
            .orderBy('currentStreak', 'desc')
            .limit(10)
            .get();

        const leaderboard = [];
        snapshot.forEach(doc => {
            const d = doc.data();
            if (d.currentStreak && d.currentStreak > 0) {
                // Nickname varsa onu kullan, yoksa email'in başını al
                let name = d.nickname ? d.nickname : (d.email ? d.email.split('@')[0] : 'User');
                leaderboard.push({ name, streak: d.currentStreak });
            }
        });

        res.json({ success: true, data: leaderboard });
    } catch (error) {
        console.error("Leaderboard error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;

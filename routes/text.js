const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');
const { db, admin } = require('../firebaseConfig');
const { OpenAI } = require('openai');
require('dotenv').config();

// DeepSeek API (OpenAI SDK uyumludur)
const openai = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",
});

router.post('/generate', verifyToken, async (req, res) => {
  try {
    const { topic, level, wordCountRequested } = req.body;
    const userId = req.user.uid;

    if (!topic || !level || !wordCountRequested) {
      return res.status(400).json({ success: false, error: 'topic, level ve wordCountRequested parametreleri zorunludur.' });
    }

    const requiredTokens = Math.ceil(wordCountRequested / 100);

    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists || userDoc.data().tokens < requiredTokens) {
        return res.status(403).json({ success: false, error: `Yetersiz bakiye. Bu işlem ${requiredTokens} token gerektiriyor.` });
    }

    const keywordCount = Math.max(8, Math.floor(wordCountRequested / 12));
    
    const isRandomTopic = topic.toLowerCase().includes('random');
    const topicInstruction = isRandomTopic 
        ? "Choose a completely random, highly interesting, and unique topic yourself" 
        : topic;

    const systemPrompt = `You are a language-learning text generator. Your ONLY job is to write stories with EXACTLY the requested word count. Return ONLY a valid JSON object with no markdown.`;

    function buildUserPrompt(retryAttempt = 0) {
      const wordTarget = retryAttempt > 0 
        ? `EXACTLY ${wordCountRequested} WORDS (previous was too short). ADD MORE details, dialogue, descriptions until you reach the target.`
        : `EXACTLY ${wordCountRequested} WORDS. Count your words carefully before finishing.`;

      return `Topic: ${topicInstruction}
Level: ${level}

Return valid JSON with:
{
  "title": "short title",
  "content": "${wordTarget} - Natural English at ${level} level. Use dialogue, descriptions, concrete examples.",
  "keywords": [{"word": "...", "turkish": "..."}] x ${keywordCount}
}`;
    }

    const maxTokens = Math.min(4096, Math.max(1024, wordCountRequested * 2 + 500));

    // AI çağrısı - daha hızlı ve tek seferde doğru sonuç almak için optimize edildi
    let aiResponse;
    let attempts = 0;
    const MAX_ATTEMPTS = 2; // 3'ten 2'ye düşürüldü
    const MIN_WORD_RATIO = 0.75; // %75 kabul edilebilir

    while (attempts < MAX_ATTEMPTS) {
      attempts++;
      
      const completion = await openai.chat.completions.create({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: buildUserPrompt(attempts - 1) }
        ],
        response_format: { type: "json_object" },
        max_tokens: maxTokens,
        temperature: 0.3, // Daha hızlı ve tutarlı sonuç için düşük temperature
        frequency_penalty: 0.1 // Hafif tekrar önleme
      });

      let aiResponseContent = completion.choices[0].message.content.trim();
      
      const startIdx = aiResponseContent.indexOf('{');
      const endIdx = aiResponseContent.lastIndexOf('}');
      if (startIdx !== -1 && endIdx !== -1) {
        aiResponseContent = aiResponseContent.substring(startIdx, endIdx + 1);
      }
      
      aiResponse = JSON.parse(aiResponseContent);

      const actualWordCount = aiResponse.content
        ? aiResponse.content.split(/\s+/).filter(w => w.length > 0).length
        : 0;

      console.log(`⚡ Deneme ${attempts}/${MAX_ATTEMPTS}: İstenen=${wordCountRequested}, Üretilen=${actualWordCount} kelime (${Math.round(actualWordCount/wordCountRequested*100)}%)`);

      if (actualWordCount >= wordCountRequested * MIN_WORD_RATIO) {
        console.log(`✅ Kabul edildi.`);
        break;
      }
      
      if (attempts < MAX_ATTEMPTS) {
        console.log(`⚠️ Kısa geldi, tekrar deneniyor...`);
      } else {
        console.log(`⚠️ Maksimum deneme, mevcut metin kullanıldı.`);
      }
    }

    const { title, content, keywords } = aiResponse;

    // 2. Firestore'a kaydet
    const docRef = await db.collection('generated_texts').add({
      userId,
      topic,
      level,
      wordCountRequested,
      title,
      content,
      keywords, // JSON nesnesi olarak kaydediyoruz
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // 3. Token düş
    await userRef.update({
        tokens: admin.firestore.FieldValue.increment(-requiredTokens)
    });

    res.json({
      success: true, data: { id: docRef.id, title, content, keywords } });

  } catch (error) {
    console.error("Metin oluşturma hatası:", error);
    res.status(500).json({ success: false, error: error.message || "Bilinmeyen bir hata oluştu" });
  }
});

// Metin için soru üretme (arka planda çalışır, +2 token)
router.post('/generate-questions/:textId', verifyToken, async (req, res) => {
  try {
    const { textId } = req.params;
    const userId = req.user.uid;

    // 1. Token kontrolü (2 token)
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists || (userDoc.data().tokens || 0) < 2) {
      return res.status(403).json({ success: false, error: 'Yetersiz bakiye. Soru üretimi 2 token gerektiriyor.' });
    }

    // 2. Metni Firestore'dan al
    const textRef = db.collection('generated_texts').doc(textId);
    const textDoc = await textRef.get();
    if (!textDoc.exists) {
      return res.status(404).json({ success: false, error: 'Metin bulunamadı.' });
    }
    const textData = textDoc.data();
    if (textData.userId !== userId) {
      return res.status(403).json({ success: false, error: 'Bu metne erişim izniniz yok.' });
    }

    // Eğer zaten sorular üretilmişse, doğrudan dön (token düşme)
    if (textData.questions && textData.questions.length > 0) {
      return res.json({ success: true, data: { questions: textData.questions, alreadyExisted: true } });
    }

    const level = textData.level || 'B2';

    // 3. Soruları üret
    const systemPromptQ = `You are a language teacher. Return only valid JSON. Format: {"questions": [{"question": "...", "options": ["A", "B", "C", "D"], "correctAnswerIndex": 0}]}`;
    const userPromptQ = `Based on the following text, create exactly 5 multiple-choice reading comprehension questions appropriate for ${level} learners.

Text:
${textData.content}

Return JSON with exactly 5 questions. Options must be an array of 4 strings. correctAnswerIndex must be 0, 1, 2, or 3.`;

    const qCompletion = await openai.chat.completions.create({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: systemPromptQ },
        { role: "user", content: userPromptQ }
      ],
      response_format: { type: "json_object" }
    });

    let qResponseContent = qCompletion.choices[0].message.content.trim();
    const qStartIdx = qResponseContent.indexOf('{');
    const qEndIdx = qResponseContent.lastIndexOf('}');
    if (qStartIdx !== -1 && qEndIdx !== -1) {
      qResponseContent = qResponseContent.substring(qStartIdx, qEndIdx + 1);
    }
    const aiResponseQ = JSON.parse(qResponseContent);

    // 4. Soruları Firestore'a kaydet ve token düş
    await textRef.update({
      questions: aiResponseQ.questions
    });

    await userRef.update({
      tokens: admin.firestore.FieldValue.increment(-2)
    });

    res.json({ success: true, data: { questions: aiResponseQ.questions, alreadyExisted: false } });
  } catch (error) {
    console.error("Soru üretme hatası:", error);
    res.status(500).json({ success: false, error: error.message || "Bilinmeyen bir hata oluştu" });
  }
});

// Metin sorularının sonuçlarını kaydet
router.post('/submit-questions/:textId', verifyToken, async (req, res) => {
  try {
    const { textId } = req.params;
    const userId = req.user.uid;
    const { correctCount, wrongCount } = req.body;

    if (correctCount === undefined || wrongCount === undefined) {
      return res.status(400).json({ success: false, error: 'correctCount ve wrongCount zorunludur.' });
    }

    // Metnin kullanıcıya ait olduğunu kontrol et
    const textRef = db.collection('generated_texts').doc(textId);
    const textDoc = await textRef.get();
    if (!textDoc.exists) {
      return res.status(404).json({ success: false, error: 'Metin bulunamadı.' });
    }
    if (textDoc.data().userId !== userId) {
      return res.status(403).json({ success: false, error: 'Bu metne erişim izniniz yok.' });
    }

    // Daha önce gönderilmiş mi kontrol et
    const existingSubmissions = await db.collection('text_question_submissions')
      .where('userId', '==', userId)
      .where('textId', '==', textId)
      .get();

    if (!existingSubmissions.empty) {
      return res.status(400).json({ success: false, error: 'Bu metnin sorularını zaten yanıtladınız.' });
    }

    // Sonucu kaydet
    await db.collection('text_question_submissions').add({
      userId,
      textId,
      correctCount,
      wrongCount,
      totalQuestions: correctCount + wrongCount,
      submittedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Metin dökümanına da sonuçları yaz
    await textRef.update({
      questionResults: {
        correctCount,
        wrongCount,
        submittedAt: admin.firestore.FieldValue.serverTimestamp()
      }
    });

    res.json({ success: true, data: { correctCount, wrongCount } });
  } catch (error) {
    console.error("Soru sonucu kaydetme hatası:", error);
    res.status(500).json({ success: false, error: error.message || "Bilinmeyen bir hata oluştu" });
  }
});

// Geçmiş Metinleri Getirme
router.get('/', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const page = parseInt(req.query.page) || 1;
    const limitVal = parseInt(req.query.limit) || 10;
    const offsetVal = (page - 1) * limitVal;

    let texts = [];
    let totalItems = 0;

    try {
        const countSnap = await db.collection('generated_texts').where('userId', '==', userId).count().get();
        totalItems = countSnap.data().count;

        const textsSnapshot = await db.collection('generated_texts')
          .where('userId', '==', userId)
          .orderBy('createdAt', 'desc')
          .limit(limitVal)
          .offset(offsetVal)
          .get();

        textsSnapshot.forEach(doc => {
          texts.push({ id: doc.id, ...doc.data() });
        });
    } catch (err) {
        console.warn("Index missing, falling back to in-memory pagination:", err.message);
        const snapshot = await db.collection('generated_texts').where('userId', '==', userId).get();
        const allDocs = [];
        snapshot.forEach(doc => allDocs.push({ id: doc.id, ...doc.data() }));
        allDocs.sort((a, b) => {
          const timeA = a.createdAt ? a.createdAt._seconds : 0;
          const timeB = b.createdAt ? b.createdAt._seconds : 0;
          return timeB - timeA;
        });
        totalItems = allDocs.length;
        texts = allDocs.slice(offsetVal, offsetVal + limitVal);
    }

    res.json({ 
        success: true, 
        data: texts,
        pagination: {
            page,
            limit: limitVal,
            totalItems,
            totalPages: Math.ceil(totalItems / limitVal)
        }
    });
  } catch (error) {
    console.error("Metinleri listeleme hatası:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// İstatistikleri Getirme
router.get('/stats', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;

    const userDoc = await db.collection('users').doc(userId).get();
    const tokens = userDoc.exists ? (userDoc.data().tokens || 0) : 0;
    const currentStreak = userDoc.exists ? (userDoc.data().currentStreak || 0) : 0;

    const textsQuery = await db.collection('generated_texts').where('userId', '==', userId).get();
    let textsCount = 0;
    let totalGeneratedWords = 0;
    let mostUsedLevelMap = {};
    let topicsSet = new Set();
    
    textsQuery.forEach(doc => {
        textsCount++;
        const data = doc.data();
        totalGeneratedWords += (data.wordCountRequested || 0);
        
        if (data.level) {
            mostUsedLevelMap[data.level] = (mostUsedLevelMap[data.level] || 0) + 1;
        }
        if (data.topic) {
            topicsSet.add(data.topic.toLowerCase());
        }
    });

    let mostUsedLevel = "-";
    let maxLevelCount = 0;
    for (const [lvl, count] of Object.entries(mostUsedLevelMap)) {
        if (count > maxLevelCount) {
            maxLevelCount = count;
            mostUsedLevel = lvl;
        }
    }

    const uniqueTopics = topicsSet.size;

    // Kelime Sayısı (Öğrenildi ve Öğrenilmedi)
    const wordsQuery = await db.collection('user_dictionary_words').where('userId', '==', userId).get();
    let dictWords = 0;
    let learnedWords = 0;

    wordsQuery.forEach(doc => {
      dictWords++;
      if (doc.data().isLearned) learnedWords++;
    });

    // Günlük Görev (Daily Challenge) İstatistikleri
    const submissionsQuery = await db.collection('daily_submissions').where('userId', '==', userId).get();
    let totalCorrectAnswers = 0;
    let totalWrongAnswers = 0;
    
    submissionsQuery.forEach(doc => {
        const data = doc.data();
        totalCorrectAnswers += (data.correctCount || 0);
        totalWrongAnswers += (data.wrongCount || 0);
    });

    // Metin Soruları (Text Questions) İstatistikleri
    const textQSubmissionsQuery = await db.collection('text_question_submissions').where('userId', '==', userId).get();
    let textQCorrect = 0;
    let textQWrong = 0;
    let textQTotal = 0;

    textQSubmissionsQuery.forEach(doc => {
        const data = doc.data();
        textQCorrect += (data.correctCount || 0);
        textQWrong += (data.wrongCount || 0);
        textQTotal++;
    });

    res.json({ 
      success: true, 
      data: {
        textsCount,
        totalGeneratedWords,
        uniqueTopics,
        mostUsedLevel,
        dictWords,
        learnedWords,
        pendingWords: dictWords - learnedWords,
        tokens,
        currentStreak,
        totalCorrectAnswers,
        totalWrongAnswers,
        textQuestionsCorrect: textQCorrect,
        textQuestionsWrong: textQWrong,
        textQuestionsAnswered: textQTotal
      }
    });

  } catch (error) {
    console.error("İstatistik getirme hatası:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

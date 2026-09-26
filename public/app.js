import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

// Sunucudan (backend .env üzerinden) Firebase ayarlarını güvenle çekiyoruz
const configResponse = await fetch('/api/config/firebase');
const firebaseConfig = await configResponse.json();

if (!firebaseConfig.apiKey) {
    console.error("Firebase Config yüklenemedi. Lütfen backend .env dosyasını kontrol edin.");
    alert("HATA: Firebase ayarları eksik. Lütfen .env dosyasını kontrol edin.");
}

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// Onboarding Tooltip Helper
function showOnboardingTooltip(id, message, containerId) {
    if (localStorage.getItem(`onboarding_${id}`)) return;
    const container = document.getElementById(containerId);
    if (!container || container.querySelector(`.onboarding-tooltip[data-id="${id}"]`)) return;
    const tooltip = document.createElement('div');
    tooltip.className = 'onboarding-tooltip';
    tooltip.setAttribute('data-id', id);
    const textSpan = document.createElement('span');
    textSpan.innerHTML = `💡 ${message}`;
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '✖';
    closeBtn.onclick = () => {
        localStorage.setItem(`onboarding_${id}`, 'true');
        tooltip.remove();
    };
    tooltip.appendChild(textSpan);
    tooltip.appendChild(closeBtn);
    container.insertBefore(tooltip, container.firstChild);
}

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');
const loginBtn = document.getElementById('google-login-btn');
const logoutBtn = document.getElementById('logout-btn');
const userNameDisplay = document.getElementById('user-name-display');
const generateForm = document.getElementById('generate-form');
const wordCountInput = document.getElementById('word-count');
const wordCountDisplay = document.getElementById('word-count-display');

// Sections
const sections = document.querySelectorAll('.tab-section');
const tabBtns = document.querySelectorAll('.tab-btn');
const resultsSection = document.getElementById('results-section');

// Word count update
if (wordCountInput) {
    wordCountInput.addEventListener('input', (e) => {
        const count = e.target.value;
        wordCountDisplay.textContent = `${count} words`;
        const requiredTokens = Math.ceil(count / 100);
        document.getElementById('btn-text').textContent = `Generate Story (${requiredTokens} Tokens)`;
    });
}

let currentUserToken = null;
let currentTokens = 0;

function updateTokenDisplay(tokens) {
    currentTokens = tokens;
    const tokenEl = document.getElementById('user-tokens');
    tokenEl.style.display = 'inline-block';
    tokenEl.textContent = `🪙 ${tokens}`;
}

async function syncUserTokens() {
    if (!currentUserToken) return;
    try {
        const res = await fetch('/api/user/sync', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${currentUserToken}` }
        });
        const data = await res.json();
        if (data.success) {
            updateTokenDisplay(data.data.tokens);
            if (data.data.role === 'admin') {
                document.getElementById('tab-admin').style.display = 'block';
            }
            
            if (!data.data.nickname) {
                document.getElementById('nickname-modal').style.display = 'flex';
            } else {
                userNameDisplay.textContent = data.data.nickname;
            }

            // Daily bubble kontrolü
            updateDailyBubbleFromStatus();
        }
    } catch (e) {
        console.error("Token sync failed", e);
    }
}

// Daily Challenge tab'ındaki token baloncuğunu güncelle
function updateDailyBubble(show) {
    const bubble = document.getElementById('daily-tab-bubble');
    if (bubble) {
        bubble.style.display = show ? 'inline-block' : 'none';
    }
}

async function updateDailyBubbleFromStatus() {
    if (!currentUserToken) return;
    try {
        const res = await fetch('/api/daily/status', {
            headers: { 'Authorization': `Bearer ${currentUserToken}` }
        });
        const data = await res.json();
        if (data.success) {
            updateDailyBubble(!data.data.isCompleted);
        }
    } catch (e) {
        // Sessizce başarısız ol
    }
}

// Profile Dropdown Logic
const profileIcon = document.getElementById('profile-icon');
const profileDropdownMenu = document.getElementById('profile-dropdown-menu');

if (profileIcon && profileDropdownMenu) {
    profileIcon.addEventListener('click', (e) => {
        e.stopPropagation();
        if (profileDropdownMenu.style.display === 'none') {
            profileDropdownMenu.style.display = 'block';
        } else {
            profileDropdownMenu.style.display = 'none';
        }
    });

    document.addEventListener('click', (e) => {
        if (!profileIcon.contains(e.target) && !profileDropdownMenu.contains(e.target)) {
            profileDropdownMenu.style.display = 'none';
        }
    });
}

// Save Nickname Logic
const saveNicknameBtn = document.getElementById('save-nickname-btn');
const nicknameInput = document.getElementById('nickname-input');

if (saveNicknameBtn && nicknameInput) {
    saveNicknameBtn.addEventListener('click', async () => {
        const nickname = nicknameInput.value.trim();
        if (nickname.length < 3) {
            alert("Nickname must be at least 3 characters.");
            return;
        }
        
        saveNicknameBtn.disabled = true;
        saveNicknameBtn.textContent = 'Saving...';
        
        try {
            const res = await fetch('/api/user/nickname', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentUserToken}`
                },
                body: JSON.stringify({ nickname })
            });
            const data = await res.json();
            
            if (data.success) {
                document.getElementById('nickname-modal').style.display = 'none';
                userNameDisplay.textContent = data.data.nickname;
            } else {
                alert("Error: " + data.error);
                saveNicknameBtn.disabled = false;
                saveNicknameBtn.textContent = 'Save Nickname';
            }
        } catch (e) {
            alert("Error saving nickname.");
            saveNicknameBtn.disabled = false;
            saveNicknameBtn.textContent = 'Save Nickname';
        }
    });
}

// Manage Modal Logic
window.openAdminManageModal = async function(user) {
    document.getElementById('admin-manage-uid').value = user.id;
    document.getElementById('admin-manage-email').textContent = user.email;
    document.getElementById('admin-manage-nickname').value = user.nickname || '';
    document.getElementById('admin-manage-tokens').value = user.tokens || 0;
    document.getElementById('admin-manage-streak').value = user.currentStreak || 0;
    document.getElementById('admin-manage-role').value = user.role || 'user';
    
    // Yükleniyor durumu
    document.getElementById('admin-stat-texts').textContent = '...';
    document.getElementById('admin-stat-words').textContent = '...';
    document.getElementById('admin-stat-daily').textContent = '...';
    
    document.getElementById('admin-manage-modal').style.display = 'flex';
    
    try {
        const res = await fetch(`/api/admin/user/${user.id}/details`, {
            headers: { 'Authorization': `Bearer ${currentUserToken}` }
        });
        const json = await res.json();
        
        if (json.success) {
            document.getElementById('admin-stat-texts').textContent = json.data.stats.generatedTextsCount || 0;
            document.getElementById('admin-stat-words').textContent = json.data.stats.dictionaryWordsCount || 0;
            document.getElementById('admin-stat-daily').textContent = json.data.stats.dailySubmissionsCount || 0;
        }
    } catch (e) {
        console.error("Detay yükleme hatası", e);
    }
};

const adminCloseModalBtn = document.getElementById('admin-close-modal-btn');
if (adminCloseModalBtn) {
    adminCloseModalBtn.addEventListener('click', () => {
        document.getElementById('admin-manage-modal').style.display = 'none';
    });
}

const adminUpdateForm = document.getElementById('admin-update-form');
if (adminUpdateForm) {
    adminUpdateForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const uid = document.getElementById('admin-manage-uid').value;
        const nickname = document.getElementById('admin-manage-nickname').value;
        const tokens = parseInt(document.getElementById('admin-manage-tokens').value);
        const currentStreak = parseInt(document.getElementById('admin-manage-streak').value);
        const role = document.getElementById('admin-manage-role').value;
        
        const submitBtn = e.target.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';
        
        try {
            const res = await fetch(`/api/admin/user/${uid}/update`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentUserToken}`
                },
                body: JSON.stringify({ nickname, tokens, role, currentStreak })
            });
            const json = await res.json();
            
            if (json.success) {
                document.getElementById('admin-manage-modal').style.display = 'none';
                const currentSearch = document.getElementById('search-admin') ? document.getElementById('search-admin').value : '';
                loadAdminData(adminCurrentPage, currentSearch); // Tabloyu yenile
            } else {
                alert("Error: " + json.error);
            }
        } catch (error) {
            console.error(error);
            alert("Error updating user.");
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Save Changes';
        }
    });
}

let adminCurrentPage = 1;

async function loadAdminData(page = 1, searchQuery = '') {
    try {
        adminCurrentPage = page;
        const tbody = document.getElementById('admin-users-list');
        const paginationDiv = document.getElementById('admin-pagination');
        const prevBtn = document.getElementById('admin-prev');
        const nextBtn = document.getElementById('admin-next');
        const pageInfo = document.getElementById('admin-page-info');
        
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Loading...</td></tr>';
        paginationDiv.style.display = 'none';

        const params = new URLSearchParams({
            page: page,
            limit: ITEMS_PER_PAGE
        });
        if (searchQuery) {
            params.append('search', searchQuery);
        }

        const [statsRes, usersRes] = await Promise.all([
            fetch('/api/admin/stats', { headers: { 'Authorization': `Bearer ${currentUserToken}` } }),
            fetch(`/api/admin/users?${params.toString()}`, { headers: { 'Authorization': `Bearer ${currentUserToken}` } })
        ]);
        
        const statsData = await statsRes.json();
        const usersData = await usersRes.json();
        
        if (statsData.success) {
            document.getElementById('admin-total-users').textContent = statsData.data.totalUsers;
            document.getElementById('admin-total-texts').textContent = statsData.data.totalTexts;
        }
        
        if (usersData.success) {
            tbody.innerHTML = '';
            
            if (usersData.data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">No users found.</td></tr>';
                return;
            }

            usersData.data.forEach(user => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${user.email}</td>
                    <td>${user.nickname || '-'}</td>
                    <td>${user.tokens}</td>
                    <td><span style="background: ${user.role === 'admin' ? 'rgba(255,82,82,0.2)' : 'rgba(255,255,255,0.1)'}; padding: 4px 8px; border-radius: 4px; color: ${user.role === 'admin' ? '#ff5252' : 'inherit'};">${user.role}</span></td>
                    <td>${user.currentStreak || 0}</td>
                    <td class="admin-actions-cell" style="display: flex; gap: 8px;">
                        <button class="admin-action-btn admin-token-btn" onclick='openAdminManageModal(${JSON.stringify(user)})'>Manage</button>
                        <button class="admin-action-btn" style="background: rgba(255, 123, 0, 0.1); color: #ff7b00; border: 1px solid rgba(255, 123, 0, 0.3);" onclick="openAdminNotifModal('private', '${user.email}')">Message</button>
                        <button class="admin-action-btn" style="background: rgba(52, 168, 83, 0.1); color: #34A853; border: 1px solid rgba(52, 168, 83, 0.3);" onclick="viewUserTexts('${user.uid || user.id}', '${user.nickname || user.email}')">Texts</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });

            // Handle Pagination Controls
            if (usersData.pagination && usersData.pagination.totalPages > 1) {
                paginationDiv.style.display = 'flex';
                pageInfo.textContent = `Page ${usersData.pagination.page} of ${usersData.pagination.totalPages}`;
                
                prevBtn.disabled = usersData.pagination.page <= 1;
                prevBtn.onclick = () => loadAdminData(usersData.pagination.page - 1, searchQuery);
                
                nextBtn.disabled = usersData.pagination.page >= usersData.pagination.totalPages;
                nextBtn.onclick = () => loadAdminData(usersData.pagination.page + 1, searchQuery);
            }
        }
    } catch (e) {
        console.error("Admin data load error", e);
    }
}

// Auth State Observer
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // User is signed in
        currentUserToken = await user.getIdToken();
        showScreen('app');
        showOnboardingTooltip('generate_info', 'Konu, seviye ve kelime sayısını seçerek kendinize özel okuma metinleri üretebilirsiniz.', 'generator-section');
        await syncUserTokens();
        await loadNotifications();
    } else {
        // User is signed out
        currentUserToken = null;
        showScreen('login');
    }
});

// Login
loginBtn.addEventListener('click', async () => {
    try {
        if (!firebaseConfig.apiKey) {
            alert("Firebase Config ayarlanamadı! Lütfen backend terminalinde sunucuyu yeniden başlatın.");
            return;
        }
        await signInWithPopup(auth, provider);
    } catch (error) {
        console.error("Giriş hatası:", error);
        alert("Giriş yapılamadı: " + error.message);
    }
});

// Logout
logoutBtn.addEventListener('click', () => {
    signOut(auth);
});

// Tab Switching
tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        // Remove active class from all
        tabBtns.forEach(b => b.classList.remove('active'));
        sections.forEach(s => s.classList.remove('active'));
        
        // Add active to clicked
        btn.classList.add('active');
        const targetId = btn.getAttribute('data-target');
        document.getElementById(targetId).classList.add('active');

        // Load data based on tab
        if (targetId === 'generator-section') {
            showOnboardingTooltip('generate_info', 'Konu, seviye ve kelime sayısını seçerek kendinize özel okuma metinleri üretebilirsiniz.', 'generator-section');
        } else if (targetId === 'dictionary-section') {
            loadDictionary();
        } else if (targetId === 'past-texts-section') {
            loadPastTexts();
        } else if (targetId === 'stats-section') {
            loadStats();
        } else if (targetId === 'admin-section') {
            loadAdminData();
        } else if (targetId === 'daily-section') {
            loadDailyChallenge();
        }
    });
});

// Random Topic Logic
const randomTopicBtn = document.getElementById('random-topic-btn');
const topicInput = document.getElementById('topic');

if (randomTopicBtn && topicInput) {
    randomTopicBtn.addEventListener('click', () => {
        topicInput.value = "Random Topic";
    });
}

// Generate Text Form Submit
const generateBtn = document.getElementById('generate-btn');
const btnText = document.getElementById('btn-text');
const generateSpinner = document.getElementById('generate-spinner');
let currentGeneratedTextId = null;
let generateUserAnswers = {};
let currentGeneratedQuestions = null;

generateForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUserToken) return;

    const topic = document.getElementById('topic').value;
    const level = document.getElementById('level').value;
    const wordCount = parseInt(document.getElementById('word-count').value, 10);

    const requiredTokens = Math.ceil(wordCount / 100);
    if (currentTokens < requiredTokens) {
        alert(`Yetersiz bakiye! Bu işlem için ${requiredTokens} token gerekiyor, fakat ${currentTokens} tokeniniz var. Lütfen token yükleyin.`);
        return;
    }

    setLoading(true);
    resultsSection.style.display = 'none';
    // Soru bölümünü sıfırla
    document.getElementById('generate-questions-section').style.display = 'none';
    document.getElementById('generate-questions-loading').style.display = 'none';
    document.getElementById('generate-questions-container').style.display = 'none';
    document.getElementById('generate-questions-result').style.display = 'none';
    generateUserAnswers = {};
    currentGeneratedQuestions = null;

    try {
        const response = await fetch('/api/text/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentUserToken}`
            },
            body: JSON.stringify({
                topic: topic,
                level: level,
                wordCountRequested: wordCount
            })
        });

        const result = await response.json();

        if (response.status === 403) {
            alert(result.error || "Yetersiz bakiye.");
            return;
        }

        if (result.success) {
            updateTokenDisplay(currentTokens - requiredTokens); // Bakiye güncelle
            displayResults(result.data);
            resultsSection.style.display = 'block';
            currentGeneratedTextId = result.data.id;

            // Arka planda soruları üret (kullanıcı metni okurken) - sadece checkbox işaretliyse
            const generateQuestions = document.getElementById('generate-questions-checkbox').checked;
            if (generateQuestions) {
                generateQuestionsInBackground(result.data.id);
            }
        } else {
            alert("Metin üretilirken hata oluştu: " + result.error);
        }
    } catch (error) {
        console.error("API hatası:", error);
        alert("Sunucuya bağlanırken bir hata oluştu.");
    } finally {
        setLoading(false);
    }
});

// Arka planda soruları üret
async function generateQuestionsInBackground(textId) {
    if (!currentUserToken || currentTokens < 2) {
        // Yetersiz token varsa soru bölümünü hiç gösterme
        return;
    }

    const questionsSection = document.getElementById('generate-questions-section');
    const loadingDiv = document.getElementById('generate-questions-loading');
    const questionsContainer = document.getElementById('generate-questions-container');
    const resultDiv = document.getElementById('generate-questions-result');

    questionsSection.style.display = 'block';
    loadingDiv.style.display = 'block';
    questionsContainer.style.display = 'none';
    resultDiv.style.display = 'none';

    try {
        const res = await fetch(`/api/text/generate-questions/${textId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentUserToken}`
            }
        });

        const json = await res.json();

        if (json.success) {
            // Sadece yeni üretilen sorular için token düş
            if (!json.data.alreadyExisted) {
                updateTokenDisplay(currentTokens - 2);
            }
            loadingDiv.style.display = 'none';
            questionsContainer.style.display = 'block';
            renderGeneratedQuestions(json.data.questions);
        } else if (res.status === 403) {
            // Yetersiz bakiye
            questionsSection.style.display = 'none';
        } else {
            console.error("Soru üretme hatası:", json.error);
            questionsSection.style.display = 'none';
        }
    } catch (e) {
        console.error("Soru API hatası:", e);
        questionsSection.style.display = 'none';
    }
}

function renderGeneratedQuestions(questions) {
    currentGeneratedQuestions = questions;
    const list = document.getElementById('generate-questions-list');
    list.innerHTML = '';
    generateUserAnswers = {};

    questions.forEach((q, qIndex) => {
        const card = document.createElement('div');
        card.className = 'question-card';

        const qText = document.createElement('div');
        qText.className = 'question-text';
        qText.textContent = `${qIndex + 1}. ${q.question}`;
        card.appendChild(qText);

        const optsList = document.createElement('div');
        optsList.className = 'options-list';

        q.options.forEach((opt, optIndex) => {
            const btn = document.createElement('button');
            btn.className = 'option-btn';
            btn.textContent = `${['A', 'B', 'C', 'D'][optIndex]}) ${opt}`;

            btn.onclick = () => {
                generateUserAnswers[qIndex] = optIndex;
                Array.from(optsList.children).forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');

                if (Object.keys(generateUserAnswers).length === questions.length) {
                    document.getElementById('generate-questions-submit-btn').style.display = 'block';
                }
            };
            optsList.appendChild(btn);
        });

        card.appendChild(optsList);
        list.appendChild(card);
    });

    document.getElementById('generate-questions-submit-btn').style.display = 'none';
}

// Soru cevaplarını değerlendir ve Firestore'a kaydet
document.getElementById('generate-questions-submit-btn')?.addEventListener('click', async () => {
    if (!currentGeneratedQuestions || !currentGeneratedTextId) return;

    let correct = 0;
    let wrong = 0;

    // Seçenekleri renklendir
    const questionCards = document.querySelectorAll('#generate-questions-list .question-card');
    currentGeneratedQuestions.forEach((q, index) => {
        const card = questionCards[index];
        if (!card) return;
        const optionBtns = card.querySelectorAll('.option-btn');

        optionBtns.forEach((btn, optIndex) => {
            btn.disabled = true;
            if (optIndex === q.correctAnswerIndex) {
                btn.classList.add('correct');
            }
            if (generateUserAnswers[index] === optIndex && optIndex !== q.correctAnswerIndex) {
                btn.classList.add('incorrect');
            }
        });

        if (generateUserAnswers[index] === q.correctAnswerIndex) {
            correct++;
        } else {
            wrong++;
        }
    });

    // Submit butonunu gizle
    document.getElementById('generate-questions-submit-btn').style.display = 'none';

    // Sonuçları göster
    document.getElementById('generate-questions-result').style.display = 'block';
    document.getElementById('gen-correct-count').textContent = correct;
    document.getElementById('gen-wrong-count').textContent = wrong;

    // Firestore'a sonuçları kaydet
    try {
        const res = await fetch(`/api/text/submit-questions/${currentGeneratedTextId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentUserToken}`
            },
            body: JSON.stringify({ correctCount: correct, wrongCount: wrong })
        });
        const json = await res.json();
        if (!json.success) {
            console.warn("Sonuç kaydedilemedi:", json.error);
        }
    } catch (e) {
        console.error("Sonuç kaydetme API hatası:", e);
    }
});

function getHighlightedContentHtml(content, keywords) {
    let contentHtml = content;
    if (keywords && Array.isArray(keywords)) {
        keywords.forEach(kw => {
            const escapedWord = kw.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`\\b(${escapedWord})\\b`, 'i'); // removed 'g' to replace only the first occurrence
            
            contentHtml = contentHtml.replace(regex, `<span class="inline-keyword" data-tr="${kw.turkish.replace(/"/g, '&quot;')}" onclick="handleKeywordClick('${kw.word.replace(/'/g, "\\'")}', '${kw.turkish.replace(/'/g, "\\'")}', this, event)">$1</span>`);
        });
    }
    return contentHtml;
}

function displayResults(data) {
    document.getElementById('result-title').textContent = data.title;
    
    let contentHtml = getHighlightedContentHtml(data.content, data.keywords);
    
    document.getElementById('result-content').innerHTML = contentHtml;
    
    resultsSection.style.display = 'block';
    showOnboardingTooltip('generator_click', 'Metin içindeki turuncu altı çizili kelimelere tıklayarak sözlüğünüze ekleyebilirsiniz. Fareyle üzerine gelerek anlamını görebilirsiniz.', 'results-section');
}

// Global click listener to hide tooltips when tapping outside
document.addEventListener('click', () => {
    document.querySelectorAll('.inline-keyword.show-tooltip').forEach(el => {
        el.classList.remove('show-tooltip');
    });
});

window.handleKeywordClick = function(word, turkish, element, event) {
    event.stopPropagation();
    
    // Desktop mouse: add directly on click since hover already shows meaning
    if (event.pointerType === 'mouse') {
        addToDictionary(word, turkish, element);
        return;
    }
    
    // Mobile touch logic: 1st tap shows tooltip, 2nd tap adds
    if (element.classList.contains('show-tooltip')) {
        addToDictionary(word, turkish, element);
    } else {
        document.querySelectorAll('.inline-keyword.show-tooltip').forEach(el => {
            el.classList.remove('show-tooltip');
        });
        element.classList.add('show-tooltip');
        
        setTimeout(() => {
            if (element.classList.contains('show-tooltip')) {
                element.classList.remove('show-tooltip');
            }
        }, 3000);
    }
}

// Global window access for onclick functions
window.addToDictionary = async function(word, turkish, btn) {
    if (!currentUserToken) return;
    
    const isSpan = btn.tagName.toLowerCase() === 'span';
    
    if (!isSpan) btn.textContent = '...';
    btn.disabled = true;

    try {
        const response = await fetch('/api/dictionary', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentUserToken}`
            },
            body: JSON.stringify({ word, turkish })
        });
        const result = await response.json();

        if (result.success) {
            if (isSpan) {
                btn.style.color = '#34A853';
                btn.style.borderBottomColor = '#34A853';
                btn.setAttribute('data-tr', 'Added ✓');
            } else {
                btn.textContent = 'Added ✓';
                btn.style.background = 'rgba(52, 168, 83, 0.4)';
            }
        } else {
            if (!isSpan) btn.textContent = 'Error';
            btn.disabled = false;
            alert(result.error);
        }
    } catch(e) {
        if (!isSpan) btn.textContent = 'Error';
        btn.disabled = false;
    }
}

let textsCurrentPage = 1;
const ITEMS_PER_PAGE = 5; // To show pagination easily

async function loadPastTexts(page = 1) {
    if (!currentUserToken) return;
    textsCurrentPage = page;
    const container = document.getElementById('past-texts-list');
    const paginationDiv = document.getElementById('past-texts-pagination');
    const prevBtn = document.getElementById('past-texts-prev');
    const nextBtn = document.getElementById('past-texts-next');
    const pageInfo = document.getElementById('past-texts-page-info');

    container.innerHTML = '<div class="spinner" style="margin: 0 auto;"></div>';
    paginationDiv.style.display = 'none';

    try {
        const res = await fetch(`/api/text?page=${page}&limit=${ITEMS_PER_PAGE}`, {
            headers: { 'Authorization': `Bearer ${currentUserToken}` }
        });
        const json = await res.json();

        if (json.success) {
            container.innerHTML = '';
            showOnboardingTooltip('past_texts_click', 'Metin kartlarına tıklayarak içeriği genişletip okuyabilirsiniz.', 'past-texts-section');
            if (json.data.length === 0 && page === 1) {
                container.innerHTML = '<p style="color: var(--text-muted)">You have not generated any texts yet.</p>';
                return;
            }

            json.data.forEach(textData => {
                const card = document.createElement('div');
                card.className = 'text-card';
                
                let dateStr = 'Recent';
                if (textData.createdAt && textData.createdAt._seconds) {
                    dateStr = new Date(textData.createdAt._seconds * 1000).toLocaleDateString();
                }
                
                const contentHtml = getHighlightedContentHtml(textData.content, textData.keywords);

                card.innerHTML = `
                    <h3>${textData.title || textData.topic}</h3>
                    <div class="meta">
                        <span>Level: ${textData.level}</span>
                        <span>Date: ${dateStr}</span>
                    </div>
                    <div class="card-expanded-content" style="display: none; margin-top: 16px; border-top: 1px solid var(--panel-border); padding-top: 16px;">
                        <p style="white-space: pre-wrap; color: #e2e8f0; line-height: 1.8; font-size: 1.1rem; margin-bottom:0;">${contentHtml}</p>
                    </div>
                `;
                
                card.onclick = () => {
                    const expanded = card.querySelector('.card-expanded-content');
                    if (expanded.style.display === 'none') {
                        expanded.style.display = 'block';
                    } else {
                        expanded.style.display = 'none';
                    }
                };
                container.appendChild(card);
            });

            // Handle Pagination Controls
            if (json.pagination && json.pagination.totalPages > 1) {
                paginationDiv.style.display = 'flex';
                pageInfo.textContent = `Page ${json.pagination.page} of ${json.pagination.totalPages}`;
                
                prevBtn.disabled = json.pagination.page <= 1;
                prevBtn.onclick = () => loadPastTexts(json.pagination.page - 1);
                
                nextBtn.disabled = json.pagination.page >= json.pagination.totalPages;
                nextBtn.onclick = () => loadPastTexts(json.pagination.page + 1);
            }
        }
    } catch (e) {
        container.innerHTML = '<p>Error loading texts.</p>';
    }
}


let dictCurrentPage = 1;

async function loadDictionary(page = 1) {
    if (!currentUserToken) return;
    dictCurrentPage = page;
    const container = document.getElementById('dictionary-list');
    const paginationDiv = document.getElementById('dict-pagination');
    const prevBtn = document.getElementById('dict-prev');
    const nextBtn = document.getElementById('dict-next');
    const pageInfo = document.getElementById('dict-page-info');

    container.innerHTML = '<div class="spinner" style="margin: 0 auto;"></div>';
    paginationDiv.style.display = 'none';

    try {
        const res = await fetch(`/api/dictionary?page=${page}&limit=${ITEMS_PER_PAGE}`, {
            headers: { 'Authorization': `Bearer ${currentUserToken}` }
        });
        const json = await res.json();

        if (json.success) {
            container.innerHTML = '';
            showOnboardingTooltip('dict_learned', 'Kelime kartlarına tıklayarak onları "Öğrenildi" olarak işaretleyebilirsiniz.', 'dictionary-section');
            if (json.data.length === 0 && page === 1) {
                container.innerHTML = '<p style="color: var(--text-muted)">Your vocabulary list is empty.</p>';
                return;
            }

            json.data.forEach(wordData => {
                const li = document.createElement('li');
                li.className = 'keyword-item dict-card';
                if (wordData.isLearned) {
                    li.classList.add('learned-card');
                }
                
                li.innerHTML = `
                    <div class="dict-words">
                        <span class="kw-en">${wordData.word}</span>
                        <span class="kw-tr">${wordData.turkish}</span>
                    </div>
                    <div class="dict-status">${wordData.isLearned ? '✓ Learned' : 'Click to mark Learned'}</div>
                `;
                
                li.onclick = async () => {
                    const isNowLearned = !li.classList.contains('learned-card');
                    // Optimizasyon: UI'ı anında güncelliyoruz ki kullanıcı beklediğini hissetmesin
                    if (isNowLearned) {
                        li.classList.add('learned-card');
                        li.querySelector('.dict-status').textContent = '✓ Learned';
                    } else {
                        li.classList.remove('learned-card');
                        li.querySelector('.dict-status').textContent = 'Click to mark Learned';
                    }
                    
                    try {
                        await fetch(`/api/dictionary/${wordData.id}/learned`, {
                            method: 'PUT',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${currentUserToken}`
                            },
                            body: JSON.stringify({ isLearned: isNowLearned })
                        });
                    } catch (e) {
                        console.error('Failed to toggle learned status', e);
                        // Eğer hata verirse UI'ı eski haline çevir
                        if (!isNowLearned) {
                            li.classList.add('learned-card');
                            li.querySelector('.dict-status').textContent = '✓ Learned';
                        } else {
                            li.classList.remove('learned-card');
                            li.querySelector('.dict-status').textContent = 'Click to mark Learned';
                        }
                    }
                };
                
                container.appendChild(li);
            });
        }
    } catch (e) {
        container.innerHTML = '<p>Error loading dictionary.</p>';
    }
}



// Chart.js instances
let vocabChartInstance = null;
let questionsChartInstance = null;

async function loadStats() {
    if (!currentUserToken) return;
    try {
        const res = await fetch('/api/text/stats', {
            headers: { 'Authorization': `Bearer ${currentUserToken}` }
        });
        const json = await res.json();

        if (json.success) {
            const d = json.data;

            // Summary cards
            document.getElementById('stat-streak').textContent = d.currentStreak ? `🔥 ${d.currentStreak}` : '0';
            document.getElementById('stat-tokens').textContent = d.tokens ? `🪙 ${d.tokens}` : '0';
            document.getElementById('stat-texts-count').textContent = d.textsCount || 0;
            document.getElementById('stat-generated-words').textContent = d.totalGeneratedWords || 0;

            // Vocabulary
            document.getElementById('stat-learned-words').textContent = d.learnedWords || 0;
            document.getElementById('stat-pending-words').textContent = d.pendingWords || 0;
            document.getElementById('stat-dict-words').textContent = d.dictWords || 0;

            // Detail cards
            document.getElementById('stat-unique-topics').textContent = d.uniqueTopics || 0;
            document.getElementById('stat-favorite-level').textContent = d.mostUsedLevel || '-';
            document.getElementById('stat-text-q-answered').textContent = d.textQuestionsAnswered || 0;

            // Accuracy bars
            document.getElementById('stat-total-correct').textContent = d.totalCorrectAnswers || 0;
            document.getElementById('stat-total-wrong').textContent = d.totalWrongAnswers || 0;
            document.getElementById('stat-text-q-correct').textContent = d.textQuestionsCorrect || 0;
            document.getElementById('stat-text-q-wrong').textContent = d.textQuestionsWrong || 0;

            // Vocabulary Doughnut Chart
            const vocabCtx = document.getElementById('vocabChart').getContext('2d');
            if (vocabChartInstance) vocabChartInstance.destroy();
            vocabChartInstance = new Chart(vocabCtx, {
                type: 'doughnut',
                data: {
                    labels: ['Mastered', 'Learning'],
                    datasets: [{
                        data: [d.learnedWords || 0, d.pendingWords || 0],
                        backgroundColor: ['#34A853', '#FF9800'],
                        borderColor: ['#1a3a1a', '#3a2a0a'],
                        borderWidth: 2,
                        hoverBorderColor: ['#34A853', '#FF9800'],
                        hoverBorderWidth: 3
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '65%',
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(20, 22, 28, 0.95)',
                            titleColor: '#fff',
                            bodyColor: '#e2e8f0',
                            borderColor: 'rgba(255,255,255,0.1)',
                            borderWidth: 1,
                            padding: 12,
                            callbacks: {
                                label: function(ctx) {
                                    const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                                    const pct = total > 0 ? Math.round(ctx.raw / total * 100) : 0;
                                    return ` ${ctx.label}: ${ctx.raw} (${pct}%)`;
                                }
                            }
                        }
                    }
                }
            });

            // Questions Bar Chart
            const qCtx = document.getElementById('questionsChart').getContext('2d');
            if (questionsChartInstance) questionsChartInstance.destroy();
            questionsChartInstance = new Chart(qCtx, {
                type: 'bar',
                data: {
                    labels: ['Daily Challenge', 'Text Questions'],
                    datasets: [
                        {
                            label: 'Correct',
                            data: [d.totalCorrectAnswers || 0, d.textQuestionsCorrect || 0],
                            backgroundColor: 'rgba(52, 168, 83, 0.7)',
                            borderColor: '#34A853',
                            borderWidth: 1,
                            borderRadius: 6,
                            borderSkipped: false
                        },
                        {
                            label: 'Wrong',
                            data: [d.totalWrongAnswers || 0, d.textQuestionsWrong || 0],
                            backgroundColor: 'rgba(255, 82, 82, 0.7)',
                            borderColor: '#ff5252',
                            borderWidth: 1,
                            borderRadius: 6,
                            borderSkipped: false
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(20, 22, 28, 0.95)',
                            titleColor: '#fff',
                            bodyColor: '#e2e8f0',
                            borderColor: 'rgba(255,255,255,0.1)',
                            borderWidth: 1,
                            padding: 12
                        }
                    },
                    scales: {
                        x: {
                            stacked: true,
                            grid: { display: false },
                            ticks: { color: '#a0a5b1', font: { size: 11 } }
                        },
                        y: {
                            stacked: true,
                            grid: { color: 'rgba(255,255,255,0.05)' },
                            ticks: { color: '#a0a5b1', font: { size: 11 }, stepSize: 1 }
                        }
                    }
                }
            });

            // Accuracy bars
            const dailyTotal = (d.totalCorrectAnswers || 0) + (d.totalWrongAnswers || 0);
            const dailyPct = dailyTotal > 0 ? Math.round(d.totalCorrectAnswers / dailyTotal * 100) : 0;
            const dailyAccSection = document.getElementById('daily-accuracy-section');
            const dailyBar = document.getElementById('daily-accuracy-bar');
            const dailyPctEl = document.getElementById('daily-accuracy-pct');

            if (dailyTotal > 0) {
                dailyAccSection.style.display = 'block';
                dailyBar.style.width = dailyPct + '%';
                dailyPctEl.textContent = dailyPct + '%';
            } else {
                dailyAccSection.style.display = 'none';
            }

            const textQTotal = (d.textQuestionsCorrect || 0) + (d.textQuestionsWrong || 0);
            const textQPct = textQTotal > 0 ? Math.round(d.textQuestionsCorrect / textQTotal * 100) : 0;
            const textQAccSection = document.getElementById('textq-accuracy-section');
            const textQBar = document.getElementById('textq-accuracy-bar');
            const textQPctEl = document.getElementById('textq-accuracy-pct');

            if (textQTotal > 0) {
                textQAccSection.style.display = 'block';
                textQBar.style.width = textQPct + '%';
                textQPctEl.textContent = textQPct + '%';
            } else {
                textQAccSection.style.display = 'none';
            }

            // Update timestamp
            const now = new Date();
            document.getElementById('stats-last-updated').textContent =
                `Updated: ${now.toLocaleTimeString()}`;
        }
    } catch (e) {
        console.error("Stats Error:", e);
    }
}

function showScreen(screenType) {
    if (screenType === 'login') {
        loginScreen.classList.add('active');
        appScreen.classList.remove('active');
    } else {
        loginScreen.classList.remove('active');
        appScreen.classList.add('active');
    }
}

function setLoading(isLoading) {
    if (isLoading) {
        btnText.style.display = 'none';
        generateSpinner.style.display = 'block';
        generateBtn.disabled = true;
    } else {
        btnText.style.display = 'block';
        generateSpinner.style.display = 'none';
        generateBtn.disabled = false;
    }
}

// Daily Challenge Logic
let currentDailyData = null;
let userAnswers = {};

async function loadDailyChallenge() {
    if (!currentUserToken) return;
    
    // Reset UI
    document.getElementById('daily-status-badge').style.display = 'none';
    document.getElementById('daily-content-container').style.display = 'none';
    document.getElementById('daily-questions-container').style.display = 'none';
    document.getElementById('daily-result-container').style.display = 'none';
    document.getElementById('daily-loading').style.display = 'block';
    userAnswers = {};

    try {
        // Status Check
        const statusRes = await fetch('/api/daily/status', {
            headers: { 'Authorization': `Bearer ${currentUserToken}` }
        });
        const statusData = await statusRes.json();
        
        // Bubble ve info banner'ı güncelle
        updateDailyBubble(!statusData.success || !statusData.data.isCompleted);
        const tokenInfo = document.getElementById('daily-token-info');
        if (tokenInfo) {
            tokenInfo.style.display = (!statusData.success || !statusData.data.isCompleted) ? 'block' : 'none';
        }

        if (statusData.success && statusData.data.isCompleted) {
            document.getElementById('daily-loading').style.display = 'none';
            document.getElementById('daily-result-container').style.display = 'block';
            document.getElementById('daily-status-badge').textContent = 'Completed';
            document.getElementById('daily-status-badge').style.display = 'inline-block';

            // Doğru/yanlış kartlarını gizle, yarın gel hatırlatmasını göster
            document.getElementById('daily-stats-row').style.display = 'none';
            document.getElementById('daily-comeback-reminder').style.display = 'block';
            
            document.getElementById('anim-streak-value').textContent = statusData.data.currentStreak || 1;
            document.getElementById('streak-animation').style.display = 'block';
            document.getElementById('rank-value').textContent = statusData.data.rank || 1;
            document.getElementById('rank-info').style.display = 'block';

            loadLeaderboard();
            return;
        }

        document.getElementById('daily-status-badge').textContent = 'Generating...';
        document.getElementById('daily-status-badge').style.display = 'inline-block';

        // Load Challenge
        const res = await fetch('/api/daily/challenge', {
            headers: { 'Authorization': `Bearer ${currentUserToken}` }
        });
        const json = await res.json();

        if (json.success) {
            currentDailyData = json.data;
            document.getElementById('daily-loading').style.display = 'none';
            document.getElementById('daily-content-container').style.display = 'block';
            
            document.getElementById('daily-title').textContent = currentDailyData.title;
            document.getElementById('daily-topic').textContent = `Topic: ${currentDailyData.topic}`;
            document.getElementById('daily-level').textContent = `Level: ${currentDailyData.level}`;
            
            const highlightedHtml = getHighlightedContentHtml(currentDailyData.content, currentDailyData.keywords);
            document.getElementById('daily-text').innerHTML = highlightedHtml;
            document.getElementById('daily-status-badge').textContent = 'In Progress';
            
            showOnboardingTooltip('daily_read', 'Metni dikkatlice okuyun. "Sorulara Geç" butonuna tıkladığınızda metni tekrar göremeyeceksiniz!', 'daily-content-container');
        } else {
            alert('Günlük görev alınamadı: ' + json.error);
        }
        
        loadLeaderboard();
    } catch (e) {
        console.error(e);
        alert('Sunucu hatası');
    }
}

document.getElementById('daily-go-questions-btn')?.addEventListener('click', () => {
    document.getElementById('daily-content-container').style.display = 'none';
    document.getElementById('daily-questions-container').style.display = 'block';
    renderDailyQuestions();
});

function renderDailyQuestions() {
    const list = document.getElementById('daily-questions-list');
    list.innerHTML = '';
    
    currentDailyData.questions.forEach((q, qIndex) => {
        const card = document.createElement('div');
        card.className = 'question-card';
        
        const qText = document.createElement('div');
        qText.className = 'question-text';
        qText.textContent = `${qIndex + 1}. ${q.question}`;
        card.appendChild(qText);
        
        const optsList = document.createElement('div');
        optsList.className = 'options-list';
        
        q.options.forEach((opt, optIndex) => {
            const btn = document.createElement('button');
            btn.className = 'option-btn';
            btn.textContent = `${['A', 'B', 'C', 'D'][optIndex]}) ${opt}`;
            
            btn.onclick = () => {
                userAnswers[qIndex] = optIndex;
                Array.from(optsList.children).forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                
                if (Object.keys(userAnswers).length === currentDailyData.questions.length) {
                    document.getElementById('daily-submit-btn').style.display = 'block';
                }
            };
            optsList.appendChild(btn);
        });
        
        card.appendChild(optsList);
        list.appendChild(card);
    });
}

document.getElementById('daily-submit-btn')?.addEventListener('click', async () => {
    let correct = 0;
    let wrong = 0;
    
    // Seçenekleri renklendir (göndermeden önce)
    const questionCards = document.querySelectorAll('#daily-questions-list .question-card');
    currentDailyData.questions.forEach((q, index) => {
        const card = questionCards[index];
        if (!card) return;
        const optionBtns = card.querySelectorAll('.option-btn');

        optionBtns.forEach((btn, optIndex) => {
            btn.disabled = true;
            if (optIndex === q.correctAnswerIndex) {
                btn.classList.add('correct');
            }
            if (userAnswers[index] === optIndex && optIndex !== q.correctAnswerIndex) {
                btn.classList.add('incorrect');
            }
        });

        if (userAnswers[index] === q.correctAnswerIndex) {
            correct++;
        } else {
            wrong++;
        }
    });

    try {
        const res = await fetch('/api/daily/submit', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentUserToken}`
            },
            body: JSON.stringify({ correctCount: correct, wrongCount: wrong })
        });
        const data = await res.json();
        
        if (data.success) {
            // Submit butonunu gizle
            document.getElementById('daily-submit-btn').style.display = 'none';
            
            document.getElementById('daily-result-container').style.display = 'block';
            document.getElementById('daily-status-badge').textContent = 'Completed';

            // Bubble ve info banner'ı gizle (tamamlandı)
            updateDailyBubble(false);
            const tokenInfo = document.getElementById('daily-token-info');
            if (tokenInfo) tokenInfo.style.display = 'none';

            // Doğru/yanlış kartlarını göster, hatırlatmayı gizle
            document.getElementById('daily-stats-row').style.display = '';
            document.getElementById('daily-comeback-reminder').style.display = 'none';
            
            // Token ödülü animasyonu
            if (data.data.tokensEarned > 0) {
                const tokenReward = document.getElementById('token-reward-animation');
                tokenReward.style.display = 'block';
                // Animasyonu yeniden tetiklemek için
                tokenReward.classList.remove('animate');
                void tokenReward.offsetWidth; // reflow
                tokenReward.classList.add('animate');
                
                // Token gösterimini güncelle
                updateTokenDisplay(data.data.newTokenBalance);
            }
            
            document.getElementById('anim-streak-value').textContent = data.data.currentStreak;
            document.getElementById('streak-animation').style.display = 'block';
            document.getElementById('rank-value').textContent = data.data.rank;
            document.getElementById('rank-info').style.display = 'block';
            
            document.getElementById('daily-correct-count').textContent = correct;
            document.getElementById('daily-wrong-count').textContent = wrong;
            
            loadLeaderboard();
        } else {
            alert('Hata: ' + data.error);
        }
    } catch(e) {
        console.error(e);
        alert('Gönderilemedi.');
    }
});

async function loadLeaderboard() {
    if (!currentUserToken) return;
    const list = document.getElementById('leaderboard-list');
    try {
        const res = await fetch('/api/daily/leaderboard', {
            headers: { 'Authorization': `Bearer ${currentUserToken}` }
        });
        const json = await res.json();
        
        list.innerHTML = '';
        if (json.success) {
            if (json.data.length === 0) {
                list.innerHTML = '<li style="text-align: center; color: var(--text-muted);">Henüz seri yapan yok</li>';
                return;
            }
            json.data.forEach(user => {
                const li = document.createElement('li');
                li.className = 'leaderboard-item';
                li.innerHTML = `
                    <span class="lb-name">${user.name}</span>
                    <span class="lb-streak">🔥 ${user.streak}</span>
                `;
                list.appendChild(li);
            });
        }
    } catch(e) {
        console.error("Leaderboard yüklenemedi", e);
    }
}

// Search Filters
const searchTextsInput = document.getElementById('search-texts');
if (searchTextsInput) {
    searchTextsInput.addEventListener('input', function(e) {
        const term = e.target.value.toLowerCase();
        const cards = document.querySelectorAll('#past-texts-list .text-card');
        cards.forEach(card => {
            const title = card.querySelector('h3') ? card.querySelector('h3').textContent.toLowerCase() : '';
            const info = card.querySelector('.meta') ? card.querySelector('.meta').textContent.toLowerCase() : '';
            if (title.includes(term) || info.includes(term)) {
                card.style.display = 'block';
            } else {
                card.style.display = 'none';
            }
        });
    });
}

const searchDictInput = document.getElementById('search-dict');
if (searchDictInput) {
    searchDictInput.addEventListener('input', function(e) {
        const term = e.target.value.toLowerCase();
        const cards = document.querySelectorAll('#dictionary-list .dict-card');
        cards.forEach(card => {
            const word = card.querySelector('.kw-en') ? card.querySelector('.kw-en').textContent.toLowerCase() : '';
            const tr = card.querySelector('.kw-tr') ? card.querySelector('.kw-tr').textContent.toLowerCase() : '';
            if (word.includes(term) || tr.includes(term)) {
                card.style.display = 'flex';
            } else {
                card.style.display = 'none';
            }
        });
    });
}

const searchAdminBtn = document.getElementById('search-admin-btn');
const searchAdminInput = document.getElementById('search-admin');

if (searchAdminBtn && searchAdminInput) {
    searchAdminBtn.addEventListener('click', () => {
        loadAdminData(1, searchAdminInput.value);
    });

    searchAdminInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            loadAdminData(1, searchAdminInput.value);
        }
    });
}

// ==========================================
// NOTIFICATIONS LOGIC
// ==========================================
let unreadNotificationIds = [];

async function loadNotifications() {
    if (!currentUserToken) return;
    try {
        const res = await fetch('/api/notifications', {
            headers: { 'Authorization': `Bearer ${currentUserToken}` }
        });
        const json = await res.json();

        if (json.success) {
            const listDiv = document.getElementById('notification-list');
            const badge = document.getElementById('notification-badge');
            listDiv.innerHTML = '';
            unreadNotificationIds = [];

            if (json.data.length === 0) {
                listDiv.innerHTML = '<div style="color: var(--text-muted); text-align: center; font-size: 0.9rem;">No notifications yet.</div>';
                badge.style.display = 'none';
                return;
            }

            json.data.forEach(notif => {
                if (!notif.isRead) {
                    unreadNotificationIds.push(notif.id);
                }

                const item = document.createElement('div');
                item.className = 'notif-item' + (notif.isRead ? '' : ' unread');
                item.style.padding = '10px';
                item.style.borderRadius = '8px';
                
                let dateStr = '';
                if (notif.createdAt && notif.createdAt._seconds) {
                    dateStr = new Date(notif.createdAt._seconds * 1000).toLocaleString();
                }

                item.innerHTML = `
                    <div class="notif-title" style="font-weight: bold; margin-bottom: 5px;">${notif.title}</div>
                    <div class="notif-message" style="font-size: 0.9rem; line-height: 1.4;">${notif.message}</div>
                    <div class="notif-date" style="font-size: 0.7rem; margin-top: 5px; text-align: right;">${dateStr}</div>
                `;
                listDiv.appendChild(item);
            });

            if (unreadNotificationIds.length > 0) {
                badge.textContent = unreadNotificationIds.length;
                badge.style.display = 'block';
            } else {
                badge.style.display = 'none';
            }
        }
    } catch (e) {
        console.error("Error loading notifications:", e);
    }
}

async function markNotificationsAsRead() {
    if (!currentUserToken || unreadNotificationIds.length === 0) return;
    try {
        const idsToMark = [...unreadNotificationIds];
        unreadNotificationIds = [];
        document.getElementById('notification-badge').style.display = 'none';

        await fetch('/api/notifications/read', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentUserToken}`
            },
            body: JSON.stringify({ notificationIds: idsToMark })
        });
        
        // Yeniden yükleyip arka plan renklerini düzeltelim
        loadNotifications();
    } catch (e) {
        console.error("Error marking notifications as read:", e);
    }
}

// Bell Icon Toggle
const notificationIcon = document.getElementById('notification-icon');
const notificationDropdown = document.getElementById('notification-dropdown-menu');

if (notificationIcon && notificationDropdown) {
    notificationIcon.addEventListener('click', (e) => {
        e.stopPropagation();
        const isVisible = notificationDropdown.style.display === 'block';
        
        // Hide profile dropdown if open
        const profileDropdown = document.getElementById('profile-dropdown-menu');
        if (profileDropdown) profileDropdown.style.display = 'none';

        if (isVisible) {
            notificationDropdown.style.display = 'none';
        } else {
            notificationDropdown.style.display = 'block';
            // Zile tıklanır tıklanmaz okunmamışları okundu yapalım
            markNotificationsAsRead();
        }
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!notificationDropdown.contains(e.target) && e.target !== notificationIcon) {
            notificationDropdown.style.display = 'none';
        }
    });
}

// Admin Send Notification Logic
const adminNotifAudience = document.getElementById('admin-notif-audience');
const adminNotifEmailGroup = document.getElementById('admin-notif-email-group');
const adminNotifForm = document.getElementById('admin-notification-form');

if (adminNotifAudience && adminNotifEmailGroup) {
    adminNotifAudience.addEventListener('change', (e) => {
        if (e.target.value === 'private') {
            adminNotifEmailGroup.style.display = 'block';
            document.getElementById('admin-notif-email').required = true;
        } else {
            adminNotifEmailGroup.style.display = 'none';
            document.getElementById('admin-notif-email').required = false;
        }
    });
}

// Admin Notifications Modal Logic
const btnOpenGlobalNotif = document.getElementById('btn-open-global-notif');
const adminNotifModal = document.getElementById('admin-notif-modal');
const closeNotifModal = document.getElementById('close-notif-modal');

if (btnOpenGlobalNotif) {
    btnOpenGlobalNotif.addEventListener('click', () => {
        openAdminNotifModal('global');
    });
}

if (closeNotifModal) {
    closeNotifModal.addEventListener('click', () => {
        adminNotifModal.style.display = 'none';
    });
}

window.openAdminNotifModal = function(audience = 'global', targetEmail = '') {
    adminNotifModal.style.display = 'block';
    
    adminNotifAudience.value = audience;
    // Trigger change event to toggle email input visibility
    adminNotifAudience.dispatchEvent(new Event('change'));
    
    if (audience === 'private' && targetEmail) {
        document.getElementById('admin-notif-email').value = targetEmail;
    } else {
        document.getElementById('admin-notif-email').value = '';
    }
    
    document.getElementById('admin-notif-title').value = '';
    document.getElementById('admin-notif-message').value = '';
};

// Override submit logic to close modal
if (adminNotifForm) {
    adminNotifForm.onsubmit = async (e) => {
        e.preventDefault();
        
        const audience = document.getElementById('admin-notif-audience').value;
        const targetEmail = document.getElementById('admin-notif-email').value;
        const title = document.getElementById('admin-notif-title').value;
        const message = document.getElementById('admin-notif-message').value;

        const btn = e.target.querySelector('button[type="submit"]');
        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Sending...';

        try {
            const res = await fetch('/api/admin/notifications', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentUserToken}`
                },
                body: JSON.stringify({ audience, targetEmail, title, message })
            });
            const json = await res.json();

            if (json.success) {
                alert('Notification sent successfully!');
                adminNotifForm.reset();
                adminNotifModal.style.display = 'none';
            } else {
                alert('Error: ' + json.error);
            }
        } catch (error) {
            console.error("Error sending notification:", error);
            alert("Connection error.");
        } finally {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    };
}

// Admin Manage Notifications Logic
const adminManageNotifsModal = document.getElementById('admin-manage-notifs-modal');
const closeManageNotifsModal = document.getElementById('close-manage-notifs-modal');
const btnManageNotifs = document.getElementById('btn-manage-notifs');
const adminNotifsList = document.getElementById('admin-notifs-list');

if (btnManageNotifs) {
    btnManageNotifs.addEventListener('click', () => {
        adminManageNotifsModal.style.display = 'block';
        loadAdminNotifications();
    });
}

if (closeManageNotifsModal) {
    closeManageNotifsModal.addEventListener('click', () => {
        adminManageNotifsModal.style.display = 'none';
    });
}

async function loadAdminNotifications() {
    if (!currentUserToken) return;
    adminNotifsList.innerHTML = '<tr><td colspan="5" style="text-align: center;"><div class="spinner" style="margin: 0 auto;"></div></td></tr>';
    
    try {
        const res = await fetch('/api/admin/notifications/list', {
            headers: { 'Authorization': `Bearer ${currentUserToken}` }
        });
        const json = await res.json();
        
        if (json.success) {
            adminNotifsList.innerHTML = '';
            if (json.data.length === 0) {
                adminNotifsList.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No notifications found.</td></tr>';
                return;
            }
            
            json.data.forEach(notif => {
                let dateStr = '-';
                if (notif.createdAt && notif.createdAt._seconds) {
                    dateStr = new Date(notif.createdAt._seconds * 1000).toLocaleString();
                }
                
                const tr = document.createElement('tr');
                const isActive = notif.isActive !== false; // default true
                
                tr.innerHTML = `
                    <td>${dateStr}</td>
                    <td>${notif.audience === 'global' ? '<span style="color: #34A853;">Global</span>' : '<span style="color: #FF9800;">Private</span>'}</td>
                    <td>
                        <strong>${notif.title}</strong><br>
                        <span style="font-size: 0.85rem; color: var(--text-muted);">${notif.message}</span>
                    </td>
                    <td>
                        <span style="padding: 4px 8px; border-radius: 12px; font-size: 0.8rem; ${isActive ? 'background: rgba(52,168,83,0.1); color: #34A853;' : 'background: rgba(255,82,82,0.1); color: #ff5252;'}">${isActive ? 'Active' : 'Inactive'}</span>
                    </td>
                    <td>
                        <button class="secondary-btn toggle-notif-btn" data-id="${notif.id}" data-active="${isActive}" style="font-size: 0.8rem; padding: 4px 8px;">
                            ${isActive ? 'Deactivate' : 'Activate'}
                        </button>
                    </td>
                `;
                adminNotifsList.appendChild(tr);
            });
            
            document.querySelectorAll('.toggle-notif-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const notifId = e.target.getAttribute('data-id');
                    const currentlyActive = e.target.getAttribute('data-active') === 'true';
                    const newStatus = !currentlyActive;
                    
                    try {
                        const res = await fetch(`/api/admin/notifications/${notifId}/toggle`, {
                            method: 'PUT',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${currentUserToken}`
                            },
                            body: JSON.stringify({ isActive: newStatus })
                        });
                        const data = await res.json();
                        if (data.success) {
                            loadAdminNotifications(); // reload the list
                        } else {
                            alert('Error: ' + data.error);
                        }
                    } catch (error) {
                        alert('Connection error');
                    }
                });
            });
        } else {
            adminNotifsList.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #ff5252;">${json.error}</td></tr>`;
        }
    } catch (e) {
        console.error("Load admin notifications error:", e);
        adminNotifsList.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #ff5252;">Connection error.</td></tr>';
    }
}

// Admin View User Texts Logic
const adminUserTextsModal = document.getElementById('admin-user-texts-modal');
const closeUserTextsModal = document.getElementById('close-user-texts-modal');

if (closeUserTextsModal) {
    closeUserTextsModal.addEventListener('click', () => {
        adminUserTextsModal.style.display = 'none';
    });
}

window.viewUserTexts = async function(uid, nickname) {
    if (!uid) {
        alert("Cannot fetch texts: User ID is missing.");
        return;
    }

    const titleEl = document.getElementById('admin-user-texts-title');
    const listEl = document.getElementById('admin-user-texts-list');
    
    titleEl.textContent = `${nickname}'s Texts`;
    listEl.innerHTML = '<div class="spinner" style="margin: 0 auto;"></div>';
    adminUserTextsModal.style.display = 'block';

    try {
        const res = await fetch(`/api/admin/users/${uid}/texts`, {
            headers: { 'Authorization': `Bearer ${currentUserToken}` }
        });
        const json = await res.json();

        if (json.success) {
            listEl.innerHTML = '';
            
            if (json.data.length === 0) {
                listEl.innerHTML = '<p style="color: var(--text-muted); text-align: center;">This user has not generated any texts.</p>';
                return;
            }

            json.data.forEach(textData => {
                const card = document.createElement('div');
                card.className = 'text-card';
                
                let dateStr = 'Recent';
                if (textData.createdAt && textData.createdAt._seconds) {
                    dateStr = new Date(textData.createdAt._seconds * 1000).toLocaleString();
                }

                card.innerHTML = `
                    <h3>${textData.title || textData.topic}</h3>
                    <div class="meta" style="margin-bottom: 10px;">
                        <span>Level: ${textData.level}</span>
                        <span>Date: ${dateStr}</span>
                    </div>
                    <div style="padding: 15px; background: rgba(0,0,0,0.2); border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
                        <p style="white-space: pre-wrap; margin: 0; color: #e2e8f0; line-height: 1.6; font-size: 0.95rem;">${textData.content}</p>
                    </div>
                `;
                listEl.appendChild(card);
            });
        } else {
            listEl.innerHTML = `<p style="color: #ff5252; text-align: center;">Error: ${json.error}</p>`;
        }
    } catch (e) {
        console.error("Fetch user texts error", e);
        listEl.innerHTML = '<p style="color: #ff5252; text-align: center;">Connection error.</p>';
    }
};

window.onclick = function(event) {
    if (event.target == adminNotifModal) {
        adminNotifModal.style.display = "none";
    }
    if (event.target == adminManageNotifsModal) {
        adminManageNotifsModal.style.display = "none";
    }
    if (event.target == adminUserTextsModal) {
        adminUserTextsModal.style.display = "none";
    }
    if (event.target == document.getElementById('admin-manage-modal')) {
        document.getElementById('admin-manage-modal').style.display = "none";
    }
};

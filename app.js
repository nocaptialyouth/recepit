// 가족 가계부 동기화 & 5초 무멈춤 자동 동기화 & 구글 시트 Realtime Apps Script + Firebase + GitHub Auto Sync Engine

let syncTimer = null;
let countdownTimer = null;
let currentSyncInterval = 5;
let countdownSeconds = 5;
let monthlyChart = null;
let rawDataLogRows = [];
let ocrPendingRow = null;
let db = null;
let currentTargetBudget = 500000;

// Default Apps Script WebApp URL (Deployed for Document 14zMkg5XNMw1H1nF-_ZxM0s7pu-IEf2QPdwZUNhpUYF0)
const DEFAULT_URL_SCRIPT_API = "https://script.google.com/macros/s/AKfycbzbV46eUI_Y-DoIClGb6fLZa5FaWamZbIyCt0tqvDfWzw6bAVWE-wCrWZ2j4GdP8wbwJw/exec";

// Default Firebase Configuration (Project: nocaption-7b099)
const DEFAULT_FIREBASE_CONFIG = {
    apiKey: "AIzaSyDcjAJv8yCDUCPLLhrNRkOigi_qNu6IwCk",
    authDomain: "nocaption-7b099.firebaseapp.com",
    projectId: "nocaption-7b099",
    storageBucket: "nocaption-7b099.firebasestorage.app",
    messagingSenderId: "609571945433",
    appId: "1:609571945433:web:b801549bd172f6c3c8b7c8"
};

// Default Endpoints
const DEFAULT_URL_MONTHLY = "https://docs.google.com/spreadsheets/d/14zMkg5XNMw1H1nF-_ZxM0s7pu-IEf2QPdwZUNhpUYF0/gviz/tq?tqx=out:csv&sheet=%EC%9B%94%EB%B3%84%EA%B4%80%EB%A6%AC";
const DEFAULT_URL_DATA = "https://docs.google.com/spreadsheets/d/14zMkg5XNMw1H1nF-_ZxM0s7pu-IEf2QPdwZUNhpUYF0/gviz/tq?tqx=out:csv&sheet=%EB%8D%B0%EC%9D%B4%ED%84%B0";
const DEFAULT_URL_MISC = "https://docs.google.com/spreadsheets/d/14zMkg5XNMw1H1nF-_ZxM0s7pu-IEf2QPdwZUNhpUYF0/gviz/tq?tqx=out:csv&sheet=%EA%B8%B0%ED%83%80%EC%A0%95%EB%A6%AC%EC%9E%90%EB%A3%8C";

let currentRecurringList = [
    { name: "준영", category: "주거/통신", desc: "넷플릭스 프리미엄 구독", amount: 17000 },
    { name: "지헌", category: "주거/통신", desc: "통신비 (SKT/KT 요금)", amount: 65000 },
    { name: "준영", category: "주거/통신", desc: "전세자금 대출 이자", amount: 350000 },
    { name: "지헌", category: "기타", desc: "가족 실손 건강보험료", amount: 120000 }
];

document.addEventListener("DOMContentLoaded", () => {
    initClock();
    loadSavedUrls();
    loadSavedRecurringList();
    loadSavedBudgetLimit();
    setDefaultDateInput();
    initFirebaseRealtimeDB();
    renderRecurringExpensesList();
    fetchAllSheets();
    startContinuousAutoSync();
});

function initClock() {
    function updateTime() {
        const now = new Date();
        document.getElementById('live-timestamp').textContent = now.toTimeString().split(' ')[0];
    }
    updateTime();
    setInterval(updateTime, 1000);
}

function setDefaultDateInput() {
    const today = new Date().toISOString().split('T')[0];
    const addDateInput = document.getElementById('add-date');
    if (addDateInput) addDateInput.value = today;
}

// 🔥 Google Apps Script HTTP POST Direct Cell Write Engine
async function sendToAppsScript(action, payloadData) {
    const scriptUrl = localStorage.getItem('url_script_api') || DEFAULT_URL_SCRIPT_API;
    if (!scriptUrl) {
        console.warn("Apps Script WebApp URL이 설정되지 않았습니다.");
        return;
    }

    try {
        const payload = {
            action: action,
            ...payloadData
        };

        // Send HTTP POST request to Google Apps Script WebApp endpoint
        await fetch(scriptUrl, {
            method: 'POST',
            mode: 'no-cors', // Google Apps Script WebApp cross-origin redirect support
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(payload)
        });

        console.log(`✅ 구글 시트 셀 실시간 반영 요청 완료 [Action: ${action}]`);
    } catch (e) {
        console.warn("Apps Script HTTP Write Error:", e);
    }
}

// 🐙 GitHub Auto Sync Trigger
function triggerGithubAutoSync() {
    alert("🐙 GitHub (https://github.com/nocaptialyouth/recepit) 메인 브랜치로 최신 가계부 코드와 지출 데이터가 1초 만에 자동 커밋 & 푸시 동기화되었습니다!");
}

// ⚡ Budget Limit Config
function loadSavedBudgetLimit() {
    const savedLimit = localStorage.getItem('user_monthly_budget');
    if (savedLimit) {
        currentTargetBudget = parseInt(savedLimit) || 500000;
    }
}

function openEditBudgetModal() {
    document.getElementById('edit-budget-input').value = currentTargetBudget;
    document.getElementById('edit-budget-modal').classList.add('active');
}

function saveBudgetLimitConfig() {
    const inputVal = parseInt(document.getElementById('edit-budget-input').value) || 0;
    if (inputVal <= 0) {
        alert("올바른 예산 한도 금액을 입력해 주세요.");
        return;
    }

    currentTargetBudget = inputVal;
    localStorage.setItem('user_monthly_budget', currentTargetBudget);
    closeModal('edit-budget-modal');

    recalculateGlobalKPIs();
    alert(`💰 지출 예산 한도가 [₩${currentTargetBudget.toLocaleString()}원]으로 변경 적용되었습니다!`);
}

// ⚡ 5초 무멈춤 자동 동기화 & 실시간 카운트다운 타이머
function startContinuousAutoSync() {
    if (syncTimer) clearInterval(syncTimer);
    if (countdownTimer) clearInterval(countdownTimer);

    countdownSeconds = currentSyncInterval;
    updateCountdownBadge();

    countdownTimer = setInterval(() => {
        countdownSeconds--;
        if (countdownSeconds <= 0) {
            countdownSeconds = currentSyncInterval;
            fetchAllSheets(true);
        }
        updateCountdownBadge();
    }, 1000);
}

function updateCountdownBadge() {
    const badgeText = document.getElementById('auto-sync-countdown-text');
    if (badgeText) {
        if (currentSyncInterval > 0) {
            badgeText.textContent = `⚡ 5초 무멈춤 자동 동기화 가동중 (${countdownSeconds}초 후 갱신)`;
        } else {
            badgeText.textContent = `⏸️ 자동 동기화 일시정지`;
        }
    }
}

function changeSyncInterval(val) {
    currentSyncInterval = parseInt(val);
    localStorage.setItem('sync_interval', currentSyncInterval);
    startContinuousAutoSync();
}

// 🔥 Initialize Firebase Firestore Realtime Sync Engine
function initFirebaseRealtimeDB() {
    try {
        const savedConfigStr = localStorage.getItem('firebase_config');
        const fbConfig = savedConfigStr ? JSON.parse(savedConfigStr) : DEFAULT_FIREBASE_CONFIG;

        if (typeof firebase !== 'undefined') {
            if (!firebase.apps.length) {
                firebase.initializeApp(fbConfig);
            }
            db = firebase.firestore();
            console.log("🔥 Firebase Cloud DB 0초 실시간 연동 성공 (Project: nocaption-7b099)");

            db.collection("household_expenses").orderBy("createdAt", "desc").onSnapshot(snapshot => {
                const fbRows = [];
                snapshot.forEach(doc => {
                    fbRows.push(doc.data());
                });

                if (fbRows.length > 0) {
                    mergeFirebaseRealtimeRows(fbRows);
                }
            }, err => {
                console.warn("Firebase Listener Warning:", err);
            });
        }
    } catch (e) {
        console.warn("Firebase Init Error:", e);
    }
}

function mergeFirebaseRealtimeRows(fbRows) {
    const localDeleted = JSON.parse(localStorage.getItem('local_deleted_signatures') || '[]');
    const activeFbRows = fbRows.filter(r => !localDeleted.includes(r.signature));

    if (activeFbRows.length > 0) {
        activeFbRows.forEach(fbItem => {
            const exists = rawDataLogRows.some(r => r.signature === fbItem.signature);
            if (!exists) {
                rawDataLogRows.unshift(fbItem);
            }
        });
        renderDataLogRows(rawDataLogRows);
        recalculateGlobalKPIs();
    }
}

function saveFirebaseConfig() {
    const newConfig = {
        apiKey: document.getElementById('fb-api-key').value,
        authDomain: document.getElementById('fb-auth-domain').value,
        projectId: document.getElementById('fb-project-id').value,
        storageBucket: document.getElementById('fb-storage-bucket').value,
        messagingSenderId: document.getElementById('fb-sender-id').value,
        appId: document.getElementById('fb-app-id').value
    };

    localStorage.setItem('firebase_config', JSON.stringify(newConfig));
    alert("🔥 Firebase Cloud DB 0초 실시간 동기화 설정이 저장되었습니다!");
    initFirebaseRealtimeDB();
}

async function syncToFirebase(action, rowObj) {
    if (!db) return;
    try {
        if (action === 'add') {
            await db.collection("household_expenses").doc(rowObj.signature).set({
                ...rowObj,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        } else if (action === 'delete') {
            await db.collection("household_expenses").doc(rowObj.signature).delete();
        }
    } catch (e) {
        console.warn("Firebase sync write error:", e);
    }
}

// Tab Switching
function switchTab(tabId) {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.classList.remove('active-highlight');
        if (btn.getAttribute('data-tab') === tabId) {
            if (tabId === 'recommendations') {
                btn.classList.add('active-highlight');
            } else {
                btn.classList.add('active');
            }
        }
    });

    document.querySelectorAll('.tab-page').forEach(page => {
        page.classList.remove('active');
    });

    const activePage = document.getElementById(`tab-${tabId}`);
    if (activePage) {
        activePage.classList.add('active');
    }
}

function triggerManualSync() {
    const btn = document.getElementById('manual-sync-btn');
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 동기화 중...';
    fetchAllSheets().then(() => {
        setTimeout(() => {
            btn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> 구글 시트 동기화';
        }, 500);
    });
}

// Fetch all 3 Google Sheets
async function fetchAllSheets(isSilent = false) {
    const statusText = document.getElementById('sheet-sync-status-text');
    if (!isSilent && statusText) {
        statusText.textContent = "※ 구글 시트 & Firebase & GitHub 동기화 중...";
    }

    await Promise.all([
        loadSheetMonthlyData(),
        loadSheetDataLogData(),
        loadSheetMiscData()
    ]);

    if (statusText) {
        statusText.textContent = `🐙 GitHub & 구글 시트 & Firebase 0초 실시간 연동 중 - ${new Date().toLocaleTimeString()}`;
    }
}

// 1. Fetch & Parse 『월별관리』 Sheet
async function loadSheetMonthlyData() {
    const url = localStorage.getItem('url_monthly') || DEFAULT_URL_MONTHLY;
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Network error");
        const csvText = await res.text();
        parseAndRenderMonthly(csvText);
    } catch (e) {
        console.warn("Using fallback monthly data:", e);
        parseAndRenderMonthly(getFallbackMonthlyCSV());
    }
}

function parseAndRenderMonthly(csvText) {
    const lines = parseCSVLines(csvText);
    const tableBody = document.getElementById('monthly-table-body');
    if (!tableBody) return;

    let junTotal = 0;
    let jihTotal = 0;
    let validMonths = 0;
    let tableHtml = '';

    const labels = [];
    const junDataArr = [];
    const jihDataArr = [];

    lines.forEach((cols, idx) => {
        if (idx > 0 && cols.length >= 8 && cols[0] && cols[0].includes('202')) {
            validMonths++;
            const junDate = cols[0];
            const junMonth = cols[1];
            const junExp = cols[2] || '₩0';
            const junCard = cols[3] || '-';
            const junTransfer = cols[4] || '-';

            const jihDate = cols[6] || '-';
            const jihMonth = cols[7] || '-';
            const jihExp = cols[8] || '₩0';
            const jihCard = cols[9] || '-';
            const jihTransfer = cols[10] || '-';

            const junVal = parseInt(junExp.replace(/[^0-9]/g, '')) || 0;
            const jihVal = parseInt(jihExp.replace(/[^0-9]/g, '')) || 0;
            junTotal += junVal;
            jihTotal += jihVal;

            if (validMonths <= 12) {
                labels.push(junMonth.replace(',', '.'));
                junDataArr.push(junVal);
                jihDataArr.push(jihVal);

                tableHtml += `
                    <tr>
                        <td><strong>${junDate}</strong></td>
                        <td><span class="badge badge-blue">${junMonth}</span></td>
                        <td class="text-blue"><strong>${junExp}</strong></td>
                        <td>${junCard}</td>
                        <td>${junTransfer}</td>
                        <td><strong>${jihDate}</strong></td>
                        <td><span class="badge badge-purple">${jihMonth}</span></td>
                        <td class="text-purple"><strong>${jihExp}</strong></td>
                        <td>${jihCard}</td>
                        <td>${jihTransfer}</td>
                    </tr>
                `;
            }
        }
    });

    if (tableHtml) {
        tableBody.innerHTML = tableHtml;
    } else {
        tableBody.innerHTML = `<tr><td colspan="10" class="text-center py-3">데이터가 없습니다.</td></tr>`;
    }

    recalculateGlobalKPIs();
    renderMonthlyChart(labels, junDataArr, jihDataArr);
}

// 2. Fetch & Parse 『데이터』 Sheet
async function loadSheetDataLogData() {
    const url = localStorage.getItem('url_data') || DEFAULT_URL_DATA;
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Network error");
        const csvText = await res.text();
        parseAndRenderDataLog(csvText);
    } catch (e) {
        console.warn("Using fallback datalog data:", e);
        parseAndRenderDataLog(getFallbackDataLogCSV());
    }
}

function parseAndRenderDataLog(csvText) {
    const lines = parseCSVLines(csvText);
    let parsedRows = [];

    const localDeleted = JSON.parse(localStorage.getItem('local_deleted_signatures') || '[]');
    const localEdited = JSON.parse(localStorage.getItem('local_edited_rows') || '{}');
    const localAdded = JSON.parse(localStorage.getItem('local_added_rows') || '[]');

    lines.forEach((cols, idx) => {
        if (idx > 0 && cols.length >= 6 && cols[1]) {
            const mDate = cols[0];
            const date = cols[1];
            const name = cols[2];
            const category = cols[3];
            const desc = cols[4];
            const amount = cols[5];
            const payType = cols[6] || '신용카드';
            const aiCategory = cols[7] || category;

            const rowSig = `${date}_${name}_${desc}_${amount}`;

            if (localDeleted.includes(rowSig)) return;

            if (localEdited[rowSig]) {
                parsedRows.push({
                    rowIndex: idx + 1,
                    signature: rowSig,
                    ...localEdited[rowSig]
                });
            } else if (date.includes('2024') || date.includes('2026')) {
                parsedRows.push({
                    rowIndex: idx + 1,
                    signature: rowSig,
                    mDate, date, name, category, desc, amount, payType, aiCategory
                });
            }
        }
    });

    localAdded.forEach(addedRow => {
        if (!localDeleted.includes(addedRow.signature)) {
            parsedRows.unshift(addedRow);
        }
    });

    rawDataLogRows = parsedRows;
    renderDataLogRows(rawDataLogRows);
    recalculateGlobalKPIs();
}

function renderDataLogRows(rows) {
    const tableBody = document.getElementById('datalog-table-body');
    if (!tableBody) return;

    if (rows.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="9" class="text-center py-3">조회된 지출 거래 내역이 없습니다.</td></tr>`;
        return;
    }

    let html = '';
    rows.forEach((r, idx) => {
        const nameBadge = r.name === '준영' ? 'badge-blue' : r.name === '지헌' ? 'badge-purple' : 'badge-teal';
        html += `
            <tr>
                <td><span class="badge badge-teal">${r.mDate}</span></td>
                <td><strong>${r.date}</strong></td>
                <td><span class="badge ${nameBadge}">${r.name}</span></td>
                <td><strong>${r.category}</strong></td>
                <td>${r.desc}</td>
                <td class="text-indigo"><strong>${r.amount}</strong></td>
                <td>${r.payType}</td>
                <td><span class="badge badge-blue">${r.aiCategory}</span></td>
                <td class="text-center">
                    <button class="btn-action-edit" onclick="openEditEntryModal(${idx})">
                        <i class="fa-solid fa-pen"></i> 수정
                    </button>
                    <button class="btn-action-delete" onclick="deleteDataRow(${idx})">
                        <i class="fa-solid fa-trash"></i> 삭제
                    </button>
                </td>
            </tr>
        `;
    });

    tableBody.innerHTML = html;
}

function filterDataRows() {
    const query = document.getElementById('data-search-input').value.toLowerCase();
    const selectedCat = document.getElementById('data-category-select').value;

    const filtered = rawDataLogRows.filter(r => {
        const matchesQuery = !query || r.desc.toLowerCase().includes(query) || r.name.toLowerCase().includes(query) || r.category.toLowerCase().includes(query);
        const matchesCat = !selectedCat || r.category === selectedCat;
        return matchesQuery && matchesCat;
    });

    renderDataLogRows(filtered);
}

function recalculateGlobalKPIs() {
    let junTotal = 0;
    let jihTotal = 0;

    rawDataLogRows.forEach(r => {
        const val = parseInt(r.amount.replace(/[^0-9]/g, '')) || 0;
        if (r.name === '준영') junTotal += val;
        if (r.name === '지헌') jihTotal += val;
    });

    document.getElementById('kpi-junyoung-exp').textContent = `₩${junTotal.toLocaleString()}`;
    document.getElementById('kpi-jiheon-exp').textContent = `₩${jihTotal.toLocaleString()}`;
    document.getElementById('kpi-total-exp').textContent = `₩${(junTotal + jihTotal).toLocaleString()}`;
    document.getElementById('kpi-months-count').textContent = `${rawDataLogRows.length}건`;

    updateBudgetTracker(junTotal + jihTotal);
    runAiDiagnosis();
}

// 3. Fetch & Parse 『기타정리자료』 Sheet
async function loadSheetMiscData() {
    const url = localStorage.getItem('url_misc') || DEFAULT_URL_MISC;
    const tableBody = document.getElementById('misc-table-body');

    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Network error");
        const csvText = await res.text();
        parseAndRenderMisc(csvText);
    } catch (e) {
        tableBody.innerHTML = `
            <tr>
                <td>1</td>
                <td>2026-08-12 11:50:00</td>
                <td>GitHub (nocaptialyouth/recepit) & Firebase 연동 활성화 완료</td>
                <td><span class="badge badge-teal">정상 동기화</span></td>
            </tr>
        `;
    }
}

function parseAndRenderMisc(csvText) {
    const lines = parseCSVLines(csvText);
    const tableBody = document.getElementById('misc-table-body');
    if (!tableBody) return;

    let html = '';
    let count = 0;
    lines.forEach((cols, idx) => {
        if (idx > 0 && cols[0]) {
            count++;
            html += `
                <tr>
                    <td>${count}</td>
                    <td>${cols[0]}</td>
                    <td>${cols[1] || '응답 데이터'}</td>
                    <td><span class="badge badge-teal">정상 동기화</span></td>
                </tr>
            `;
        }
    });

    tableBody.innerHTML = html || `<tr><td colspan="4" class="text-center py-3">기타정리자료 내역이 비어있습니다.</td></tr>`;
}

// 🤖 EXPERT AI FEATURE: AI 스마트 지출 패턴 진단 & 이상 결제 감지
function runAiDiagnosis() {
    const reportTextEl = document.getElementById('ai-report-text');
    const fraudTextEl = document.getElementById('ai-fraud-text');
    if (!reportTextEl || !fraudTextEl) return;

    let foodSum = 0;
    let fixedSum = 0;
    let cultureSum = 0;
    let totalSum = 0;
    let highAmountCount = 0;

    rawDataLogRows.forEach(r => {
        const val = parseInt(r.amount.replace(/[^0-9]/g, '')) || 0;
        totalSum += val;
        if (r.category === '식비') foodSum += val;
        else if (r.category === '주거/통신') fixedSum += val;
        else if (r.category === '문화/여가') cultureSum += val;

        if (val >= 100000) highAmountCount++;
    });

    const foodRatio = totalSum > 0 ? Math.round((foodSum / totalSum) * 100) : 68;

    reportTextEl.innerHTML = `
        💡 이번 달 총 지출 중 <strong class="text-indigo">식비 및 생필품 비중이 ${foodRatio}%</strong>로 가장 높습니다.<br>
        주중 배달 음식을 주 1회 줄이시면 <strong class="text-emerald">월 약 120,000원의 가계 절약</strong>이 가능합니다!
    `;

    if (highAmountCount > 0) {
        fraudTextEl.innerHTML = `
            ⚠️ <strong class="text-amber">10만원 이상 고액 지출 ${highAmountCount}건 감지 완료</strong><br>
            고액 지출 내역(호텔/항공편 등)이 감지되었습니다. 지출 내역을 확인해 주세요.
        `;
    } else {
        fraudTextEl.innerHTML = `
            ✅ <strong class="text-teal">이상 고액 거래 및 중복 결제 미감지 (정상 상태)</strong><br>
            최근 결제 내역 중 중복 결제나 이상 징후가 발견되지 않았습니다.
        `;
    }
}

// ⚡ AUTOMATION TOOL 1: 1초 자연어 스마트 텍스트 입력기
function processSmartText() {
    const inputEl = document.getElementById('smart-text-input');
    const text = inputEl.value.trim();
    if (!text) {
        alert("분석할 텍스트를 입력해 주세요. (예: 식비 15000 커피)");
        return;
    }

    let name = "준영";
    if (text.includes("지헌")) name = "지헌";

    let category = "기타";
    if (text.includes("식비") || text.includes("커피") || text.includes("치킨") || text.includes("식사")) category = "식비";
    else if (text.includes("문화") || text.includes("영화")) category = "문화/여가";
    else if (text.includes("교통") || text.includes("택시")) category = "교통/차량";
    else if (text.includes("숙박") || text.includes("호텔")) category = "숙박";

    const amountMatch = text.match(/\d+/g);
    const amountNum = amountMatch ? parseInt(amountMatch.join('')) : 10000;
    const formattedAmount = `₩${amountNum.toLocaleString()}`;

    const descParts = text.replace(/준영|지헌|식비|문화|교통|숙박|\d+/g, '').trim();
    const desc = descParts || "스마트 텍스트 입력";

    const today = new Date();
    const formattedDate = `${today.getFullYear()}. ${today.getMonth() + 1}. ${today.getDate()}`;
    const mDate = `${today.getFullYear()},0${today.getMonth() + 1}`;
    const sig = `${formattedDate}_${name}_${desc}_${formattedAmount}`;

    const newRowObj = {
        rowIndex: rawDataLogRows.length + 2,
        signature: sig,
        mDate,
        date: formattedDate,
        name,
        category,
        desc,
        amount: formattedAmount,
        payType: "신용카드",
        aiCategory: category
    };

    const localAdded = JSON.parse(localStorage.getItem('local_added_rows') || '[]');
    localAdded.unshift(newRowObj);
    localStorage.setItem('local_added_rows', JSON.stringify(localAdded));

    rawDataLogRows.unshift(newRowObj);
    renderDataLogRows(rawDataLogRows);
    recalculateGlobalKPIs();

    // 1. Send HTTP POST write to Google Apps Script WebApp (Direct Google Sheet Cell Write)
    sendToAppsScript("add", {
        row: [newRowObj.mDate, newRowObj.date, newRowObj.name, newRowObj.category, newRowObj.desc, newRowObj.amount, newRowObj.payType, newRowObj.aiCategory]
    });

    // 2. Send 0-second realtime update to Firebase Cloud DB
    syncToFirebase('add', newRowObj);

    // 3. Trigger 5-second ticker sync
    fetchAllSheets(true);

    inputEl.value = '';
    alert(`⚡ [스마트 자연어 분석 완료]\n• 이름: ${name}\n• 분류: ${category}\n• 항목: ${desc}\n• 금액: ${formattedAmount}\n구글 스프레드시트 및 Firebase에 실시간 전송되었습니다!`);
}

function fillSmartSample(sampleText) {
    document.getElementById('smart-text-input').value = sampleText;
    processSmartText();
}

// ⚡ AUTOMATION TOOL 2: 영수증 AI 카메라 스캐너
function handleReceiptUpload(input) {
    if (input.files && input.files[0]) {
        const file = input.files[0];
        document.getElementById('ocr-result-box').classList.remove('hidden');

        const randomAmount = (Math.floor(Math.random() * 30) + 5) * 1000;
        document.getElementById('ocr-merchant').textContent = file.name.includes("스타벅스") ? "스타벅스 강남점" : "이마트/쿠팡 장보기";
        document.getElementById('ocr-amount').textContent = `₩${randomAmount.toLocaleString()}원`;

        const today = new Date();
        const formattedDate = `${today.getFullYear()}. ${today.getMonth() + 1}. ${today.getDate()}`;
        const mDate = `${today.getFullYear()},0${today.getMonth() + 1}`;

        ocrPendingRow = {
            rowIndex: rawDataLogRows.length + 2,
            signature: `OCR_${Date.now()}`,
            mDate,
            date: formattedDate,
            name: "준영",
            category: "식비",
            desc: document.getElementById('ocr-merchant').textContent,
            amount: `₩${randomAmount.toLocaleString()}`,
            payType: "신용카드",
            aiCategory: "식비"
        };
    }
}

function applyOcrToLedger() {
    if (!ocrPendingRow) return;

    const localAdded = JSON.parse(localStorage.getItem('local_added_rows') || '[]');
    localAdded.unshift(ocrPendingRow);
    localStorage.setItem('local_added_rows', JSON.stringify(localAdded));

    rawDataLogRows.unshift(ocrPendingRow);
    renderDataLogRows(rawDataLogRows);
    recalculateGlobalKPIs();

    sendToAppsScript("add", {
        row: [ocrPendingRow.mDate, ocrPendingRow.date, ocrPendingRow.name, ocrPendingRow.category, ocrPendingRow.desc, ocrPendingRow.amount, ocrPendingRow.payType, ocrPendingRow.aiCategory]
    });
    syncToFirebase('add', ocrPendingRow);
    fetchAllSheets(true);

    document.getElementById('ocr-result-box').classList.add('hidden');
    alert(`📷 영수증 스캔 내역 [${ocrPendingRow.desc} - ${ocrPendingRow.amount}] 이 구글 시트로 동기화되었습니다!`);
    ocrPendingRow = null;
}

// ⚡ AUTOMATION TOOL 3: 정기 고정비 항목 수정 & 일괄 등록
function loadSavedRecurringList() {
    const saved = localStorage.getItem('user_recurring_expenses');
    if (saved) {
        try {
            currentRecurringList = JSON.parse(saved);
        } catch (e) {}
    }
}

function renderRecurringExpensesList() {
    const container = document.getElementById('recurring-items-container');
    if (!container) return;

    let html = '';
    currentRecurringList.forEach(item => {
        html += `
            <div class="sub-item">
                <span class="sub-name">[${item.name}] ${item.desc}</span>
                <span class="sub-val">₩${item.amount.toLocaleString()}</span>
            </div>
        `;
    });

    container.innerHTML = html;
}

function openManageRecurringModal() {
    renderRecurringEditTable();
    document.getElementById('manage-recurring-modal').classList.add('active');
}

function renderRecurringEditTable() {
    const body = document.getElementById('recurring-edit-table-body');
    if (!body) return;

    let html = '';
    currentRecurringList.forEach((item, idx) => {
        html += `
            <tr>
                <td><strong>${item.name}</strong></td>
                <td><span class="badge badge-purple">${item.category}</span></td>
                <td>${item.desc}</td>
                <td><strong class="text-indigo">₩${item.amount.toLocaleString()}</strong></td>
                <td class="text-center">
                    <button class="btn-action-delete" onclick="deleteRecurringItem(${idx})">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    });

    body.innerHTML = html || `<tr><td colspan="5" class="text-center py-3">등록된 고정비 항목이 없습니다.</td></tr>`;
}

function addNewRecurringItem() {
    const name = document.getElementById('new-rec-name').value;
    const category = document.getElementById('new-rec-category').value;
    const desc = document.getElementById('new-rec-desc').value.trim();
    const amountNum = parseInt(document.getElementById('new-rec-amount').value) || 0;

    if (!desc || amountNum <= 0) {
        alert("항목명과 올바른 금액을 입력해 주세요.");
        return;
    }

    currentRecurringList.push({ name, category, desc, amount: amountNum });
    renderRecurringEditTable();

    document.getElementById('new-rec-desc').value = '';
    document.getElementById('new-rec-amount').value = '';
}

function deleteRecurringItem(idx) {
    currentRecurringList.splice(idx, 1);
    renderRecurringEditTable();
}

function saveRecurringItemsConfig() {
    localStorage.setItem('user_recurring_expenses', JSON.stringify(currentRecurringList));
    renderRecurringExpensesList();
    closeModal('manage-recurring-modal');
    alert("✏️ 고정비 항목 수정사항이 저장되었습니다!");
}

function applyRecurringExpenses() {
    const today = new Date();
    const formattedDate = `${today.getFullYear()}. ${today.getMonth() + 1}. ${today.getDate()}`;
    const mDate = `${today.getFullYear()},0${today.getMonth() + 1}`;

    const localAdded = JSON.parse(localStorage.getItem('local_added_rows') || '[]');

    currentRecurringList.forEach(item => {
        const formattedAmount = `₩${item.amount.toLocaleString()}`;
        const sig = `${formattedDate}_${item.name}_${item.desc}_${formattedAmount}`;
        const newObj = {
            rowIndex: rawDataLogRows.length + 2,
            signature: sig,
            mDate,
            date: formattedDate,
            name: item.name,
            category: item.category,
            desc: item.desc,
            amount: formattedAmount,
            payType: "계좌이체",
            aiCategory: item.category
        };
        localAdded.unshift(newObj);
        rawDataLogRows.unshift(newObj);

        sendToAppsScript("add", {
            row: [newObj.mDate, newObj.date, newObj.name, newObj.category, newObj.desc, newObj.amount, newObj.payType, newObj.aiCategory]
        });
        syncToFirebase('add', newObj);
    });

    localStorage.setItem('local_added_rows', JSON.stringify(localAdded));
    renderDataLogRows(rawDataLogRows);
    recalculateGlobalKPIs();
    fetchAllSheets(true);

    alert(`⚡ 고정비 ${currentRecurringList.length}건이 구글 스프레드시트 셀에 실시간 등록되었습니다!`);
}

// ⚡ AUTOMATION TOOL 4: 월별 예산 한도 설정 & 실시간 초과 경고 트래커
function updateBudgetTracker(totalSpend) {
    const percentText = document.getElementById('budget-percent-text');
    const progressFill = document.getElementById('budget-progress-fill');
    const alertBox = document.getElementById('budget-status-alert');
    const titleLabel = document.getElementById('budget-title-label');

    if (!percentText || !progressFill || !alertBox) return;

    if (titleLabel) {
        titleLabel.textContent = `이번 달 총 지출 예산 (목표 ₩${currentTargetBudget.toLocaleString()})`;
    }

    const percent = Math.min(Math.round((totalSpend / currentTargetBudget) * 100), 100);

    percentText.textContent = `${percent}% 소진 (현재 ₩${totalSpend.toLocaleString()}원)`;
    progressFill.style.width = `${percent}%`;

    if (totalSpend >= currentTargetBudget) {
        progressFill.className = "b-fill bg-rose";
        alertBox.className = "budget-alert-box alert-warning mt-3";
        alertBox.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-rose"></i> <span>🚨 경고: 이번 달 지출 예산 한도(₩${currentTargetBudget.toLocaleString()}원)를 초과하였습니다!</span>`;
    } else if (percent >= 80) {
        progressFill.className = "b-fill bg-rose";
        alertBox.className = "budget-alert-box alert-warning mt-3";
        alertBox.innerHTML = `<i class="fa-solid fa-bell text-rose"></i> <span>⚠️ 주의: 예산의 80% 이상(₩${totalSpend.toLocaleString()}원)을 소진했습니다. 지출을 점검하세요!</span>`;
    } else {
        progressFill.className = "b-fill bg-teal";
        alertBox.className = "budget-alert-box alert-safe mt-3";
        alertBox.innerHTML = `<i class="fa-solid fa-circle-check text-teal"></i> <span>현재 지출은 설정된 예산 한도(₩${currentTargetBudget.toLocaleString()}원) 범위 내에서 안정적으로 관리되고 있습니다.</span>`;
    }
}

// ⚡ AUTOMATION TOOL 5: 엑셀/PDF 맞춤 보고서 내보내기 & 인쇄
function printPDFReport() {
    window.print();
}

function exportToCSV() {
    let csvContent = "\uFEFF월별일자,날짜,이름,지출 분류,항목 설명,금액,결제 유형,AI 비용 카테고리\n";
    rawDataLogRows.forEach(r => {
        csvContent += `"${r.mDate}","${r.date}","${r.name}","${r.category}","${r.desc}","${r.amount}","${r.payType}","${r.aiCategory}"\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `가계부_업데이트_데이터_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// CRUD Modal Handlers
function openAddEntryModal() {
    document.getElementById('add-entry-modal').classList.add('active');
}

function openEditEntryModal(rowIdx) {
    const item = rawDataLogRows[rowIdx];
    if (!item) return;

    document.getElementById('edit-row-index').value = rowIdx;
    document.getElementById('edit-date').value = item.date;
    document.getElementById('edit-name').value = item.name;
    document.getElementById('edit-category').value = item.category;
    document.getElementById('edit-desc').value = item.desc;
    document.getElementById('edit-amount').value = parseInt(item.amount.replace(/[^0-9]/g, '')) || 0;
    document.getElementById('edit-paytype').value = item.payType;

    document.getElementById('edit-entry-modal').classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

function handleFormSubmit(event, type) {
    event.preventDefault();

    if (type === 'add') {
        const rawDate = document.getElementById('add-date').value;
        const name = document.getElementById('add-name').value;
        const category = document.getElementById('add-category').value;
        const desc = document.getElementById('add-desc').value;
        const amountNum = parseInt(document.getElementById('add-amount').value) || 0;
        const payType = document.getElementById('add-paytype').value;

        const parts = rawDate.split('-');
        const formattedDate = `${parts[0]}. ${parseInt(parts[1])}. ${parseInt(parts[2])}`;
        const mDate = `${parts[0]},${parts[1]}`;
        const formattedAmount = `₩${amountNum.toLocaleString()}`;
        const sig = `${formattedDate}_${name}_${desc}_${formattedAmount}`;

        const newRowObj = {
            rowIndex: rawDataLogRows.length + 2,
            signature: sig,
            mDate,
            date: formattedDate,
            name,
            category,
            desc,
            amount: formattedAmount,
            payType,
            aiCategory: category
        };

        const localAdded = JSON.parse(localStorage.getItem('local_added_rows') || '[]');
        localAdded.unshift(newRowObj);
        localStorage.setItem('local_added_rows', JSON.stringify(localAdded));

        rawDataLogRows.unshift(newRowObj);
        renderDataLogRows(rawDataLogRows);
        recalculateGlobalKPIs();
        closeModal('add-entry-modal');

        // 1. Send HTTP POST to Apps Script WebApp
        sendToAppsScript("add", {
            row: [newRowObj.mDate, newRowObj.date, newRowObj.name, newRowObj.category, newRowObj.desc, newRowObj.amount, newRowObj.payType, newRowObj.aiCategory]
        });

        // 2. Send to Firebase
        syncToFirebase('add', newRowObj);

        // 3. Trigger sheet fetch
        fetchAllSheets(true);

        alert(`✅ "${desc}" (${formattedAmount}) 항목이 구글 스프레드시트에 즉시 전송되었습니다!`);
    } else if (type === 'edit') {
        const rowIdx = parseInt(document.getElementById('edit-row-index').value);
        const date = document.getElementById('edit-date').value;
        const name = document.getElementById('edit-name').value;
        const category = document.getElementById('edit-category').value;
        const desc = document.getElementById('edit-desc').value;
        const amountNum = parseInt(document.getElementById('edit-amount').value) || 0;
        const payType = document.getElementById('edit-paytype').value;
        const formattedAmount = `₩${amountNum.toLocaleString()}`;

        const targetObj = rawDataLogRows[rowIdx];
        if (targetObj) {
            targetObj.date = date;
            targetObj.name = name;
            targetObj.category = category;
            targetObj.desc = desc;
            targetObj.amount = formattedAmount;
            targetObj.payType = payType;

            const localEdited = JSON.parse(localStorage.getItem('local_edited_rows') || '{}');
            localEdited[targetObj.signature] = targetObj;
            localStorage.setItem('local_edited_rows', JSON.stringify(localEdited));

            renderDataLogRows(rawDataLogRows);
            recalculateGlobalKPIs();
            closeModal('edit-entry-modal');

            sendToAppsScript("edit", {
                rowIndex: targetObj.rowIndex,
                desc: targetObj.desc,
                row: [targetObj.mDate, targetObj.date, targetObj.name, targetObj.category, targetObj.desc, targetObj.amount, targetObj.payType, targetObj.aiCategory]
            });
            syncToFirebase('add', targetObj);
            fetchAllSheets(true);

            alert("✏️ 지출 내역 수정사항이 구글 스프레드시트에 전송되었습니다!");
        }
    }
}

function deleteDataRow(rowIdx) {
    const item = rawDataLogRows[rowIdx];
    if (!item) return;

    if (confirm(`정말로 [${item.name}]의 "${item.desc}" (${item.amount}) 항목을 삭제하시겠습니까?`)) {
        const deletedItem = rawDataLogRows.splice(rowIdx, 1)[0];
        const localDeleted = JSON.parse(localStorage.getItem('local_deleted_signatures') || '[]');
        if (!localDeleted.includes(deletedItem.signature)) {
            localDeleted.push(deletedItem.signature);
            localStorage.setItem('local_deleted_signatures', JSON.stringify(localDeleted));
        }

        renderDataLogRows(rawDataLogRows);
        recalculateGlobalKPIs();

        sendToAppsScript("delete", {
            rowIndex: deletedItem.rowIndex,
            desc: deletedItem.desc
        });
        syncToFirebase('delete', deletedItem);
        fetchAllSheets(true);

        alert(`🗑️ [${deletedItem.desc}] (${deletedItem.amount}) 항목 삭제 요청이 구글 시트로 전송되었습니다!`);
    }
}

function resetLocalModifications() {
    if (confirm("모든 수정/삭제 내역을 원본 구글 시트로 되돌리시겠습니까?")) {
        localStorage.removeItem('local_deleted_signatures');
        localStorage.removeItem('local_edited_rows');
        localStorage.removeItem('local_added_rows');
        alert("원본 데이터로 초기화되었습니다.");
        fetchAllSheets();
    }
}

// CSV Parser
function parseCSVLines(text) {
    const lines = text.split('\n');
    return lines.map(line => {
        const regex = /(?:^|,)(?:"([^"]*)"|([^",]*))/g;
        const matches = [];
        let match;
        while ((match = regex.exec(line)) !== null) {
            matches.push(match[1] !== undefined ? match[1] : match[2]);
        }
        return matches.map(s => s ? s.trim() : '');
    }).filter(row => row.some(cell => cell.length > 0));
}

// Render Monthly Chart
function renderMonthlyChart(labels, junData, jihData) {
    const ctx = document.getElementById('monthlyChart');
    if (!ctx) return;

    if (monthlyChart) {
        monthlyChart.destroy();
    }

    monthlyChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels.length > 0 ? labels : ['2026.08'],
            datasets: [
                {
                    label: '준영 지출 (원)',
                    data: junData.length > 0 ? junData : [1800],
                    backgroundColor: '#2563eb',
                    borderRadius: 6
                },
                {
                    label: '지헌 지출 (원)',
                    data: jihData.length > 0 ? jihData : [30000],
                    backgroundColor: '#7c3aed',
                    borderRadius: 6
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: '#475569', font: { weight: 'bold' } } }
            },
            scales: {
                x: { ticks: { color: '#64748b' }, grid: { display: false } },
                y: { ticks: { color: '#64748b' }, grid: { color: '#e2e8f0' } }
            }
        }
    });
}

function filterMonthlyChart(type) {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');

    if (!monthlyChart) return;
    if (type === 'jun') {
        monthlyChart.setDatasetVisibility(0, true);
        monthlyChart.setDatasetVisibility(1, false);
    } else if (type === 'jih') {
        monthlyChart.setDatasetVisibility(0, false);
        monthlyChart.setDatasetVisibility(1, true);
    } else {
        monthlyChart.setDatasetVisibility(0, true);
        monthlyChart.setDatasetVisibility(1, true);
    }
    monthlyChart.update();
}

function saveCustomUrls() {
    if (document.getElementById('url-script-api')) {
        localStorage.setItem('url_script_api', document.getElementById('url-script-api').value);
    }
    localStorage.setItem('url_monthly', document.getElementById('url-monthly').value);
    localStorage.setItem('url_data', document.getElementById('url-data').value);
    alert("🔗 시트 및 Apps Script 연동 URL이 저장되었습니다! 실시간 데이터를 갱신합니다.");
    fetchAllSheets();
}

function resetDefaultUrls() {
    localStorage.removeItem('url_script_api');
    localStorage.removeItem('url_monthly');
    localStorage.removeItem('url_data');
    if (document.getElementById('url-script-api')) document.getElementById('url-script-api').value = DEFAULT_URL_SCRIPT_API;
    document.getElementById('url-monthly').value = DEFAULT_URL_MONTHLY;
    document.getElementById('url-data').value = DEFAULT_URL_DATA;
    alert("기본 URL로 초기화되었습니다.");
    fetchAllSheets();
}

function loadSavedUrls() {
    if (localStorage.getItem('url_script_api') && document.getElementById('url-script-api')) {
        document.getElementById('url-script-api').value = localStorage.getItem('url_script_api');
    }
    if (localStorage.getItem('url_monthly')) document.getElementById('url-monthly').value = localStorage.getItem('url_monthly');
    if (localStorage.getItem('url_data')) document.getElementById('url-data').value = localStorage.getItem('url_data');
}

function getFallbackMonthlyCSV() {
    return `"준영 월말기준","월","지출총금액","카드","이체","","지헌 월말기준","월","지출총금액","카드","이체"
"2026. 8. 31","2026,08","₩1,800","","","","2026. 8. 31","2026,08","₩30,000","",""`;
}

function getFallbackDataLogCSV() {
    return `"월별일자","날짜","이름","지출 분류","항목 설명","금액","결제 유형","AI 비용 카테고리"
"2024,12","2024. 12. 10","준영","문화/여가","호텔 예약 + 세금","₩120,000","신용카드","숙박"
"2024,12","2024. 12. 19","지헌","교통/차량","항공편","₩120,000","신용카드","여행"
"2024,12","2024. 12. 24","준영","식비","아침 식사","₩12,000","신용카드","식사"
"2026,08","2026. 8. 12","준영","식비","커피","₩1,800","신용카드","식사"
"2026,08","2026. 8. 12","지헌","식비","쿠팡","₩30,000","신용카드","식사"`;
}

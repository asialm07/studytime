
// State & Storage Keys
const KEYS = {
    THEME: 'studytime_theme',
    GOAL: 'studytime_goal',
    SUBJECTS: 'studytime_subjects',
    CHECKLIST: 'studytime_checklist',
    TIMER: 'studytime_timer_state'
};

const DB_NAME = 'StudytimeDB';
const DB_VERSION = 1;
let db;

let timerInterval;
let timerState = JSON.parse(localStorage.getItem(KEYS.TIMER)) || {
    running: false,
    startTimestamp: null,
    accumulated: 0,
    subject: ''
};

let dailyGoal = parseFloat(localStorage.getItem(KEYS.GOAL)) || 8;
let subjects = JSON.parse(localStorage.getItem(KEYS.SUBJECTS)) || ['General Study'];
let checklist = JSON.parse(localStorage.getItem(KEYS.CHECKLIST)) || [];

// DOM Elements
const els = {
    themeToggle: document.getElementById('theme-toggle'),
    themeMeta: document.getElementById('theme-meta'),
    subjectSelect: document.getElementById('subject-select'),
    timerDisplay: document.getElementById('timer-display'),
    btnStart: document.getElementById('start-btn'),
    btnPause: document.getElementById('pause-btn'),
    btnResume: document.getElementById('resume-btn'),
    btnFinish: document.getElementById('finish-btn'),
    goalText: document.getElementById('goal-text'),
    goalFill: document.getElementById('goal-progress-fill'),
    checklistForm: document.getElementById('checklist-form'),
    checklistInput: document.getElementById('checklist-input'),
    checklistItems: document.getElementById('checklist-items'),
    checklistProgress: document.getElementById('checklist-progress'),
    chart: document.getElementById('chart'),
    historyList: document.getElementById('history-list'),
    modals: {
        subjects: document.getElementById('subjects-modal'),
        goal: document.getElementById('goal-modal')
    }
};

// Initialize App
async function init() {
    initTheme();
    renderSubjects();
    renderChecklist();
    updateGoalUI();
    
    try {
        await initDB();
        await refreshData();
    } catch(e) {
        console.error("IndexedDB failed", e);
    }
    
    initTimerDisplay();
    if(timerState.running) {
        startTimerInterval();
        updateTimerControls('running');
    } else if (timerState.accumulated > 0) {
        updateTimerControls('paused');
    } else {
        updateTimerControls('stopped');
    }
    
    setupEventListeners();
    registerServiceWorker();
}

// Database
function initDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            db = e.target.result;
            if (!db.objectStoreNames.contains('sessions')) {
                db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
            }
        };
        req.onsuccess = (e) => { db = e.target.result; resolve(); };
        req.onerror = (e) => reject(e);
    });
}

function getAllSessions() {
    return new Promise((resolve) => {
        if(!db) return resolve([]);
        const tx = db.transaction('sessions', 'readonly');
        const store = tx.objectStore('sessions');
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
    });
}

function saveSession(session) {
    return new Promise((resolve) => {
        const tx = db.transaction('sessions', 'readwrite');
        tx.objectStore('sessions').add(session);
        tx.oncomplete = resolve;
    });
}

function deleteSession(id) {
    return new Promise((resolve) => {
        const tx = db.transaction('sessions', 'readwrite');
        tx.objectStore('sessions').delete(id);
        tx.oncomplete = resolve;
    });
}

// Timer Logic
function saveTimerState() {
    localStorage.setItem(KEYS.TIMER, JSON.stringify(timerState));
}

function getElapsedMs() {
    let total = timerState.accumulated;
    if (timerState.running && timerState.startTimestamp) {
        total += Date.now() - timerState.startTimestamp;
    }
    return total;
}

function formatTime(ms) {
    const totalSecs = Math.floor(ms / 1000);
    const h = String(Math.floor(totalSecs / 3600)).padStart(2, '0');
    const m = String(Math.floor((totalSecs % 3600) / 60)).padStart(2, '0');
    const s = String(totalSecs % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
}

function initTimerDisplay() {
    els.timerDisplay.textContent = formatTime(getElapsedMs());
}

function updateTimerControls(status) {
    els.btnStart.style.display = status === 'stopped' ? 'block' : 'none';
    els.btnPause.style.display = status === 'running' ? 'block' : 'none';
    els.btnResume.style.display = status === 'paused' ? 'block' : 'none';
    els.btnFinish.style.display = status !== 'stopped' ? 'block' : 'none';
    els.subjectSelect.disabled = status !== 'stopped';
}

function startTimerInterval() {
    if(timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        els.timerDisplay.textContent = formatTime(getElapsedMs());
    }, 1000);
}

// Timer Actions
els.btnStart.onclick = () => {
    timerState.running = true;
    timerState.startTimestamp = Date.now();
    timerState.subject = els.subjectSelect.value || subjects[0];
    saveTimerState();
    startTimerInterval();
    updateTimerControls('running');
};

els.btnPause.onclick = () => {
    timerState.accumulated += Date.now() - timerState.startTimestamp;
    timerState.running = false;
    saveTimerState();
    clearInterval(timerInterval);
    initTimerDisplay();
    updateTimerControls('paused');
};

els.btnResume.onclick = () => {
    timerState.running = true;
    timerState.startTimestamp = Date.now();
    saveTimerState();
    startTimerInterval();
    updateTimerControls('running');
};

els.btnFinish.onclick = async () => {
    const elapsed = getElapsedMs();
    if (elapsed > 60000) { // minimum 1 minute to save
        const now = Date.now();
        const session = {
            subject: timerState.subject,
            durationMs: elapsed,
            startTime: now - elapsed,
            endTime: now,
            date: new Date().toLocaleDateString('en-CA') // YYYY-MM-DD format roughly
        };
        await saveSession(session);
        await refreshData();
    }
    
    // Reset
    timerState = { running: false, startTimestamp: null, accumulated: 0, subject: '' };
    saveTimerState();
    clearInterval(timerInterval);
    initTimerDisplay();
    updateTimerControls('stopped');
};

// Data & Stats calculation
async function refreshData() {
    const sessions = await getAllSessions();
    renderHistory(sessions);
    calculateStats(sessions);
}

function calculateStats(sessions) {
    const now = new Date();
    const todayStr = now.toLocaleDateString('en-CA');
    
    // Week calculation (last 7 days)
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(now.getDate() - 6);
    sevenDaysAgo.setHours(0,0,0,0);
    
    let todayMs = 0;
    let weekMs = 0;
    let todayCount = 0;
    let maxMs = 0;
    
    const dayMap = {};
    for(let i=0; i<7; i++) {
        let d = new Date(now);
        d.setDate(now.getDate() - i);
        dayMap[d.toLocaleDateString('en-CA')] = 0;
    }
    
    const subjectMap = {};
    
    sessions.forEach(s => {
        const sDate = new Date(s.endTime);
        const sDateStr = s.date || sDate.toLocaleDateString('en-CA');
        
        // Subject breakdown
        subjectMap[s.subject] = (subjectMap[s.subject] || 0) + s.durationMs;
        
        if (s.durationMs > maxMs) maxMs = s.durationMs;
        
        if (sDateStr === todayStr) {
            todayMs += s.durationMs;
            todayCount++;
        }
        
        if (sDate >= sevenDaysAgo) {
            weekMs += s.durationMs;
        }
        
        if (dayMap[sDateStr] !== undefined) {
            dayMap[sDateStr] += s.durationMs;
        }
    });
    
    const avgMs = sessions.length ? sessions.reduce((a,b)=>a+b.durationMs, 0) / sessions.length : 0;
    
    const fmtHrs = ms => {
        const h = Math.floor(ms / 3600000);
        const m = Math.floor((ms % 3600000) / 60000);
        return `${h}h ${m}m`;
    };
    
    document.getElementById('stat-today').textContent = fmtHrs(todayMs);
    document.getElementById('stat-week').textContent = fmtHrs(weekMs);
    document.getElementById('stat-sessions-today').textContent = todayCount;
    document.getElementById('stat-avg').textContent = fmtHrs(avgMs);
    document.getElementById('stat-longest').textContent = fmtHrs(maxMs);
    
    updateGoalUI(todayMs);
    renderChart(dayMap, todayStr);
    renderSubjectBreakdown(subjectMap, fmtHrs);
}

function updateGoalUI(todayMs = 0) {
    const goalMs = dailyGoal * 3600000;
    const progress = Math.min((todayMs / goalMs) * 100, 100);
    els.goalFill.style.width = progress + '%';
    
    const todayH = (todayMs / 3600000).toFixed(1);
    const remH = Math.max((goalMs - todayMs) / 3600000, 0).toFixed(1);
    els.goalText.textContent = `${todayH}h / ${dailyGoal}h (${remH}h remaining)`;
}

function renderChart(dayMap, todayStr) {
    els.chart.innerHTML = '';
    const keys = Object.keys(dayMap).sort();
    const maxVal = Math.max(...Object.values(dayMap), 3600000); // minimum scale 1 hour
    
    keys.forEach(k => {
        const val = dayMap[k];
        const pct = (val / maxVal) * 100;
        
        const wrapper = document.createElement('div');
        wrapper.className = 'chart-bar-wrapper';
        
        const bar = document.createElement('div');
        bar.className = 'chart-bar';
        bar.style.height = Math.max(pct, 2) + '%';
        if(k === todayStr) bar.style.backgroundColor = 'var(--success)';
        
        const lbl = document.createElement('div');
        lbl.className = 'chart-label';
        const d = new Date(k);
        lbl.textContent = ['S','M','T','W','T','F','S'][d.getDay()];
        
        wrapper.appendChild(bar);
        wrapper.appendChild(lbl);
        els.chart.appendChild(wrapper);
    });
}

function renderSubjectBreakdown(subjectMap, fmtHrs) {
    const list = document.getElementById('subject-breakdown-list');
    list.innerHTML = '';
    const sorted = Object.keys(subjectMap).sort((a,b) => subjectMap[b] - subjectMap[a]);
    if(sorted.length === 0) {
        list.innerHTML = '<li class="subtext">No data yet</li>';
        return;
    }
    sorted.forEach(sub => {
        const li = document.createElement('li');
        li.className = 'breakdown-item';
        li.innerHTML = `<span>${sub}</span><strong>${fmtHrs(subjectMap[sub])}</strong>`;
        list.appendChild(li);
    });
}

function renderHistory(sessions) {
    els.historyList.innerHTML = '';
    if(sessions.length === 0) {
        els.historyList.innerHTML = '<p class="subtext">No study sessions recorded yet.</p>';
        return;
    }
    // Sort descending
    sessions.sort((a,b) => b.endTime - a.endTime).forEach(s => {
        const div = document.createElement('div');
        div.className = 'history-item';
        
        const hMs = s.durationMs;
        const h = Math.floor(hMs / 3600000);
        const m = Math.floor((hMs % 3600000) / 60000);
        
        div.innerHTML = `
            <div class="history-header">
                <span class="history-subject">${s.subject}</span>
                <span class="history-duration">${h}h ${m}m</span>
            </div>
            <div class="history-header">
                <span class="history-date">${new Date(s.endTime).toLocaleString()}</span>
                <button class="delete-btn" data-id="${s.id}">Delete</button>
            </div>
        `;
        els.historyList.appendChild(div);
    });
    
    // Add delete listeners
    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.onclick = async (e) => {
            const id = parseInt(e.target.dataset.id);
            if(confirm('Delete this session?')) {
                await deleteSession(id);
                await refreshData();
            }
        };
    });
}

// Subjects
function renderSubjects() {
    els.subjectSelect.innerHTML = '';
    const list = document.getElementById('subjects-list');
    list.innerHTML = '';
    
    subjects.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s;
        opt.textContent = s;
        els.subjectSelect.appendChild(opt);
        
        const li = document.createElement('li');
        li.innerHTML = `<span>${s}</span><button class="delete-btn" data-sub="${s}">Remove</button>`;
        list.appendChild(li);
    });
    
    if(timerState.subject && subjects.includes(timerState.subject)) {
        els.subjectSelect.value = timerState.subject;
    }
    
    list.querySelectorAll('.delete-btn').forEach(btn => {
        btn.onclick = (e) => {
            const sub = e.target.dataset.sub;
            if(subjects.length === 1) return alert('You must have at least one subject.');
            subjects = subjects.filter(x => x !== sub);
            localStorage.setItem(KEYS.SUBJECTS, JSON.stringify(subjects));
            renderSubjects();
        };
    });
}

document.getElementById('add-subject-form').onsubmit = (e) => {
    e.preventDefault();
    const input = document.getElementById('new-subject-input');
    const val = input.value.trim();
    if(val && !subjects.includes(val)) {
        subjects.push(val);
        localStorage.setItem(KEYS.SUBJECTS, JSON.stringify(subjects));
        input.value = '';
        renderSubjects();
    }
};

// Checklist
function saveChecklist() {
    localStorage.setItem(KEYS.CHECKLIST, JSON.stringify(checklist));
    renderChecklist();
}

function renderChecklist() {
    els.checklistItems.innerHTML = '';
    let completedCount = 0;
    
    checklist.forEach(item => {
        if(item.completed) completedCount++;
        const li = document.createElement('li');
        
        const box = document.createElement('div');
        box.className = `checkbox ${item.completed ? 'completed' : ''}`;
        box.onclick = () => { item.completed = !item.completed; saveChecklist(); };
        
        const text = document.createElement('span');
        text.className = `checklist-text ${item.completed ? 'completed' : ''}`;
        text.textContent = item.text;
        text.onclick = () => { item.completed = !item.completed; saveChecklist(); };
        
        const del = document.createElement('button');
        del.className = 'delete-btn';
        del.textContent = '✕';
        del.onclick = () => {
            checklist = checklist.filter(x => x.id !== item.id);
            saveChecklist();
        };
        
        li.appendChild(box);
        li.appendChild(text);
        li.appendChild(del);
        els.checklistItems.appendChild(li);
    });
    
    els.checklistProgress.textContent = `${completedCount}/${checklist.length}`;
}

els.checklistForm.onsubmit = (e) => {
    e.preventDefault();
    const val = els.checklistInput.value.trim();
    if(val) {
        checklist.push({ id: Date.now(), text: val, completed: false });
        saveChecklist();
        els.checklistInput.value = '';
    }
};

// Modals
function setupEventListeners() {
    document.getElementById('manage-subjects-btn').onclick = () => els.modals.subjects.classList.add('active');
    document.getElementById('edit-goal-btn').onclick = () => {
        document.getElementById('goal-input').value = dailyGoal;
        els.modals.goal.classList.add('active');
    };
    
    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.onclick = (e) => e.target.closest('.modal').classList.remove('active');
    });
    
    document.getElementById('edit-goal-form').onsubmit = (e) => {
        e.preventDefault();
        dailyGoal = parseFloat(document.getElementById('goal-input').value);
        localStorage.setItem(KEYS.GOAL, dailyGoal);
        els.modals.goal.classList.remove('active');
        refreshData();
    };
    
    els.themeToggle.onclick = () => {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const newTheme = isDark ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem(KEYS.THEME, newTheme);
        updateThemeMeta(newTheme);
    };
    
    document.getElementById('export-csv-btn').onclick = async () => {
        const sessions = await getAllSessions();
        if(!sessions.length) return alert('No data to export.');
        
        let csv = 'Date,Subject,Start Time,End Time,Duration (Seconds)\n';
        sessions.sort((a,b) => b.endTime - a.endTime).forEach(s => {
            const ds = new Date(s.startTime).toLocaleString().replace(/,/g, '');
            const de = new Date(s.endTime).toLocaleString().replace(/,/g, '');
            const dur = Math.floor(s.durationMs / 1000);
            csv += `${s.date || new Date(s.endTime).toLocaleDateString('en-CA')},"${s.subject}",${ds},${de},${dur}\n`;
        });
        
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'studytime_export.csv';
        a.click();
        URL.revokeObjectURL(url);
    };
    
    // Visibility API to fix timer display when coming from background
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            initTimerDisplay();
        }
    });
}

function initTheme() {
    const saved = localStorage.getItem(KEYS.THEME) || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeMeta(saved);
}

function updateThemeMeta(theme) {
    els.themeMeta.content = theme === 'dark' ? '#0f172a' : '#f1f5f9';
}

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('SW Registered', reg))
            .catch(err => console.error('SW Failed', err));
    }
}

init();

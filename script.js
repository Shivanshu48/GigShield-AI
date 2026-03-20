// ─── CONFIG ─────────────────────────────────────────────────
const OPENWEATHER_API_KEY = 'YOUR_API_KEY_HERE';
const STORAGE_KEY_USERS  = 'gigshield_users';
const STORAGE_KEY_ACTIVE = 'gigshield_active';
const STORAGE_KEY_OTPS   = 'gigshield_otps';

// ─── STATE ──────────────────────────────────────────────────
let state = {
  user:        null,
  riskScore:   null,
  premium:     null,
  payout:      0,
  temperature: null,
  activity:    [],
};

let otpCountdownTimer = null;
let pendingOtpEmail   = '';
let pendingResetEmail = '';

// ─── UTILS ──────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function genUserId() {
  return 'GS-' + Math.random().toString(36).substr(2, 7).toUpperCase();
}

function genOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function now() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function showError(msg) {
  const el = $('auth-error');
  if (!el) return;
  el.textContent = '// ' + msg;
  el.style.display = 'block';
  const suc = $('auth-success');
  if (suc) suc.style.display = 'none';
}

function showSuccess(msg) {
  const el = $('auth-success');
  if (!el) return;
  el.textContent = '✓ ' + msg;
  el.style.display = 'block';
  const err = $('auth-error');
  if (err) err.style.display = 'none';
}

function clearMessages() {
  const e = $('auth-error');   if (e) e.style.display = 'none';
  const s = $('auth-success'); if (s) s.style.display = 'none';
}

function getUsers() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY_USERS) || '{}');
}

function saveUsers(u) {
  localStorage.setItem(STORAGE_KEY_USERS, JSON.stringify(u));
}

function hashPassword(pw) {
  // Simple deterministic hash (demo-safe; not cryptographic)
  let h = 0;
  for (let i = 0; i < pw.length; i++) {
    h = Math.imul(31, h) + pw.charCodeAt(i) | 0;
  }
  return h.toString(16);
}

function setVal(id, val, colorClass = '') {
  const el = $(id);
  if (!el) return;
  el.textContent = val;
  el.className = el.className.replace(/\b(green|orange|blue|muted)\b/g, '').trim();
  if (colorClass) el.classList.add(colorClass);
  el.classList.add('value-updated');
  el.addEventListener('animationend', () => el.classList.remove('value-updated'), { once: true });
}

function triggerScan(cardId) {
  const el = $(cardId);
  if (!el) return;
  el.classList.remove('active-scan');
  void el.offsetWidth;
  el.classList.add('active-scan');
  el.addEventListener('animationend', () => el.classList.remove('active-scan'), { once: true });
}

function logActivity(text, color = 'green') {
  state.activity.unshift({ text, color, time: now() });
  if (state.activity.length > 8) state.activity.pop();
  renderActivity();
}

function renderActivity() {
  const feed = $('activity-feed');
  if (!feed) return;
  if (!state.activity.length) {
    feed.innerHTML = '<div class="empty-state">// no activity yet</div>';
    return;
  }
  feed.innerHTML = state.activity.map((a, i) => `
    <div class="activity-item" style="animation-delay:${i * 0.04}s">
      <div class="activity-dot ${a.color}"></div>
      <div>
        <div class="activity-text">${a.text}</div>
        <div class="activity-time">${a.time}</div>
      </div>
    </div>
  `).join('');
}

// ─── OTP HELPERS ────────────────────────────────────────────

function storeOTP(email, otp) {
  const otps = JSON.parse(localStorage.getItem(STORAGE_KEY_OTPS) || '{}');
  otps[email] = { code: otp, expires: Date.now() + 120000 };
  localStorage.setItem(STORAGE_KEY_OTPS, JSON.stringify(otps));
}

function verifyOTP(email, inputCode) {
  const otps = JSON.parse(localStorage.getItem(STORAGE_KEY_OTPS) || '{}');
  const entry = otps[email];
  if (!entry) return false;
  if (Date.now() > entry.expires) return false;
  return entry.code === inputCode.trim();
}

function clearOTP(email) {
  const otps = JSON.parse(localStorage.getItem(STORAGE_KEY_OTPS) || '{}');
  delete otps[email];
  localStorage.setItem(STORAGE_KEY_OTPS, JSON.stringify(otps));
}

// Simulate sending OTP (demo: show in alert + console)
function simulateSendOTP(email, otp) {
  console.log(`%c[GigShield OTP] ${email} → ${otp}`, 'color:#00ff87; font-size:14px; font-weight:bold');
  // In production, replace with an email API call (SendGrid, etc.)
  setTimeout(() => alert(`[DEMO] OTP for ${email}:\n\n${otp}\n\n(In production this would be emailed)`), 200);
}

function startOTPCountdown(countdownId, resendBtnId, seconds = 120) {
  clearInterval(otpCountdownTimer);
  let remaining = seconds;
  const countEl  = $(countdownId);
  const resendEl = $(resendBtnId);
  if (countEl)  countEl.textContent = remaining;
  if (resendEl) resendEl.disabled = true;

  otpCountdownTimer = setInterval(() => {
    remaining--;
    if (countEl) countEl.textContent = remaining;
    if (remaining <= 0) {
      clearInterval(otpCountdownTimer);
      if (resendEl) resendEl.disabled = false;
    }
  }, 1000);
}

// Wire OTP boxes (auto-advance, backspace)
function wireOTPBoxes(containerId) {
  const container = $(containerId);
  if (!container) return;
  const boxes = Array.from(container.querySelectorAll('.otp-box'));

  boxes.forEach((box, i) => {
    box.addEventListener('input', () => {
      const v = box.value.replace(/\D/g, '');
      box.value = v.slice(-1);
      if (v && i < boxes.length - 1) boxes[i + 1].focus();
      box.classList.toggle('filled', !!box.value);
    });

    box.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && !box.value && i > 0) boxes[i - 1].focus();
    });

    box.addEventListener('paste', e => {
      e.preventDefault();
      const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
      boxes.forEach((b, j) => {
        b.value = pasted[j] || '';
        b.classList.toggle('filled', !!b.value);
      });
      const next = Math.min(pasted.length, boxes.length - 1);
      boxes[next].focus();
    });
  });
}

function getOTPValue(containerId) {
  const container = $(containerId);
  if (!container) return '';
  return Array.from(container.querySelectorAll('.otp-box')).map(b => b.value).join('');
}

// ─── AUTH TABS ───────────────────────────────────────────────

function initAuthTabs() {
  const tabs   = document.querySelectorAll('.tab-btn');
  const panels = document.querySelectorAll('.auth-panel');
  if (!tabs.length) return;

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.style.display = 'none');
      tab.classList.add('active');
      const target = $('panel-' + tab.dataset.tab);
      if (target) target.style.display = 'block';
      clearMessages();
    });
  });
}

// ─── MULTI-STEP REGISTER ─────────────────────────────────────

let regCurrentStep = 1;

function goRegStep(step) {
  [1,2,3].forEach(s => {
    const el = $('reg-step-' + s);
    if (el) el.style.display = s === step ? 'block' : 'none';

    const dot  = $('sdot-' + s);
    if (dot) {
      dot.classList.remove('active', 'done');
      if (s < step)  dot.classList.add('done');
      if (s === step) dot.classList.add('active');
    }
  });

  [1,2].forEach(s => {
    const line = $('sline-' + s);
    if (line) line.classList.toggle('done', s < step);
  });

  const label = $('reg-step-label');
  if (label) label.textContent = step;
  regCurrentStep = step;
  clearMessages();
}

function validateStep1() {
  const name  = $('reg-name').value.trim();
  const age   = parseInt($('reg-age').value);
  const email = $('reg-email').value.trim();
  const phone = $('reg-phone').value.trim();
  const loc   = $('reg-location').value.trim();

  if (!name)                        { showError('Full name is required'); return false; }
  if (!age || age < 18 || age > 65) { showError('Age must be between 18 and 65'); return false; }
  if (!email || !email.includes('@')){ showError('Valid email is required'); return false; }
  if (!phone || phone.length !== 10 || !/^\d+$/.test(phone)) { showError('Enter a valid 10-digit phone number'); return false; }
  if (!loc)                         { showError('City / delivery zone is required'); return false; }

  // Check if email already registered
  const users = getUsers();
  if (Object.values(users).find(u => u.email === email)) {
    showError('Email already registered — please sign in'); return false;
  }

  return true;
}

function validateStep2() {
  const platform   = $('reg-platform').value;
  const platformId = $('reg-platform-id').value.trim();
  const idType     = $('reg-id-type').value;
  const idNum      = $('reg-id-number').value.trim();

  if (!platform)   { showError('Please select your delivery platform'); return false; }
  if (!platformId) { showError('Platform worker ID is required'); return false; }
  if (!idType)     { showError('Please select an ID proof type'); return false; }
  if (!idNum)      { showError('ID document number is required'); return false; }

  return true;
}

function validateStep3() {
  const pw      = $('reg-password').value;
  const confirm = $('reg-confirm-password').value;
  const consent = $('reg-consent').checked;

  if (pw.length < 8)     { showError('Password must be at least 8 characters'); return false; }
  if (pw !== confirm)    { showError('Passwords do not match'); return false; }
  if (!consent)          { showError('Please accept the Terms of Service'); return false; }

  return true;
}

function initRegisterSteps() {
  // Password strength meter
  const pwInput = $('reg-password');
  if (pwInput) {
    pwInput.addEventListener('input', () => {
      const v = pwInput.value;
      let score = 0;
      if (v.length >= 8) score++;
      if (/[A-Z]/.test(v)) score++;
      if (/[0-9]/.test(v)) score++;
      if (/[^a-zA-Z0-9]/.test(v)) score++;

      const fill  = $('strength-fill');
      const label = $('strength-label');
      const colors = ['', '#ff4d4d', '#ff6b1a', '#ffd700', '#00ff87'];
      const labels = ['', 'Weak', 'Fair', 'Good', 'Strong'];

      if (fill) {
        fill.style.width = (score * 25) + '%';
        fill.style.background = colors[score] || 'transparent';
      }
      if (label) {
        label.textContent = v.length ? '// ' + (labels[score] || '') : '';
        label.style.color = colors[score] || 'var(--text-muted)';
      }
    });
  }

  $('reg-next-1') && $('reg-next-1').addEventListener('click', () => {
    if (validateStep1()) goRegStep(2);
  });

  $('reg-next-2') && $('reg-next-2').addEventListener('click', () => {
    if (validateStep2()) goRegStep(3);
  });

  $('reg-back-2') && $('reg-back-2').addEventListener('click', () => goRegStep(1));
  $('reg-back-3') && $('reg-back-3').addEventListener('click', () => goRegStep(2));

  const form = $('register-form');
  if (form) form.addEventListener('submit', handleRegister);
}

function handleRegister(e) {
  e.preventDefault();
  if (!validateStep3()) return;

  const userId = genUserId();
  const user   = {
    userId,
    name:       $('reg-name').value.trim(),
    age:        $('reg-age').value.trim(),
    email:      $('reg-email').value.trim().toLowerCase(),
    phone:      $('reg-phone').value.trim(),
    location:   $('reg-location').value.trim(),
    platform:   $('reg-platform').value,
    platformId: $('reg-platform-id').value.trim(),
    idType:     $('reg-id-type').value,
    idNumber:   $('reg-id-number').value.trim(),
    password:   hashPassword($('reg-password').value),
    joined:     new Date().toISOString(),
  };

  const users = getUsers();
  users[user.email] = user;
  saveUsers(users);

  localStorage.setItem(STORAGE_KEY_ACTIVE, JSON.stringify(user));

  const btn = $('reg-btn');
  btn.textContent = '✓ Account Created!';
  btn.disabled = true;
  showSuccess('Account created! Redirecting to dashboard…');
  setTimeout(() => { window.location.href = 'dashboard.html'; }, 1000);
}

// ─── LOGIN ───────────────────────────────────────────────────

function initLoginMethodToggle() {
  const btns = document.querySelectorAll('.method-btn');
  if (!btns.length) return;

  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const method  = btn.dataset.method;
      const pwPanel = $('login-password-fields');
      const otpPanel = $('login-otp-fields');

      if (pwPanel)  pwPanel.style.display  = method === 'password' ? 'block' : 'none';
      if (otpPanel) otpPanel.style.display = method === 'otp'      ? 'block' : 'none';
      clearMessages();
    });
  });
}

function handleLogin(e) {
  e.preventDefault();
  clearMessages();

  const email = $('login-email').value.trim().toLowerCase();
  const pw    = $('login-password').value;

  if (!email) { showError('Email is required'); return; }
  if (!pw)    { showError('Password is required'); return; }

  const users = getUsers();
  const user  = users[email];

  if (!user)                           { showError('No account found for this email'); return; }
  if (user.password !== hashPassword(pw)) { showError('Incorrect password'); return; }

  doLogin(user);
}

// OTP login flow
function initOTPLogin() {
  const sendBtn   = $('btn-send-otp');
  const verifyBtn = $('btn-verify-otp');
  const resendBtn = $('btn-resend-otp');

  if (sendBtn) sendBtn.addEventListener('click', sendLoginOTP);
  if (verifyBtn) verifyBtn.addEventListener('click', verifyLoginOTP);
  if (resendBtn) resendBtn.addEventListener('click', sendLoginOTP);

  wireOTPBoxes('otp-boxes');
}

function sendLoginOTP() {
  clearMessages();
  const email = $('otp-email').value.trim().toLowerCase();
  if (!email || !email.includes('@')) { showError('Enter a valid email address'); return; }

  const users = getUsers();
  if (!users[email]) { showError('No account found for this email'); return; }

  const otp = genOTP();
  storeOTP(email, otp);
  simulateSendOTP(email, otp);

  pendingOtpEmail = email;

  $('otp-sent-to') && ($('otp-sent-to').textContent = email);
  $('otp-send-wrap').style.display   = 'none';
  $('otp-verify-wrap').style.display = 'block';

  startOTPCountdown('otp-countdown', 'btn-resend-otp', 120);
  showSuccess('OTP sent! Check your console/alert for the demo code.');
}

function verifyLoginOTP() {
  clearMessages();
  const code = getOTPValue('otp-boxes');
  if (code.length !== 6) { showError('Enter the complete 6-digit OTP'); return; }

  if (!verifyOTP(pendingOtpEmail, code)) {
    showError('Invalid or expired OTP');
    return;
  }

  clearOTP(pendingOtpEmail);
  clearInterval(otpCountdownTimer);

  const user = getUsers()[pendingOtpEmail];
  doLogin(user);
}

function doLogin(user) {
  localStorage.setItem(STORAGE_KEY_ACTIVE, JSON.stringify(user));
  showSuccess('Login successful! Redirecting…');
  setTimeout(() => { window.location.href = 'dashboard.html'; }, 800);
}

// ─── RESET PASSWORD ──────────────────────────────────────────

function initResetPassword() {
  const forgotLink   = $('forgot-link');
  const backToLogin  = $('back-to-login');
  const sendResetBtn = $('btn-reset-send');
  const confirmBtn   = $('btn-reset-confirm');
  const tabsEl       = $('auth-tabs');

  forgotLink && forgotLink.addEventListener('click', e => {
    e.preventDefault();
    showPanel('reset');
    if (tabsEl) tabsEl.style.display = 'none';
    clearMessages();
  });

  backToLogin && backToLogin.addEventListener('click', e => {
    e.preventDefault();
    showPanel('login');
    if (tabsEl) tabsEl.style.display = 'flex';
    $('reset-stage-1').style.display = 'block';
    $('reset-stage-2').style.display = 'none';
    clearMessages();
  });

  sendResetBtn && sendResetBtn.addEventListener('click', sendResetCode);
  confirmBtn   && confirmBtn.addEventListener('click', confirmResetPassword);

  wireOTPBoxes('reset-otp-boxes');
}

function sendResetCode() {
  clearMessages();
  const email = $('reset-email').value.trim().toLowerCase();
  if (!email || !email.includes('@')) { showError('Enter a valid email address'); return; }

  const users = getUsers();
  if (!users[email]) { showError('No account registered with this email'); return; }

  const otp = genOTP();
  storeOTP('reset_' + email, otp);
  simulateSendOTP(email, otp);

  pendingResetEmail = email;

  $('reset-sent-to') && ($('reset-sent-to').textContent = email);
  $('reset-stage-1').style.display = 'none';
  $('reset-stage-2').style.display = 'block';

  showSuccess('Reset code sent! Check console/alert for the demo code.');
}

function confirmResetPassword() {
  clearMessages();
  const code      = getOTPValue('reset-otp-boxes');
  const newPw     = $('reset-new-pw').value;
  const confirmPw = $('reset-confirm-pw').value;

  if (code.length !== 6)   { showError('Enter the complete 6-digit code'); return; }
  if (newPw.length < 8)    { showError('Password must be at least 8 characters'); return; }
  if (newPw !== confirmPw) { showError('Passwords do not match'); return; }

  if (!verifyOTP('reset_' + pendingResetEmail, code)) {
    showError('Invalid or expired reset code');
    return;
  }

  clearOTP('reset_' + pendingResetEmail);

  const users = getUsers();
  if (users[pendingResetEmail]) {
    users[pendingResetEmail].password = hashPassword(newPw);
    saveUsers(users);
  }

  showSuccess('Password updated! You can now sign in.');

  setTimeout(() => {
    showPanel('login');
    $('auth-tabs').style.display = 'flex';
    $('reset-stage-1').style.display = 'block';
    $('reset-stage-2').style.display = 'none';
    clearMessages();
  }, 1500);
}

// ─── EYE TOGGLE ─────────────────────────────────────────────

function initEyeToggles() {
  document.querySelectorAll('.eye-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = $(btn.dataset.target);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
      btn.textContent = input.type === 'password' ? '👁' : '🙈';
    });
  });
}

// ─── PANEL SWITCHER ──────────────────────────────────────────

function showPanel(name) {
  document.querySelectorAll('.auth-panel').forEach(p => p.style.display = 'none');
  const target = $('panel-' + name);
  if (target) target.style.display = 'block';
}

// ─── DASHBOARD INIT ──────────────────────────────────────────

function loadUser() {
  const raw = localStorage.getItem(STORAGE_KEY_ACTIVE);
  if (!raw) { window.location.href = 'index.html'; return false; }
  state.user = JSON.parse(raw);
  const u = state.user;

  const initial = (u.name || 'U').charAt(0).toUpperCase();
  document.querySelectorAll('.user-display-name').forEach(el => el.textContent = u.name || '—');
  document.querySelectorAll('.user-avatar-initial').forEach(el => el.textContent = initial);

  const set = (id, val) => { const el = $(id); if (el) el.textContent = val || '—'; };

  set('profile-userid',   u.userId);
  set('profile-location', u.location);
  set('profile-phone',    u.phone ? '+91 ' + u.phone : '—');
  set('profile-email',    u.email);
  set('profile-age',      u.age ? u.age + ' yrs' : '—');
  set('profile-platform', u.platform || '—');
  set('profile-idtype',   u.idType ? u.idType + ' · ' + (u.idNumber || '') : '—');

  return true;
}

// ─── RISK CALCULATION ────────────────────────────────────────

async function checkRisk() {
  const btn = $('btn-risk');
  btn.disabled = true;
  btn.textContent = '⟳ Analyzing…';

  $('val-premium').classList.add('loading-shimmer');
  $('val-risk').classList.add('loading-shimmer');

  triggerScan('risk-card');
  await sleep(1400);

  const risk    = parseFloat((0.3 + Math.random() * 0.6).toFixed(2));
  const premium = parseFloat((30 + risk * 50).toFixed(2));

  state.riskScore = risk;
  state.premium   = premium;

  $('val-premium').classList.remove('loading-shimmer');
  $('val-risk').classList.remove('loading-shimmer');

  const riskColor = risk > 0.7 ? 'orange' : risk > 0.5 ? 'blue' : 'green';
  setVal('val-risk',    (risk * 100).toFixed(0) + '%', riskColor);
  setVal('val-premium', '₹' + premium.toFixed(2), 'green');

  const fill = $('risk-fill');
  if (fill) fill.style.width = (risk * 100) + '%';

  logActivity(`Risk scored ${(risk*100).toFixed(0)}% — premium set ₹${premium.toFixed(2)}`, riskColor);

  btn.disabled = false;
  btn.textContent = '🔄 Recalculate';
}

// ─── WEATHER ─────────────────────────────────────────────────

async function checkWeather() {
  const btn = $('btn-weather');
  btn.disabled = true;
  btn.textContent = '⟳ Fetching…';

  triggerScan('weather-card');
  const city = state.user ? state.user.location : 'Mumbai';

  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${OPENWEATHER_API_KEY}&units=metric`;
    const res  = await fetch(url);
    const data = await res.json();
    if (data.cod !== 200) throw new Error(data.message || 'API error');
    processWeather(Math.round(data.main.temp), city);
  } catch {
    processWeather(Math.round(28 + Math.random() * 15), city, true);
  }

  btn.disabled = false;
  btn.textContent = '☁ Re-check';
}

function processWeather(temp, city, isDemo = false) {
  state.temperature = temp;

  const tempEl = $('weather-temp');
  if (tempEl) tempEl.textContent = temp;

  const cityEl = $('weather-city');
  if (cityEl) cityEl.textContent = city;

  const statusEl = $('weather-status');
  if (statusEl) statusEl.textContent = isDemo ? 'Demo Data' : 'Live Data';

  const heatAlert = $('heat-alert');
  if (temp > 35) {
    if (heatAlert) heatAlert.style.display = 'flex';
    state.payout += 150;
    updatePayout();
    logPayoutItem('Heat Risk Payout', 150);
    logActivity(`⚠️ Heat alert ${temp}°C — ₹150 auto-credited`, 'orange');
  } else {
    if (heatAlert) heatAlert.style.display = 'none';
    logActivity(`Weather checked: ${temp}°C in ${city}`, 'blue');
  }
}

// ─── RAIN SIMULATION ─────────────────────────────────────────

function simulateRain() {
  showModal({
    emoji:  '🌧️',
    title:  'Heavy Rain Detected',
    sub:    '⚡ Parametric trigger activated automatically\n💸 Funds disbursed instantly — no claim needed',
    amount: '₹200',
    onClose: () => {
      state.payout += 200;
      updatePayout();
      logPayoutItem('Rain Parametric Trigger', 200);
      logActivity('🌧️ Rain event — ₹200 auto-credited to wallet', 'blue');
    }
  });
}

// ─── PAYOUT ──────────────────────────────────────────────────

function updatePayout() {
  setVal('val-payout', '₹' + state.payout, 'green');
  triggerScan('payout-card');
}

function logPayoutItem(label, amount) {
  const list = $('payout-list');
  if (!list) return;
  const item = document.createElement('div');
  item.className = 'payout-item';
  item.innerHTML = `
    <span class="payout-item-label">${label}</span>
    <span class="payout-item-amount">+₹${amount}</span>
  `;
  list.prepend(item);
}

// ─── MODAL ───────────────────────────────────────────────────

function showModal({ emoji, title, sub, amount, onClose }) {
  const overlay = $('modal-overlay');
  if (!overlay) return;

  $('modal-emoji')  && ($('modal-emoji').textContent  = emoji);
  $('modal-title')  && ($('modal-title').textContent  = title);
  $('modal-sub')    && ($('modal-sub').innerHTML      = sub.replace(/\n/g, '<br>'));
  $('modal-amount') && ($('modal-amount').textContent = amount);

  overlay.classList.add('active');

  const closeBtn = $('modal-close-btn');
  if (closeBtn) {
    const handler = () => {
      overlay.classList.remove('active');
      if (onClose) onClose();
      closeBtn.removeEventListener('click', handler);
    };
    closeBtn.addEventListener('click', handler);
  }
}

// ─── LOGOUT ──────────────────────────────────────────────────

function handleLogout() {
  localStorage.removeItem(STORAGE_KEY_ACTIVE);
  window.location.href = 'index.html';
}

// ─── PAGE INIT ───────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const page = document.body.dataset.page;

  if (page === 'auth') {
    initAuthTabs();
    initLoginMethodToggle();
    initRegisterSteps();
    initOTPLogin();
    initResetPassword();
    initEyeToggles();

    const loginForm = $('login-form');
    if (loginForm) loginForm.addEventListener('submit', handleLogin);

    // Already logged in → skip to dashboard
    if (localStorage.getItem(STORAGE_KEY_ACTIVE)) {
      window.location.href = 'dashboard.html';
    }
  }

  if (page === 'dashboard') {
    if (!loadUser()) return;
    renderActivity();

    $('btn-risk')    && $('btn-risk').addEventListener('click', checkRisk);
    $('btn-weather') && $('btn-weather').addEventListener('click', checkWeather);
    $('btn-rain')    && $('btn-rain').addEventListener('click', simulateRain);
    $('btn-logout')  && $('btn-logout').addEventListener('click', handleLogout);
  }
});

let currentUser = null;

function getUser() { return currentUser; }

function setUser(user, token) {
  currentUser = user;
  if (token) localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
}

function logout() {
  currentUser = null;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  navigateTo('login');
  renderSidebar(null);
  document.getElementById('sidebar').classList.add('hidden');
  document.getElementById('main-content').className = 'main-content full';
}

function isLoggedIn() {
  return !!localStorage.getItem('token');
}

async function loadCurrentUser() {
  if (!isLoggedIn()) return null;
  try {
    const stored = localStorage.getItem('user');
    if (stored) currentUser = JSON.parse(stored);
    const fresh = await api.me();
    currentUser = fresh;
    localStorage.setItem('user', JSON.stringify(fresh));
    return fresh;
  } catch (err) {
    logout();
    return null;
  }
}

// ── Toast ────────────────────────────────────────────────────────────────────
function toast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(100%)'; el.style.transition = '.3s'; setTimeout(() => el.remove(), 300); }, duration);
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function openModal(title, bodyHtml) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  document.getElementById('modal-overlay').classList.remove('hidden');
}
function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function renderSidebar(user) {
  if (!user) return;
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.remove('hidden');
  document.getElementById('main-content').className = 'main-content';

  const userInfo = document.getElementById('user-info');
  userInfo.innerHTML = `<strong>${user.full_name || user.email}</strong>${user.role ? `<span style="text-transform:capitalize">${esc(user.role)}</span>` : ''}`;

  const menu = document.getElementById('nav-menu');
  const items = getNavItems(user.role);
  menu.innerHTML = items.map(item =>
    item.section
      ? `<div class="nav-section">${item.section}</div>`
      : `<button class="nav-item" onclick="navigateTo('${item.page}')" id="nav-${item.page}">
           <span class="icon">${item.icon}</span>${item.label}
           ${item.page === 'notifications' ? '<span id="notif-badge" class="nav-badge" style="display:none"></span>' : ''}
         </button>`
  ).join('');
  refreshNotificationBadge();
}

function getNavItems(role) {
  const common = [
    { page: 'dashboard', icon: '📊', label: 'Dashboard' },
    { page: 'market', icon: '🌿', label: 'Market' },
  ];
  const buyerSeller = [
    { section: 'My Account' },
    { page: 'portfolio', icon: '💼', label: 'Portfolio' },
    { page: 'trading', icon: '🔄', label: 'My Orders' },
    { page: 'wallet', icon: '💰', label: 'Wallet' },
    { page: 'retirements', icon: '🏅', label: 'Retirements' },
    { page: 'compliance', icon: '📋', label: 'Compliance' },
    { page: 'company', icon: '🏢', label: 'Company' },
  ];
  const personal = [
    { section: 'Me' },
    { page: 'notifications', icon: '🔔', label: 'Notifications' },
    { page: 'security', icon: '🔐', label: 'Security' },
  ];
  const adminItems = [
    { section: 'Admin' },
    { page: 'admin', icon: '⚙️', label: 'Admin Panel' },
  ];
  const sellerExtra = [
    { page: 'projects', icon: '🌱', label: 'My Projects' },
  ];

  if (role === 'admin') return [...common, ...adminItems, ...personal];
  if (role === 'seller') return [...common, ...buyerSeller, ...sellerExtra, ...personal];
  return [...common, ...buyerSeller, ...personal];
}

function setActiveNav(page) {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const el = document.getElementById('nav-' + page);
  if (el) el.classList.add('active');
}

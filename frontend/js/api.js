const API_BASE = '/api';

async function apiFetch(endpoint, options = {}) {
  const token = localStorage.getItem('token');
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(API_BASE + endpoint, { ...options, headers });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const api = {
  // Auth
  login: (email, password, mfa_code) => apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email, password, mfa_code }) }),
  resendVerification: () => apiFetch('/auth/resend-verification', { method: 'POST' }),
  mfaSetup: () => apiFetch('/auth/mfa/setup', { method: 'POST' }),
  mfaEnable: (code) => apiFetch('/auth/mfa/enable', { method: 'POST', body: JSON.stringify({ code }) }),
  mfaDisable: (code) => apiFetch('/auth/mfa/disable', { method: 'POST', body: JSON.stringify({ code }) }),
  register: (data) => apiFetch('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  me: () => apiFetch('/auth/me'),

  // Market
  market: () => apiFetch('/market'),
  marketCredits: () => apiFetch('/market/credits'),
  marketCredit: (id) => apiFetch('/market/credit/' + id),
  priceHistory: (id) => apiFetch('/market/prices/' + id),
  creditOrders: (id) => apiFetch('/market/orders/' + id),
  verifyCertificate: (number) => apiFetch('/market/certificates/' + encodeURIComponent(number)),

  // Trading
  myOrders: () => apiFetch('/trading/orders'),
  placeOrder: (data) => apiFetch('/trading/orders', { method: 'POST', body: JSON.stringify(data) }),
  cancelOrder: (id) => apiFetch('/trading/orders/' + id, { method: 'DELETE' }),
  executeTrade: (data) => apiFetch('/trading/execute', { method: 'POST', body: JSON.stringify(data) }),
  myTrades: () => apiFetch('/trading/trades'),
  portfolio: () => apiFetch('/trading/portfolio'),
  retire: (data) => apiFetch('/trading/retire', { method: 'POST', body: JSON.stringify(data) }),
  myRetirements: () => apiFetch('/trading/retirements'),
  certificate: (id) => apiFetch('/trading/retirements/' + id),

  // Wallet
  wallet: () => apiFetch('/wallet'),
  deposit: (amount) => apiFetch('/wallet/deposit', { method: 'POST', body: JSON.stringify({ amount }) }),
  withdraw: (amount) => apiFetch('/wallet/withdraw', { method: 'POST', body: JSON.stringify({ amount }) }),

  // Notifications
  notifications: () => apiFetch('/notifications'),
  markRead: (id) => apiFetch('/notifications/' + id + '/read', { method: 'POST' }),
  markAllRead: () => apiFetch('/notifications/read-all', { method: 'POST' }),

  // Companies
  myCompany: () => apiFetch('/companies/my'),
  registerCompany: (data) => apiFetch('/companies', { method: 'POST', body: JSON.stringify(data) }),
  updateCompany: (data) => apiFetch('/companies/my', { method: 'PUT', body: JSON.stringify(data) }),
  myProjects: () => apiFetch('/companies/projects'),
  createProject: (data) => apiFetch('/companies/projects', { method: 'POST', body: JSON.stringify(data) }),
  issueCredits: (data) => apiFetch('/companies/credits', { method: 'POST', body: JSON.stringify(data) }),
  myDocuments: () => apiFetch('/companies/documents'),
  uploadDocument: (data) => apiFetch('/companies/documents', { method: 'POST', body: JSON.stringify(data) }),

  // Admin
  adminCompanies: () => apiFetch('/companies/admin/all'),
  adminProjects: () => apiFetch('/companies/admin/projects'),
  adminTrades: () => apiFetch('/companies/admin/trades'),
  adminUsers: () => apiFetch('/companies/admin/users'),
  adminAudit: () => apiFetch('/companies/admin/audit'),
  updateKyc: (id, data) => apiFetch('/companies/admin/' + id + '/kyc', { method: 'PUT', body: JSON.stringify(data) }),
  approveProject: (id, data) => apiFetch('/companies/admin/projects/' + id + '/approve', { method: 'PUT', body: JSON.stringify(data) }),
  toggleUser: (id) => apiFetch('/companies/admin/users/' + id + '/toggle', { method: 'PUT' }),
  companyDocuments: (id) => apiFetch('/companies/admin/' + id + '/documents'),
  adminStats: () => apiFetch('/admin/stats'),
  adminRetirements: () => apiFetch('/admin/retirements'),
  runExpiryJob: () => apiFetch('/admin/jobs/expire-orders', { method: 'POST' }),

  // Compliance
  myReports: () => apiFetch('/compliance/reports'),
  submitReport: (data) => apiFetch('/compliance/reports', { method: 'POST', body: JSON.stringify(data) }),
  myTargets: () => apiFetch('/compliance/targets'),
  setTarget: (data) => apiFetch('/compliance/targets', { method: 'POST', body: JSON.stringify(data) }),
  adminReports: () => apiFetch('/compliance/admin/reports'),
  reviewReport: (id, data) => apiFetch('/compliance/admin/reports/' + id + '/review', { method: 'PUT', body: JSON.stringify(data) }),

  // Health
  health: () => apiFetch('/health'),
};

// Downloads a protected file (the browser cannot add the login token to a plain link)
async function downloadFile(url, fileName) {
  const res = await fetch(API_BASE + url, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
  if (!res.ok) throw new Error('Download failed.');
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// Helpers
// Escape a value for safe insertion into HTML (text or attribute values)
function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// Encode a value as a JS string literal for use inside an inline onclick="" handler
function jsArg(v) {
  return esc(JSON.stringify(v === null || v === undefined ? '' : String(v)));
}
function fmt(num, decimals = 2) {
  if (num === null || num === undefined) return '—';
  return parseFloat(num).toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtCurrency(num) {
  if (num === null || num === undefined) return '—';
  return '$' + fmt(num, 2);
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function badge(text, color) {
  const map = { green:'green', active:'green', approved:'green', filled:'green', available:'green', net_zero:'green',
                red:'red', rejected:'red', cancelled:'red', suspended:'red', danger:'red',
                yellow:'yellow', pending:'yellow', open:'yellow', draft:'yellow', on_track:'green', partially_filled:'yellow',
                blue:'blue', submitted:'blue', under_review:'blue', info:'blue',
                gray:'gray', completed:'gray', retired:'gray', expired:'gray', off_track:'red', no_target:'gray',
                deposit:'green', sale:'green', release:'blue', hold:'yellow', purchase:'red', withdrawal:'red' };
  const c = map[color] || map[text?.toLowerCase()] || 'gray';
  return `<span class="badge badge-${c}">${esc(text) || '—'}</span>`;
}

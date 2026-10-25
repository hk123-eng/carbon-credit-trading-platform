async function renderAdmin() {
  const user = getUser();
  if (user?.role !== 'admin') { navigateTo('dashboard'); return; }

  const container = document.getElementById('page-container');
  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">Admin Panel</div>
      <div class="page-sub">Platform management and oversight</div>
    </div>
    <div class="tabs">
      <button class="tab-btn active" onclick="switchAdminTab('overview',this)">Overview</button>
      <button class="tab-btn" onclick="switchAdminTab('companies',this)">Companies</button>
      <button class="tab-btn" onclick="switchAdminTab('projects',this)">Projects</button>
      <button class="tab-btn" onclick="switchAdminTab('users',this)">Users</button>
      <button class="tab-btn" onclick="switchAdminTab('trades',this)">All Trades</button>
      <button class="tab-btn" onclick="switchAdminTab('reports',this)">Emissions</button>
      <button class="tab-btn" onclick="switchAdminTab('retirements',this)">Retirements</button>
      <button class="tab-btn" onclick="switchAdminTab('audit',this)">Audit Log</button>
    </div>
    <div id="admin-tab-content"><div class="loading-center"><div class="spinner"></div></div></div>
  `;
  await loadAdminOverview();
}

async function switchAdminTab(tab, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const loaders = { overview: loadAdminOverview, companies: loadAdminCompanies, projects: loadAdminProjects, users: loadAdminUsers, trades: loadAdminTrades, reports: loadAdminReports, retirements: loadAdminRetirements, audit: loadAdminAudit };
  await (loaders[tab] || loadAdminCompanies)();
}

async function loadAdminCompanies() {
  document.getElementById('admin-tab-content').innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
  try {
    const companies = await api.adminCompanies();
    document.getElementById('admin-tab-content').innerHTML = `
      <div class="card">
        <div class="card-header"><span class="card-title">All Companies (${companies.length})</span></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Company</th><th>Email</th><th>Type</th><th>Country</th><th>Sector</th><th>KYC</th><th>Docs</th><th>Reliability</th><th>Projects</th><th>Trade Value</th><th>Wallet</th><th>Actions</th></tr></thead>
            <tbody>
              ${companies.map(c => `
                <tr>
                  <td><strong>${esc(c.legal_name)}</strong><br><span class="text-muted" style="font-size:11px">${fmtDate(c.created_at)}</span></td>
                  <td class="text-muted">${esc(c.email)}${c.email_verified ? '' : '<br><span class="badge badge-yellow">unverified</span>'}</td>
                  <td>${badge(c.company_type,'blue')}</td>
                  <td>${esc(c.country)}</td>
                  <td>${esc(c.industry_sector)}</td>
                  <td>${badge(c.kyc_status)}</td>
                  <td>${esc(c.kyc_documents)}</td>
                  <td>
                    <div class="progress-bar" style="width:60px;margin-bottom:2px"><div class="progress-fill" style="width:${c.reliability_score||0}%"></div></div>
                    <span style="font-size:11px">${esc(c.reliability_score)}</span>
                  </td>
                  <td>${c.total_projects||0}</td>
                  <td>${fmtCurrency(c.lifetime_trade_value)}</td>
                  <td>${fmtCurrency(c.wallet_balance)}</td>
                  <td>
                    <button class="btn btn-outline btn-xs" onclick="openKycModal(${jsArg(c.id)},${jsArg(c.legal_name)},${jsArg(c.kyc_status)})">KYC</button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    document.getElementById('admin-tab-content').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

function openKycModal(companyId, name, currentStatus) {
  openModal('Update KYC — ' + name, `
    <div id="kyc-err" class="alert alert-error" style="display:none"></div>
    <div class="form-group"><label>Current Status</label>${badge(currentStatus)}</div>
    <div class="form-group"><label>Uploaded documents</label><div id="kyc-doc-list"><div class="spinner"></div></div></div>
    <div class="form-group"><label>New KYC Status</label>
      <select id="kyc-status">
        <option value="approved">Approved</option>
        <option value="under_review">Under Review</option>
        <option value="rejected">Rejected</option>
        <option value="suspended">Suspended</option>
      </select>
    </div>
    <div class="form-group"><label>Rejection Reason (if rejecting)</label>
      <textarea id="kyc-reason" placeholder="Required if rejecting…"></textarea>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="updateKyc(${jsArg(companyId)})">Update KYC</button>
    </div>
  `);
  loadKycDocList(companyId);
}

async function updateKyc(id) {
  const errEl = document.getElementById('kyc-err');
  errEl.style.display = 'none';
  const kyc_status = document.getElementById('kyc-status').value;
  const kyc_rejection_reason = document.getElementById('kyc-reason').value;
  try {
    await api.updateKyc(id, { kyc_status, kyc_rejection_reason: kyc_rejection_reason || undefined });
    closeModal();
    toast('KYC status updated.', 'success');
    await loadAdminCompanies();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
}

async function loadAdminProjects() {
  document.getElementById('admin-tab-content').innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
  try {
    const projects = await api.adminProjects();
    document.getElementById('admin-tab-content').innerHTML = `
      <div class="card">
        <div class="card-header"><span class="card-title">All Projects (${projects.length})</span></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Project</th><th>Company</th><th>Type</th><th>Country</th><th>Standard</th><th>Cap</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              ${projects.map(p => `
                <tr>
                  <td><strong>${esc(p.name)}</strong><br><span class="text-muted" style="font-size:11px">${fmtDate(p.created_at)}</span></td>
                  <td>${esc(p.company_name)}</td>
                  <td>${badge(p.project_type.replace('_',' '),'green')}</td>
                  <td>${esc(p.country)}</td>
                  <td style="font-size:12px">${esc(p.verification_standard)}</td>
                  <td>${fmt(p.total_credits_cap,0)}</td>
                  <td>${badge(p.status)}</td>
                  <td>
                    ${p.status === 'pending' ? `
                      <button class="btn btn-primary btn-xs" onclick="approveProject(${jsArg(p.id)},'active')">Approve</button>
                      <button class="btn btn-danger btn-xs" onclick="approveProject(${jsArg(p.id)},'rejected')">Reject</button>
                    ` : `<button class="btn btn-ghost btn-xs" onclick="approveProject(${jsArg(p.id)},'${p.status==='active'?'suspended':'active'}')">
                      ${p.status === 'active' ? 'Suspend' : 'Activate'}
                    </button>`}
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    document.getElementById('admin-tab-content').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

async function approveProject(id, status) {
  const note = status === 'rejected' ? prompt('Rejection reason:') : undefined;
  if (status === 'rejected' && !note) return;
  try {
    await api.approveProject(id, { status, admin_notes: note });
    toast('Project status updated to: ' + status, 'success');
    await loadAdminProjects();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function loadAdminUsers() {
  document.getElementById('admin-tab-content').innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
  try {
    const users = await api.adminUsers();
    document.getElementById('admin-tab-content').innerHTML = `
      <div class="card">
        <div class="card-header"><span class="card-title">All Users (${users.length})</span></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Verified</th><th>Active</th><th>Last Login</th><th>Joined</th><th>Actions</th></tr></thead>
            <tbody>
              ${users.map(u => `
                <tr>
                  <td><strong>${esc(u.full_name)}</strong></td>
                  <td class="text-muted">${esc(u.email)}</td>
                  <td>${badge(u.role,'blue')}</td>
                  <td>${u.is_verified ? '✅' : '❌'}</td>
                  <td>${u.is_active ? badge('Active','green') : badge('Disabled','red')}</td>
                  <td class="text-muted">${fmtDate(u.last_login_at)}</td>
                  <td class="text-muted">${fmtDate(u.created_at)}</td>
                  <td>
                    <button class="btn btn-ghost btn-xs" onclick="toggleUser(${jsArg(u.id)})">${u.is_active ? 'Disable' : 'Enable'}</button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    document.getElementById('admin-tab-content').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

async function toggleUser(id) {
  try {
    await api.toggleUser(id);
    toast('User status updated.', 'success');
    await loadAdminUsers();
  } catch (err) { toast(err.message, 'error'); }
}

async function loadAdminTrades() {
  document.getElementById('admin-tab-content').innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
  try {
    const trades = await api.adminTrades();
    document.getElementById('admin-tab-content').innerHTML = `
      <div class="card">
        <div class="card-header"><span class="card-title">All Trades (${trades.length})</span>
          <button class="btn btn-outline btn-sm" onclick="runExpiryJob()">Run order-expiry job now</button></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Credit</th><th>Project</th><th>Buyer</th><th>Seller</th><th>Qty</th><th>Price</th><th>Total Value</th><th>Fee</th></tr></thead>
            <tbody>
              ${trades.length ? trades.map(t => `
                <tr>
                  <td>${fmtDateTime(t.executed_at)}</td>
                  <td>${esc(t.serial_number)}</td>
                  <td>${esc(t.project_name)}</td>
                  <td>${esc(t.buyer_name)}</td>
                  <td>${esc(t.seller_name)}</td>
                  <td>${fmt(t.quantity,0)}</td>
                  <td>${fmtCurrency(t.trade_price)}</td>
                  <td><strong>${fmtCurrency(t.total_value)}</strong></td>
                  <td class="text-muted">${fmtCurrency(t.platform_fee)}</td>
                </tr>`).join('')
                : '<tr><td colspan="9" class="table-empty">No trades yet.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    document.getElementById('admin-tab-content').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

async function loadAdminReports() {
  document.getElementById('admin-tab-content').innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
  try {
    const reports = await api.adminReports();
    document.getElementById('admin-tab-content').innerHTML = `
      <div class="card">
        <div class="card-header"><span class="card-title">Emissions Reports (${reports.length})</span></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Company</th><th>Year</th><th>Total tCO2e</th><th>Offset</th><th>Net</th><th>Compliance</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              ${reports.map(r => `
                <tr>
                  <td><strong>${esc(r.legal_name)}</strong></td>
                  <td>${esc(r.report_year)}</td>
                  <td>${fmt(r.total_tonnes)}</td>
                  <td class="text-green">${fmt(r.offset_tonnes)}</td>
                  <td class="${parseFloat(r.net_emissions)<=0?'text-green':'text-red'}">${fmt(r.net_emissions)}</td>
                  <td>${badge(r.compliance_status)}</td>
                  <td>${badge(r.report_status)}</td>
                  <td>
                    ${r.report_status === 'submitted' ? `
                      <button class="btn btn-primary btn-xs" onclick="reviewReport(${jsArg(r.id)},'approved')">Approve</button>
                      <button class="btn btn-danger btn-xs" onclick="reviewReport(${jsArg(r.id)},'rejected')">Reject</button>
                    ` : '—'}
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    document.getElementById('admin-tab-content').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

async function reviewReport(id, status) {
  const notes = status === 'rejected' ? prompt('Review notes:') : undefined;
  try {
    await api.reviewReport(id, { status, review_notes: notes });
    toast('Report ' + status + '.', 'success');
    await loadAdminReports();
  } catch (err) { toast(err.message, 'error'); }
}

async function loadAdminAudit() {
  document.getElementById('admin-tab-content').innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
  try {
    const logs = await api.adminAudit();
    document.getElementById('admin-tab-content').innerHTML = `
      <div class="card">
        <div class="card-header"><span class="card-title">Audit Log (last 100)</span></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Schema</th><th>Table</th><th>Record ID</th></tr></thead>
            <tbody>
              ${logs.map(l => `
                <tr>
                  <td style="font-size:12px">${fmtDateTime(l.logged_at)}</td>
                  <td class="text-muted" style="font-size:12px">${l.user_email || 'System'}</td>
                  <td>${badge(l.action, l.action==='INSERT'?'green':l.action==='DELETE'?'red':l.action==='LOGIN'?'blue':'gray')}</td>
                  <td class="text-muted">${esc(l.schema_name)}</td>
                  <td>${esc(l.table_name)}</td>
                  <td class="text-muted" style="font-size:11px">${l.record_id ? esc(String(l.record_id).substring(0,8))+'…' : '—'}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    document.getElementById('admin-tab-content').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

// Fills the document list inside the KYC review modal
function loadKycDocList(companyId) {
  api.companyDocuments(companyId).then((docs) => {
    const el = document.getElementById('kyc-doc-list');
    if (!el) return;
    el.innerHTML = docs.length ? docs.map((d) => `
      <div class="flex justify-between items-center" style="padding:6px 0;border-bottom:1px solid var(--border);font-size:13px">
        <span>${esc(d.doc_type.replace(/_/g, ' '))} — ${esc(d.original_name)} <span class="text-muted">(${fmt(d.size_bytes / 1024, 1)} KB)</span></span>
        <button class="btn btn-ghost btn-xs" onclick="downloadFile(${jsArg('/companies/documents/' + d.id + '/download')}, ${jsArg(d.original_name)})">Download</button>
      </div>`).join('') : '<div class="alert alert-warning" style="margin:0">No documents uploaded yet — approval is blocked until they are.</div>';
  }).catch((err) => {
    const el = document.getElementById('kyc-doc-list');
    if (el) el.innerHTML = `<span class="text-red">${esc(err.message)}</span>`;
  });
}

async function loadAdminOverview() {
  const el = document.getElementById('admin-tab-content');
  el.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
  try {
    const s = await api.adminStats();
    const card = (label, value, sub) => `<div class="stat-card"><div class="stat-label">${label}</div><div class="stat-value">${value}</div><div class="stat-sub">${sub}</div></div>`;
    el.innerHTML = `
      <div class="card-grid">
        ${card('Companies', esc(s.companies), `${esc(s.kyc_pending)} waiting for KYC review`)}
        ${card('Projects Pending', esc(s.projects_pending), 'Awaiting approval')}
        ${card('Trades', esc(s.trades), `${fmt(s.volume_tonnes, 0)} tCO2e traded`)}
        ${card('Traded Value', fmtCurrency(s.traded_value), `${fmtCurrency(s.fee_revenue)} platform fees`)}
        ${card('Credits Retired', fmt(s.retired_tonnes, 0), 'tCO2e permanently retired')}
        ${card('Wallet Funds', fmtCurrency(s.wallet_funds), `${fmtCurrency(s.escrow_funds)} in escrow, ${esc(s.open_orders)} open orders`)}
      </div>`;
  } catch (err) {
    el.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

async function loadAdminRetirements() {
  const el = document.getElementById('admin-tab-content');
  el.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
  try {
    const list = await api.adminRetirements();
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><span class="card-title">Retirement Certificates (${list.length})</span></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Certificate</th><th>Company</th><th>Credit</th><th>Quantity</th><th>Year</th><th>Beneficiary</th><th>Retired</th></tr></thead>
          <tbody>${list.length ? list.map((r) => `
            <tr>
              <td><strong>${esc(r.certificate_number)}</strong></td>
              <td>${esc(r.company_name)}</td>
              <td>${esc(r.serial_number)}</td>
              <td>${fmt(r.quantity, 0)} tCO2e</td>
              <td>${esc(r.report_year)}</td>
              <td>${esc(r.beneficiary)}</td>
              <td class="text-muted">${fmtDateTime(r.retired_at)}</td>
            </tr>`).join('') : '<tr><td colspan="7" class="table-empty">No retirements yet.</td></tr>'}</tbody>
        </table></div>
      </div>`;
  } catch (err) {
    el.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

async function runExpiryJob() {
  try {
    const r = await api.runExpiryJob();
    toast(r.message, 'success');
    await loadAdminTrades();
  } catch (err) { toast(err.message, 'error'); }
}

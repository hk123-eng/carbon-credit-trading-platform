async function renderRetirements() {
  const container = document.getElementById('page-container');
  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">Retirements</div>
      <div class="page-sub">Credits you have permanently retired to offset emissions, with their certificates</div>
    </div>
    <div class="card mb-16">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div class="form-group" style="margin:0;flex:1;min-width:220px">
          <label>Check any certificate number</label>
          <input type="text" id="cert-lookup" placeholder="RET-2024-000001" onkeydown="if(event.key==='Enter')lookupCertificate()" />
        </div>
        <button class="btn btn-outline" onclick="lookupCertificate()">Verify</button>
      </div>
      <div id="cert-lookup-result" style="margin-top:10px"></div>
    </div>
    <div id="ret-content"><div class="loading-center"><div class="spinner"></div></div></div>
  `;
  try {
    const list = await api.myRetirements();
    const total = list.reduce((s, r) => s + Number(r.quantity), 0);
    document.getElementById('ret-content').innerHTML = `
      <div class="card">
        <div class="card-header">
          <span class="card-title">My Certificates (${list.length}) — ${fmt(total, 0)} tCO2e retired</span>
          <button class="btn btn-outline btn-sm" onclick="navigateTo('portfolio')">Retire from Portfolio</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Certificate</th><th>Credit</th><th>Project</th><th>Quantity</th><th>Report Year</th><th>Beneficiary</th><th>Retired</th><th></th></tr></thead>
            <tbody>
              ${list.length ? list.map((r) => `
                <tr>
                  <td><strong>${esc(r.certificate_number)}</strong></td>
                  <td>${esc(r.serial_number)}<br><span class="text-muted">${esc(r.vintage_year)}</span></td>
                  <td>${esc(r.project_name)}</td>
                  <td>${fmt(r.quantity, 0)} tCO2e</td>
                  <td>${esc(r.report_year)}</td>
                  <td>${esc(r.beneficiary)}</td>
                  <td class="text-muted">${fmtDate(r.retired_at)}</td>
                  <td><button class="btn btn-outline btn-xs" onclick="showCertificate(${jsArg(r.id)})">View</button></td>
                </tr>`).join('') : '<tr><td colspan="8" class="table-empty">No credits retired yet. Retire held credits from your Portfolio.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    document.getElementById('ret-content').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

async function lookupCertificate() {
  const number = document.getElementById('cert-lookup').value.trim().toUpperCase();
  const out = document.getElementById('cert-lookup-result');
  if (!number) return;
  try {
    const c = await api.verifyCertificate(number);
    out.innerHTML = `<div class="alert alert-success">✔ <strong>${esc(c.certificate_number)}</strong> is genuine:
      ${fmt(c.quantity, 0)} tCO2e of ${esc(c.serial_number)} (${esc(c.project_name)}) retired by ${esc(c.retired_by)}
      for ${esc(c.beneficiary)} against ${esc(c.report_year)} emissions.</div>`;
  } catch (err) {
    out.innerHTML = `<div class="alert alert-error">No certificate with this number exists.</div>`;
  }
}

async function showCertificate(id) {
  openModal('Retirement Certificate', '<div class="loading-center"><div class="spinner"></div></div>');
  try {
    const c = await api.certificate(id);
    document.getElementById('modal-body').innerHTML = `
      <div class="certificate" id="certificate">
        <div class="cert-logo">🌱 CarbonTrade</div>
        <div class="cert-title">Certificate of Carbon Credit Retirement</div>
        <div class="cert-number">${esc(c.certificate_number)}</div>
        <p class="cert-text">This certifies that</p>
        <div class="cert-amount">${fmt(c.quantity, 0)} tCO2e</div>
        <p class="cert-text">have been permanently retired on behalf of <strong>${esc(c.beneficiary)}</strong>
          by <strong>${esc(c.company_name)}</strong> to offset emissions reported for <strong>${esc(c.report_year)}</strong>.</p>
        <table class="cert-table">
          <tr><td>Credit serial</td><td>${esc(c.serial_number)} (vintage ${esc(c.vintage_year)})</td></tr>
          <tr><td>Project</td><td>${esc(c.project_name)}, ${esc(c.project_country)}</td></tr>
          <tr><td>Standard</td><td>${esc(c.verification_standard)}</td></tr>
          <tr><td>Reason</td><td>${esc(c.reason) || '—'}</td></tr>
          <tr><td>Retired on</td><td>${fmtDateTime(c.retired_at)}</td></tr>
        </table>
        <p class="cert-foot">Anyone can confirm this certificate on the Retirements page by entering its number.</p>
      </div>
      <div class="modal-actions no-print">
        <button class="btn btn-ghost" onclick="closeModal()">Close</button>
        <button class="btn btn-primary" onclick="window.print()">Print / Save as PDF</button>
      </div>
    `;
  } catch (err) {
    document.getElementById('modal-body').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

function openRetireModal(creditId, serial, held) {
  const year = new Date().getFullYear() - 1;
  const user = getUser();
  openModal('Retire Credits', `
    <div id="ret-err" class="alert alert-error" style="display:none"></div>
    <div class="info-box mb-16">Retired credits are removed from circulation for good and count as offsets in your emissions report for the chosen year.</div>
    <div class="form-group"><label>Credit</label><input type="text" value="${esc(serial)}" disabled /></div>
    <div class="form-row">
      <div class="form-group"><label>Quantity (tCO2e) — you hold ${fmt(held, 0)}</label><input type="number" id="ret-qty" min="1" max="${esc(held)}" /></div>
      <div class="form-group"><label>Emissions Report Year</label><input type="number" id="ret-year" value="${year}" max="${year + 1}" min="2000" /></div>
    </div>
    <div class="form-group"><label>Beneficiary</label><input type="text" id="ret-ben" value="${esc(user?.legal_name || user?.full_name || '')}" /></div>
    <div class="form-group"><label>Reason (optional)</label><input type="text" id="ret-reason" placeholder="e.g. Offset of Scope 1 emissions" /></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="ret-submit" onclick="submitRetire(${jsArg(creditId)})">Retire Credits</button>
    </div>
  `);
}

async function submitRetire(creditId) {
  const errEl = document.getElementById('ret-err');
  const btn = document.getElementById('ret-submit');
  errEl.style.display = 'none';
  btn.disabled = true;
  try {
    const r = await api.retire({
      credit_id: creditId,
      quantity: document.getElementById('ret-qty').value,
      report_year: parseInt(document.getElementById('ret-year').value),
      beneficiary: document.getElementById('ret-ben').value,
      reason: document.getElementById('ret-reason').value || undefined,
    });
    toast(`Certificate ${r.retirement.certificate_number} issued.`, 'success');
    await showCertificate(r.retirement.id);
    refreshNotificationBadge();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
    btn.disabled = false;
  }
}

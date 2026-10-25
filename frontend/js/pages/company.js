async function renderCompanyPage() {
  const container = document.getElementById('page-container');
  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">Company Profile</div>
      <div class="page-sub">Your registered company details</div>
    </div>
    <div id="company-content"><div class="loading-center"><div class="spinner"></div></div></div>
  `;

  try {
    const company = await api.myCompany().catch(() => null);
    if (!company) {
      document.getElementById('company-content').innerHTML = `
        <div class="card" style="max-width:600px">
          <h3 style="margin-bottom:8px">Register Your Company</h3>
          <p class="text-muted" style="margin-bottom:20px">You need to register a company profile to start trading carbon credits.</p>
          ${getUser() && !getUser().is_verified ? `<div class="alert alert-warning">Please verify your e-mail address first. <a href="#" onclick="navigateTo('security');return false">Go to Security</a></div>` : ''}
          <div id="comp-err" class="alert alert-error" style="display:none"></div>
          ${companyForm()}
          <div style="margin-top:20px">
            <button class="btn btn-primary" onclick="registerCompany()">Register Company</button>
          </div>
        </div>
      `;
    } else {
      document.getElementById('company-content').innerHTML = `
        <div class="two-col">
          <div class="card">
            <div class="card-header">
              <span class="card-title">${esc(company.legal_name)}</span>
              ${badge(company.kyc_status)}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px">
              <div><span class="text-muted">Type</span><br><strong>${esc(company.company_type)}</strong></div>
              <div><span class="text-muted">Country</span><br><strong>${esc(company.country)}</strong></div>
              <div><span class="text-muted">Sector</span><br><strong>${esc(company.industry_sector)}</strong></div>
              <div><span class="text-muted">Reg. Number</span><br><strong>${esc(company.registration_number)}</strong></div>
              <div><span class="text-muted">Founded</span><br><strong>${company.founded_year || '—'}</strong></div>
              <div><span class="text-muted">Employees</span><br><strong>${company.employee_count || '—'}</strong></div>
              <div><span class="text-muted">Revenue (USD)</span><br><strong>${company.annual_revenue_usd ? fmtCurrency(company.annual_revenue_usd) : '—'}</strong></div>
              <div><span class="text-muted">Baseline Emissions</span><br><strong>${company.annual_emissions_baseline ? fmt(company.annual_emissions_baseline) + ' ' + company.emissions_unit : '—'}</strong></div>
            </div>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">Reliability & KYC</span></div>
            <div style="margin-bottom:12px">
              <div class="text-muted" style="font-size:12px;margin-bottom:4px">Reliability Score</div>
              <div style="font-size:28px;font-weight:700;color:var(--primary)">${esc(company.reliability_score)}</div>
              <div class="progress-bar" style="margin-top:6px"><div class="progress-fill" style="width:${esc(company.reliability_score)}%"></div></div>
            </div>
            <hr>
            <div style="font-size:13px">
              <div class="flex justify-between" style="padding:6px 0;border-bottom:1px solid var(--border)">
                <span class="text-muted">KYC Status</span>${badge(company.kyc_status)}
              </div>
              <div class="flex justify-between" style="padding:6px 0;border-bottom:1px solid var(--border)">
                <span class="text-muted">Account Verified</span><span>${company.is_verified ? '✅ Yes' : '❌ No'}</span>
              </div>
              <div class="flex justify-between" style="padding:6px 0">
                <span class="text-muted">Member Since</span><span>${fmtDate(company.created_at)}</span>
              </div>
            </div>
            ${company.kyc_status === 'pending' ? `<div class="alert alert-warning" style="margin-top:12px">Your KYC is pending. Upload your documents below; you can trade once an administrator approves them.</div>` : ''}
            ${company.kyc_status === 'rejected' && company.kyc_rejection_reason ? `<div class="alert alert-error" style="margin-top:12px">KYC rejected: ${esc(company.kyc_rejection_reason)}</div>` : ''}
          </div>
        </div>
        <div class="card mt-24">
          <div class="card-header"><span class="card-title">Pollution Sources</span></div>
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            ${(company.primary_pollution_sources || []).map(s => `<span class="badge badge-gray">${esc(s.replace(/_/g,' '))}</span>`).join('') || '<span class="text-muted">None listed</span>'}
          </div>
        </div>
        <div class="card mt-24">
          <div class="card-header"><span class="card-title">KYC Documents</span></div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px">
            <div class="form-group" style="margin:0">
              <label>Document type</label>
              <select id="doc-type">
                <option value="certificate_of_incorporation">Certificate of incorporation</option>
                <option value="tax_registration">Tax registration (GST / PAN)</option>
                <option value="address_proof">Registered address proof</option>
                <option value="authorised_signatory_id">Authorised signatory ID</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div class="form-group" style="margin:0;flex:1;min-width:200px">
              <label>File (PDF, PNG or JPEG, up to 5 MB)</label>
              <input type="file" id="doc-file" accept="application/pdf,image/png,image/jpeg" />
            </div>
            <button class="btn btn-primary" id="doc-upload-btn" onclick="uploadKycDocument()">Upload</button>
          </div>
          <div id="kyc-docs"><div class="loading-center"><div class="spinner"></div></div></div>
        </div>
      `;
      loadKycDocuments();
    }
  } catch (err) {
    document.getElementById('company-content').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

function companyForm(c = {}) {
  return `
    <div class="form-row">
      <div class="form-group"><label>Legal Name *</label><input type="text" id="cf-legal" value="${esc(c.legal_name)}" placeholder="Company Legal Name"/></div>
      <div class="form-group"><label>Trade Name</label><input type="text" id="cf-trade" value="${esc(c.trade_name)}" placeholder="Optional trade name"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Company Type *</label>
        <select id="cf-type">
          <option value="buyer" ${c.company_type==='buyer'?'selected':''}>Buyer</option>
          <option value="seller" ${c.company_type==='seller'?'selected':''}>Seller</option>
          <option value="both" ${c.company_type==='both'?'selected':''}>Both</option>
        </select>
      </div>
      <div class="form-group"><label>Registration Number *</label><input type="text" id="cf-reg" value="${esc(c.registration_number)}" placeholder="e.g. SC-IN-2003-00812"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Country Code * (2 letters)</label><input type="text" id="cf-country" value="${esc(c.country)}" maxlength="2" placeholder="IN"/></div>
      <div class="form-group"><label>Industry Sector *</label>
        <select id="cf-sector">
          ${['energy','manufacturing','transport','agriculture','construction','finance','technology','retail','other'].map(s=>`<option value="${s}" ${c.industry_sector===s?'selected':''}>${s}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Annual Revenue (USD)</label><input type="number" id="cf-rev" value="${esc(c.annual_revenue_usd)}" placeholder="0"/></div>
      <div class="form-group"><label>Employee Count</label><input type="number" id="cf-emp" value="${esc(c.employee_count)}" placeholder="0"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Annual Emissions Baseline (tCO2e)</label><input type="number" id="cf-emis" value="${esc(c.annual_emissions_baseline)}" placeholder="0"/></div>
      <div class="form-group"><label>Founded Year</label><input type="number" id="cf-founded" value="${esc(c.founded_year)}" placeholder="2000"/></div>
    </div>
  `;
}

async function registerCompany() {
  const errEl = document.getElementById('comp-err');
  errEl.style.display = 'none';
  const data = {
    legal_name: document.getElementById('cf-legal').value.trim(),
    trade_name: document.getElementById('cf-trade').value.trim() || undefined,
    company_type: document.getElementById('cf-type').value,
    registration_number: document.getElementById('cf-reg').value.trim(),
    country: document.getElementById('cf-country').value.trim().toUpperCase(),
    industry_sector: document.getElementById('cf-sector').value,
    annual_revenue_usd: parseFloat(document.getElementById('cf-rev').value) || undefined,
    employee_count: parseInt(document.getElementById('cf-emp').value) || undefined,
    annual_emissions_baseline: parseFloat(document.getElementById('cf-emis').value) || undefined,
    founded_year: parseInt(document.getElementById('cf-founded').value) || undefined,
  };
  try {
    await api.registerCompany(data);
    toast('Company registered! Awaiting KYC review.', 'success');
    await renderCompanyPage();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
}

// Projects page for sellers
async function renderProjectsPage() {
  const container = document.getElementById('page-container');
  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">My Projects</div>
      <div class="page-sub">Manage your carbon offset projects and credits</div>
    </div>
    <div class="tabs">
      <button class="tab-btn active" onclick="switchProjectTab('projects',this)">Projects</button>
      <button class="tab-btn" onclick="switchProjectTab('credits',this)">Issue Credits</button>
    </div>
    <div id="project-tab-content"><div class="loading-center"><div class="spinner"></div></div></div>
  `;
  await loadMyProjects();
}

async function switchProjectTab(tab, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (tab === 'projects') await loadMyProjects();
  else openIssueCreditsModal();
}

async function loadMyProjects() {
  document.getElementById('project-tab-content').innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
  try {
    const projects = await api.myProjects();
    document.getElementById('project-tab-content').innerHTML = `
      <div class="card">
        <div class="card-header">
          <span class="card-title">My Carbon Projects (${projects.length})</span>
          <button class="btn btn-primary btn-sm" onclick="openCreateProject()">+ New Project</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Type</th><th>Standard</th><th>Country</th><th>Cap</th><th>Issued</th><th>Period</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              ${projects.length ? projects.map(p => `
                <tr>
                  <td><strong>${esc(p.name)}</strong></td>
                  <td>${badge(p.project_type.replace('_',' '),'green')}</td>
                  <td>${esc(p.verification_standard)}</td>
                  <td>${esc(p.country)}</td>
                  <td>${fmt(p.total_credits_cap,0)}</td>
                  <td>${fmt(p.total_issued,0)}</td>
                  <td style="font-size:12px">${fmtDate(p.start_date)} – ${fmtDate(p.end_date)}</td>
                  <td>${badge(p.status)}</td>
                  <td>
                    ${p.status === 'active' ? `<button class="btn btn-outline btn-xs" onclick="openIssueCreditsForm(${jsArg(p.id)},${jsArg(p.name)})">Issue Credits</button>` : ''}
                  </td>
                </tr>`).join('')
                : '<tr><td colspan="9" class="table-empty">No projects yet.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    document.getElementById('project-tab-content').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

function openCreateProject() {
  openModal('Create Carbon Project', `
    <div id="proj-err" class="alert alert-error" style="display:none"></div>
    <div class="form-group"><label>Project Name *</label><input type="text" id="pj-name" placeholder="e.g. Amazon Reforestation 2024"/></div>
    <div class="form-group"><label>Description *</label><textarea id="pj-desc" placeholder="Describe the project in detail (min 20 chars)…"></textarea></div>
    <div class="form-row">
      <div class="form-group"><label>Project Type *</label>
        <select id="pj-type">
          ${['forestry','solar','wind','hydro','methane_capture','energy_efficiency','ocean','direct_air_capture','other'].map(t=>`<option value="${t}">${t.replace('_',' ')}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Country Code *</label><input type="text" id="pj-country" placeholder="IN" maxlength="2"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Verification Standard *</label>
        <select id="pj-std">
          ${['Verra VCS','Gold Standard','American Carbon Registry','Climate Action Reserve','Plan Vivo','Other'].map(s=>`<option value="${s}">${s}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Verification Body *</label><input type="text" id="pj-body" placeholder="e.g. Bureau Veritas"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Total Credits Cap *</label><input type="number" id="pj-cap" placeholder="e.g. 500000"/></div>
      <div class="form-group"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Start Date *</label><input type="date" id="pj-start"/></div>
      <div class="form-group"><label>End Date *</label><input type="date" id="pj-end"/></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="createProject()">Submit for Review</button>
    </div>
  `);
}

async function createProject() {
  const errEl = document.getElementById('proj-err');
  errEl.style.display = 'none';
  const data = {
    name: document.getElementById('pj-name').value.trim(),
    description: document.getElementById('pj-desc').value.trim(),
    project_type: document.getElementById('pj-type').value,
    verification_standard: document.getElementById('pj-std').value,
    verification_body: document.getElementById('pj-body').value.trim(),
    country: document.getElementById('pj-country').value.trim().toUpperCase(),
    total_credits_cap: parseFloat(document.getElementById('pj-cap').value),
    start_date: document.getElementById('pj-start').value,
    end_date: document.getElementById('pj-end').value,
  };
  try {
    await api.createProject(data);
    closeModal();
    toast('Project submitted for admin review!', 'success');
    await loadMyProjects();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
}

function openIssueCreditsForm(projectId, projectName) {
  openModal('Issue Credits — ' + projectName, `
    <div id="cred-err" class="alert alert-error" style="display:none"></div>
    <div class="form-row">
      <div class="form-group"><label>Serial Number *</label><input type="text" id="cred-serial" placeholder="e.g. VCS-2024-000010"/></div>
      <div class="form-group"><label>Vintage Year *</label><input type="number" id="cred-vintage" value="${new Date().getFullYear()-1}" min="1990"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Quantity (tCO2e) *</label><input type="number" id="cred-qty" placeholder="e.g. 10000"/></div>
      <div class="form-group"><label>Price per Unit ($) *</label><input type="number" id="cred-price" placeholder="e.g. 22.50" step="0.01"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Unit</label>
        <select id="cred-unit"><option value="tCO2e">tCO2e</option><option value="ktCO2e">ktCO2e</option></select>
      </div>
      <div class="form-group"><label>CO2 Methodology</label><input type="text" id="cred-meth" placeholder="e.g. IPCC Tier 2"/></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="issueCredits(${jsArg(projectId)})">Issue Credits</button>
    </div>
  `);
}

function openIssueCreditsModal() {
  openModal('Issue Credits', '<p class="text-muted">Please use the "Issue Credits" button on a specific active project from the Projects tab.</p><div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">OK</button></div>');
  loadMyProjects();
}

async function issueCredits(projectId) {
  const errEl = document.getElementById('cred-err');
  errEl.style.display = 'none';
  const data = {
    project_id: projectId,
    serial_number: document.getElementById('cred-serial').value.trim(),
    vintage_year: parseInt(document.getElementById('cred-vintage').value),
    quantity: parseFloat(document.getElementById('cred-qty').value),
    price_per_unit: parseFloat(document.getElementById('cred-price').value),
    unit: document.getElementById('cred-unit').value,
    co2_methodology: document.getElementById('cred-meth').value || undefined,
  };
  try {
    await api.issueCredits(data);
    closeModal();
    toast('Credits issued and listed on market!', 'success');
    await loadMyProjects();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
}

async function loadKycDocuments() {
  const el = document.getElementById('kyc-docs');
  if (!el) return;
  try {
    const docs = await api.myDocuments();
    el.innerHTML = docs.length ? `
      <div class="table-wrap"><table>
        <thead><tr><th>Type</th><th>File</th><th>Size</th><th>SHA-256</th><th>Uploaded</th><th></th></tr></thead>
        <tbody>${docs.map((d) => `
          <tr>
            <td>${esc(d.doc_type.replace(/_/g, ' '))}</td>
            <td>${esc(d.original_name)}</td>
            <td class="text-muted">${fmt(d.size_bytes / 1024, 1)} KB</td>
            <td class="text-muted" style="font-family:monospace;font-size:11px">${esc(d.sha256.slice(0, 16))}…</td>
            <td class="text-muted">${fmtDateTime(d.uploaded_at)}</td>
            <td><button class="btn btn-ghost btn-xs" onclick="downloadFile(${jsArg('/companies/documents/' + d.id + '/download')}, ${jsArg(d.original_name)})">Download</button></td>
          </tr>`).join('')}</tbody>
      </table></div>` : '<p class="text-muted" style="font-size:13px">No documents uploaded yet.</p>';
  } catch (err) {
    el.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}

async function uploadKycDocument() {
  const file = document.getElementById('doc-file').files[0];
  if (!file) { toast('Choose a file first.', 'error'); return; }
  if (file.size > 5 * 1024 * 1024) { toast('Files must be 5 MB or smaller.', 'error'); return; }
  const btn = document.getElementById('doc-upload-btn');
  btn.disabled = true;
  try {
    const data_base64 = await readFileAsBase64(file);
    await api.uploadDocument({ doc_type: document.getElementById('doc-type').value, file_name: file.name, mime_type: file.type, data_base64 });
    toast('Document uploaded.', 'success');
    document.getElementById('doc-file').value = '';
    await loadKycDocuments();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

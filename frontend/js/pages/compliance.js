async function renderCompliance() {
  const container = document.getElementById('page-container');
  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">Compliance</div>
      <div class="page-sub">Emissions reporting and reduction targets</div>
    </div>
    <div class="tabs">
      <button class="tab-btn active" onclick="switchComplianceTab('reports',this)">Emissions Reports</button>
      <button class="tab-btn" onclick="switchComplianceTab('targets',this)">Reduction Targets</button>
    </div>
    <div id="compliance-tab-content"><div class="loading-center"><div class="spinner"></div></div></div>
  `;
  await loadEmissionsReports();
}

async function switchComplianceTab(tab, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (tab === 'reports') await loadEmissionsReports();
  else await loadTargets();
}

async function loadEmissionsReports() {
  document.getElementById('compliance-tab-content').innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
  try {
    const reports = await api.myReports();
    document.getElementById('compliance-tab-content').innerHTML = `
      <div class="card">
        <div class="card-header">
          <span class="card-title">Annual Emissions Reports</span>
          <button class="btn btn-primary btn-sm" onclick="openSubmitReport()">+ Submit Report</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Year</th><th>Scope 1</th><th>Scope 2</th><th>Scope 3</th><th>Total</th><th>Retired Credits</th><th>Net Emissions</th><th>Allowed by Target</th><th>Compliance</th><th>Status</th></tr></thead>
            <tbody>
              ${reports.length ? reports.map(r => `
                <tr>
                  <td><strong>${esc(r.report_year)}</strong></td>
                  <td>${fmt(r.scope1_tonnes)} t</td>
                  <td>${fmt(r.scope2_tonnes)} t</td>
                  <td>${fmt(r.scope3_tonnes)} t</td>
                  <td><strong>${fmt(r.total_tonnes)} t</strong></td>
                  <td class="text-green">${fmt(r.offset_tonnes)} t</td>
                  <td class="${parseFloat(r.net_emissions) <= 0 ? 'text-green' : 'text-red'}"><strong>${fmt(r.net_emissions)} t</strong></td>
                  <td class="text-muted">${r.allowed_emissions !== null ? fmt(r.allowed_emissions) + ' t<br><span style="font-size:11px">target ' + esc(r.target_year) + '</span>' : '—'}</td>
                  <td>${badge((r.compliance_status || '').replace('_', ' '), r.compliance_status)}</td>
                  <td>${badge(r.report_status)}</td>
                </tr>`).join('')
                : '<tr><td colspan="10" class="table-empty">No reports submitted yet.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    document.getElementById('compliance-tab-content').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

function openSubmitReport() {
  const currentYear = new Date().getFullYear() - 1;
  openModal('Submit Emissions Report', `
    <div id="rep-err" class="alert alert-error" style="display:none"></div>
    <div class="info-box mb-16">Report covers your company's GHG emissions for one calendar year.</div>
    <div class="form-group">
      <label>Report Year</label>
      <input type="number" id="rep-year" value="${currentYear}" max="${currentYear}" min="2000" />
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Scope 1 Emissions (tCO2e) — Direct</label>
        <input type="number" id="rep-s1" placeholder="0" min="0" step="0.01"/>
      </div>
      <div class="form-group">
        <label>Scope 2 Emissions (tCO2e) — Energy</label>
        <input type="number" id="rep-s2" placeholder="0" min="0" step="0.01"/>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Scope 3 Emissions (tCO2e) — Value Chain</label>
        <input type="number" id="rep-s3" placeholder="0" min="0" step="0.01"/>
      </div>
      <div class="form-group">
        <label>Credits Purchased</label>
        <input type="number" id="rep-cp" placeholder="0" min="0" step="0.0001"/>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Credits Retired (Offsets)</label>
        <input type="text" value="Taken automatically from your retirement certificates" disabled/>
      </div>
      <div class="form-group">
        <label>Methodology</label>
        <select id="rep-meth">
          <option value="GHG Protocol">GHG Protocol</option>
          <option value="ISO 14064">ISO 14064</option>
          <option value="CDP">CDP</option>
          <option value="Other">Other</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Third-Party Verified?</label>
        <select id="rep-tpv">
          <option value="false">No</option>
          <option value="true">Yes</option>
        </select>
      </div>
      <div class="form-group">
        <label>Verifier Name</label>
        <input type="text" id="rep-verifier" placeholder="e.g. Bureau Veritas" />
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitReport()">Submit Report</button>
    </div>
  `);
}

async function submitReport() {
  const errEl = document.getElementById('rep-err');
  errEl.style.display = 'none';
  const data = {
    report_year: parseInt(document.getElementById('rep-year').value),
    scope1_tonnes: parseFloat(document.getElementById('rep-s1').value) || 0,
    scope2_tonnes: parseFloat(document.getElementById('rep-s2').value) || 0,
    scope3_tonnes: parseFloat(document.getElementById('rep-s3').value) || 0,
    credits_purchased: parseFloat(document.getElementById('rep-cp').value) || 0,
    methodology: document.getElementById('rep-meth').value,
    third_party_verified: document.getElementById('rep-tpv').value === 'true',
    verifier_name: document.getElementById('rep-verifier').value || undefined,
  };
  try {
    await api.submitReport(data);
    closeModal();
    toast('Emissions report submitted!', 'success');
    await loadEmissionsReports();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
}

async function loadTargets() {
  document.getElementById('compliance-tab-content').innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
  try {
    const targets = await api.myTargets();
    document.getElementById('compliance-tab-content').innerHTML = `
      <div class="card">
        <div class="card-header">
          <span class="card-title">Reduction Targets</span>
          <button class="btn btn-primary btn-sm" onclick="openSetTarget()">+ Set Target</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Baseline Year</th><th>Target Year</th><th>Reduction</th><th>Type</th><th>Description</th><th>Public</th></tr></thead>
            <tbody>
              ${targets.length ? targets.map(t => `
                <tr>
                  <td>${esc(t.baseline_year)}</td>
                  <td><strong>${esc(t.target_year)}</strong></td>
                  <td>
                    <div class="progress-bar" style="width:100px;margin-bottom:2px"><div class="progress-fill" style="width:${t.reduction_pct}%"></div></div>
                    <span style="font-size:12px">${fmt(t.reduction_pct)}%</span>
                  </td>
                  <td>${badge(t.target_type.replace('_',' '),'blue')}</td>
                  <td class="text-muted">${t.description || '—'}</td>
                  <td>${t.is_public ? '✅' : '🔒'}</td>
                </tr>`).join('')
                : '<tr><td colspan="6" class="table-empty">No targets set.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    document.getElementById('compliance-tab-content').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

function openSetTarget() {
  openModal('Set Reduction Target', `
    <div id="tgt-err" class="alert alert-error" style="display:none"></div>
    <div class="form-row">
      <div class="form-group">
        <label>Baseline Year</label>
        <input type="number" id="tgt-base" value="2020" min="1990" max="2024"/>
      </div>
      <div class="form-group">
        <label>Target Year</label>
        <input type="number" id="tgt-year" value="2030" min="2025" max="2075"/>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Reduction % (0–100)</label>
        <input type="number" id="tgt-pct" placeholder="e.g. 45" min="1" max="100" step="0.01"/>
      </div>
      <div class="form-group">
        <label>Target Type</label>
        <select id="tgt-type">
          <option value="absolute">Absolute</option>
          <option value="intensity">Intensity</option>
          <option value="net_zero">Net Zero</option>
          <option value="science_based">Science Based</option>
        </select>
      </div>
    </div>
    <div class="form-group">
      <label>Description</label>
      <textarea id="tgt-desc" placeholder="Describe your commitment…"></textarea>
    </div>
    <div class="form-group">
      <label>Make Public?</label>
      <select id="tgt-pub"><option value="true">Yes</option><option value="false">No</option></select>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveTarget()">Save Target</button>
    </div>
  `);
}

async function saveTarget() {
  const errEl = document.getElementById('tgt-err');
  errEl.style.display = 'none';
  const data = {
    baseline_year: parseInt(document.getElementById('tgt-base').value),
    target_year: parseInt(document.getElementById('tgt-year').value),
    reduction_pct: parseFloat(document.getElementById('tgt-pct').value),
    target_type: document.getElementById('tgt-type').value,
    description: document.getElementById('tgt-desc').value || undefined,
    is_public: document.getElementById('tgt-pub').value === 'true',
  };
  try {
    await api.setTarget(data);
    closeModal();
    toast('Reduction target saved!', 'success');
    await loadTargets();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
}

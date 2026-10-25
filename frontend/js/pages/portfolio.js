async function renderPortfolio() {
  const container = document.getElementById('page-container');
  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">Portfolio</div>
      <div class="page-sub">Your current carbon credit holdings</div>
    </div>
    <div id="portfolio-content"><div class="loading-center"><div class="spinner"></div></div></div>
  `;

  try {
    const holdings = await api.portfolio();

    const totalQty   = holdings.reduce((s, h) => s + parseFloat(h.quantity_held || 0), 0);
    const totalCost  = holdings.reduce((s, h) => s + parseFloat(h.total_cost_basis || 0), 0);
    const totalVal   = holdings.reduce((s, h) => s + parseFloat(h.quantity_held || 0) * parseFloat(h.current_price || 0), 0);
    const totalPnl   = holdings.reduce((s, h) => s + parseFloat(h.unrealised_pnl || 0), 0);
    const pnlPct     = totalCost > 0 ? ((totalVal - totalCost) / totalCost * 100) : 0;

    document.getElementById('portfolio-content').innerHTML = `
      <div class="card-grid">
        <div class="stat-card">
          <div class="stat-label">Total Credits</div>
          <div class="stat-value">${fmt(totalQty, 0)}</div>
          <div class="stat-sub">${holdings.length} positions</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Cost Basis</div>
          <div class="stat-value">${fmtCurrency(totalCost)}</div>
          <div class="stat-sub">Total amount invested</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Market Value</div>
          <div class="stat-value">${fmtCurrency(totalVal)}</div>
          <div class="stat-sub">At current prices</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Unrealised P&L</div>
          <div class="stat-value ${totalPnl >= 0 ? 'text-green' : 'text-red'}">${fmtCurrency(totalPnl)}</div>
          <div class="stat-sub ${pnlPct >= 0 ? 'text-green' : 'text-red'}">${pnlPct >= 0 ? '+' : ''}${fmt(pnlPct)}%</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Holdings</span>
          <button class="btn btn-outline btn-sm" onclick="navigateTo('market')">Buy Credits</button>
        </div>
        ${holdings.length === 0 ? `
          <div class="table-empty">
            <p>No holdings yet.</p>
            <button class="btn btn-primary" style="margin-top:12px" onclick="navigateTo('market')">Browse Market</button>
          </div>
        ` : `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Credit / Vintage</th><th>Project</th><th>Type</th><th>Quantity</th><th>Avg. Buy Price</th><th>Current Price</th><th>Cost Basis</th><th>Mkt Value</th><th>P&L</th><th>Return %</th><th>Since</th><th>Action</th></tr></thead>
            <tbody>
              ${holdings.map(h => {
                const pnl = parseFloat(h.unrealised_pnl || 0);
                const ret = parseFloat(h.return_pct || 0);
                return `
                <tr>
                  <td><strong>${esc(h.serial_number)}</strong><br><span class="text-muted">${esc(h.vintage_year)}</span></td>
                  <td>${esc(h.project_name)}<br>${badge(h.project_type,'green')}</td>
                  <td><span class="text-muted">${esc(h.verification_standard)}</span></td>
                  <td>${fmt(h.quantity_held, 0)} tCO2e</td>
                  <td>${fmtCurrency(h.avg_purchase_price)}</td>
                  <td>${fmtCurrency(h.current_price)}</td>
                  <td>${fmtCurrency(h.total_cost_basis)}</td>
                  <td>${fmtCurrency(parseFloat(h.quantity_held) * parseFloat(h.current_price || 0))}</td>
                  <td class="${pnl >= 0 ? 'text-green' : 'text-red'}">${fmtCurrency(pnl)}</td>
                  <td class="${ret >= 0 ? 'text-green' : 'text-red'}">${ret >= 0 ? '+' : ''}${fmt(ret)}%</td>
                  <td class="text-muted">${fmtDate(h.first_acquired_at)}</td>
                  <td style="white-space:nowrap">${h.credit_id ? `<button class="btn btn-outline btn-xs" onclick="openPlaceOrder(${jsArg(h.credit_id)},${jsArg(h.serial_number)},${jsArg(h.current_price)},'sell')">Sell</button>
                    <button class="btn btn-primary btn-xs" onclick="openRetireModal(${jsArg(h.credit_id)},${jsArg(h.serial_number)},${jsArg(h.quantity_held)})">Retire</button>` : '—'}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`}
      </div>
    `;
  } catch (err) {
    document.getElementById('portfolio-content').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

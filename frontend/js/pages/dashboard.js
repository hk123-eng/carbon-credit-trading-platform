async function renderDashboard() {
  const user = getUser();
  const container = document.getElementById('page-container');

  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">Dashboard</div>
      <div class="page-sub">Welcome back, ${user?.full_name || user?.email}</div>
    </div>
    <div id="dash-content"><div class="loading-center"><div class="spinner"></div></div></div>
  `;

  try {
    const [market, portfolio, trades, wallet] = await Promise.all([
      api.market().catch(() => []),
      api.portfolio().catch(() => []),
      api.myTrades().catch(() => []),
      user?.role === 'admin' ? Promise.resolve(null) : api.wallet().catch(() => null),
    ]);

    const totalHoldings = portfolio.reduce((s, h) => s + parseFloat(h.quantity_held || 0), 0);
    const totalValue = portfolio.reduce((s, h) => s + parseFloat(h.quantity_held || 0) * parseFloat(h.current_price || 0), 0);
    const totalPnl = portfolio.reduce((s, h) => s + parseFloat(h.unrealised_pnl || 0), 0);
    const tradeCount = trades.length;
    const buyVol = trades.filter(t => t.side === 'buy').reduce((s, t) => s + parseFloat(t.total_value || 0), 0);

    document.getElementById('dash-content').innerHTML = `
      <div class="card-grid">
        <div class="stat-card">
          <div class="stat-label">Credits Held</div>
          <div class="stat-value">${fmt(totalHoldings, 0)}</div>
          <div class="stat-sub">tCO2e across ${portfolio.length} positions</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Portfolio Value</div>
          <div class="stat-value">${fmtCurrency(totalValue)}</div>
          <div class="stat-sub">At current market prices</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Unrealised P&L</div>
          <div class="stat-value ${totalPnl >= 0 ? 'text-green' : 'text-red'}">${fmtCurrency(totalPnl)}</div>
          <div class="stat-sub">Across all positions</div>
        </div>
        ${wallet ? `<div class="stat-card" onclick="navigateTo('wallet')" style="cursor:pointer">
          <div class="stat-label">Available Funds</div>
          <div class="stat-value">${fmtCurrency(wallet.available)}</div>
          <div class="stat-sub">${fmtCurrency(wallet.reserved)} held in escrow</div>
        </div>` : ''}
        <div class="stat-card">
          <div class="stat-label">Total Trades</div>
          <div class="stat-value">${tradeCount}</div>
          <div class="stat-sub">${fmtCurrency(buyVol)} buy volume</div>
        </div>
      </div>

      <div class="two-col">
        <div class="card">
          <div class="card-header">
            <span class="card-title">Market Overview</span>
            <button class="btn btn-outline btn-sm" onclick="navigateTo('market')">View All</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Credit</th><th>Project</th><th>Price</th><th>Change</th></tr></thead>
              <tbody>
                ${market.slice(0,5).map(m => `
                  <tr>
                    <td><strong>${esc(m.serial_number)}</strong><br><span class="text-muted">${esc(m.vintage_year)}</span></td>
                    <td>${esc(m.project_name)}<br><span class="text-muted">${esc(m.project_type)}</span></td>
                    <td>${fmtCurrency(m.current_price)}</td>
                    <td class="${parseFloat(m.price_change_pct || 0) >= 0 ? 'text-green' : 'text-red'}">
                      ${m.price_change_pct ? (parseFloat(m.price_change_pct) >= 0 ? '+' : '') + fmt(m.price_change_pct) + '%' : '—'}
                    </td>
                  </tr>`).join('') || '<tr><td colspan="4" class="table-empty">No market data</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title">Recent Trades</span>
            <button class="btn btn-outline btn-sm" onclick="navigateTo('trading')">View All</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Credit</th><th>Side</th><th>Value</th></tr></thead>
              <tbody>
                ${trades.slice(0,5).map(t => `
                  <tr>
                    <td>${fmtDate(t.executed_at)}</td>
                    <td>${esc(t.serial_number)}</td>
                    <td>${badge(t.side?.toUpperCase(), t.side === 'buy' ? 'green' : 'blue')}</td>
                    <td>${fmtCurrency(t.total_value)}</td>
                  </tr>`).join('') || '<tr><td colspan="4" class="table-empty">No trades yet</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    document.getElementById('dash-content').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

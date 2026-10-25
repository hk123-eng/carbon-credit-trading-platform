async function renderTrading() {
  const container = document.getElementById('page-container');
  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">My Orders</div>
      <div class="page-sub">Manage your open and historical orders</div>
    </div>
    <div class="tabs">
      <button class="tab-btn active" onclick="switchTradingTab('orders',this)">My Orders</button>
      <button class="tab-btn" onclick="switchTradingTab('trades',this)">Trade History</button>
    </div>
    <div id="trading-tab-content"><div class="loading-center"><div class="spinner"></div></div></div>
  `;
  await loadTradingOrders();
}

async function switchTradingTab(tab, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (tab === 'orders') await loadTradingOrders();
  else await loadTradeHistory();
}

async function loadTradingOrders() {
  document.getElementById('trading-tab-content').innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
  try {
    const orders = await api.myOrders();
    document.getElementById('trading-tab-content').innerHTML = `
      <div class="card">
        <div class="card-header">
          <span class="card-title">My Orders (${orders.length})</span>
          <button class="btn btn-outline btn-sm" onclick="navigateTo('market')">+ New Order</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Credit</th><th>Project</th><th>Type</th><th>Qty</th><th>Price</th><th>Filled</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              ${orders.length ? orders.map(o => `
                <tr>
                  <td>${fmtDate(o.placed_at)}</td>
                  <td>${esc(o.serial_number)}</td>
                  <td>${esc(o.project_name)}</td>
                  <td>${badge(o.order_type.toUpperCase(), o.order_type === 'buy' ? 'green' : 'blue')}</td>
                  <td>${fmt(o.quantity, 0)}</td>
                  <td>${fmtCurrency(o.price_per_unit)}</td>
                  <td>
                    <div class="progress-bar" style="width:80px;margin-bottom:2px"><div class="progress-fill" style="width:${o.quantity > 0 ? Math.min(100,(o.filled_qty/o.quantity)*100) : 0}%"></div></div>
                    <span style="font-size:11px">${fmt(o.filled_qty,0)} / ${fmt(o.quantity,0)}</span>
                  </td>
                  <td>${badge(o.status)}</td>
                  <td>
                    ${['open','partially_filled'].includes(o.status)
                      ? `<button class="btn btn-danger btn-xs" onclick="cancelOrder(${jsArg(o.id)})">Cancel</button>`
                      : '—'}
                  </td>
                </tr>`).join('')
                : '<tr><td colspan="9" class="table-empty">No orders yet. Go to Market to place one.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    document.getElementById('trading-tab-content').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

async function cancelOrder(id) {
  if (!confirm('Cancel this order?')) return;
  try {
    await api.cancelOrder(id);
    toast('Order cancelled.', 'success');
    await loadTradingOrders();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function loadTradeHistory() {
  document.getElementById('trading-tab-content').innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
  try {
    const trades = await api.myTrades();
    document.getElementById('trading-tab-content').innerHTML = `
      <div class="card">
        <div class="card-header">
          <span class="card-title">Trade History (${trades.length})</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Credit</th><th>Project</th><th>Side</th><th>Qty</th><th>Price</th><th>Total Value</th><th>Fee</th><th>Net</th><th>Counterparty</th></tr></thead>
            <tbody>
              ${trades.length ? trades.map(t => `
                <tr>
                  <td>${fmtDateTime(t.executed_at)}</td>
                  <td>${esc(t.serial_number)}</td>
                  <td>${esc(t.project_name)}</td>
                  <td>${badge(t.side?.toUpperCase(), t.side === 'buy' ? 'green' : 'blue')}</td>
                  <td>${fmt(t.quantity, 0)}</td>
                  <td>${fmtCurrency(t.trade_price)}</td>
                  <td><strong>${fmtCurrency(t.total_value)}</strong></td>
                  <td class="text-muted">${fmtCurrency(t.platform_fee)}</td>
                  <td>${fmtCurrency(t.net_value)}</td>
                  <td class="text-muted">${t.side === 'buy' ? t.seller_name : t.buyer_name}</td>
                </tr>`).join('')
                : '<tr><td colspan="10" class="table-empty">No trades yet.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    document.getElementById('trading-tab-content').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

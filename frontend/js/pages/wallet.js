async function renderWallet() {
  const container = document.getElementById('page-container');
  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">Wallet</div>
      <div class="page-sub">Funds for buying credits. Buy orders hold money in escrow until they fill, are cancelled or expire.</div>
    </div>
    <div id="wallet-content"><div class="loading-center"><div class="spinner"></div></div></div>
  `;
  try {
    const w = await api.wallet();
    document.getElementById('wallet-content').innerHTML = `
      <div class="card-grid">
        <div class="stat-card">
          <div class="stat-label">Available</div>
          <div class="stat-value text-green">${fmtCurrency(w.available)}</div>
          <div class="stat-sub">Can be used for new buy orders</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">In Escrow</div>
          <div class="stat-value">${fmtCurrency(w.reserved)}</div>
          <div class="stat-sub">Held by your open buy orders</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Balance</div>
          <div class="stat-value">${fmtCurrency(w.balance)}</div>
          <div class="stat-sub">Available + escrow</div>
        </div>
      </div>
      <div class="card mb-16">
        <div class="card-header">
          <span class="card-title">Add or Withdraw Funds</span>
          <span class="badge badge-yellow">Sandbox payments</span>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
          <div class="form-group" style="margin:0;min-width:180px">
            <label>Amount (USD)</label>
            <input type="number" id="wallet-amount" min="0.01" step="0.01" placeholder="e.g. 25000" />
          </div>
          <button class="btn btn-primary" id="btn-deposit" onclick="walletTransfer('deposit')">Add Funds</button>
          <button class="btn btn-outline" id="btn-withdraw" onclick="walletTransfer('withdraw')">Withdraw</button>
        </div>
        <p class="text-muted" style="font-size:12px;margin-top:10px">No real card or bank transfer is made in this version; deposits are recorded as sandbox payments.</p>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Ledger</span></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Balance After</th><th>Escrow After</th><th>Note</th></tr></thead>
            <tbody>
              ${w.ledger.length ? w.ledger.map((l) => `
                <tr>
                  <td>${fmtDateTime(l.created_at)}</td>
                  <td>${badge(l.entry_type)}</td>
                  <td class="${Number(l.amount) < 0 ? 'text-red' : ''}">${fmtCurrency(l.amount)}</td>
                  <td>${fmtCurrency(l.balance_after)}</td>
                  <td class="text-muted">${fmtCurrency(l.reserved_after)}</td>
                  <td class="text-muted" style="font-size:12px">${esc(l.note)}</td>
                </tr>`).join('') : '<tr><td colspan="6" class="table-empty">No wallet activity yet.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    document.getElementById('wallet-content').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

async function walletTransfer(kind) {
  const amount = document.getElementById('wallet-amount').value;
  if (!amount || Number(amount) <= 0) { toast('Enter an amount greater than zero.', 'error'); return; }
  const btn = document.getElementById(kind === 'deposit' ? 'btn-deposit' : 'btn-withdraw');
  btn.disabled = true;
  try {
    const r = kind === 'deposit' ? await api.deposit(amount) : await api.withdraw(amount);
    toast(r.message, 'success');
    await renderWallet();
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
  }
}

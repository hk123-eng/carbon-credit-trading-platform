async function renderMarket() {
  const container = document.getElementById('page-container');
  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">Market</div>
      <div class="page-sub">Browse and trade available carbon credits</div>
    </div>
    <div class="card mb-16">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div class="form-group" style="margin:0;flex:1;min-width:160px">
          <label>Search</label>
          <input type="text" id="mkt-search" placeholder="Project name or serial…" oninput="filterMarket()" />
        </div>
        <div class="form-group" style="margin:0">
          <label>Type</label>
          <select id="mkt-type" onchange="filterMarket()">
            <option value="">All Types</option>
            <option value="forestry">Forestry</option>
            <option value="solar">Solar</option>
            <option value="wind">Wind</option>
            <option value="hydro">Hydro</option>
            <option value="methane_capture">Methane Capture</option>
            <option value="energy_efficiency">Energy Efficiency</option>
            <option value="ocean">Ocean</option>
            <option value="direct_air_capture">Direct Air Capture</option>
          </select>
        </div>
        <div class="form-group" style="margin:0">
          <label>Location</label>
          <select id="mkt-country" onchange="filterMarket()">
            <option value="">All Locations</option>
          </select>
        </div>
        <div class="form-group" style="margin:0">
          <label>Vintage</label>
          <select id="mkt-vintage" onchange="filterMarket()">
            <option value="">All Vintages</option>
          </select>
        </div>
        <div class="form-group" style="margin:0">
          <label>Standard</label>
          <select id="mkt-std" onchange="filterMarket()">
            <option value="">All Standards</option>
            <option value="Verra VCS">Verra VCS</option>
            <option value="Gold Standard">Gold Standard</option>
            <option value="American Carbon Registry">ACR</option>
            <option value="Climate Action Reserve">Climate Action Reserve</option>
            <option value="Plan Vivo">Plan Vivo</option>
          </select>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="resetMarketFilters()">Reset</button>
      </div>
    </div>
    <div id="market-table-wrap"><div class="loading-center"><div class="spinner"></div></div></div>
  `;

  try {
    const credits = await api.marketCredits();
    window._marketData = credits;
    populateFilterOptions(credits);
    renderMarketTable(credits);
  } catch (err) {
    document.getElementById('market-table-wrap').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

// Fill the location and vintage dropdowns from the values present in the data
function populateFilterOptions(credits) {
  const countries = [...new Set(credits.map(c => c.project_country).filter(Boolean))].sort();
  const vintages = [...new Set(credits.map(c => c.vintage_year).filter(Boolean))].sort((a, b) => b - a);
  document.getElementById('mkt-country').innerHTML +=
    countries.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  document.getElementById('mkt-vintage').innerHTML +=
    vintages.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
}

function filterMarket() {
  const search = document.getElementById('mkt-search').value.toLowerCase();
  const type = document.getElementById('mkt-type').value;
  const country = document.getElementById('mkt-country').value;
  const vintage = document.getElementById('mkt-vintage').value;
  const std = document.getElementById('mkt-std').value;
  let data = window._marketData || [];
  if (search) data = data.filter(c => (c.project_name + c.serial_number + c.seller_name).toLowerCase().includes(search));
  if (type) data = data.filter(c => c.project_type === type);
  if (country) data = data.filter(c => c.project_country === country);
  if (vintage) data = data.filter(c => String(c.vintage_year) === vintage);
  if (std) data = data.filter(c => c.verification_standard === std);
  renderMarketTable(data);
}

function resetMarketFilters() {
  ['mkt-search', 'mkt-type', 'mkt-country', 'mkt-vintage', 'mkt-std'].forEach(id => { document.getElementById(id).value = ''; });
  renderMarketTable(window._marketData || []);
}

function renderMarketTable(credits) {
  document.getElementById('market-table-wrap').innerHTML = `
    <div class="card">
      <div class="card-header">
        <span class="card-title">Available Credits (${credits.length})</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Serial / Vintage</th>
              <th>Project / Location</th>
              <th>Type</th>
              <th>Standard</th>
              <th>Quantity</th>
              <th>Price / unit</th>
              <th>Seller</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${credits.length ? credits.map(c => `
              <tr>
                <td><strong>${esc(c.serial_number)}</strong><br><span class="text-muted">${esc(c.vintage_year)}</span></td>
                <td>${esc(c.project_name)}<br><span class="text-muted">${esc(c.project_country)}</span></td>
                <td>${badge(c.project_type.replace(/_/g,' '), 'green')}</td>
                <td><span class="text-muted" style="font-size:12px">${esc(c.verification_standard)}</span></td>
                <td>${fmt(c.quantity, 0)} tCO2e</td>
                <td><strong>${fmtCurrency(c.price_per_unit)}</strong></td>
                <td>${esc(c.seller_name)}<br><span style="font-size:11px;color:var(--text-muted)">Score: ${esc(c.reliability_score)}</span></td>
                <td>
                  <button class="btn btn-outline btn-xs" onclick="openCreditDetail(${jsArg(c.id)})">Details</button>
                  <button class="btn btn-primary btn-xs" onclick="openPlaceOrder(${jsArg(c.id)},${jsArg(c.serial_number)},${jsArg(c.price_per_unit)})">Trade</button>
                </td>
              </tr>`).join('') : '<tr><td colspan="8" class="table-empty">No credits match your filters</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function openCreditDetail(id) {
  openModal('Credit Details', '<div class="loading-center"><div class="spinner"></div></div>');
  try {
    const [credit, orders, prices] = await Promise.all([api.marketCredit(id), api.creditOrders(id), api.priceHistory(id).catch(() => [])]);
    const buyOrders = orders.filter(o => o.order_type === 'buy');
    const sellOrders = orders.filter(o => o.order_type === 'sell').sort((a, b) => a.price_per_unit - b.price_per_unit);

    document.getElementById('modal-body').innerHTML = `
      <div class="two-col" style="margin-bottom:12px">
        <div><span class="text-muted">Serial</span><br><strong>${esc(credit.serial_number)}</strong></div>
        <div><span class="text-muted">Vintage</span><br><strong>${esc(credit.vintage_year)}</strong></div>
        <div><span class="text-muted">Quantity</span><br><strong>${fmt(credit.quantity, 0)} tCO2e</strong></div>
        <div><span class="text-muted">Price/unit</span><br><strong>${fmtCurrency(credit.price_per_unit)}</strong></div>
        <div><span class="text-muted">Status</span><br>${badge(credit.status)}</div>
        <div><span class="text-muted">Standard</span><br><strong>${esc(credit.verification_standard)}</strong></div>
        <div><span class="text-muted">Location</span><br><strong>${esc(credit.project_country)}</strong></div>
      </div>
      <hr>
      <p><strong>Project:</strong> ${esc(credit.project_name)}</p>
      <p style="font-size:12px;color:var(--text-muted);margin-top:4px">${esc(credit.project_description)}</p>
      <p style="margin-top:8px"><strong>Seller:</strong> ${esc(credit.seller_name)} — Reliability: ${esc(credit.reliability_score)}</p>
      <hr>
      <p style="font-weight:600;margin-bottom:6px">Price history</p>
      ${lineChartSvg(prices.map((p) => ({ t: p.recorded_at, v: p.price })))}
      <hr>
      <div class="two-col">
        <div>
          <p style="font-weight:600;margin-bottom:6px">Buy Orders (${buyOrders.length})</p>
          ${buyOrders.slice(0,3).map(o => `<div style="font-size:12px;padding:4px 0;border-bottom:1px solid var(--border)">${fmtCurrency(o.price_per_unit)} — ${fmt(o.quantity - o.filled_qty,0)} wanted</div>`).join('') || '<p class="text-muted" style="font-size:12px">None</p>'}
        </div>
        <div>
          <p style="font-weight:600;margin-bottom:6px">Sell Orders (${sellOrders.length})</p>
          ${sellOrders.slice(0,3).map(o => `<div style="font-size:12px;padding:4px 0;border-bottom:1px solid var(--border)">${fmtCurrency(o.price_per_unit)} — ${fmt(o.quantity - o.filled_qty,0)} available</div>`).join('') || '<p class="text-muted" style="font-size:12px">None</p>'}
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="closeModal()">Close</button>
        <button class="btn btn-primary" onclick="closeModal();openPlaceOrder(${jsArg(credit.id)},${jsArg(credit.serial_number)},${jsArg(credit.price_per_unit)})">Place Order</button>
      </div>
    `;
  } catch (err) {
    document.getElementById('modal-body').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

function openPlaceOrder(creditId, serial, suggestedPrice, defaultType = 'buy') {
  openModal('Place Order', `
    <div id="order-err" class="alert alert-error" style="display:none"></div>
    <div class="form-group">
      <label>Credit</label>
      <input type="text" value="${esc(serial)}" disabled />
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Order Type</label>
        <select id="ord-type">
          <option value="buy" ${defaultType === 'buy' ? 'selected' : ''}>Buy</option>
          <option value="sell" ${defaultType === 'sell' ? 'selected' : ''}>Sell</option>
        </select>
      </div>
      <div class="form-group">
        <label>Quantity (tCO2e)</label>
        <input type="number" id="ord-qty" placeholder="e.g. 500" min="1" />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Price per Unit ($)</label>
        <input type="number" id="ord-price" value="${esc(suggestedPrice)}" step="0.01" />
      </div>
      <div class="form-group">
        <label>Notes (optional)</label>
        <input type="text" id="ord-notes" placeholder="Any notes" />
      </div>
    </div>
    <div class="form-group">
      <label>Expires (optional)</label>
      <input type="datetime-local" id="ord-expiry" />
    </div>
    <div id="ord-total" style="background:var(--bg);padding:10px 12px;border-radius:var(--radius);font-size:13px;margin-bottom:4px"></div>
    <div id="ord-funds" class="text-muted" style="font-size:12px;margin-bottom:4px"></div>
    <p class="text-muted" style="font-size:12px">Orders are matched automatically against the best-priced opposite orders. A buy order holds quantity × price from your wallet in escrow; unused money is returned when it fills, is cancelled or expires.</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="ord-submit" onclick="submitOrder(${jsArg(creditId)})">Place Order</button>
    </div>
  `);

  const updateTotal = () => {
    const qty = parseFloat(document.getElementById('ord-qty').value) || 0;
    const price = parseFloat(document.getElementById('ord-price').value) || 0;
    document.getElementById('ord-total').innerHTML = `Total: <strong>${fmtCurrency(qty * price)}</strong>`;
  };
  document.getElementById('ord-qty').addEventListener('input', updateTotal);
  document.getElementById('ord-price').addEventListener('input', updateTotal);
  api.wallet().then((w) => {
    const el = document.getElementById('ord-funds');
    if (el) el.textContent = `Available in your wallet: ${fmtCurrency(w.available)}`;
  }).catch(() => {});
}

async function submitOrder(creditId) {
  const order_type = document.getElementById('ord-type').value;
  const quantity = document.getElementById('ord-qty').value;
  const price_per_unit = document.getElementById('ord-price').value;
  const notes = document.getElementById('ord-notes').value;
  const expiryRaw = document.getElementById('ord-expiry').value;
  const order_expiry = expiryRaw ? new Date(expiryRaw).toISOString() : undefined;
  const errEl = document.getElementById('order-err');
  const btn = document.getElementById('ord-submit');
  errEl.style.display = 'none';

  if (!quantity || !price_per_unit) { errEl.textContent = 'Quantity and price are required.'; errEl.style.display = 'block'; return; }

  btn.disabled = true;
  try {
    const result = await api.placeOrder({ credit_id: creditId, order_type, quantity, price_per_unit, notes, order_expiry });
    closeModal();
    toast(result.message || 'Order placed successfully!', 'success');
    refreshNotificationBadge();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
  }
}

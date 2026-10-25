async function renderSecurity() {
  const container = document.getElementById('page-container');
  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">Account Security</div>
      <div class="page-sub">E-mail verification and two-factor login</div>
    </div>
    <div id="sec-content"><div class="loading-center"><div class="spinner"></div></div></div>
  `;
  try {
    const me = await api.me();
    document.getElementById('sec-content').innerHTML = `
      <div class="two-col">
        <div class="card">
          <div class="card-header"><span class="card-title">E-mail Address</span>${me.is_verified ? badge('verified', 'green') : badge('not verified', 'yellow')}</div>
          <p style="font-size:13px">${esc(me.email)}</p>
          ${me.is_verified
            ? '<p class="text-muted" style="font-size:12px;margin-top:8px">Your address is confirmed.</p>'
            : `<p class="text-muted" style="font-size:12px;margin:8px 0">You need a verified address before you can register a company.</p>
               <button class="btn btn-outline btn-sm" onclick="resendVerification()">Send verification e-mail again</button>
               <div id="verify-dev" style="margin-top:10px"></div>`}
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">Two-Factor Login</span>${me.mfa_enabled ? badge('on', 'green') : badge('off', 'gray')}</div>
          <div id="mfa-area">
            ${me.mfa_enabled
              ? `<p style="font-size:13px;margin-bottom:12px">Signing in needs your password and a 6-digit code from your authenticator app.</p>
                 <div class="form-group"><label>Current code (to turn it off)</label><input type="text" id="mfa-off-code" inputmode="numeric" maxlength="6" placeholder="123456" /></div>
                 <button class="btn btn-danger btn-sm" onclick="disableMfa()">Turn off two-factor login</button>`
              : `<p style="font-size:13px;margin-bottom:12px">Add a second step to your login using Google Authenticator, Microsoft Authenticator or a similar app.</p>
                 <button class="btn btn-primary btn-sm" onclick="startMfaSetup()">Set up two-factor login</button>`}
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    document.getElementById('sec-content').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

async function resendVerification() {
  try {
    const r = await api.resendVerification();
    toast(r.message, 'success');
    if (r.dev_verification_url) {
      document.getElementById('verify-dev').innerHTML =
        `<div class="info-box" style="font-size:12px">Development mode (no e-mail server): <a href="${esc(r.dev_verification_url)}">open the verification link</a></div>`;
    }
  } catch (err) { toast(err.message, 'error'); }
}

async function startMfaSetup() {
  try {
    const { secret, otpauth_url } = await api.mfaSetup();
    const grouped = secret.match(/.{1,4}/g).join(' ');
    document.getElementById('mfa-area').innerHTML = `
      <ol style="font-size:13px;padding-left:18px;line-height:1.7">
        <li>In your authenticator app choose <em>Add account → Enter a setup key</em>.</li>
        <li>Account: <strong>CarbonTrade</strong>, key type: <strong>Time based</strong>.</li>
        <li>Key: <code class="mfa-key">${esc(grouped)}</code></li>
        <li>Enter the 6-digit code the app shows.</li>
      </ol>
      <p class="text-muted" style="font-size:11px;word-break:break-all;margin:6px 0 12px">Setup link: ${esc(otpauth_url)}</p>
      <div class="form-group"><label>6-digit code</label><input type="text" id="mfa-code" inputmode="numeric" maxlength="6" placeholder="123456" onkeydown="if(event.key==='Enter')confirmMfa()" /></div>
      <button class="btn btn-primary btn-sm" onclick="confirmMfa()">Turn on</button>
    `;
  } catch (err) { toast(err.message, 'error'); }
}

async function confirmMfa() {
  try {
    const r = await api.mfaEnable(document.getElementById('mfa-code').value.trim());
    toast(r.message, 'success');
    refreshNotificationBadge();
    renderSecurity();
  } catch (err) { toast(err.message, 'error'); }
}

async function disableMfa() {
  try {
    const r = await api.mfaDisable(document.getElementById('mfa-off-code').value.trim());
    toast(r.message, 'success');
    renderSecurity();
  } catch (err) { toast(err.message, 'error'); }
}

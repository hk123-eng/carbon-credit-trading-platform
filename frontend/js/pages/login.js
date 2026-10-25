function renderLoginPage() {
  const container = document.getElementById('page-container');
  container.innerHTML = `
    <div class="login-page">
      <div class="card">
        <div class="login-logo">
          <div class="icon">🌱</div>
          <h1>CarbonTrade</h1>
          <p>Carbon Credit Trading Platform</p>
        </div>
        <div class="login-tabs">
          <button class="login-tab active" onclick="showLoginTab('login')">Sign In</button>
          <button class="login-tab" onclick="showLoginTab('register')">Register</button>
        </div>

        <!-- Login form -->
        <div id="login-form">
          <div id="login-error" class="alert alert-error" style="display:none"></div>
          <div class="form-group">
            <label>Email Address</label>
            <input type="email" id="login-email" placeholder="you@company.com" />
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" id="login-password" placeholder="Your password" onkeydown="if(event.key==='Enter')doLogin()" />
          </div>
          <div class="form-group" id="mfa-group" style="display:none">
            <label>Authenticator code</label>
            <input type="text" id="login-mfa" inputmode="numeric" maxlength="6" placeholder="6-digit code" onkeydown="if(event.key==='Enter')doLogin()" />
          </div>
          <button class="btn btn-primary w-full" onclick="doLogin()" id="login-btn">Sign In</button>
          <div class="mt-16" style="text-align:center; color: var(--text-muted); font-size:12px;">
            <strong>Demo accounts:</strong><br>
            admin@carbonplatform.io / Admin@1234<br>
            cfo@steelcorp.com / Buyer@1234<br>
            ops@greenterra.io / Seller@1234
          </div>
        </div>

        <!-- Register form -->
        <div id="register-form" style="display:none">
          <div id="reg-error" class="alert alert-error" style="display:none"></div>
          <div class="form-row">
            <div class="form-group">
              <label>Full Name</label>
              <input type="text" id="reg-name" placeholder="Your full name" />
            </div>
            <div class="form-group">
              <label>Role</label>
              <select id="reg-role">
                <option value="buyer">Buyer</option>
                <option value="seller">Seller</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label>Email Address</label>
            <input type="email" id="reg-email" placeholder="you@company.com" />
          </div>
          <div class="form-group">
            <label>Phone (optional)</label>
            <input type="text" id="reg-phone" placeholder="+91 98765 43210" />
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" id="reg-password" placeholder="Min 8 characters" />
          </div>
          <button class="btn btn-primary w-full" onclick="doRegister()">Create Account</button>
        </div>
      </div>
    </div>
  `;
}

function showLoginTab(tab) {
  document.querySelectorAll('.login-tab').forEach((el, i) => el.classList.toggle('active', (i === 0 && tab === 'login') || (i === 1 && tab === 'register')));
  document.getElementById('login-form').style.display = tab === 'login' ? 'block' : 'none';
  document.getElementById('register-form').style.display = tab === 'register' ? 'block' : 'none';
}

async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');

  errEl.style.display = 'none';
  errEl.className = 'alert alert-error';
  if (!email || !password) { errEl.textContent = 'Please enter email and password.'; errEl.style.display = 'block'; return; }

  btn.disabled = true;
  btn.textContent = 'Signing in…';
  const mfaInput = document.getElementById('login-mfa');
  const mfa_code = mfaInput && mfaInput.value.trim() ? mfaInput.value.trim() : undefined;
  try {
    const data = await api.login(email, password, mfa_code);
    setUser(data.user, data.token);
    await loadCurrentUser(); // full profile, including company details
    renderSidebar(data.user);
    document.getElementById('main-content').className = 'main-content';
    toast('Welcome back, ' + data.user.full_name + '!', 'success');
    await navigateTo('dashboard');
  } catch (err) {
    if (err.data && err.data.mfa_required) {
      document.getElementById('mfa-group').style.display = 'block';
      document.getElementById('login-mfa').focus();
    }
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
}

async function doRegister() {
  const full_name = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const role = document.getElementById('reg-role').value;
  const phone = document.getElementById('reg-phone').value.trim();
  const errEl = document.getElementById('reg-error');

  errEl.style.display = 'none';
  if (!full_name || !email || !password) { errEl.textContent = 'Please fill all required fields.'; errEl.style.display = 'block'; return; }

  try {
    const r = await api.register({ full_name, email, password, role, phone: phone || undefined });
    showLoginTab('login');
    document.getElementById('login-email').value = email;
    const errLogin = document.getElementById('login-error');
    errLogin.className = 'alert alert-success';
    errLogin.innerHTML = 'Account created. We sent a verification link to your e-mail.' +
      (r.dev_verification_url ? ` <br><span style="font-size:12px">Development mode (no e-mail server): <a href="${esc(r.dev_verification_url)}">open the verification link</a>.</span>` : '');
    errLogin.style.display = 'block';
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
}

const routes = {
  login:      renderLoginPage,
  dashboard:  renderDashboard,
  market:     renderMarket,
  trading:    renderTrading,
  portfolio:  renderPortfolio,
  compliance: renderCompliance,
  admin:      renderAdmin,
  company:    renderCompanyPage,
  projects:   renderProjectsPage,
  wallet:     renderWallet,
  retirements: renderRetirements,
  notifications: renderNotifications,
  security:   renderSecurity,
};

async function navigateTo(page, params = {}) {
  if (!isLoggedIn() && page !== 'login') {
    return navigateTo('login');
  }
  if (isLoggedIn() && page === 'login') {
    return navigateTo('dashboard');
  }

  const user = getUser();
  if (user && page === 'admin' && user.role !== 'admin') {
    return navigateTo('dashboard');
  }

  const container = document.getElementById('page-container');
  container.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
  setActiveNav(page);

  const renderer = routes[page];
  if (renderer) {
    try {
      await renderer(params);
    } catch (err) {
      container.innerHTML = `<div class="card"><p class="text-red">Error loading page: ${esc(err.message)}</p></div>`;
    }
  } else {
    container.innerHTML = '<div class="card"><h3>Page not found</h3></div>';
  }
}

// ── Bootstrap ────────────────────────────────────────────────────────────────
(async function init() {
  // Result of opening an e-mail verification link
  const verified = new URLSearchParams(location.search).get('verified');
  if (verified !== null) {
    history.replaceState(null, '', '/');
    setTimeout(() => toast(verified === '1' ? 'E-mail address verified. Thank you!' : 'That verification link is invalid or has expired.',
      verified === '1' ? 'success' : 'error', 5000), 300);
  }
  setInterval(refreshNotificationBadge, 30000);
  if (isLoggedIn()) {
    const user = await loadCurrentUser();
    if (user) {
      renderSidebar(user);
      document.getElementById('main-content').className = 'main-content';
      await navigateTo('dashboard');
    } else {
      document.getElementById('main-content').className = 'main-content full';
      await navigateTo('login');
    }
  } else {
    document.getElementById('main-content').className = 'main-content full';
    await navigateTo('login');
  }
})();

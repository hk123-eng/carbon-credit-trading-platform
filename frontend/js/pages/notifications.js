const NOTIFICATION_ICONS = { trade: '🔄', order_expired: '⏰', retirement: '🏅', kyc: '🪪', project: '🌱', report: '📋', security: '🔐' };

async function renderNotifications() {
  const container = document.getElementById('page-container');
  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">Notifications</div>
      <div class="page-sub">Trades, approvals, expiries and security events</div>
    </div>
    <div id="notif-content"><div class="loading-center"><div class="spinner"></div></div></div>
  `;
  try {
    const { unread, notifications } = await api.notifications();
    document.getElementById('notif-content').innerHTML = `
      <div class="card">
        <div class="card-header">
          <span class="card-title">${unread} unread</span>
          ${unread ? '<button class="btn btn-outline btn-sm" onclick="markAllNotificationsRead()">Mark all as read</button>' : ''}
        </div>
        ${notifications.length ? notifications.map((n) => `
          <div class="notif ${n.is_read ? '' : 'notif-unread'}" onclick="openNotification(${jsArg(n.id)}, ${jsArg(n.link_page || '')})">
            <div class="notif-icon">${NOTIFICATION_ICONS[n.kind] || '🔔'}</div>
            <div style="flex:1">
              <div class="notif-title">${esc(n.title)}</div>
              ${n.body ? `<div class="notif-body">${esc(n.body)}</div>` : ''}
              <div class="notif-time">${fmtDateTime(n.created_at)}</div>
            </div>
          </div>`).join('') : '<div class="table-empty">No notifications yet.</div>'}
      </div>
    `;
  } catch (err) {
    document.getElementById('notif-content').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

async function openNotification(id, page) {
  try { await api.markRead(id); } catch (e) { /* already read */ }
  refreshNotificationBadge();
  if (page && routes[page]) navigateTo(page);
  else renderNotifications();
}

async function markAllNotificationsRead() {
  await api.markAllRead();
  refreshNotificationBadge();
  renderNotifications();
}

// Updates the unread count shown next to "Notifications" in the sidebar
async function refreshNotificationBadge() {
  if (!isLoggedIn()) return;
  try {
    const { unread } = await api.notifications();
    const el = document.getElementById('notif-badge');
    if (el) {
      el.textContent = unread > 99 ? '99+' : String(unread);
      el.style.display = unread ? 'inline-flex' : 'none';
    }
  } catch (e) { /* ignore */ }
}

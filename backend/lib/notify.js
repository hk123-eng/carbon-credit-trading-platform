// In-app notifications. Like the audit trail, these are written after the main
// transaction commits and never throw, so a notification failure cannot undo
// or break the action that caused it.

async function notifyUser(db, userId, kind, title, body = null, linkPage = null) {
  try {
    await db.query(
      `INSERT INTO auth.notifications (user_id, kind, title, body, link_page) VALUES ($1, $2, $3, $4, $5)`,
      [userId, kind, title, body, linkPage]
    );
  } catch (err) {
    console.error('Notification error:', err.message);
  }
}

async function notifyCompany(db, companyId, kind, title, body = null, linkPage = null) {
  try {
    await db.query(
      `INSERT INTO auth.notifications (user_id, kind, title, body, link_page)
       SELECT user_id, $2, $3, $4, $5 FROM registry.companies WHERE id = $1`,
      [companyId, kind, title, body, linkPage]
    );
  } catch (err) {
    console.error('Notification error:', err.message);
  }
}

async function notifyAdmins(db, kind, title, body = null, linkPage = 'admin') {
  try {
    await db.query(
      `INSERT INTO auth.notifications (user_id, kind, title, body, link_page)
       SELECT id, $1, $2, $3, $4 FROM auth.users WHERE role = 'admin' AND is_active`,
      [kind, title, body, linkPage]
    );
  } catch (err) {
    console.error('Notification error:', err.message);
  }
}

module.exports = { notifyUser, notifyCompany, notifyAdmins };

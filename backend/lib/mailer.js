// Outgoing e-mail. The project has no SMTP server, so every message is stored in
// auth.outbox_emails (and printed to the console in development). Replacing this
// one function with an SMTP or e-mail API call is all that real delivery needs.

async function sendMail(db, to, subject, body) {
  await db.query(
    'INSERT INTO auth.outbox_emails (to_address, subject, body) VALUES ($1, $2, $3)',
    [to, subject, body]
  );
  if (process.env.MAIL_LOG !== 'off') {
    console.log(`\n[mail] To: ${to}\n[mail] Subject: ${subject}\n${body}\n`);
  }
}

module.exports = { sendMail };

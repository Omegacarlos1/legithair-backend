# ADR 0003: Gmail for local transactional email delivery

Status: accepted for local owner testing, 2026-10-23

The owner requested Gmail delivery for account verification. Add Gmail SMTP as an opt-in implementation of the existing provider-agnostic email boundary while retaining `FakeEmailProvider` as the default for deterministic automated tests.

Gmail authenticates with the complete Gmail address and a 16-character App Password created after enabling Google 2-Step Verification. The credential is read only from the ignored `.env`; `.env.example`, documentation, Postman exports, logs, and test evidence contain placeholders only. The worker uses `smtp.gmail.com` on port 465 with TLS from connection start. Provider calls remain outside database claim transactions, and failed jobs return to the durable retry queue.

This decision does not approve personal Gmail for production. The PRD proposes Resend subject to owner approval, and production sender domain, deliverability, quotas, monitoring, and provider ownership remain release gates.

References checked on 2026-10-23:

- Google Gmail SMTP: <https://developers.google.com/workspace/gmail/imap/imap-smtp>
- Google App Passwords: <https://support.google.com/mail/answer/185833>
- Nodemailer Gmail guide: <https://nodemailer.com/guides/using-gmail>

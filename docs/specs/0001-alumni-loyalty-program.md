# 0001 · Alumni Loyalty Program

**Status**: Assumed
**Date**: 2026-09-21
**Authorized by**: kelasonline.mrbob, during /develop

## Owed decision
How the client proposal (Google Doc "PROPOSAL ALUMNI LOYALTY PROGRAM", tabs ALUMNI LOYALTY PROGRAM and DRAFT KATALOG) maps onto this app: how a referral is matched, when points are credited, how the Rp100.000 discount is applied, how the point reset works, how rewards are claimed, and where the public Loyalty Program page lives.

## Assumption built on
1. **Referral field.** The registration field is "Kode Referral / Nama Pemberi Rekomendasi" (`member_registrations.referral_code`). It accepts the alumni's personal code, their email, or their full name (case and spacing ignored). A pemberi rekomendasi is any active user with role `member`. The registrant cannot refer themselves (same email).
2. **Personal code.** Every alumni gets `users.loyalty_code`, made from the first name (letters only, up to 6) plus the user id, for example `SITI42`. It is created the first time the alumni opens the loyalty dashboard. The share link is `/register?ref=<code>`, which fills the field.
3. **Discount (client revision, 22 September 2026).** No discount at registration. The registrant pays the normal price until an admin verifies the referral. On approval, if the registration is still unpaid and the per person package price is at least Rp900.000 (client revision 23 September 2026; below that the alumni still earns points but the new member gets no discount), Rp100.000 is deducted from `package_price`, `referral_discount` records it, and the registrant gets an email containing a link to `/pendaftaran/<registration_code>` with the new total. A registrant who paid before verification keeps the old total and is told so in that email.
4. **Points.** Points come from the package name using the DRAFT KATALOG "RINCIAN POIN" table (the long table, plus TOEFL follows its VIP packages). One registration gives one package worth of points. Each registration with a filled referral field creates one `loyalty_referrals` row with status `pending`.
5. **Verification and points.** Admin approves or rejects each referral on `/admin/loyalty`, and may approve before payment so the discount can still be applied. Approval needs exactly one matched alumni. Admin can change the points before approving, and can set the alumni by code, email, or name when the field did not match. Points count only when the referral is approved **and** the new member's registration is `confirmed`; an approved but unpaid referral shows as waiting on the alumni dashboard.
6. **Point periods.** Points count inside a period. Period 1 ends 31 December 2026. From 1 January 2027 points reset, and each new period lasts 180 days (2027-01-01 to 2027-06-29, then 2027-06-30 onward). Balance = approved referral points credited in the period minus claims made in the period that were not rejected. Dates use Asia/Jakarta.
7. **Rewards.** The catalog is the DRAFT KATALOG "KONSEP HADIAH" table (20, 30, 50, 100, 300, 500 points). An alumni claims one item by filling recipient name, phone, and full address. Points are held when the claim is sent, and returned if admin rejects it. Admin moves a claim through `pending`, `processing`, `shipped`, `completed`, or `rejected`, and the alumni gets a notification each time.
8. **Public page.** This repo has no marketing landing page, so the Loyalty Program page is a public route in this app: `/loyalty-program`. The main website can link to it. The login and registration pages link to it too.

## Code area
- `src/utils/loyalty.js` (catalog, points table, periods, matching, tables)
- `src/controllers/loyaltyController.js`, `src/routes/loyalty.js`
- `src/routes/member.js`, `src/routes/admin.js`, `src/app.js`
- `src/controllers/authController.js` (registration)
- `src/views/loyalty/program.ejs`, `src/views/member/loyalty.ejs`, `src/views/admin/loyalty.ejs`
- `src/views/auth/register.ejs`, `register-thanks.ejs`, `confirm-transfer.ejs`, `login.ejs`
- `src/views/member/dashboard.ejs`, `src/views/admin/dashboard.ejs`
- `src/utils/registrationEmail.js` (discount row)
- `public/css/style.css`

## Requirements
- AC-9: Reward lists show points and items only. The rupiah value of each tier is not displayed anywhere (client revision 23 September 2026).
- AC-1: The registration form shows "Kode Referral / Nama Pemberi Rekomendasi". Pressing Terapkan (or typing) tells the registrant whether the referral is valid and shows the Rp100.000 discount in the summary for VIP priced packages and above.
- AC-2: Submitting with a referral stores the normal price. The thanks page, the emails and the form all say the discount comes after verification.
- AC-2b: Approving the referral deducts Rp100.000 from an unpaid registration and emails the registrant a link to their registration page with the new total.
- AC-3: Every registration with a filled referral field appears on `/admin/loyalty` as pending with the points from the catalog.
- AC-4: Admin can approve (only after payment) or reject a referral. Approved points show on the alumni dashboard.
- AC-5: `/member/loyalty` shows the personal code, share link, point balance, period end, progress to the next reward, referral history, and claim history.
- AC-6: An alumni with enough points can claim a reward with name, phone, and address. The balance drops at once. A rejected claim returns the points.
- AC-7: `/loyalty-program` is public and explains the mechanism, rules, reward catalog, and points table, with links to register and to log in.

## Ratify
This decision was recorded by /develop, not deliberated. Run `/architect alumni loyalty program`
to deliberate and ratify it. Until then it stays flagged as an owed decision; it does not block marking the feature `done`.

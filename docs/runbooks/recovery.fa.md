# پشتیبان‌گیری و بازیابی

## تهیهٔ backup

فایل passphrase باید حاوی یک مقدار تصادفی پرآنتروپی باشد، خارج از مخزن نگهداری شود و دسترسی 0600 داشته باشد. `MASTER_KEY` برنامه جداگانه و امن پشتیبان‌گیری شود؛ بدون آن Auth و MFA قابل بازیابی نیستند.

```bash
export BACKUP_PASSPHRASE_FILE=/secure/backup-passphrase
export BACKUP_DIRECTORY=/secure/backups
bash infrastructure/scripts/backup.sh
```

اسکریپت از `pg_dump -Fc` استفاده و خروجی را بدون فایل plaintext واسط با AES-256-CBC/PBKDF2 رمزگذاری می‌کند. HMAC-SHA256 روی ciphertext، قبل از decrypt صحت را تأیید می‌کند؛ فایل `.hmac` را همراه backup نگه دارید. backup و کلید را به یک میزبان مستقل منتقل کنید. برنامهٔ زمان‌بندی و نگهداری روی VPS با cron/systemd یا ابزار backup زیرساخت تعیین شود؛ RPO ۱۵ دقیقه تنها با طراحی و آزمون PITR قابل تعهد است.

## Restore drill در محیط جدا

1. یک PostgreSQL تازه و ایزوله بسازید؛ از نام دیتابیس Production استفاده نکنید.
2. اصالت ciphertext را بررسی کنید:

```bash
python3 infrastructure/scripts/verify-backup.py /secure/backups/backup.dump.enc /secure/backup-passphrase
```

3. فقط پس از موفقیت مرحلهٔ قبل، decrypt را مستقیم به `pg_restore` روی دیتابیس خالی pipe کنید. از `set -o pipefail` استفاده کنید تا خرابی decrypt پنهان نشود:

```bash
set -o pipefail
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
  -pass file:/secure/backup-passphrase -in /secure/backups/backup.dump.enc \
  | docker exec -i YOUR_ISOLATED_POSTGRES pg_restore -U wa -d YOUR_EMPTY_RESTORE_DATABASE --exit-on-error
```

4. تعداد رکوردها، schema migration checksum، یک نمونهٔ پیام، decrypt نشست و صحت مجوز حساب را بررسی کنید. در محیط restore، اتصال Gateway را روشن نکنید؛ دو محیط نباید صاحب زندهٔ یک شماره باشند.
5. زمان واقعی بازیابی را ثبت کنید. فایل‌های private export موقت‌اند و قابل بازتولید؛ فایل‌های دائمی رسانه در نسخهٔ متنی فعلی وجود ندارند.

فرمان `pnpm test:restore` این چرخه را با دادهٔ مصنوعی در دو دیتابیس موقت اجرا می‌کند و صحت پیام، checksum مهاجرت، decrypt نشست، دسترسی و رد فایل دست‌کاری‌شده را می‌سنجد. این تست به PostgreSQL محیط development و Docker نیاز دارد و زمان آن معیار RTO تولید نیست.

## قطع ناگهانی و rollback

- Postgres را پیش از workerها بالا بیاورید. پس از مهاجرت، API/jobs/gateway را شروع کنید.
- دادهٔ durable را از Redis بازسازی نکنید؛ source of truth در PostgreSQL است.
- ارسال‌های SENDING قدیمی به UNKNOWN می‌روند و خودکار دوباره ارسال نمی‌شوند.
- downgrade نسخهٔ Baileys را روی Auth مهاجرت‌یافته بدون backup سازگار انجام ندهید.
- rollback برنامه با rollback داده یکی نیست. فایل SQL مهاجرتِ اعمال‌شده را ویرایش نکنید.

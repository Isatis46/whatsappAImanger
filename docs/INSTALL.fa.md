# نصب هم‌صحبت از صفر — راهنمای افراد غیر فنی

این راهنما برای نصب نسخهٔ 0.1 روی **یک سرور تازه با Ubuntu 24.04 LTS** نوشته شده است. بعد از نصب، پنل با مرورگر و دامنهٔ خودتان باز می‌شود و با بستن کامپیوتر شما همچنان کار می‌کند. روی سروری که از قبل سایت یا دیتابیس مهم دارد، مراحل نصب را بدون بررسی مدیر سرور اجرا نکنید؛ پورت‌های ۸۰ و ۴۴۳ باید در اختیار برنامه باشند.

کد و Docker در محیط توسعه آزمایش شده‌اند. اتصال زندهٔ شمارهٔ شما، دسترسی OpenAI و صدور HTTPS برای دامنهٔ شما باید روی سرور خودتان تأیید شوند. امکانات پیشرفتهٔ باقی‌مانده را در [محدودهٔ نسخه](architecture/implementation-status.fa.md) ببینید.

## مسیر مطالعه

1. [وسایل لازم و معنی اصطلاحات](#requirements)
2. [ورود به سرور](#ssh)
3. [تنظیم دامنه](#domain)
4. [نصب Docker](#docker)
5. [دریافت برنامه و تنظیم اولیه](#download)
6. [ساخت و اجرا](#start)
7. [اولین ورود و اتصال واتساپ](#login)
8. [پشتیبان، به‌روزرسانی و رفع خطا](#backups)

<a id="requirements"></a>

## ۱. پیش‌نیازها

| مورد | توضیح ساده |
|---|---|
| سرور مجازی یا VPS | یک کامپیوتر همیشه‌روشن روی اینترنت؛ پیشنهاد شروع: ۴ هسته، ۸GB RAM و حداقل ۶۰GB SSD، Ubuntu 24.04 |
| IP سرور و دسترسی SSH | شرکت فروشندهٔ سرور آن‌ها را می‌دهد؛ SSH راه واردکردن دستور در سرور است |
| دامنه | مثل `example.com`؛ برای پنل یک زیردامنه مانند `chat.example.com` می‌سازیم |
| حساب OpenAI API | هزینهٔ API جدا از اشتراک ChatGPT است؛ اعتبار و دسترسی مدل لازم است |
| واتساپ روی گوشی | برای اسکن QR و اتصال یک شمارهٔ آزمایشی متعلق به خودتان |
| برنامهٔ احراز هویت | مانند Google Authenticator، Microsoft Authenticator یا Aegis برای کد ورود دومرحله‌ای |

Docker ابزار اجرای بخش‌های برنامه است. PostgreSQL اطلاعات را نگه می‌دارد؛ Redis صف کارها را مدیریت می‌کند؛ Caddy گواهی HTTPS را می‌گیرد. این سه همراه برنامه اجرا می‌شوند؛ لازم نیست جداگانه نصبشان کنید. **برای روش سروری این راهنما، نصب Node.js و pnpm روی سرور لازم نیست.**

### چگونه دستورها را کپی کنیم؟

- فقط متن داخل کادرهای دستور را کپی کنید؛ علامت `$` ابتدای دستورها نداریم.
- هر کادر را به‌ترتیب اجرا کنید و صبر کنید دوباره خط فرمان ظاهر شود. اگر `Error` دیدید، همان مرحله را بررسی کنید.
- دستورهایی که آخر خطشان `\` است، چندخطی‌اند؛ تمام کادر را یک‌جا کپی کنید.
- `SERVER_IP` و `chat.example.com` مثال‌اند؛ هرجا آمده‌اند با IP و دامنهٔ خودتان جایگزین کنید.
- هنگام نوشتن رمز در ترمینال ممکن است هیچ علامتی دیده نشود؛ این رفتار طبیعی است.
- ترمینال محل اجرای دستور است؛ فایل `.env` دفترچهٔ خصوصی تنظیمات و رمزهای برنامه است. محتوای آن را در GitHub، پیام‌رسان یا گزارش خطا نفرستید.

<a id="ssh"></a>

## ۲. ورود به سرور

در Windows، برنامهٔ **PowerShell** یا **Windows Terminal** را باز کنید. در macOS یا Linux، **Terminal** را باز کنید. دستور زیر روی کامپیوتر خودتان اجرا می‌شود:

```bash
ssh root@SERVER_IP
```

اگر فروشنده نام دیگری مثل `ubuntu` داده است، آن را به‌جای `root` بنویسید. اتصال اول اثر انگشت سرور را نشان می‌دهد؛ آن را با اطلاعات فروشنده تطبیق دهید و در صورت درست‌بودن `yes` بنویسید. سپس رمز یا کلید SSH خود را استفاده کنید.

بعد از ورود، اگر کاربر شما root نیست:

```bash
sudo -i
```

**از این مرحله تا پایان بخش سرور، دستورها داخل همین اتصال SSH و با دسترسی root اجرا می‌شوند.** وجود `root@...` در ابتدای خط معمولاً این موضوع را نشان می‌دهد. هیچ‌کدام از رمزهای مثال را برای حساب واقعی استفاده نکنید؛ ابزار نصب رمز تصادفی می‌سازد.

<a id="domain"></a>

## ۳. اتصال دامنه

وارد پنل DNS شرکت ثبت دامنه شوید. این رکورد را بسازید:

| نوع | نام | مقدار |
|---|---|---|
| A | `chat` | IP واقعی سرور شما |

اگر دامنهٔ شما `mycompany.com` باشد، آدرس نهایی `chat.mycompany.com` خواهد بود. اگر از Cloudflare استفاده می‌کنید، برای نصب اولیه حالت **DNS only** را انتخاب کنید. رکورد AAAA اشتباه را حذف/اصلاح کنید؛ فقط وقتی IPv6 واقعاً به همین سرور وصل است AAAA اضافه کنید.

در فایروال پنل شرکت سرور، TCP پورت‌های **80 و 443** را برای وب و پورت SSH خود را برای مدیریت مجاز کنید. پورت‌های **3000، 4000، 5432 و 6379** را عمومی نکنید؛ Compose تولیدی هم آن‌ها را منتشر نمی‌کند.

روی سرور بررسی کنید:

```bash
getent ahostsv4 chat.example.com
```

باید IP همین سرور را ببینید. انتشار DNS ممکن است زمان ببرد؛ تا درست‌شدن آن، صدور گواهی HTTPS ممکن نیست. اگر فقط IP دارید، ابتدا دامنه تهیه کنید؛ نسخهٔ Production برای ورود امن به HTTPS نیاز دارد.

<a id="docker"></a>

## ۴. نصب ابزارها روی Ubuntu

این دستورها مخصوص Ubuntu 24.04 هستند. اگر سیستم‌عامل دیگری دارید از [راهنمای رسمی Docker](https://docs.docker.com/engine/install/) استفاده کنید.

```bash
apt-get update
apt-get install -y ca-certificates curl git python3 openssl nano
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
```

مخزن رسمی Docker را اضافه کنید:

```bash
. /etc/os-release
cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
```

بررسی نصب:

```bash
docker --version
docker compose version
docker run --rm hello-world
```

در پایان باید پیام `Hello from Docker!` ببینید. خطای دانلود معمولاً مربوط به دسترسی اینترنت یا رجیستری Docker است. TLS را برای رفع خطا خاموش نکنید. اگر Docker از قبل نصب بوده و این سه دستور موفق‌اند، نصب مجدد لازم نیست.

<a id="download"></a>

## ۵. دریافت برنامه

```bash
cd /opt
git clone https://github.com/Isatis46/whatsappAImanger.git
cd /opt/whatsappAImanger
git switch main
```

اگر پیام وجود پوشه گرفتید، دوباره clone نکنید. ابتدا بررسی کنید این پوشه همان پروژهٔ شماست. برای به‌روزرسانی نصب موجود، به بخش به‌روزرسانی بروید. اگر مخزن خصوصی باشد، دسترسی GitHub لازم است؛ کلید دسترسی را داخل دستور یا فایل راهنما نگذارید و از روش رسمی SSH/GitHub استفاده کنید.

## ۶. ساخت تنظیمات اولیه

```bash
python3 infrastructure/scripts/init-production.py
```

برنامه سه سؤال می‌پرسد:

1. **دامنهٔ پنل:** مثلاً `chat.mycompany.com`، بدون `https://`، بدون `/` و بدون فاصله.
2. **ایمیل مدیر:** ایمیلی که برای ورود استفاده خواهید کرد. این نسخه ایمیل خوشامد یا بازیابی رمز نمی‌فرستد.
3. **کلید OpenAI:** از [داشبورد API](https://platform.openai.com/api-keys) بسازید. هنگام واردکردن دیده نمی‌شود. می‌توانید فعلاً Enter بزنید و بعداً اضافه کنید؛ تا آن زمان AI پاسخ نمی‌دهد.

اسکریپت فایل خصوصی `.env` را می‌سازد؛ رمز دیتابیس، رمز ورود مدیر و کلید رمزگذاری را خودش تولید می‌کند. فایل موجود را تغییر نمی‌دهد. **این ابزار فقط برای اولین نصب است؛ روی نصب قبلی فایل `.env` را حذف و دوباره تولید نکنید.**

برای دیدن یا ویرایش تنظیمات روی سرور خودتان:

```bash
nano .env
```

در nano با کلیدهای جهت حرکت کنید. ذخیره: `Ctrl+O`، سپس `Enter`. خروج: `Ctrl+X`. رمز مدیر را از خط `ADMIN_PASSWORD=` در مدیر رمز عبور امن خود نگه دارید. از این صفحه اسکرین‌شات عمومی نگیرید.

| تنظیم | کاربرد |
|---|---|
| `PUBLIC_HOST` | دامنه بدون https |
| `APP_ORIGIN` | همان دامنه با https و بدون `/` انتهایی |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | ساخت اولین مدیر؛ بعد از ساخته‌شدن کاربر، تغییر این دو رمز حساب موجود را عوض نمی‌کند |
| `OPENAI_API_KEY` | کلید خصوصی API؛ اگر خالی باشد پنل و پاسخ دستی کار می‌کنند ولی AI قابل استفاده نیست |
| `OPENAI_MODEL` | مدل پیش‌فرض؛ نام مدل باید در حساب OpenAI شما قابل دسترس باشد |
| `MASTER_KEY` | کلید خواندن نشست و MFA؛ آن را ثابت و جدا از دیتابیس پشتیبان بگیرید |
| `POSTGRES_PASSWORD` | رمز دیتابیس؛ پس از نصب تغییر سادهٔ این خط رمز داخل PostgreSQL را تغییر نمی‌دهد |

<a id="start"></a>

## ۷. ساخت و اجرای برنامه

همیشه از پوشهٔ پروژه اجرا کنید:

```bash
cd /opt/whatsappAImanger
docker compose --env-file .env -f infrastructure/compose/production.yaml config --quiet
docker compose --env-file .env -f infrastructure/compose/production.yaml build
```

فرمان اول در حالت موفق چیزی چاپ نمی‌کند. فرمان دوم ممکن است چند دقیقه طول بکشد. خروجی کامل `docker compose config` بدون `--quiet` می‌تواند رمزها را نشان دهد؛ آن را برای دیگران ارسال نکنید.

سرویس‌ها را اجرا کنید:

```bash
docker compose --env-file .env -f infrastructure/compose/production.yaml up -d
docker compose --env-file .env -f infrastructure/compose/production.yaml --profile bootstrap run --rm bootstrap
docker compose --env-file .env -f infrastructure/compose/production.yaml ps -a
```

`-d` یعنی اجرای پس‌زمینه؛ بستن SSH برنامه را خاموش نمی‌کند. `bootstrap` فقط اولین مدیر را می‌سازد. اگر گفت مدیر قبلاً وجود دارد، اطلاعات او را تغییر نداده است. سرویس `migrate` باید با `Exited (0)` تمام شده باشد؛ این یک کار یک‌باره است و خاموش‌بودن آن طبیعی است. سرویس‌های API، web، gateway، jobs، postgres، redis و caddy باید در حال اجرا باشند؛ سلامت API/Postgres/Redis نیز نمایش داده می‌شود.

بررسی مسیر اینترنتی با دامنهٔ واقعی خودتان:

```bash
curl --fail --show-error https://chat.example.com/api/v1/health/ready
```

باید پاسخ JSON سلامت بگیرید. Caddy خودکار گواهی TLS می‌گیرد و تمدید می‌کند؛ DNS صحیح، پورت‌های 80/443 و اینترنت خروجی لازم‌اند. برای دورزدن خطای گواهی از `curl -k` استفاده نکنید؛ علت DNS/گواهی را رفع کنید.

<a id="login"></a>

## ۸. ورود به پنل

در مرورگر کامپیوتر یا گوشی، **دامنهٔ واقعی خودتان با https** را باز کنید. با ایمیل و رمز `.env` وارد شوید. در اولین ورود Production به تنظیمات هدایت می‌شوید:

1. رمز فعلی را برای فعال‌سازی ورود دومرحله‌ای وارد کنید.
2. QR را با برنامهٔ Authenticator اسکن کنید. این QR مربوط به ورود مدیر است، نه اتصال واتساپ.
3. کد شش‌رقمی را وارد کنید.
4. کدهای بازیابی را امن ذخیره کنید؛ فقط یک‌بار نمایش داده می‌شوند و هر کدام یک‌بار مصرف‌اند.
5. دوباره وارد شوید؛ این بار علاوه بر رمز، کد برنامهٔ Authenticator را وارد کنید.

ساعت گوشی باید خودکار و درست باشد. رمز فراموش‌شده از طریق ایمیل بازیابی نمی‌شود؛ پیش از خروج، رمز و recovery code را امن نگه دارید. برای تیم، حساب‌های جدا بسازید و رمز مدیر را مشترک استفاده نکنید.

## ۹. اولین گفتگو و پاسخ هوشمند

آموزش تصویری و جزئیات همهٔ صفحه‌ها در [راهنمای استفاده از پنل](USER-GUIDE.fa.md) آمده است. ترتیب پیشنهادی:

1. یک دستیار با ارائه‌دهندهٔ OpenAI و مدل قابل دسترس بسازید؛ دستور رفتاری روشنی بدهید.
2. با شبیه‌ساز آن را امتحان کنید. شبیه‌سازی واتساپ ارسال نمی‌کند، ولی هزینهٔ API دارد.
3. یک حساب واتساپ آزمایشی بسازید و دکمهٔ اتصال را بزنید.
4. در واتساپ گوشی: **دستگاه‌های متصل / Linked devices → اتصال دستگاه / Link a device**؛ QR حساب را اسکن کنید.
5. دستیار را به حساب اختصاص دهید؛ اجازهٔ مدل ابری و پاسخ هوشمند را فعال کنید.
6. از یک شمارهٔ دیگر پیام تازه بفرستید. پیام ارسالی از همان شمارهٔ متصل یا تاریخچه نباید پاسخ AI ایجاد کند.
7. در صندوق، حالت «انسانی» را آزمایش کنید؛ سپس یک پاسخ دستی بفرستید و تحویل واقعی را روی گوشی دریافت‌کننده ببینید.

Baileys اتصال رسمی WhatsApp Business API نیست. ابتدا شمارهٔ آزمایشی خودتان را به کار ببرید؛ تغییرات سرویس واتساپ ممکن است اتصال را تحت تأثیر قرار دهد. CRM و پیامک در این نسخه غیرفعال‌اند و نیاز به تنظیم ندارند.

### اضافه‌کردن یا تغییر کلید OpenAI بعد از نصب

```bash
cd /opt/whatsappAImanger
nano .env
docker compose --env-file .env -f infrastructure/compose/production.yaml up -d --force-recreate api jobs
```

خط `OPENAI_API_KEY=` را ویرایش کنید؛ کلید را داخل فرمان shell ننویسید تا در تاریخچهٔ دستورات نماند. `restart` به‌تنهایی تنظیمات محیطی تازه را بارگذاری نمی‌کند. پس از تغییر کلید دوباره شبیه‌ساز را آزمایش کنید. تغییر مدل پیش‌فرض سرور، نسخهٔ دستیارهای قبلی را تغییر نمی‌دهد؛ مدل هر دستیار را از پنل ویرایش کنید.

<a id="backups"></a>

## ۱۰. پشتیبان‌گیری

پشتیبان معتبر شامل **دیتابیس رمزگذاری‌شده + فایل HMAC + کلید پشتیبان + فایل `.env` به‌صورت امن** است. بدون `MASTER_KEY` اصلی، نشست‌ها و MFA قابل بازیابی نیستند. کلیدها را جدا از فایل پشتیبان و یک کپی را خارج از خود VPS نگه دارید.

فقط برای اولین بار، کلید پشتیبان بسازید؛ روی فایل موجود چیزی ننویسید:

```bash
install -d -m 700 /root/whatsapp-backups /root/whatsapp-secrets
python3 - <<'PY'
import os, secrets
path = '/root/whatsapp-secrets/backup-passphrase'
try:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
except FileExistsError:
    print('Existing backup key preserved.')
else:
    with os.fdopen(fd, 'w') as file:
        file.write(secrets.token_hex(48))
    print('Private backup key created.')
PY
```

هر بار که می‌خواهید backup بگیرید:

```bash
cd /opt/whatsappAImanger
BACKUP_PASSPHRASE_FILE=/root/whatsapp-secrets/backup-passphrase \
BACKUP_DIRECTORY=/root/whatsapp-backups \
bash infrastructure/scripts/backup.sh
ls -lh /root/whatsapp-backups
```

دو فایل با پسوندهای `.dump.enc` و `.dump.enc.hmac` ساخته می‌شود. نام دقیق فایل را به‌جای `BACKUP_FILE.dump.enc` بگذارید:

```bash
python3 infrastructure/scripts/verify-backup.py \
  /root/whatsapp-backups/BACKUP_FILE.dump.enc \
  /root/whatsapp-secrets/backup-passphrase
```

باید `Backup authentication verified.` ببینید. این بررسی اصالت فایل را تأیید می‌کند؛ سلامت کامل بازیابی فقط با restore آزمایشی مشخص می‌شود. برای انتقال امن به کامپیوتر خود، در یک ترمینال **محلی** از SFTP یا `scp` استفاده کنید؛ نمونهٔ دریافت فایل‌ها:

```bash
scp root@SERVER_IP:/root/whatsapp-backups/BACKUP_FILE.dump.enc ./
scp root@SERVER_IP:/root/whatsapp-backups/BACKUP_FILE.dump.enc.hmac ./
```

کلید پشتیبان و `.env` را با روش امن جداگانه ذخیره کنید. آن‌ها را داخل پوشهٔ عمومی، ایمیل یا Git نگذارید. فضای دیسک و تعداد نسخه‌های backup را مرتب بررسی کنید. برای زمان‌بندی، مدیر سرور می‌تواند همان فرمان backup را با cron اجرا کند؛ زمان cron بر اساس منطقهٔ زمانی سرور است.

**بازیابی روی نصب اصلی می‌تواند داده‌های جدید را از بین ببرد.** ابتدا در سرور/دیتابیس جدا با [راهنمای restore](runbooks/recovery.fa.md) امتحان کنید و برای جایگزینی تولیدی از فرد فنی کمک بگیرید. بازگردانی آزمایشی نباید Gateway شمارهٔ اصلی را روشن کند.

## ۱۱. به‌روزرسانی امن

ابتدا backup بگیرید و یادداشت نسخهٔ جدید را بخوانید. سپس:

```bash
cd /opt/whatsappAImanger
git status --short
git rev-parse HEAD
```

شناسهٔ نسخهٔ قبلی را یادداشت کنید. اگر `git status` تغییرات کد خودتان را نشان داد، قبل از ادامه از فرد فنی کمک بگیرید؛ از `reset --hard` برای پاک‌کردن آن‌ها استفاده نکنید. `.env` نباید در این خروجی باشد.

```bash
git pull --ff-only origin main
docker compose --env-file .env -f infrastructure/compose/production.yaml build
docker compose --env-file .env -f infrastructure/compose/production.yaml stop caddy web api gateway jobs
docker compose --env-file .env -f infrastructure/compose/production.yaml run --rm migrate
docker compose --env-file .env -f infrastructure/compose/production.yaml up -d
docker compose --env-file .env -f infrastructure/compose/production.yaml ps -a
```

ساخت قبل از توقف انجام می‌شود؛ اگر build شکست خورد، سرویس قبلی هنوز کار می‌کند. در فاصلهٔ توقف تا `up` پنل و پاسخگویی در دسترس نیستند. اگر migration خطا داد، ادامه ندهید؛ خطا و سازگاری داده را بررسی کنید. برای rollback، برگرداندن کد به‌تنهایی تغییرات دیتابیس را برنمی‌گرداند. `.env`، volumeها و کلیدها را حفظ کنید و نصب اولیه را دوباره انجام ندهید.

## ۱۲. فرمان‌های روزمره

همهٔ این فرمان‌ها در `/opt/whatsappAImanger` اجرا می‌شوند:

```bash
# وضعیت سرویس‌ها
docker compose --env-file .env -f infrastructure/compose/production.yaml ps -a

# آخرین گزارش‌های خطا؛ پیش از ارسال برای دیگران اطلاعات خصوصی را بررسی کنید
docker compose --env-file .env -f infrastructure/compose/production.yaml logs --tail 100 api jobs gateway caddy

# توقف موقت برنامه؛ اطلاعات دیتابیس باقی می‌ماند
docker compose --env-file .env -f infrastructure/compose/production.yaml stop

# شروع دوباره
docker compose --env-file .env -f infrastructure/compose/production.yaml up -d

# بررسی فضای آزاد
df -h
docker system df
```

**از `docker compose down -v`، `docker volume prune` یا حذف volumeها استفاده نکنید؛ داده‌ها را پاک می‌کنند.** برای توقف پاسخ AI معمولاً کافی است از پنل تنظیمات، توقف سراسری پاسخ خودکار را بزنید؛ لازم نیست سرور خاموش شود.

## ۱۳. رفع خطاهای رایج

| مشکل | اقدام |
|---|---|
| `Permission denied` برای Docker | در SSH سرور وارد `sudo -i` شوید؛ روش این راهنما root است |
| `no configuration file` یا فایل پیدا نشد | `cd /opt/whatsappAImanger` و فرمان کامل همراه `-f` را اجرا کنید |
| `port is already allocated` برای 80/443 | وب‌سرور دیگری فعال است؛ آن را بدون بررسی خاموش نکنید، از مدیر سرور کمک بگیرید |
| پنل باز نمی‌شود / HTTPS خطا دارد | DNS A/AAAA، IP، پورت‌های 80/443 و لاگ Caddy را بررسی کنید |
| ورود با IP یا http کار نمی‌کند | از دامنهٔ دقیق `APP_ORIGIN` با https استفاده کنید |
| `origin_not_allowed` | `PUBLIC_HOST` و `APP_ORIGIN` باید با دامنهٔ مرورگر یکسان باشند؛ پس از ویرایش API/jobs را recreate کنید |
| `mfa_enrollment_required` | ورود دومرحله‌ای را در تنظیمات کامل کنید |
| کد MFA قبول نمی‌شود | ساعت خودکار گوشی را بررسی و کد جدید را امتحان کنید؛ recovery code ذخیره‌شده راه جایگزین است |
| `no space left on device` | فضای دیسک و تصاویر قدیمی را با مدیر سرور بررسی کنید؛ volume دیتابیس را پاک نکنید |
| `Killed` هنگام build | احتمال کمبود RAM؛ حداقل منابع پیشنهادشده را فراهم کنید |
| QR منقضی یا نمایش داده نمی‌شود | صفحهٔ حساب را باز نگه دارید، وضعیت Gateway و اینترنت واتساپ را بررسی کنید؛ QR کوتاه‌عمر است |
| حساب `LOGGED_OUT` است | از پنل اتصال دوباره بزنید و QR تازه را اسکن کنید |
| AI جواب نمی‌دهد | کلید/اعتبار مدل، تخصیص دستیار، اجازهٔ مدل ابری، کلید AI حساب، توقف سراسری و حالت گفتگو را بررسی کنید |
| حالت `ASSIST` پاسخ را نمی‌فرستد | طبیعی است؛ پیش‌نویس برای تأیید انسان تولید می‌شود |
| `UNKNOWN_DELIVERY` | روی گوشی مقصد و رسیدها بررسی کنید؛ ارسال نامشخص را کورکورانه تکرار نکنید |
| تغییر رمز در `.env` اثر ندارد | bootstrap رمز کاربر موجود را تغییر نمی‌دهد؛ بازیابی مدیریتی نیازمند رسیدگی جداست |

برای گزارش اشکال، مرحله، متن خطای بدون اطلاعات خصوصی، سیستم‌عامل و شناسهٔ `git rev-parse HEAD` را ارائه کنید. `.env`، QR، Cookie، شمارهٔ واقعی مشتری و محتوای خصوصی گفتگو را ضمیمه نکنید.

## ۱۴. اجرای آزمایشی روی کامپیوتر شخصی

برای استفادهٔ دائمی، مسیر VPS بالا پیشنهاد می‌شود. برای بررسی اولیه روی کامپیوتر شخصی:

1. Docker Desktop، Git، Python 3، Node.js **24.19.x** و pnpm **11.25.0** را نصب کنید. روی Windows، این مسیر را داخل Ubuntu در **WSL2** و با WSL integration فعال Docker Desktop اجرا کنید؛ دستورهای bash مستقیماً برای PowerShell نیستند.
2. مخزن را clone و وارد پوشه شوید.
3. Docker Desktop باید در حال اجرا باشد. سپس در ترمینال Linux/macOS/WSL:

```bash
git clone https://github.com/Isatis46/whatsappAImanger.git
cd whatsappAImanger
npm install --global pnpm@11.25.0
pnpm install --frozen-lockfile
pnpm setup:local
pnpm dev
```

پنل توسعه روی پورت 3000 کامپیوتر خودتان است. اطلاعات ورود در `.env` تولیدشده قرار دارد. ترمینال `pnpm dev` را باز نگه دارید؛ `Ctrl+C` فرایندهای برنامه را متوقف می‌کند. برای این مسیر، `init-production.py` را اجرا نکنید و پورت‌های توسعه را روی اینترنت عمومی نکنید. این روش روی همهٔ نسخه‌های Windows/macOS در این پروژه آزمون نشده است؛ مسیر اصلی تأییدشده Linux و Docker است.

## ۱۵. مدل محلی در آینده

فعلاً OpenAI کافی است. اگر بعداً سرویس محلی سازگار با OpenAI Chat Completions نصب کردید، `LOCAL_LLM_URL` باید به مسیر `/v1` قابل دسترس **از داخل کانتینر API و jobs** اشاره کند. `localhost` داخل کانتینر، خود همان کانتینر است، نه کامپیوتر یا VPS میزبان. سرویس مدل را بدون احراز هویت روی اینترنت عمومی باز نکنید.

پس از تنظیم آدرس و مدل در `.env`، API/jobs را recreate کنید و در نسخهٔ دستیار، provider را `local` و model را نام مدل نصب‌شده قرار دهید. GPU، دانلود مدل، Ollama/vLLM و شبکهٔ خصوصی سرویس مدل بخشی از نصب خودکار این مخزن نیستند؛ آن مرحله به تنظیم زیرساخت جدا نیاز دارد.

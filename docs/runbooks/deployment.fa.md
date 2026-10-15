# استقرار و عملیات

## معماری اجرا

- `api`: پورت داخلی 4000، Nest/Fastify، API و Socket.IO.
- `web`: Next.js standalone روی پورت داخلی 3000؛ Caddy مسیر `/api/*` و `/socket.io/*` را مستقیم به API می‌فرستد.
- `gateway`: تنها فرایندی که socket واتساپ می‌سازد؛ سقف پیش‌فرض ۱۰ نشست هم‌زمان در هر worker. انتخاب اولیه برای آزمون کسب‌وکار: ۳ حساب آزمایشی.
- `jobs`: relay، پردازش AI، projection گزارش و export.
- `postgres`، `redis`: فقط شبکهٔ خصوصی Compose و volume پایدار.
- `migrate`: مهاجرت نسخه‌دار با advisory lock و کنترل checksum؛ قبل از API و Workerها.

## آماده‌سازی VPS

1. Docker Engine و Compose v2 را روی Linux نصب کنید؛ DNS دامنه را به سرور متصل کنید.
2. `.env.example` را به `.env` خصوصی تبدیل کنید و سطح دسترسی 0600 بدهید. `MASTER_KEY` دقیقاً ۳۲ بایت تصادفی به‌شکل ۶۴ نویسهٔ hex است. از `openssl rand -hex 32` در محیط امن خود استفاده کنید.
3. `PUBLIC_HOST` نام دامنه بدون scheme و `APP_ORIGIN` همان دامنه با `https://` باشد. رمز دیتابیس در این فایل در URL استفاده می‌شود؛ مقدار تصادفی hex مشکل escape در URL ندارد.
4. `OPENAI_API_KEY` و مدل قابل دسترس را تنظیم کنید. `LOCAL_LLM_URL` می‌تواند خالی باشد. هیچ کلید را در مرورگر یا Git قرار ندهید.
5. از ریشهٔ پروژه build و up را با فرمان‌های README اجرا کنید؛ bootstrap فقط اولین مدیر را می‌سازد. در اولین ورود، MFA را فعال کنید و پس از ذخیرهٔ recovery code دوباره وارد شوید.
6. تنها پورت‌های 80/443 و SSH محافظت‌شده عمومی باشند. برای شبکهٔ خروجی، `api.openai.com` و میزبان‌های لازم WhatsApp Web برای نسخهٔ Baileys انتخاب‌شده را مجاز کنید. بازبودن HTTPS لزوماً کارکرد WebSocket واتساپ را اثبات نمی‌کند.

## بررسی سلامت

```bash
docker compose --env-file .env -f infrastructure/compose/production.yaml ps
docker compose --env-file .env -f infrastructure/compose/production.yaml logs --tail 100 api jobs gateway
```

`/api/v1/health/live` پاسخ زنده‌بودن API و `/api/v1/health/ready` اتصال DB/Redis را بررسی می‌کند. سلامت Gateway و Job Worker جداگانه از صفحهٔ سلامت سیستم و زمان آخرین heartbeat بررسی می‌شود. readiness API به‌تنهایی وجود نشست واتساپ را ثابت نمی‌کند.

برای تست پذیرش زنده: اتصال QR → دریافت متن آزمایشی → پاسخ دستی → شبیه‌ساز مدل → فعال‌سازی AI → دریافت پاسخ → handoff هنگام مدل → restart درگاه → صحت نشست و receipt. این کار فقط با حساب آزمایشی و مجوز صاحب حساب انجام شود.

## خطاهای عملیاتی

- **QR نمایش داده نمی‌شود**: heartbeat درگاه، فعال‌بودن حساب، خطای اتصال، ساعت سرور و دسترسی شبکه را بررسی کنید. QR حداکثر ۴۵ ثانیه در DB اعتبار دارد.
- **LOGGED_OUT**: اتصال دوبارهٔ صریح از پنل لازم است؛ state قدیمی در relink پاک می‌شود. retry نامحدود logout وجود ندارد.
- **DEGRADED**: پس از رفع علت، disconnect/connect صریح انجام دهید. خرابی persistence یا backlog بیش از حد اجازهٔ ادامهٔ بی‌مهار نمی‌دهد.
- **UNKNOWN_DELIVERY**: وضعیت را با گفتگو/دستگاه/رسیدها تطبیق دهید؛ وضعیت را صرفاً برای تکرار خودکار به QUEUED تغییر ندهید.
- **AI پاسخ نمی‌دهد**: وضعیت OPEN و حالت AI، کلید AI حساب، توقف سراسری، تخصیص دستیار، اجازهٔ cloud، کلید provider و عمر پیام را بررسی کنید. ASSIST تنها draft تولید می‌کند.
- **Redis از دست رفته**: outboxهای بدون consumer receipt پس از ۵ دقیقه دوباره بررسی و در صف ثبت می‌شوند؛ رکوردهای receipt و unique run/intent مانع اثر تکراری‌اند.
- **Worker وسط LLM قطع شده**: run منقطع پس از مهلت ۲ دقیقه قابل بازیابی است. هیچ پاسخ تکراری از یک run پایدار ساخته نمی‌شود. هزینهٔ یک درخواست خارجی قطع‌شده ممکن است نزد provider ثبت شده باشد.

## Build در محیط پروکسی سازمانی

Dockerfile گواهی CA اختیاری را با BuildKit secret می‌خواند و در image ذخیره نمی‌کند. اعتبارسنجی TLS غیرفعال نمی‌شود. محیط فعلی نیازمند hostname پروکسی در شبکهٔ Docker بود؛ روی VPS معمولی همان build استاندارد کافی است.

```bash
docker build --build-arg HTTP_PROXY --build-arg HTTPS_PROXY --build-arg NO_PROXY \
  --secret "id=build_ca,src=$NODE_EXTRA_CA_CERTS" --target server -t whatsapp-ai-server:0.1.0 .
```

اگر DNS داخلی پروکسی در Docker وجود ندارد، مدیر زیرساخت باید mapping صحیح آن را با `--add-host` یا DNS معتبر فراهم کند. هیچ آدرس خاص محیط توسعه در Dockerfile قفل نشده است.

## تغییر کلید رمزگذاری

صرفاً جایگزین‌کردن `MASTER_KEY` باعث غیرقابل‌خواندن‌شدن Auth، Signal keys، raw پیام و MFA می‌شود. پیش از تغییر، workerها را متوقف، backup قابل بازیابی تهیه و داده‌های رمزگذاری‌شده را به‌صورت آفلاین با کلید قبلی بازرمزگذاری کنید. این نسخه ابزار خودکار rotation ندارد؛ تا فراهم‌شدن ابزار و آزمون بازیابی، کلید را ثابت و جدا از DB امن نگه دارید.

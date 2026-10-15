"""Interactive first-install configuration. Never overwrite existing secrets."""
import getpass
import os
from pathlib import Path
import re
import secrets
import sys


def create_config(path: Path, domain: str, email: str, api_key: str = "") -> None:
    domain = domain.strip().lower()
    email = email.strip()
    if len(domain) > 253 or not re.fullmatch(
        r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}", domain
    ):
        raise ValueError("دامنه باید مانند chat.example.com و بدون https یا / باشد.")
    if not re.fullmatch(r"[A-Za-z0-9_.+%-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}", email):
        raise ValueError("ایمیل مدیر معتبر نیست.")
    if api_key and not re.fullmatch(r"[A-Za-z0-9_.:-]{10,512}", api_key):
        raise ValueError("کلید API باید بدون فاصله، خط جدید یا علامت نقل‌قول باشد.")
    db_password = secrets.token_hex(24)
    values = {
        "NODE_ENV": "production",
        "DATABASE_URL": f"postgresql://wa:{db_password}@postgres:5432/wa",
        "REDIS_URL": "redis://redis:6379",
        "MASTER_KEY": secrets.token_hex(32),
        "POSTGRES_PASSWORD": db_password,
        "PUBLIC_HOST": domain,
        "APP_ORIGIN": f"https://{domain}",
        "PORT": "4000",
        "OPENAI_API_KEY": api_key,
        "OPENAI_MODEL": "gpt-4.1-mini",
        "LOCAL_LLM_URL": "",
        "LOCAL_LLM_MODEL": "",
        "STORAGE_PATH": "/app/.local/exports",
        "ADMIN_EMAIL": email,
        "ADMIN_PASSWORD": secrets.token_urlsafe(24),
        "ORGANIZATION_NAME": "سازمان من",
    }
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as file:
        file.write("".join(f"{key}={value}\n" for key, value in values.items()))


def main() -> None:
    path = Path(".env")
    if path.exists() or path.is_symlink():
        sys.exit("فایل .env موجود است؛ تغییری نکرد. برای ویرایش از nano .env استفاده کنید.")
    if not Path("infrastructure/compose/production.yaml").is_file():
        sys.exit("ابتدا با دستور cd وارد پوشهٔ whatsappAImanger شوید.")
    print("تنظیم اولیهٔ سرور؛ رمزها به‌صورت تصادفی ساخته و فقط در .env ذخیره می‌شوند.")
    domain = input("دامنهٔ پنل، مانند chat.example.com: ")
    email = input("ایمیل ورود مدیر: ")
    api_key = getpass.getpass("کلید OpenAI (اختیاری؛ هنگام تایپ دیده نمی‌شود؛ Enter برای بعد): ")
    try:
        create_config(path, domain, email, api_key)
    except (ValueError, FileExistsError) as error:
        sys.exit(str(error))
    print("فایل .env با دسترسی خصوصی ساخته شد. مرحلهٔ بعد: ساخت و اجرای Docker طبق راهنما.")
    print("اطلاعات ورود در ADMIN_EMAIL و ADMIN_PASSWORD همین فایل است؛ آن را منتشر نکنید.")


if __name__ == "__main__":
    main()

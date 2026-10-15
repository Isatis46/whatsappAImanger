"""Create development-only secrets without printing values or replacing a user file."""
from pathlib import Path
import secrets
path = Path('.env')
if path.exists():
    print('.env already exists; unchanged.')
else:
    db_password = secrets.token_hex(24)
    content = f'''NODE_ENV=development
DATABASE_URL=postgresql://wa:{db_password}@127.0.0.1:5432/wa
REDIS_URL=redis://127.0.0.1:6379
MASTER_KEY={secrets.token_hex(32)}
APP_ORIGIN=http://localhost:3000
PORT=4000
OPENAI_MODEL=gpt-4.1-mini
STORAGE_PATH=.local/exports
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD={secrets.token_urlsafe(24)}
ORGANIZATION_NAME=سازمان من
POSTGRES_PASSWORD={db_password}
PUBLIC_HOST=localhost
'''
    with path.open('x') as file:
        file.write(content)
    path.chmod(0o600)
    print('Created protected .env with unique local development secrets.')

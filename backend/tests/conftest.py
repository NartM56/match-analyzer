import os

# Placeholder settings so app.core.config loads without a backend/.env (e.g. in CI).
# Real values from the environment or .env take precedence.
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://postgres:postgres@localhost:5432/playiq_test")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("OPENAI_API_KEY", "sk-test")

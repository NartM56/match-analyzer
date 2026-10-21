import os
from pathlib import Path

import pytest
from dotenv import dotenv_values
from sqlalchemy.engine import make_url

BACKEND = Path(__file__).resolve().parents[1]


def _test_database_url() -> str:
    """TEST_DATABASE_URL if set (CI), otherwise backend/.env's DATABASE_URL with the database
    renamed <name>_test, so local runs reuse your credentials but never touch your real data."""
    if os.environ.get("TEST_DATABASE_URL"):
        return os.environ["TEST_DATABASE_URL"]
    base = os.environ.get("DATABASE_URL") or dotenv_values(BACKEND / ".env").get("DATABASE_URL")
    if not base:
        return "postgresql+psycopg://postgres:postgres@localhost:5432/playiq_test"
    url = make_url(base)
    return url.set(database=f"{url.database}_test").render_as_string(hide_password=False)


TEST_DATABASE_URL = _test_database_url()

# Set before anything imports app.core.config, so the app itself points at the test database.
# These beat backend/.env (environment variables take precedence), so tests never use a real key.
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ["OPENAI_API_KEY"] = "sk-test"


# ── Database (only for tests that ask for `db` or `client`) ──

@pytest.fixture(scope="session")
def db_engine():
    """The test database with a fresh copy of schema.sql, created if it doesn't exist."""
    from sqlalchemy import create_engine, text

    url = make_url(TEST_DATABASE_URL)
    # the schema is dropped on every run, so refuse anything that isn't clearly a test database
    if not url.database.endswith("_test"):
        pytest.exit(f"Refusing to run database tests against '{url.database}': the name must end in _test")

    server = create_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    try:
        with server.connect() as conn:
            exists = conn.scalar(text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": url.database})
            if not exists:
                conn.exec_driver_sql(f'CREATE DATABASE "{url.database}"')
    except Exception as err:
        # locally, run what we can without a database; in CI (GitHub sets CI=true) a missing
        # database is a broken setup, and skipping would hide every database test behind a green run
        if os.environ.get("CI"):
            raise
        pytest.skip(f"No PostgreSQL for database tests ({type(err).__name__}); set TEST_DATABASE_URL")
    finally:
        server.dispose()

    engine = create_engine(url)
    with engine.begin() as conn:
        conn.exec_driver_sql("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
        # straight to psycopg without parameters, so the '%' in schema.sql's comments isn't a placeholder
        conn.connection.driver_connection.execute((BACKEND / "app" / "db" / "schema.sql").read_text())
    yield engine
    engine.dispose()


@pytest.fixture
def db(db_engine):
    """A session whose changes are all rolled back after the test, even ones the code commits."""
    from sqlalchemy.orm import Session

    with db_engine.connect() as conn:
        outer = conn.begin()
        session = Session(bind=conn, join_transaction_mode="create_savepoint")
        try:
            yield session
        finally:
            session.close()
            outer.rollback()


@pytest.fixture
def client(db):
    """FastAPI test client using the test session above."""
    from fastapi.testclient import TestClient

    from app.db.database import get_db
    from main import app

    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()

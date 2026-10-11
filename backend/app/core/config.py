from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    """Application settings loaded from environment variables"""
    model_config = SettingsConfigDict(env_file=".env")
    
    DATABASE_URL: str
    JWT_SECRET: str
    OPENAI_API_KEY: str
    OPENAI_MODEL: str = "gpt-4.1-mini"
    
    
settings = Settings()
    
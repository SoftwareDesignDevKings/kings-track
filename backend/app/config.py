from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    canvas_api_url: str = ""
    canvas_api_token: str = ""
    database_url: str = "postgresql+asyncpg://kings:kings@db:5432/kings_analytics"
    sync_interval_hours: int = 24
    cors_origins: str = "http://localhost:5173,http://localhost:3000"
    # Comma-separated Canvas course IDs to sync. If empty, all teacher courses are synced.
    canvas_course_whitelist: str = ""
    supabase_jwt_secret: str = ""

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def course_whitelist(self) -> list[int]:
        """Parsed list of whitelisted course IDs, or empty list (= no filter)."""
        return [int(x.strip()) for x in self.canvas_course_whitelist.split(",") if x.strip().isdigit()]

    @property
    def canvas_configured(self) -> bool:
        return bool(self.canvas_api_url and self.canvas_api_token)


settings = Settings()

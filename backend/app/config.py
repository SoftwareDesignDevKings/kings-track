from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    canvas_api_url: str = ""
    canvas_api_token: str = ""
    edstem_api_url: str = "https://edstem.org/api"
    edstem_api_token: str = ""
    database_url: str = "postgresql+asyncpg://kings:kings@db:5432/kings_analytics"
    sync_interval_hours: int = 6
    incremental_sync_interval_minutes: int = 30
    cors_origins: str = "http://localhost:5173,http://localhost:3000"
    auth_mode: str = "local"
    local_dev_user_email: str = "admin@local.dev"
    local_dev_user_role: str = "admin"
    supabase_url: str = ""

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def canvas_configured(self) -> bool:
        return bool(self.canvas_api_url and self.canvas_api_token)

    @property
    def edstem_configured(self) -> bool:
        return bool(self.edstem_api_token)

    @property
    def local_auth_enabled(self) -> bool:
        return self.auth_mode.lower() == "local"



settings = Settings()

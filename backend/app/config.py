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
    reminder_timezone: str = "Australia/Sydney"
    reminder_scheduler_interval_seconds: int = 60
    reminder_email_enabled: bool = False
    reminder_email_from_name: str = "Kings Track"
    reminder_email_from_address: str = ""
    reminder_smtp_host: str = ""
    reminder_smtp_port: int = 587
    reminder_smtp_username: str = ""
    reminder_smtp_password: str = ""
    reminder_smtp_starttls: bool = True
    reminder_smtp_use_ssl: bool = False
    reminder_smtp_timeout_seconds: int = 30
    reminder_test_mode_enabled: bool = True
    reminder_test_recipient_email: str = "liam22840@gmail.com"

    # Attendance watcher
    watch_folder: str = ""
    processed_folder: str = "./processed"
    watch_enabled: bool = False
    attendance_late_threshold_minutes: int = 10
    attendance_partial_threshold_minutes: int = 30

    # School term start dates for schedule-based red line in cycle PDF
    school_term_starts: str = ""

    # Cron / sync security
    cron_secret: str = ""

    # Environment & deployment
    environment: str = "development"
    deployment_target: str = "vercel"
    redis_url: str = ""
    db_pool_size: int = 5
    db_max_overflow: int = 2
    vercel_function_timeout: int = 300

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

    @property
    def reminder_email_configured(self) -> bool:
        return bool(
            self.reminder_email_enabled
            and self.reminder_email_from_address
            and self.reminder_smtp_host
        )

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def is_serverless(self) -> bool:
        return self.deployment_target == "vercel"

    @property
    def redis_configured(self) -> bool:
        return bool(self.redis_url)


settings = Settings()

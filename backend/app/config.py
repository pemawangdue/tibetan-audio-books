from functools import lru_cache
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_prefix="", case_sensitive=False, extra="ignore"
    )

    env: Literal["local", "test", "staging", "production"] = "local"
    service: Literal["api", "split", "page"] = "api"
    aws_region: str = "us-east-1"
    aws_endpoint_url: str | None = None
    books_table: str = "dadhep-books"
    books_owner_index: str = "owner-created_at-index"
    pages_table: str = "dadhep-pages"
    cache_table: str = "dadhep-cache"
    upload_bucket: str = "dadhep-uploads"
    assets_bucket: str = "dadhep-assets"
    split_queue_url: str = ""
    page_queue_url: str = ""
    priority_queue_url: str = ""
    cognito_user_pool_id: str = ""
    cognito_app_client_id: str = ""
    local_auth_bypass: bool = False
    local_user_id: str = "local-user"
    monlam_provider: Literal["mock", "rest"] = "mock"
    monlam_api_url: str = ""
    monlam_api_key: str = Field(default="", repr=False)
    monlam_api_key_header: str = "X-API-Key"
    monlam_ocr_path: str = "/ocr/single-page"
    monlam_cleanup_path: str = ""  # unused; Monlam has no cleanup endpoint
    monlam_tts_path: str = "/text-to-speech/"
    monlam_chat_path: str = "/ai/chat"
    monlam_chat_model: str = "melong"
    monlam_voice: Literal["lhasa_female", "lhasa_male", "amdo_female", "amdo_male", "kham_female", "kham_male"] = "lhasa_male"
    monlam_timeout_seconds: float = 60
    vector_bucket: str = ""
    embedding_model_id: str = "amazon.titan-embed-text-v2:0"
    embedding_dimensions: int = 1024
    embedding_max_input_chars: int = 20_000
    # ~600-900 tokens/chunk with overlap; top-k fits in Monlam's 20k context.
    rag_chunk_chars: int = 1200
    rag_chunk_overlap_chars: int = 200
    rag_top_k: int = 8
    presigned_url_ttl: int = 900
    max_upload_bytes: int = 50 * 1024 * 1024
    max_pages: int = 500
    page_max_attempts: int = 3
    processing_lease_seconds: int = 840
    cors_origins: list[str] = ["http://localhost:3000"]

    @property
    def cognito_issuer(self) -> str:
        return (
            f"https://cognito-idp.{self.aws_region}.amazonaws.com/"
            f"{self.cognito_user_pool_id}"
        )

    @model_validator(mode="after")
    def validate_auth(self) -> "Settings":
        if (
            self.env in {"staging", "production"}
            and self.local_auth_bypass
        ):
            raise ValueError("local_auth_bypass cannot be enabled outside local/test")
        if self.service == "api" and not self.local_auth_bypass and (
            not self.cognito_user_pool_id or not self.cognito_app_client_id
        ):
            raise ValueError("Cognito pool and client IDs are required")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()

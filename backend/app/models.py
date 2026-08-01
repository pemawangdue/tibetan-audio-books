from datetime import datetime, timezone
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class BookStatus(StrEnum):
    UPLOADING = "uploading"
    QUEUED = "queued"
    SPLITTING = "splitting"
    PROCESSING = "processing"
    COMPLETED = "completed"
    PARTIAL = "partial"
    FAILED = "failed"


class PageStatus(StrEnum):
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    CORRECTING = "correcting"
    FAILED = "failed"


class UploadUrlRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=240)
    content_type: str = Field(
        pattern=r"^(application/(pdf|zip)|image/(png|jpeg|webp))$"
    )
    size_bytes: int = Field(gt=0)

    @field_validator("filename")
    @classmethod
    def safe_filename(cls, value: str) -> str:
        value = value.replace("\\", "/").split("/")[-1].strip()
        if not value or value in {".", ".."}:
            raise ValueError("invalid filename")
        return value


class UploadUrlResponse(BaseModel):
    upload_id: str
    object_key: str
    url: str
    fields: dict[str, str]
    expires_in: int


class BookCreate(BaseModel):
    upload_id: str = Field(min_length=1, max_length=100)
    object_key: str = Field(min_length=1, max_length=1024)
    title: str = Field(min_length=1, max_length=300)
    language: str = Field(default="bo", max_length=20)
    tts_voice: str = Field(default="default", min_length=1, max_length=100)


class Book(BaseModel):
    book_id: str
    owner_id: str
    title: str
    language: str
    tts_voice: str = "default"
    source_key: str
    status: BookStatus
    total_pages: int = 0
    completed_pages: int = 0
    failed_pages: int = 0
    cover_page_key: str | None = None
    cover_url: str | None = None
    visibility: Literal["private", "shared"] = "private"
    index_status: Literal["pending", "indexing", "ready", "failed"] | None = None
    indexed_chunks: int | None = None
    indexed_at: str | None = None
    index_error: str | None = None
    created_at: str
    updated_at: str
    error: str | None = None


class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str = Field(min_length=1, max_length=20_000)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=8_000)
    history: list[ChatMessage] = Field(default_factory=list, max_length=20)


class ChatResponse(BaseModel):
    answer: str
    citations: list[int] = Field(default_factory=list)
    index_status: str | None = None


class BookList(BaseModel):
    items: list[Book]
    next_token: str | None = None


class Segment(BaseModel):
    index: int
    text: str
    start_ms: int
    end_ms: int
    audio_key: str
    audio_url: str | None = None


class PageSummary(BaseModel):
    page_number: int
    status: PageStatus
    duration_seconds: float | None = None
    error: str | None = None


class BookProgress(BaseModel):
    book_id: str
    status: BookStatus
    total_pages: int
    completed_pages: int
    failed_pages: int
    ready_pages: list[int]
    pages: list[PageSummary]


class Page(BaseModel):
    book_id: str
    page_number: int
    owner_id: str
    status: PageStatus
    image_key: str
    ocr_text: str | None = None
    corrected_text: str | None = None
    audio_key: str | None = None
    pending_audio_key: str | None = None
    segments_key: str | None = None
    image_url: str | None = None
    audio_url: str | None = None
    segments_url: str | None = None
    segments: list[Segment] = Field(default_factory=list)
    duration_seconds: float | None = None
    version: int = 1
    attempts: int = 0
    processing_expires_at: int | None = None
    created_at: str
    updated_at: str
    error: str | None = None


class PageCorrection(BaseModel):
    text: str | None = Field(default=None, min_length=1, max_length=100_000)
    regenerate: Literal[True] = True


class JobMessage(BaseModel):
    kind: str
    book_id: str
    owner_id: str
    page_number: int | None = None
    source_key: str | None = None
    image_key: str | None = None
    text_override: str | None = None
    tts_voice: str = "default"
    version: int = 1


class ProcessingResult(BaseModel):
    text: str
    audio: bytes
    segments: list[dict[str, Any]]

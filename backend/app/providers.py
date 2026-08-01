import hashlib
import logging
import re
from abc import ABC, abstractmethod
from typing import Any

import httpx

from .config import Settings

logger = logging.getLogger(__name__)


class Provider(ABC):
    name: str

    @abstractmethod
    def ocr(self, image: bytes) -> str: ...

    @abstractmethod
    def cleanup(self, text: str) -> str: ...

    @abstractmethod
    def tts(self, text: str) -> bytes: ...


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _raise_for_status(response: httpx.Response) -> None:
    if response.is_success:
        return
    detail = response.text
    try:
        detail = response.json()
    except Exception:
        pass
    raise httpx.HTTPStatusError(
        f"{response.status_code} for {response.request.url}: {detail}",
        request=response.request,
        response=response,
    )


def _extract_text(payload: Any) -> str:
    if isinstance(payload, str) and payload.strip():
        return payload.strip()
    if not isinstance(payload, dict):
        raise ValueError(f"Unexpected Monlam OCR response: {payload!r}")
    for key in ("text", "ocr_text", "result"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, dict):
            nested = value.get("text")
            if isinstance(nested, str) and nested.strip():
                return nested.strip()
    raise ValueError(f"Monlam OCR response missing text: {payload}")


class MockMonlamProvider(Provider):
    """Deterministic local provider; output depends only on input bytes/text."""

    name = "mock-v1"

    def ocr(self, image: bytes) -> str:
        digest = hashlib.sha256(image).hexdigest()[:12]
        return f"དཔེ་ཆ་ {digest} ། བོད་ཡིག་ཞིབ་འཇུག །"

    def cleanup(self, text: str) -> str:
        return normalize_text(text)

    def tts(self, text: str) -> bytes:
        # Test-safe deterministic stand-in, not intended to be decoded as real MP3.
        return b"MOCK-MP3\x00" + hashlib.sha256(text.encode("utf-8")).digest()


class MonlamProvider(Provider):
    """Adapter for the Monlam REST API (OCR + TTS)."""

    name = "rest-v1"

    def __init__(self, settings: Settings):
        if not settings.monlam_api_url:
            raise ValueError("MONLAM_API_URL is required for REST provider")
        key_value = (
            f"Bearer {settings.monlam_api_key}"
            if settings.monlam_api_key_header.lower() == "authorization"
            else settings.monlam_api_key
        )
        self.client = httpx.Client(
            base_url=settings.monlam_api_url.rstrip("/"),
            headers={settings.monlam_api_key_header: key_value}
            if settings.monlam_api_key
            else {},
            timeout=httpx.Timeout(settings.monlam_timeout_seconds, connect=10),
        )
        self.ocr_path = settings.monlam_ocr_path
        self.tts_path = settings.monlam_tts_path
        self.voice = settings.monlam_voice
        self.name = f"rest-v1:{self.voice}"

    def ocr(self, image: bytes) -> str:
        # Monlam SinglePageOCRRequest requires multipart field name "file".
        response = self.client.post(
            self.ocr_path,
            files={"file": ("page.png", image, "image/png")},
            data={"lang_hint": "bo", "model_name": "monlam-ocr"},
        )
        _raise_for_status(response)
        return _extract_text(response.json())

    def cleanup(self, text: str) -> str:
        # Monlam currently has no cleanup endpoint; normalize locally.
        return normalize_text(text)

    def tts(self, text: str) -> bytes:
        logger.debug("Requesting TTS for %d characters", len(text))
        response = self.client.post(
            self.tts_path,
            json={
                "text": text,
                "voice_name": self.voice,
                "model_name": "monlamai-tts",
            },
        )
        _raise_for_status(response)
        data = response.json()
        audio_url = data.get("audio_url")
        if not audio_url and isinstance(data.get("result"), dict):
            audio_url = data["result"].get("audio_url")
        if not audio_url:
            raise ValueError(
                f"Monlam TTS did not return an audio_url. Response: {data}"
            )
        # Absolute audio URLs should not inherit Monlam auth headers.
        audio_response = httpx.get(audio_url, timeout=self.client.timeout)
        _raise_for_status(audio_response)
        return audio_response.content


def get_provider(settings: Settings) -> Provider:
    if settings.monlam_provider == "mock":
        return MockMonlamProvider()
    return MonlamProvider(settings)


def sentence_segments(text: str) -> list[str]:
    parts = [part.strip() for part in re.split(r"(?<=[།༎.!?])\s*", text)]
    return [part for part in parts if part]

import hashlib
import re
from abc import ABC, abstractmethod

import httpx

from .config import Settings


class MonlamProvider(ABC):
    name: str

    @abstractmethod
    def ocr(self, image: bytes) -> str: ...

    @abstractmethod
    def cleanup(self, text: str) -> str: ...

    @abstractmethod
    def tts(self, text: str) -> bytes: ...


class MockMonlamProvider(MonlamProvider):
    """Deterministic local provider; output depends only on input bytes/text."""

    name = "mock-v1"

    def ocr(self, image: bytes) -> str:
        digest = hashlib.sha256(image).hexdigest()[:12]
        return f"དཔེ་ཆ་ {digest} ། བོད་ཡིག་ཞིབ་འཇུག །"

    def cleanup(self, text: str) -> str:
        return re.sub(r"\s+", " ", text).strip()

    def tts(self, text: str) -> bytes:
        # Test-safe deterministic stand-in, not intended to be decoded as real MP3.
        return b"MOCK-MP3\x00" + hashlib.sha256(text.encode("utf-8")).digest()


class RestMonlamProvider(MonlamProvider):
    """Adapter shell for the currently undocumented Monlam REST API.

    Endpoint paths and response fields are intentionally isolated here so they
    can be adjusted when the provider contract is finalized.
    """

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
        self.cleanup_path = settings.monlam_cleanup_path
        self.tts_path = settings.monlam_tts_path
        self.voice = settings.monlam_voice
        self.name = f"rest-v1:{self.voice}"

    def ocr(self, image: bytes) -> str:
        response = self.client.post(
            self.ocr_path, files={"image": ("page.png", image, "image/png")}
        )
        response.raise_for_status()
        return response.json()["text"]

    def cleanup(self, text: str) -> str:
        response = self.client.post(self.cleanup_path, json={"text": text})
        response.raise_for_status()
        return response.json()["text"]

    def tts(self, text: str) -> bytes:
        response = self.client.post(
            self.tts_path, json={"text": text, "voice": self.voice}
        )
        response.raise_for_status()
        return response.content


def get_provider(settings: Settings) -> MonlamProvider:
    if settings.monlam_provider == "rest":
        return RestMonlamProvider(settings)
    return MockMonlamProvider()


def sentence_segments(text: str) -> list[str]:
    parts = [part.strip() for part in re.split(r"(?<=[།༎.!?])\s*", text)]
    return [part for part in parts if part]

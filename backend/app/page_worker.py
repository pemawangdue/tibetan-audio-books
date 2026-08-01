import hashlib
import io
import json
import logging
import time
from typing import Any

from botocore.exceptions import ClientError
from mutagen.mp3 import MP3

from .aws import Aws, get_aws
from .config import Settings, get_settings
from .models import BookStatus, JobMessage, PageStatus, utc_now
from .providers import Provider, get_provider, sentence_segments
from .repositories import Repositories


logger = logging.getLogger(__name__)


def _hash(*parts: bytes | str) -> str:
    digest = hashlib.sha256()
    for part in parts:
        digest.update(part if isinstance(part, bytes) else part.encode("utf-8"))
        digest.update(b"\x00")
    return digest.hexdigest()


def _duration_ms(audio: bytes, text: str) -> int:
    try:
        return max(1, round(MP3(io.BytesIO(audio)).info.length * 1000))
    except Exception:
        # Deterministic mock audio has no media frames.
        return max(400, len(text) * 65)


def _cached_text(
    repos: Repositories,
    key: str,
    producer: Any,
) -> str:
    cached = repos.get_cache(key)
    if cached and isinstance(cached.get("text"), str):
        return cached["text"]
    text = producer()
    repos.put_cache(key, {"text": text})
    return text


def _tts_asset(
    text: str,
    provider: Provider,
    aws: Aws,
    settings: Settings,
) -> tuple[str, bytes]:
    digest = _hash(provider.name, "tts", text)
    key = f"cache/tts/{provider.name}/{digest}.mp3"
    try:
        audio = aws.s3.get_object(Bucket=settings.assets_bucket, Key=key)["Body"].read()
    except ClientError as exc:
        if exc.response["Error"]["Code"] not in {"404", "NoSuchKey", "NotFound"}:
            raise
        audio = provider.tts(text)
        aws.s3.put_object(
            Bucket=settings.assets_bucket,
            Key=key,
            Body=audio,
            ContentType="audio/mpeg",
            ServerSideEncryption="AES256",
        )
    return key, audio


def _update_book_progress(
    repos: Repositories,
    message: JobMessage,
    *,
    completed: int = 0,
    failed: int = 0,
) -> None:
    book = repos.update_book(
        message.book_id,
        message.owner_id,
        "SET updated_at = :now ADD completed_pages :completed, failed_pages :failed",
        {":now": utc_now(), ":completed": completed, ":failed": failed},
    )
    if book.total_pages and book.completed_pages + book.failed_pages >= book.total_pages:
        final = BookStatus.COMPLETED if book.failed_pages == 0 else BookStatus.PARTIAL
        repos.update_book(
            message.book_id,
            message.owner_id,
            "SET #s = :status, updated_at = :now",
            {":status": final.value, ":now": utc_now()},
            {"#s": "status"},
        )


def process_page(
    message: JobMessage,
    aws: Aws,
    settings: Settings,
    provider: Provider | None = None,
) -> None:
    if message.kind != "page" or message.page_number is None or not message.image_key:
        raise ValueError("Invalid page message")
    repos = Repositories(aws, settings)
    page = repos.get_page(message.book_id, message.page_number, message.owner_id)
    if page.version != message.version:
        return  # stale correction or duplicate
    if page.status == PageStatus.COMPLETED:
        return
    now_epoch = int(time.time())
    if (
        page.status == PageStatus.PROCESSING
        and (page.processing_expires_at or 0) > now_epoch
    ):
        return
    if page.status == PageStatus.FAILED and page.attempts >= settings.page_max_attempts:
        return
    was_correction = bool(page.audio_key)
    claimed = repos.update_page(
        message.book_id,
        message.page_number,
        message.owner_id,
        "SET #s = :processing, attempts = if_not_exists(attempts, :zero) + :one, "
        "processing_expires_at = :lease, updated_at = :now REMOVE #error",
        {
            ":processing": PageStatus.PROCESSING.value,
            ":zero": 0,
            ":one": 1,
            ":now": utc_now(),
            ":lease": now_epoch + settings.processing_lease_seconds,
            ":now_epoch": now_epoch,
            ":version": message.version,
            ":queued": PageStatus.QUEUED.value,
            ":correcting": PageStatus.CORRECTING.value,
            ":failed": PageStatus.FAILED.value,
        },
        {"#s": "status", "#error": "error", "#v": "version"},
        extra_condition=(
            "#v = :version AND (#s IN (:queued, :correcting, :failed) OR "
            "(#s = :processing AND processing_expires_at <= :now_epoch))"
        ),
    )
    provider = provider or get_provider(
        settings.model_copy(update={"monlam_voice": message.tts_voice})
    )
    try:
        # Perform OCR, cleanup, and TTS
        image = aws.s3.get_object(
            Bucket=settings.assets_bucket, Key=message.image_key
        )["Body"].read()
        if message.text_override:
            text = message.text_override.strip()
            ocr_text = page.ocr_text
        else:
            ocr_key = f"ocr:{_hash(provider.name, image)}"
            ocr_text = _cached_text(repos, ocr_key, lambda: provider.ocr(image))
            cleanup_key = f"cleanup:{_hash(provider.name, ocr_text)}"
            text = _cached_text(
                repos, cleanup_key, lambda: provider.cleanup(ocr_text or "")
            )

        version_prefix = (
            f"books/{message.book_id}/pages/{message.page_number}/v{message.version}"
        )
        segment_manifest = []
        elapsed_ms = 0
        for index, sentence in enumerate(sentence_segments(text)):
            _, audio = _tts_asset(sentence, provider, aws, settings)
            segment_key = f"{version_prefix}/segments/{index:04d}.wav"
            aws.s3.put_object(                
                Bucket=settings.assets_bucket,
                Key=segment_key,
                Body=audio,
                ContentType="audio/wav",
                ServerSideEncryption="AES256",
            )
            duration_ms = _duration_ms(audio, sentence)
            segment_manifest.append(
                {
                    "index": index,
                    "text": sentence,
                    "start_ms": elapsed_ms,
                    "end_ms": elapsed_ms + duration_ms,
                    "audio_key": segment_key,
                }
            )
            elapsed_ms += duration_ms
        _, full_audio = _tts_asset(text, provider, aws, settings)
        audio_key = f"{version_prefix}/audio.wav"
        segments_key = f"{version_prefix}/segments.json"
        aws.s3.put_object(
            Bucket=settings.assets_bucket,
            Key=audio_key,
            Body=full_audio,
            ContentType="audio/wav",
            ServerSideEncryption="AES256",
        )
        aws.s3.put_object(
            Bucket=settings.assets_bucket,
            Key=segments_key,
            Body=json.dumps(segment_manifest, ensure_ascii=False).encode("utf-8"),
            ContentType="application/json",
            ServerSideEncryption="AES256",
        )
        repos.update_page(
            message.book_id,
            message.page_number,
            message.owner_id,
            "SET #s = :complete, ocr_text = :ocr, corrected_text = :text, "
            "audio_key = :audio, segments_key = :segments, "
            "duration_seconds = :duration, updated_at = :now "
            "REMOVE pending_audio_key, processing_expires_at, #error",
            {
                ":complete": PageStatus.COMPLETED.value,
                ":ocr": ocr_text or text,
                ":text": text,
                ":audio": audio_key,
                ":segments": segments_key,
                ":duration": elapsed_ms / 1000,
                ":now": utc_now(),
                ":processing": PageStatus.PROCESSING.value,
                ":version": message.version,
            },
            {"#s": "status", "#error": "error", "#v": "version"},
            extra_condition="#v = :version AND #s = :processing",
        )
        if not was_correction:
            _update_book_progress(repos, message, completed=1)
    except Exception as exc:
        logger.exception("Page processing failed")
        terminal = claimed.attempts >= settings.page_max_attempts
        repos.update_page(
            message.book_id,
            message.page_number,
            message.owner_id,
            "SET #s = :failed, #error = :error, updated_at = :now "
            "REMOVE processing_expires_at",
            {
                ":failed": PageStatus.FAILED.value,
                ":error": str(exc)[:1000],
                ":now": utc_now(),
                ":version": message.version,
            },
            {"#s": "status", "#error": "error", "#v": "version"},
            extra_condition="#v = :version",
        )
        if terminal:
            if not was_correction:
                _update_book_progress(repos, message, failed=1)
            return
        raise


def handler(event: dict, _context: object) -> dict:
    aws, settings = get_aws(), get_settings()
    failures = []
    for record in event.get("Records", []):
        try:
            process_page(
                JobMessage.model_validate(json.loads(record["body"])),
                aws,
                settings,
            )
        except Exception:
            failures.append({"itemIdentifier": record["messageId"]})
    return {"batchItemFailures": failures}

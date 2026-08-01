import io
import json
import logging
import zipfile
from typing import Iterable

import fitz
from PIL import Image

from .aws import Aws, get_aws
from .config import Settings, get_settings
from .models import BookStatus, JobMessage, PageStatus, utc_now
from .repositories import Repositories


logger = logging.getLogger(__name__)
IMAGE_SUFFIXES = (".png", ".jpg", ".jpeg", ".webp")
THUMBNAIL_SIZE = 512
THUMBNAIL_BACKGROUND = (255, 255, 255)


def make_square_thumbnail(
    image_bytes: bytes,
    size: int = THUMBNAIL_SIZE,
    background: tuple[int, int, int] = THUMBNAIL_BACKGROUND,
) -> bytes:
    with Image.open(io.BytesIO(image_bytes)) as source:
        source = source.convert("RGB")
        source.thumbnail((size, size), Image.LANCZOS)
        canvas = Image.new("RGB", (size, size), background)
        offset = ((size - source.width) // 2, (size - source.height) // 2)
        canvas.paste(source, offset)
        buffer = io.BytesIO()
        canvas.save(buffer, format="PNG", optimize=True)
        return buffer.getvalue()


def render_document(data: bytes, max_pages: int = 500) -> Iterable[bytes]:
    if zipfile.is_zipfile(io.BytesIO(data)):
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            names = sorted(
                name
                for name in archive.namelist()
                if not name.endswith("/") and name.lower().endswith(IMAGE_SUFFIXES)
            )
            if not names or len(names) > max_pages:
                raise ValueError(
                    f"Image collection must contain 1-{max_pages} supported images"
                )
            for name in names:
                yield from render_document(archive.read(name), max_pages=1)
        return
    document = fitz.open(stream=data)
    try:
        if document.page_count < 1:
            raise ValueError("Document has no pages")
        if document.page_count > max_pages:
            raise ValueError(f"Document exceeds the {max_pages}-page MVP limit")
        for page in document:
            yield page.get_pixmap(dpi=200, alpha=False).tobytes("png")
    finally:
        document.close()


def process_split(message: JobMessage, aws: Aws, settings: Settings) -> None:
    if message.kind != "split" or not message.source_key:
        raise ValueError("Invalid split message")
    repos = Repositories(aws, settings)
    book = repos.get_book(message.book_id, message.owner_id)
    repos.update_book(
        message.book_id,
        message.owner_id,
        "SET #s = :status, updated_at = :now REMOVE #error",
        {":status": BookStatus.SPLITTING.value, ":now": utc_now()},
        {"#s": "status", "#error": "error"},
    )
    source = aws.s3.get_object(
        Bucket=settings.upload_bucket, Key=message.source_key
    )["Body"].read()
    images = list(render_document(source, settings.max_pages))
    now = utc_now()
    page_jobs: list[JobMessage] = []
    for page_number, image in enumerate(images, start=1):
        if page_number == 1:
            aws.s3.put_object(
                Bucket=settings.assets_bucket,
                Key=f"books/{message.book_id}/pages/cover-thumb.png",
                Body=make_square_thumbnail(image),
                ContentType="image/png",
                ServerSideEncryption="AES256",
            )
        image_key = f"books/{message.book_id}/pages/{page_number}/source.png"
        aws.s3.put_object(
            Bucket=settings.assets_bucket,
            Key=image_key,
            Body=image,
            ContentType="image/png",
            ServerSideEncryption="AES256",
        )
        repos.put_page(
            {
                "book_id": message.book_id,
                "page_number": page_number,
                "owner_id": message.owner_id,
                "status": PageStatus.QUEUED.value,
                "image_key": image_key,
                "version": 1,
                "attempts": 0,
                "created_at": now,
                "updated_at": now,
            },
            only_if_absent=True,
        )
        page_jobs.append(
            JobMessage(
                kind="page",
                book_id=message.book_id,
                owner_id=message.owner_id,
                page_number=page_number,
                image_key=image_key,
                tts_voice=book.tts_voice,
                version=1,
            )
        )
    repos.update_book(
        message.book_id,
        message.owner_id,
        "SET #s = :status, total_pages = :total, cover_page_key = :cover, "
        "updated_at = :now",
        {
            ":status": BookStatus.PROCESSING.value,
            ":total": len(images),
            ":cover": f"books/{message.book_id}/pages/cover-thumb.png",
            ":now": utc_now(),
        },
        {"#s": "status"},
    )
    for job in page_jobs:
        queue_url = (
            settings.priority_queue_url
            if job.page_number == 1
            else settings.page_queue_url
        )
        aws.send(queue_url, job.model_dump(), group_id=message.book_id)


def handler(event: dict, _context: object) -> dict:
    aws, settings = get_aws(), get_settings()
    failures = []
    for record in event.get("Records", []):
        try:
            message = JobMessage.model_validate(json.loads(record["body"]))
            process_split(message, aws, settings)
        except Exception:
            logger.exception("Split job failed")
            failures.append({"itemIdentifier": record["messageId"]})
    return {"batchItemFailures": failures}

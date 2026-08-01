import json
import re
from functools import lru_cache
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from botocore.exceptions import ClientError

from .auth import Principal, current_user
from .aws import Aws, get_aws
from .config import Settings, get_settings
from .models import (
    Book,
    BookCreate,
    BookList,
    BookProgress,
    BookStatus,
    ChatRequest,
    ChatResponse,
    JobMessage,
    Page,
    PageCorrection,
    PageSummary,
    PageStatus,
    Segment,
    UploadUrlRequest,
    UploadUrlResponse,
    utc_now,
)
from .providers import get_provider
from .rag import build_context, delete_book_index, index_book, retrieve_chunks
from .repositories import Repositories


router = APIRouter()


def get_repositories(
    aws: Aws = Depends(get_aws), settings: Settings = Depends(get_settings)
) -> Repositories:
    return Repositories(aws, settings)


@router.post("/upload-url", response_model=UploadUrlResponse)
def create_upload_url(
    payload: UploadUrlRequest,
    user: Principal = Depends(current_user),
    aws: Aws = Depends(get_aws),
    settings: Settings = Depends(get_settings),
) -> UploadUrlResponse:
    if payload.size_bytes > settings.max_upload_bytes:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "File is too large")
    upload_id = str(uuid4())
    safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", payload.filename)
    key = f"uploads/{user.user_id}/{upload_id}/{safe_name}"
    post = aws.s3.generate_presigned_post(
        Bucket=settings.upload_bucket,
        Key=key,
        Fields={"Content-Type": payload.content_type},
        Conditions=[
            {"Content-Type": payload.content_type},
            ["content-length-range", 1, settings.max_upload_bytes],
        ],
        ExpiresIn=settings.presigned_url_ttl,
    )
    return UploadUrlResponse(
        upload_id=upload_id,
        object_key=key,
        url=post["url"],
        fields=post["fields"],
        expires_in=settings.presigned_url_ttl,
    )


@router.post("/books", response_model=Book, status_code=status.HTTP_202_ACCEPTED)
def create_book(
    payload: BookCreate,
    user: Principal = Depends(current_user),
    aws: Aws = Depends(get_aws),
    settings: Settings = Depends(get_settings),
    repos: Repositories = Depends(get_repositories),
) -> Book:
    expected_prefix = f"uploads/{user.user_id}/{payload.upload_id}/"
    if not payload.object_key.startswith(expected_prefix):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid upload object key")
    try:
        upload = aws.s3.head_object(
            Bucket=settings.upload_bucket, Key=payload.object_key
        )
    except ClientError as exc:
        if exc.response["Error"]["Code"] in {"404", "NoSuchKey", "NotFound"}:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Upload not found") from exc
        raise
    if upload.get("ContentLength", 0) > settings.max_upload_bytes:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "File is too large")
    if upload.get("ContentType") not in {
        "application/pdf",
        "application/zip",
        "image/png",
        "image/jpeg",
        "image/webp",
    }:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unsupported upload type")
    now = utc_now()
    book_id = str(uuid4())
    book = repos.create_book(
        {
            "book_id": book_id,
            "owner_id": user.user_id,
            "title": payload.title,
            "language": payload.language,
            "tts_voice": payload.tts_voice,
            "source_key": payload.object_key,
            "status": BookStatus.QUEUED.value,
            "total_pages": 0,
            "completed_pages": 0,
            "failed_pages": 0,
            "visibility": "private",
            "created_at": now,
            "updated_at": now,
        }
    )
    try:
        aws.send(
            settings.split_queue_url,
            JobMessage(
                kind="split",
                book_id=book_id,
                owner_id=user.user_id,
                source_key=payload.object_key,
                tts_voice=payload.tts_voice,
            ).model_dump(),
        )
    except Exception as exc:
        repos.update_book(
            book_id,
            user.user_id,
            "SET #s = :failed, #error = :error, updated_at = :now",
            {":failed": BookStatus.FAILED.value, ":error": str(exc), ":now": utc_now()},
            {"#s": "status", "#error": "error"},
        )
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Unable to queue book") from exc
    return book


@router.get("/books", response_model=BookList)
def list_books(
    limit: int = Query(50, ge=1, le=100),
    user: Principal = Depends(current_user),
    aws: Aws = Depends(get_aws),
    settings: Settings = Depends(get_settings),
    repos: Repositories = Depends(get_repositories),
) -> BookList:
    items = repos.list_books(user.user_id, limit)
    return BookList(
        items=[
            book.model_copy(
                update={
                    "cover_url": aws.s3.generate_presigned_url(
                        "get_object",
                        Params={
                            "Bucket": settings.assets_bucket,
                            "Key": book.cover_page_key,
                        },
                        ExpiresIn=settings.presigned_url_ttl,
                    )
                }
            )
            if book.cover_page_key
            else book
            for book in items
        ]
    )


@router.get("/books/{book_id}", response_model=Book)
def get_book(
    book_id: str,
    user: Principal = Depends(current_user),
    repos: Repositories = Depends(get_repositories),
) -> Book:
    return repos.get_book(book_id, user.user_id)


@router.get("/books/{book_id}/status", response_model=BookProgress)
def get_book_status(
    book_id: str,
    user: Principal = Depends(current_user),
    repos: Repositories = Depends(get_repositories),
) -> BookProgress:
    book = repos.get_book(book_id, user.user_id)
    pages = [
        PageSummary.model_validate(item)
        for item in repos.list_pages(book_id)
        if item.get("owner_id") == user.user_id
    ]
    return BookProgress(
        book_id=book.book_id,
        status=book.status,
        total_pages=book.total_pages,
        completed_pages=book.completed_pages,
        failed_pages=book.failed_pages,
        ready_pages=[
            page.page_number
            for page in pages
            if page.status == PageStatus.COMPLETED
        ],
        pages=pages,
    )


@router.get("/books/{book_id}/pages/{page_number}", response_model=Page)
def get_page(
    book_id: str,
    page_number: int,
    user: Principal = Depends(current_user),
    aws: Aws = Depends(get_aws),
    settings: Settings = Depends(get_settings),
    repos: Repositories = Depends(get_repositories),
) -> Page:
    repos.get_book(book_id, user.user_id)
    page = repos.get_page(book_id, page_number, user.user_id)
    urls = {
        "image_url": aws.s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.assets_bucket, "Key": page.image_key},
            ExpiresIn=settings.presigned_url_ttl,
        )
    }
    for field, key in (
        ("audio_url", page.audio_key),
        ("segments_url", page.segments_key),
    ):
        if key:
            urls[field] = aws.s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": settings.assets_bucket, "Key": key},
                ExpiresIn=settings.presigned_url_ttl,
            )
    segments: list[Segment] = []
    if page.segments_key:
        manifest = json.loads(
            aws.s3.get_object(
                Bucket=settings.assets_bucket, Key=page.segments_key
            )["Body"].read()
        )
        segments = [
            Segment.model_validate(item).model_copy(
                update={
                    "audio_url": aws.s3.generate_presigned_url(
                        "get_object",
                        Params={
                            "Bucket": settings.assets_bucket,
                            "Key": item["audio_key"],
                        },
                        ExpiresIn=settings.presigned_url_ttl,
                    )
                }
            )
            for item in manifest
        ]
    return page.model_copy(update={**urls, "segments": segments})


@router.patch(
    "/books/{book_id}/pages/{page_number}",
    response_model=Page,
    status_code=status.HTTP_202_ACCEPTED,
)
def correct_page(
    book_id: str,
    page_number: int,
    payload: PageCorrection,
    user: Principal = Depends(current_user),
    aws: Aws = Depends(get_aws),
    settings: Settings = Depends(get_settings),
    repos: Repositories = Depends(get_repositories),
) -> Page:
    book = repos.get_book(book_id, user.user_id)
    page = repos.get_page(book_id, page_number, user.user_id)
    text = payload.text if payload.text is not None else page.corrected_text or page.ocr_text
    if not text:
        raise HTTPException(status.HTTP_409_CONFLICT, "Page has no text to regenerate")
    new_version = page.version + 1
    updated = repos.update_page(
        book_id,
        page_number,
        user.user_id,
        "SET corrected_text = :text, #s = :status, #v = :version, "
        "updated_at = :now REMOVE #error, pending_audio_key",
        {
            ":text": text,
            ":status": PageStatus.CORRECTING.value,
            ":version": new_version,
            ":old_version": page.version,
            ":now": utc_now(),
        },
        {"#s": "status", "#error": "error", "#v": "version"},
        extra_condition="#v = :old_version",
    )
    # audio_key is deliberately untouched until the replacement is fully generated.
    try:
        aws.send(
            settings.priority_queue_url,
            JobMessage(
                kind="page",
                book_id=book_id,
                owner_id=user.user_id,
                page_number=page_number,
                image_key=page.image_key,
                text_override=text,
                tts_voice=book.tts_voice,
                version=new_version,
            ).model_dump(),
            group_id=book_id,
        )
    except Exception as exc:
        repos.update_page(
            book_id,
            page_number,
            user.user_id,
            "SET #s = :failed, #error = :error, updated_at = :now",
            {
                ":failed": PageStatus.FAILED.value,
                ":error": "Unable to queue regeneration",
                ":now": utc_now(),
                ":version": new_version,
            },
            {"#s": "status", "#error": "error", "#v": "version"},
            extra_condition="#v = :version",
        )
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Unable to queue regeneration"
        ) from exc
    return updated


@router.post("/books/{book_id}/chat", response_model=ChatResponse)
def chat_about_book(
    book_id: str,
    payload: ChatRequest,
    user: Principal = Depends(current_user),
    aws: Aws = Depends(get_aws),
    settings: Settings = Depends(get_settings),
    repos: Repositories = Depends(get_repositories),
) -> ChatResponse:
    book = repos.get_book(book_id, user.user_id)
    if book.status not in {BookStatus.COMPLETED, BookStatus.PARTIAL}:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Chat is available after the book finishes processing",
        )
    if not settings.vector_bucket:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Vector knowledge base is not configured",
        )
    if book.index_status == "indexing":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Knowledge base is still indexing. Try again shortly.",
        )
    if book.index_status != "ready":
        try:
            index_book(aws, settings, repos, book_id, user.user_id)
            book = repos.get_book(book_id, user.user_id)
        except Exception as exc:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                book.index_error or f"Unable to build knowledge base: {exc}",
            ) from exc
        if book.index_status != "ready":
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                book.index_error or "Knowledge base is not ready for this book",
            )
    try:
        hits = retrieve_chunks(aws, settings, book_id, payload.message)
    except ClientError as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            f"Unable to search book knowledge base: {exc}",
        ) from exc
    context = build_context(hits)
    if not context.strip():
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "No indexed text was found for this book yet",
        )
    citations = sorted(
        {
            int(item["metadata"]["page"])
            for item in hits
            if isinstance(item.get("metadata"), dict)
            and item["metadata"].get("page") is not None
        }
    )
    system = (
        "You are a careful assistant for a Tibetan audiobook. "
        "Answer only using the provided book excerpts. "
        "If the excerpts do not contain the answer, say you cannot find it in the book. "
        "Prefer Tibetan when the user writes in Tibetan. "
        "Cite page numbers when helpful.\n\n"
        f"Book title: {book.title}\n\n"
        f"Book excerpts:\n{context}"
    )
    history = [
        {"role": item.role, "content": item.content}
        for item in payload.history
        if item.role in {"user", "assistant"}
    ][-12:]
    messages = [
        {"role": "system", "content": system},
        *history,
        {"role": "user", "content": payload.message},
    ]
    try:
        answer = get_provider(settings).chat(messages)
    except Exception as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"Chat provider failed: {exc}",
        ) from exc
    return ChatResponse(
        answer=answer,
        citations=citations,
        index_status=book.index_status,
    )


@router.delete("/books/{book_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_book(
    book_id: str,
    user: Principal = Depends(current_user),
    aws: Aws = Depends(get_aws),
    settings: Settings = Depends(get_settings),
    repos: Repositories = Depends(get_repositories),
) -> Response:
    book = repos.get_book(book_id, user.user_id)
    repos.delete_pages(book_id)
    delete_book_index(aws, settings, book_id)
    for bucket, prefix in (
        (settings.assets_bucket, f"books/{book_id}/"),
        (settings.upload_bucket, book.source_key),
    ):
        result = aws.s3.list_objects_v2(Bucket=bucket, Prefix=prefix)
        objects = [{"Key": item["Key"]} for item in result.get("Contents", [])]
        if objects:
            aws.s3.delete_objects(Bucket=bucket, Delete={"Objects": objects})
    repos.delete_book(book_id, user.user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

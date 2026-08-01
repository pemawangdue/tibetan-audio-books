"""Per-book RAG over S3 Vectors, embedded with Bedrock Titan."""

from __future__ import annotations

import hashlib
import json
import logging
import math
import re
import struct
from dataclasses import dataclass
from typing import Any

from botocore.exceptions import ClientError

from .aws import Aws
from .config import Settings
from .models import utc_now
from .repositories import Repositories

logger = logging.getLogger(__name__)

# Rough Tibetan/UTF-8 budget: ~2 chars per token keeps us under Monlam's 20k cap.
CHARS_PER_TOKEN = 2
CONTEXT_TOKEN_BUDGET = 12_000
CONTEXT_CHAR_BUDGET = CONTEXT_TOKEN_BUDGET * CHARS_PER_TOKEN


@dataclass(frozen=True)
class TextChunk:
    key: str
    page_number: int
    chunk_index: int
    text: str


def index_name_for_book(book_id: str) -> str:
    # S3 Vectors index names: lowercase letters, numbers, hyphens.
    return f"book-{book_id.lower()}"


def chunk_page_text(
    page_number: int,
    text: str,
    *,
    chunk_chars: int,
    overlap_chars: int,
) -> list[TextChunk]:
    cleaned = re.sub(r"\s+", " ", text).strip()
    if not cleaned:
        return []
    # Prefer breaking on Tibetan shad / punctuation when near the limit.
    units = [
        part.strip()
        for part in re.split(r"(?<=[།༎.!?])\s*", cleaned)
        if part.strip()
    ]
    if not units:
        units = [cleaned]

    chunks: list[TextChunk] = []
    buffer = ""
    chunk_index = 0

    def flush(force: bool = False) -> None:
        nonlocal buffer, chunk_index
        while len(buffer) >= chunk_chars or (force and buffer):
            take = buffer[:chunk_chars]
            if len(buffer) > chunk_chars:
                # Back up to a sentence boundary when possible.
                cut = max(take.rfind("།"), take.rfind("༎"), take.rfind("."), take.rfind("!"))
                if cut >= chunk_chars // 2:
                    take = buffer[: cut + 1]
            take = take.strip()
            if take:
                chunks.append(
                    TextChunk(
                        key=f"p{page_number:04d}-c{chunk_index:04d}",
                        page_number=page_number,
                        chunk_index=chunk_index,
                        text=take,
                    )
                )
                chunk_index += 1
            if len(buffer) <= len(take):
                buffer = ""
                break
            next_start = max(0, len(take) - overlap_chars)
            buffer = buffer[next_start:].lstrip()
            if force and len(buffer) < chunk_chars // 4:
                # Trailing leftover will be emitted as its own final chunk below.
                break

    for unit in units:
        candidate = f"{buffer} {unit}".strip() if buffer else unit
        if len(candidate) <= chunk_chars:
            buffer = candidate
            continue
        flush(force=False)
        buffer = f"{buffer} {unit}".strip() if buffer else unit
        flush(force=False)
    flush(force=True)
    if buffer.strip():
        chunks.append(
            TextChunk(
                key=f"p{page_number:04d}-c{chunk_index:04d}",
                page_number=page_number,
                chunk_index=chunk_index,
                text=buffer.strip(),
            )
        )
    return chunks


def _mock_embedding(text: str, dimensions: int) -> list[float]:
    digest = hashlib.sha256(text.encode("utf-8")).digest()
    values: list[float] = []
    while len(values) < dimensions:
        for i in range(0, len(digest) - 3, 4):
            raw = struct.unpack_from(">I", digest, i)[0]
            values.append(((raw / 0xFFFFFFFF) * 2.0) - 1.0)
            if len(values) >= dimensions:
                break
        digest = hashlib.sha256(digest + text.encode("utf-8")).digest()
    # L2-normalize for cosine similarity.
    norm = math.sqrt(sum(v * v for v in values)) or 1.0
    return [v / norm for v in values]


def embed_texts(aws: Aws, settings: Settings, texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    if settings.env in {"local", "test"} or settings.monlam_provider == "mock":
        return [_mock_embedding(text, settings.embedding_dimensions) for text in texts]

    vectors: list[list[float]] = []
    for text in texts:
        body = {
            "inputText": text[: settings.embedding_max_input_chars],
            "dimensions": settings.embedding_dimensions,
            "normalize": True,
        }
        response = aws.bedrock.invoke_model(
            modelId=settings.embedding_model_id,
            contentType="application/json",
            accept="application/json",
            body=json.dumps(body).encode("utf-8"),
        )
        logger.info("Embedding response: %s", response)
        
        payload = json.loads(response["body"].read())
        embedding = payload.get("embedding")
        if not isinstance(embedding, list):
            raise ValueError(f"Unexpected embedding response: {payload}")
        vectors.append([float(value) for value in embedding])
    return vectors


def require_vector_bucket(settings: Settings) -> str:
    if not settings.vector_bucket:
        raise RuntimeError("VECTOR_BUCKET is not configured")
    return settings.vector_bucket


def ensure_book_index(aws: Aws, settings: Settings, book_id: str) -> str:
    # Vector bucket is provisioned by CDK (AWS::S3Vectors::VectorBucket).
    require_vector_bucket(settings)
    name = index_name_for_book(book_id)
    try:
        aws.s3vectors.get_index(
            vectorBucketName=settings.vector_bucket, indexName=name
        )
        return name
    except ClientError:
        pass
    try:
        aws.s3vectors.create_index(
            vectorBucketName=settings.vector_bucket,
            indexName=name,
            dataType="float32",
            dimension=settings.embedding_dimensions,
            distanceMetric="cosine",
            metadataConfiguration={"nonFilterableMetadataKeys": ["text"]},
        )
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code not in {"ConflictException", "IndexAlreadyExists"}:
            raise
    return name


def delete_book_index(aws: Aws, settings: Settings, book_id: str) -> None:
    if not settings.vector_bucket:
        return
    name = index_name_for_book(book_id)
    try:
        aws.s3vectors.delete_index(
            vectorBucketName=settings.vector_bucket, indexName=name
        )
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code not in {"NotFoundException", "ResourceNotFoundException", "404"}:
            logger.warning("Failed to delete vector index %s: %s", name, exc)


def _put_vector_batches(
    aws: Aws,
    settings: Settings,
    index: str,
    vectors: list[dict[str, Any]],
) -> None:
    batch_size = 100
    for start in range(0, len(vectors), batch_size):
        aws.s3vectors.put_vectors(
            vectorBucketName=settings.vector_bucket,
            indexName=index,
            vectors=vectors[start : start + batch_size],
        )


def collect_book_pages(
    aws: Aws, settings: Settings, repos: Repositories, book_id: str
) -> list[tuple[int, str]]:
    pages: list[tuple[int, str]] = []
    for item in sorted(repos.list_pages(book_id), key=lambda row: int(row["page_number"])):
        if item.get("status") != "completed":
            continue
        page_number = int(item["page_number"])
        text = (item.get("corrected_text") or item.get("ocr_text") or "").strip()
        if not text:
            version = int(item.get("version") or 1)
            key = f"books/{book_id}/pages/{page_number}/v{version}/fulltext.txt"
            try:
                text = (
                    aws.s3.get_object(Bucket=settings.assets_bucket, Key=key)["Body"]
                    .read()
                    .decode("utf-8")
                    .strip()
                )
            except ClientError:
                continue
        if text:
            pages.append((page_number, text))
    return pages


def index_book(
    aws: Aws,
    settings: Settings,
    repos: Repositories,
    book_id: str,
    owner_id: str,
) -> int:
    """Build/replace the book's vector knowledge base from completed page text."""
    repos.update_book(
        book_id,
        owner_id,
        "SET index_status = :status, updated_at = :now",
        {":status": "indexing", ":now": utc_now()},
    )
    try:
        pages = collect_book_pages(aws, settings, repos, book_id)
        if not pages:
            repos.update_book(
                book_id,
                owner_id,
                "SET index_status = :status, index_error = :error, updated_at = :now",
                {
                    ":status": "failed",
                    ":error": "No completed page text to index",
                    ":now": utc_now(),
                },
            )
            return 0

        # Consolidated full-book text for inspection / future use.
        combined = "\n\n".join(
            f"=== Page {page_number} ===\n{text}" for page_number, text in pages
        )
        aws.s3.put_object(
            Bucket=settings.assets_bucket,
            Key=f"books/{book_id}/fulltext.txt",
            Body=combined.encode("utf-8"),
            ContentType="text/plain; charset=utf-8",
            ServerSideEncryption="AES256",
        )

        chunks: list[TextChunk] = []
        for page_number, text in pages:
            chunks.extend(
                chunk_page_text(
                    page_number,
                    text,
                    chunk_chars=settings.rag_chunk_chars,
                    overlap_chars=settings.rag_chunk_overlap_chars,
                )
            )
        if not chunks:
            raise ValueError("Chunking produced no vectors")

        # Replace prior index so corrections never leave stale chunks behind.
        delete_book_index(aws, settings, book_id)
        index = ensure_book_index(aws, settings, book_id)
        embeddings = embed_texts(aws, settings, [chunk.text for chunk in chunks])
        vectors = [
            {
                "key": chunk.key,
                "data": {"float32": embedding},
                "metadata": {
                    "book_id": book_id,
                    "page": chunk.page_number,
                    "chunk": chunk.chunk_index,
                    "text": chunk.text,
                },
            }
            for chunk, embedding in zip(chunks, embeddings, strict=True)
        ]
        _put_vector_batches(aws, settings, index, vectors)
        repos.update_book(
            book_id,
            owner_id,
            "SET index_status = :status, indexed_chunks = :chunks, "
            "indexed_at = :now, updated_at = :now REMOVE index_error",
            {
                ":status": "ready",
                ":chunks": len(vectors),
                ":now": utc_now(),
            },
        )
        logger.info("Indexed book %s with %s chunks", book_id, len(vectors))
        return len(vectors)
    except Exception as exc:
        logger.exception("Indexing failed for book %s", book_id)
        repos.update_book(
            book_id,
            owner_id,
            "SET index_status = :status, index_error = :error, updated_at = :now",
            {
                ":status": "failed",
                ":error": str(exc)[:1000],
                ":now": utc_now(),
            },
        )
        raise


def retrieve_chunks(
    aws: Aws,
    settings: Settings,
    book_id: str,
    question: str,
    *,
    top_k: int | None = None,
) -> list[dict[str, Any]]:
    index = index_name_for_book(book_id)
    query_vector = embed_texts(aws, settings, [question])[0]
    response = aws.s3vectors.query_vectors(
        vectorBucketName=settings.vector_bucket,
        indexName=index,
        queryVector={"float32": query_vector},
        topK=top_k or settings.rag_top_k,
        returnMetadata=True,
        returnDistance=True,
    )
    return response.get("vectors", [])


def build_context(chunks: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    used = 0
    for item in chunks:
        metadata = item.get("metadata") or {}
        text = str(metadata.get("text") or "").strip()
        if not text:
            continue
        page = metadata.get("page")
        block = f"[Page {page}]\n{text}" if page is not None else text
        if used + len(block) > CONTEXT_CHAR_BUDGET:
            remaining = CONTEXT_CHAR_BUDGET - used
            if remaining > 200:
                parts.append(block[:remaining].rstrip() + "…")
            break
        parts.append(block)
        used += len(block) + 2
    return "\n\n".join(parts)

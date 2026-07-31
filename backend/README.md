# Dadhep backend

FastAPI API and AWS Lambda workers for the Dadhep Tibetan audio-book MVP.

## Components

- `app.handler.handler`: API Gateway/Lambda entry point (Mangum)
- `app.split_worker.handler`: SQS document splitter (PDF, image, or ZIP image collection)
- `app.page_worker.handler`: SQS OCR, cleanup, sentence segmentation, and TTS worker
- DynamoDB `Books` table: partition key `book_id` (string)
- DynamoDB `Pages` table: partition key `book_id` (string), sort key `page_number` (number)
- DynamoDB `Cache` table: partition key `cache_key` (string)
- Document/page queues and a priority queue for page 1 and corrections

Use the sibling `infra/` CDK app for deployment. `template.example.yaml` is only
a minimal SAM reference and does not include the complete security, delivery,
queue, and alarm configuration.

## Local development

Requires Python 3.12.

```bash
python -m venv .venv
./.venv/Scripts/activate
pip install -r requirements-dev.txt
copy .env.example .env
uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
pytest
```

Local auth bypass is refused when `ENV` is `staging` or `production`.
For local multi-user testing, send `Authorization: Bearer local-alice`; otherwise
the configured `LOCAL_USER_ID` is used.

## Workflow

1. Request `POST /upload-url`, then submit the returned presigned POST directly
   to S3.
2. Call `POST /books` with the `upload_id` and exact returned object key.
3. Poll `GET /books/{book_id}/status`; retrieve a page with
   `GET /books/{book_id}/pages/{page_number}`.
4. Correct or regenerate with `PATCH /books/{book_id}/pages/{page_number}`:
   `{"text":"...", "regenerate":true}`. The existing `audio_key` remains usable
   until the replacement version completes.

SQS event-source mappings must enable `ReportBatchItemFailures`. Configure the
page and priority queues with a visibility timeout longer than Lambda timeout.
The priority queue invokes the same page worker with separately reserved
concurrency. Workers use conditional version/status updates, versioned S3 keys,
partial batch failures, and terminal attempt counters for safe retries.

The mock Monlam provider is deterministic and suitable for tests. Set
`MONLAM_PROVIDER=rest` to use the isolated REST adapter shell. Endpoint
paths, API-key header, voice, and timeout are environment-configurable; their
payload mappings remain placeholders pending the official provider contract.

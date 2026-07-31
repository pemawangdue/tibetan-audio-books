from app.config import Settings
from app.models import JobMessage, Page, PageStatus
from app import page_worker, split_worker


class CompletedRepos:
    def __init__(self, *_args):
        pass

    def get_page(self, book_id, page_number, owner_id):
        return Page(
            book_id=book_id,
            page_number=page_number,
            owner_id=owner_id,
            status=PageStatus.COMPLETED,
            image_key="image.png",
            audio_key="audio.mp3",
            version=1,
            attempts=1,
            created_at="2026-01-01T00:00:00+00:00",
            updated_at="2026-01-01T00:00:00+00:00",
        )


class ExplodingAws:
    @property
    def s3(self):
        raise AssertionError("idempotent job attempted S3 access")


def test_completed_page_message_is_idempotent(monkeypatch) -> None:
    monkeypatch.setattr(page_worker, "Repositories", CompletedRepos)
    page_worker.process_page(
        JobMessage(
            kind="page",
            book_id="book-1",
            owner_id="user-1",
            page_number=1,
            image_key="image.png",
            version=1,
        ),
        ExplodingAws(),
        Settings(env="test", local_auth_bypass=True),
    )


def test_sqs_handler_reports_only_failed_records(monkeypatch) -> None:
    monkeypatch.setattr(page_worker, "get_aws", lambda: object())
    monkeypatch.setattr(
        page_worker,
        "get_settings",
        lambda: Settings(env="test", local_auth_bypass=True),
    )

    def process(message, *_args):
        if message.book_id == "bad":
            raise RuntimeError("retry")

    monkeypatch.setattr(page_worker, "process_page", process)
    event = {
        "Records": [
            {
                "messageId": "1",
                "body": '{"kind":"page","book_id":"ok","owner_id":"u",'
                '"page_number":1,"image_key":"a"}',
            },
            {
                "messageId": "2",
                "body": '{"kind":"page","book_id":"bad","owner_id":"u",'
                '"page_number":1,"image_key":"a"}',
            },
        ]
    }
    assert page_worker.handler(event, None) == {
        "batchItemFailures": [{"itemIdentifier": "2"}]
    }


class SplitRepos:
    def __init__(self, *_args):
        pass

    def get_book(self, *_args):
        return type("Book", (), {"tts_voice": "default"})()

    def update_book(self, *_args, **_kwargs):
        return object()

    def put_page(self, *_args, **_kwargs):
        return object()


class SplitS3:
    def get_object(self, **_kwargs):
        return {"Body": type("Body", (), {"read": lambda self: b"pdf"})()}

    def put_object(self, **_kwargs):
        return None


class SplitAws:
    def __init__(self):
        self.s3 = SplitS3()
        self.sent = []

    def send(self, queue_url, message, **_kwargs):
        self.sent.append((queue_url, message["page_number"]))


def test_split_worker_prioritizes_page_one(monkeypatch) -> None:
    monkeypatch.setattr(split_worker, "Repositories", SplitRepos)
    monkeypatch.setattr(split_worker, "render_document", lambda *_args: [b"1", b"2"])
    aws = SplitAws()
    settings = Settings(
        env="test",
        local_auth_bypass=True,
        upload_bucket="uploads",
        assets_bucket="assets",
        page_queue_url="standard",
        priority_queue_url="priority",
    )
    split_worker.process_split(
        JobMessage(
            kind="split",
            book_id="book-1",
            owner_id="user-1",
            source_key="book.pdf",
        ),
        aws,
        settings,
    )
    assert aws.sent == [("priority", 1), ("standard", 2)]

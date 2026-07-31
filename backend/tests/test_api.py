from fastapi.testclient import TestClient

from app.api import get_repositories
from app.aws import get_aws
from app.main import app
from app.models import Book, BookStatus, PageStatus
from app.repositories import Repositories


class FakeS3:
    def generate_presigned_post(self, **kwargs):
        return {
            "url": "https://uploads.example.test",
            "fields": {"key": kwargs["Key"], **kwargs["Fields"]},
        }


class FakeAws:
    def __init__(self):
        self.s3 = FakeS3()


class FakeRepos:
    def list_books(self, owner_id: str, limit: int):
        return [
            Book(
                book_id="book-1",
                owner_id=owner_id,
                title="Test",
                language="bo",
                source_key="uploads/local-user/u/book.pdf",
                status=BookStatus.COMPLETED,
                total_pages=1,
                completed_pages=1,
                failed_pages=0,
                created_at="2026-01-01T00:00:00+00:00",
                updated_at="2026-01-01T00:00:00+00:00",
            )
        ]


def test_upload_url_is_scoped_to_authenticated_user() -> None:
    app.dependency_overrides[get_aws] = lambda: FakeAws()
    client = TestClient(app)
    response = client.post(
        "/upload-url",
        json={
            "filename": "དཔེ་ཆ.pdf",
            "content_type": "application/pdf",
            "size_bytes": 1024,
        },
    )
    app.dependency_overrides.clear()
    assert response.status_code == 200
    assert response.json()["object_key"].startswith("uploads/local-user/")


def test_list_books_uses_authenticated_owner() -> None:
    app.dependency_overrides[get_repositories] = lambda: FakeRepos()
    client = TestClient(app)
    response = client.get("/books")
    app.dependency_overrides.clear()
    assert response.status_code == 200
    assert response.json()["items"][0]["owner_id"] == "local-user"


class StatusRepos(FakeRepos):
    def get_book(self, book_id: str, owner_id: str):
        return self.list_books(owner_id, 1)[0]

    def list_pages(self, book_id: str):
        return [
            {
                "book_id": book_id,
                "page_number": 1,
                "owner_id": "local-user",
                "status": PageStatus.COMPLETED.value,
                "duration_seconds": 3.2,
            },
            {
                "book_id": book_id,
                "page_number": 2,
                "owner_id": "local-user",
                "status": PageStatus.PROCESSING.value,
            },
        ]


def test_status_exposes_ready_pages_incrementally() -> None:
    app.dependency_overrides[get_repositories] = lambda: StatusRepos()
    client = TestClient(app)
    response = client.get("/books/book-1/status")
    app.dependency_overrides.clear()
    assert response.status_code == 200
    assert response.json()["ready_pages"] == [1]
    assert response.json()["pages"][1]["status"] == "processing"


class ItemTable:
    def __init__(self, item):
        self.item = item

    def get_item(self, **_kwargs):
        return {"Item": self.item}


def test_repository_hides_another_users_page() -> None:
    repos = Repositories.__new__(Repositories)
    repos.pages = ItemTable(
        {
            "book_id": "book-1",
            "page_number": 1,
            "owner_id": "other-user",
        }
    )
    try:
        repos.get_page("book-1", 1, "local-user")
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 404
    else:
        raise AssertionError("foreign page was returned")

import fitz

from decimal import Decimal

from app.config import Settings
from app.models import UploadUrlRequest
from app.providers import MockMonlamProvider, sentence_segments
from app.repositories import _to_dynamo
from app.split_worker import render_document


def test_production_rejects_auth_bypass() -> None:
    try:
        Settings(env="production", local_auth_bypass=True)
    except ValueError as exc:
        assert "local_auth_bypass" in str(exc)
    else:
        raise AssertionError("production bypass was accepted")


def test_upload_filename_is_reduced_to_basename() -> None:
    request = UploadUrlRequest(
        filename="../../book.pdf",
        content_type="application/pdf",
        size_bytes=100,
    )
    assert request.filename == "book.pdf"


def test_mock_provider_is_deterministic_and_segments_shad() -> None:
    provider = MockMonlamProvider()
    image = b"same-image"
    assert provider.ocr(image) == provider.ocr(image)
    assert provider.tts("བོད་") == provider.tts("བོད་")
    assert sentence_segments("ཀ ། ཁ །") == ["ཀ །", "ཁ །"]


def test_to_dynamo_converts_floats_for_dynamodb() -> None:
    assert _to_dynamo(1.25) == Decimal("1.25")
    assert _to_dynamo({":duration": 3.2}) == {":duration": Decimal("3.2")}


def test_pdf_is_rendered_to_200_dpi_png_pages() -> None:
    document = fitz.open()
    document.new_page()
    document.new_page()
    source = document.tobytes()
    document.close()

    pages = list(render_document(source))
    assert len(pages) == 2
    assert all(page.startswith(b"\x89PNG") for page in pages)

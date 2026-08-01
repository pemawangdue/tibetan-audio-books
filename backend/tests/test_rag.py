from app.rag import build_context, chunk_page_text, index_name_for_book
from app.providers import MockMonlamProvider


def test_index_name_is_per_book() -> None:
    assert index_name_for_book("AbC-123") == "book-abc-123"
    assert index_name_for_book("one") != index_name_for_book("two")


def test_chunking_keeps_shad_boundaries_and_overlap() -> None:
    text = "། ".join(f"ཚིག་གྲུབ་{n}" for n in range(40)) + "།"
    chunks = chunk_page_text(3, text, chunk_chars=120, overlap_chars=30)
    assert len(chunks) >= 2
    assert all(chunk.page_number == 3 for chunk in chunks)
    assert chunks[0].key.startswith("p0003-c")
    # Chunks should mostly end on Tibetan sentence markers when possible.
    assert sum(chunk.text.endswith("།") for chunk in chunks[:-1]) >= 1


def test_build_context_includes_page_citations() -> None:
    context = build_context(
        [
            {"metadata": {"page": 2, "text": "དཔེ་ཆའི་ནང་དོན།"}},
            {"metadata": {"page": 5, "text": "གཞན་པའི་སྐོར།"}},
        ]
    )
    assert "[Page 2]" in context
    assert "དཔེ་ཆའི་ནང་དོན།" in context
    assert "[Page 5]" in context


def test_mock_provider_chat() -> None:
    answer = MockMonlamProvider().chat(
        [
            {"role": "system", "content": "context"},
            {"role": "user", "content": "What is this book about?"},
        ]
    )
    assert "What is this book about?" in answer

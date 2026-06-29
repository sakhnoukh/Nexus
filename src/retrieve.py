import json
import base64
from pathlib import Path
from typing import Generator

from src.config import (
    DOCUMENT_STORE_PATH,
    CHROMA_DB_DIR,
    CHROMA_COLLECTION_NAME,
    EMBEDDING_MODEL_NAME,
    TOP_K_RESULTS,
    SILICONFLOW_API_KEY,
    SILICONFLOW_BASE_URL,
    VLM_MODEL_NAME,
)


def retrieve_and_answer(query: str, top_k: int = TOP_K_RESULTS, active_pdfs: list[str] | None = None) -> dict:
    """Full retrieval + generation pipeline.

    1. Embed the query
    2. Search ChromaDB for top-K results (filtered by active_pdfs)
    3. Resolve UUIDs to raw content
    4. Build multimodal prompt and stream answer from VLM

    Returns {answer, retrieved_items}.
    """
    results = _retrieve(query, top_k, active_pdfs)

    answer = _generate_answer(query, results)

    return {
        "answer": answer,
        "retrieved_items": results,
    }


def retrieve_and_answer_stream(
    query: str, top_k: int = TOP_K_RESULTS, active_pdfs: list[str] | None = None
) -> tuple[list[dict], Generator[str, None, None]]:
    """Same as retrieve_and_answer but streams the VLM response.

    Returns (retrieved_items, stream_generator).
    """
    results = _retrieve(query, top_k, active_pdfs)
    stream = _generate_answer_stream(query, results)
    return results, stream


def _retrieve(query: str, top_k: int, active_pdfs: list[str] | None = None) -> list[dict]:
    """Embed query, search ChromaDB, resolve UUIDs to raw content.

    If active_pdfs is provided, filters results to only those PDFs.
    """
    import chromadb
    from sentence_transformers import SentenceTransformer

    if not DOCUMENT_STORE_PATH.exists():
        raise FileNotFoundError(
            "document_store.json not found. Run extract.py and index.py first."
        )

    store: dict = json.loads(DOCUMENT_STORE_PATH.read_text())

    embedder = SentenceTransformer(EMBEDDING_MODEL_NAME)
    query_embedding = embedder.encode(query, normalize_embeddings=True).tolist()

    client = chromadb.PersistentClient(path=str(CHROMA_DB_DIR))
    collection = client.get_collection(CHROMA_COLLECTION_NAME)

    # Build where filter for active PDFs
    where_filter = None
    if active_pdfs:
        where_filter = {"source_pdf": {"$in": active_pdfs}}

    search_results = collection.query(
        query_embeddings=[query_embedding],
        n_results=top_k,
        where=where_filter,
    )

    retrieved_items = []
    for i, uuid_ in enumerate(search_results["ids"][0]):
        entry = store.get(uuid_)
        if not entry:
            continue

        item = {
            "uuid": uuid_,
            "type": entry["type"],
            "content": entry["content"],
            "path": entry.get("path"),
            "page": entry.get("page", 0),
            "source_pdf": entry.get("source_pdf", ""),
            "distance": search_results["distances"][0][i],
        }

        # For images, load the actual image file as base64
        if entry["type"] == "image" and entry.get("path"):
            item["image_base64"] = _encode_image_base64(entry["path"])

        retrieved_items.append(item)

    return retrieved_items


def _generate_answer(query: str, retrieved_items: list[dict]) -> str:
    """Build multimodal prompt and get answer from VLM (non-streaming)."""
    from openai import OpenAI

    client = OpenAI(api_key=SILICONFLOW_API_KEY, base_url=SILICONFLOW_BASE_URL)

    messages = _build_multimodal_messages(query, retrieved_items)

    response = client.chat.completions.create(
        model=VLM_MODEL_NAME,
        messages=messages,
        max_tokens=1024,
        temperature=0.3,
    )

    return response.choices[0].message.content.strip()


def _generate_answer_stream(
    query: str, retrieved_items: list[dict]
) -> Generator[str, None, None]:
    """Build multimodal prompt and stream answer from VLM."""
    from openai import OpenAI

    client = OpenAI(api_key=SILICONFLOW_API_KEY, base_url=SILICONFLOW_BASE_URL)

    messages = _build_multimodal_messages(query, retrieved_items)

    stream = client.chat.completions.create(
        model=VLM_MODEL_NAME,
        messages=messages,
        max_tokens=1024,
        temperature=0.3,
        stream=True,
    )

    for chunk in stream:
        delta = chunk.choices[0].delta
        if delta.content:
            yield delta.content


def _build_multimodal_messages(query: str, retrieved_items: list[dict]) -> list[dict]:
    """Construct the OpenAI-compatible multimodal message payload."""
    context_parts = []
    image_count = 0

    content = [
        {
            "type": "text",
            "text": (
                "You are a technical support engineer assistant. "
                "Use the following retrieved context from a technical manual "
                "to answer the user's question. The context may include both "
                "text excerpts and engineering diagrams. If the answer requires "
                "visual information from a diagram, reference what you see in the image.\n\n"
            ),
        }
    ]

    for item in retrieved_items:
        source = item.get("source_pdf", "unknown")
        if item["type"] == "text":
            context_parts.append(f"[Text from {source}, page {item['page']}]: {item['content']}")
        elif item["type"] == "image":
            context_parts.append(
                f"[Diagram from {source}, page {item['page']}]: {item['content']}"
            )

    context_text = "\n\n".join(context_parts)

    content.append({
        "type": "text",
        "text": f"Retrieved Context:\n{context_text}\n\nUser Question: {query}",
    })

    # Attach retrieved images
    for item in retrieved_items:
        if item["type"] == "image" and item.get("image_base64"):
            content.append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/jpeg;base64,{item['image_base64']}"
                },
            })
            image_count += 1

    return [{"role": "user", "content": content}]


def _encode_image_base64(image_path: str) -> str:
    """Read an image file and return its base64-encoded string."""
    with open(image_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


if __name__ == "__main__":
    import sys

    query = sys.argv[1] if len(sys.argv) > 1 else "What components are shown in the diagrams?"
    result = retrieve_and_answer(query)

    print(f"\nQuery: {query}")
    print(f"\nAnswer: {result['answer']}")
    print(f"\nRetrieved {len(result['retrieved_items'])} items:")
    for item in result["retrieved_items"]:
        print(f"  - [{item['type']}] page {item['page']} (distance: {item['distance']:.4f})")

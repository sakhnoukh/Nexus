import json
import base64
from pathlib import Path

from src.config import (
    DOCUMENT_STORE_PATH,
    EXTRACTED_IMAGES_DIR,
    CHROMA_DB_DIR,
    CHROMA_COLLECTION_NAME,
    EMBEDDING_MODEL_NAME,
    PDF_REGISTRY_PATH,
    SILICONFLOW_API_KEY,
    SILICONFLOW_BASE_URL,
    VLM_MODEL_NAME,
    VLM_SUMMARY_PROMPT,
)


def build_index() -> None:
    """Full indexing pipeline: VLM summaries → embeddings → ChromaDB.

    Reads document_store.json (created by extract.py), generates VLM
    descriptions for images, embeds everything, and indexes in ChromaDB.
    """
    if not DOCUMENT_STORE_PATH.exists():
        raise FileNotFoundError(
            "document_store.json not found. Run extract.py first."
        )

    store: dict = json.loads(DOCUMENT_STORE_PATH.read_text())

    # Phase 2a: Generate VLM summaries for images
    print("Generating VLM summaries for extracted images...")
    for uuid_, entry in store.items():
        if entry["type"] == "image" and entry["content"] is None:
            # Safety check: skip images that are too small for the VLM
            from PIL import Image as PILImage
            try:
                with PILImage.open(entry["path"]) as img:
                    w, h = img.size
                if w < 28 or h < 28:
                    print(f"  Skipping {Path(entry['path']).name} ({w}x{h}) — too small for VLM")
                    entry["content"] = f"[Image too small to process: {w}x{h}]"
                    continue
            except Exception as e:
                print(f"  Cannot read {entry['path']}: {e}, skipping")
                entry["content"] = f"[Unable to read image: {e}]"
                continue

            summary = _generate_image_summary(entry["path"])
            entry["content"] = summary
            print(f"  Summarized {Path(entry['path']).name}: {summary[:80]}...")

    # Save updated store with summaries
    DOCUMENT_STORE_PATH.write_text(json.dumps(store, indent=2, ensure_ascii=False))

    # Phase 2b: Embed and index in ChromaDB
    print("Embedding and indexing in ChromaDB...")
    _index_in_chromadb(store)
    print("Indexing complete.")


def _generate_image_summary(image_path: str) -> str:
    """Send image to Qwen-VL via SiliconFlow and get a text description."""
    from openai import OpenAI

    client = OpenAI(api_key=SILICONFLOW_API_KEY, base_url=SILICONFLOW_BASE_URL)

    with open(image_path, "rb") as f:
        image_data = base64.b64encode(f.read()).decode("utf-8")

    ext = Path(image_path).suffix.lower().lstrip(".")
    mime_map = {"jpg": "jpeg", "jpeg": "jpeg", "png": "png", "gif": "gif", "webp": "webp"}
    mime = mime_map.get(ext, "jpeg")

    response = client.chat.completions.create(
        model=VLM_MODEL_NAME,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": VLM_SUMMARY_PROMPT,
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/{mime};base64,{image_data}"
                        },
                    },
                ],
            }
        ],
        max_tokens=512,
        temperature=0.1,
    )

    return response.choices[0].message.content.strip()


def _index_in_chromadb(store: dict) -> None:
    """Embed all elements and index in ChromaDB with UUID metadata."""
    import chromadb
    from sentence_transformers import SentenceTransformer

    CHROMA_DB_DIR.mkdir(parents=True, exist_ok=True)

    # Load embedding model
    print(f"  Loading embedding model: {EMBEDDING_MODEL_NAME}")
    embedder = SentenceTransformer(EMBEDDING_MODEL_NAME)

    # Initialize ChromaDB
    client = chromadb.PersistentClient(path=str(CHROMA_DB_DIR))

    # Delete existing collection if present (fresh reindex)
    try:
        client.delete_collection(CHROMA_COLLECTION_NAME)
    except Exception:
        pass

    collection = client.create_collection(
        name=CHROMA_COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"},
    )

    # Batch embed and insert
    ids = []
    embeddings = []
    documents = []
    metadatas = []

    for uuid_, entry in store.items():
        content = entry["content"]
        if not content:
            continue

        embedding = embedder.encode(content, normalize_embeddings=True).tolist()

        ids.append(uuid_)
        embeddings.append(embedding)
        documents.append(content)
        metadatas.append({
            "uuid": uuid_,
            "type": entry["type"],
            "page": entry.get("page", 0),
            "path": entry.get("path") or "",
            "source_pdf": entry.get("source_pdf", ""),
        })

    if ids:
        collection.add(
            ids=ids,
            embeddings=embeddings,
            documents=documents,
            metadatas=metadatas,
        )
        print(f"  Indexed {len(ids)} elements in ChromaDB")


if __name__ == "__main__":
    build_index()

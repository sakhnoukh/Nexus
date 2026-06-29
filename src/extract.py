import uuid
import json
from pathlib import Path

from src.config import (
    DATA_DIR,
    SAMPLE_PDF_PATH,
    EXTRACTED_IMAGES_DIR,
    DOCUMENT_STORE_PATH,
    PDF_REGISTRY_PATH,
    CHUNK_SIZE,
    CHUNK_OVERLAP,
)


def extract_pdf(pdf_path: Path | None = None) -> list[dict]:
    """Extract text and images from a PDF using pymupdf.

    Appends to existing document store, removing any prior elements from
    the same PDF. Tracks source PDF name in each element.
    Returns the new elements extracted from this PDF.
    """
    import fitz

    if pdf_path is None:
        pdf_path = SAMPLE_PDF_PATH

    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")

    source_name = pdf_path.name
    EXTRACTED_IMAGES_DIR.mkdir(parents=True, exist_ok=True)

    # Load existing store and remove old elements from this PDF
    # Also clean up legacy entries (no source_pdf) from the old single-PDF format
    store = _load_document_store()
    store = {
        k: v for k, v in store.items()
        if v.get("source_pdf") not in (None, "", source_name)
    }

    doc = fitz.open(str(pdf_path))
    new_elements = []

    for page_num in range(len(doc)):
        page = doc[page_num]

        # Extract text and chunk with overlap
        page_text = page.get_text("text").strip()
        if page_text:
            chunks = _chunk_text(page_text, CHUNK_SIZE, CHUNK_OVERLAP)
            for chunk in chunks:
                elem_id = str(uuid.uuid4())
                entry = {
                    "type": "text",
                    "content": chunk,
                    "path": None,
                    "page": page_num + 1,
                    "source_pdf": source_name,
                }
                store[elem_id] = entry
                new_elements.append({**entry, "uuid": elem_id})

        # Extract images (skip tiny images that VLM can't process)
        image_list = page.get_images(full=True)
        for img_index, img_info in enumerate(image_list):
            xref = img_info[0]
            base_image = doc.extract_image(xref)
            image_bytes = base_image["image"]
            image_ext = base_image.get("ext", "jpg")
            img_w = base_image.get("width", 0)
            img_h = base_image.get("height", 0)

            # Skip images smaller than 28x28 (Qwen3-VL minimum)
            if img_w < 28 or img_h < 28:
                print(f"  Skipping tiny image on page {page_num + 1} ({img_w}x{img_h})")
                continue

            safe_name = source_name.replace(" ", "_").replace(".pdf", "")
            elem_id_placeholder = f"{safe_name}_page{page_num + 1}_img{img_index}"
            img_path = EXTRACTED_IMAGES_DIR / f"{elem_id_placeholder}.jpg"

            # Convert to JPG if needed
            if image_ext.lower() not in ("jpg", "jpeg"):
                from PIL import Image
                import io
                img = Image.open(io.BytesIO(image_bytes))
                if img.mode in ("RGBA", "P"):
                    img = img.convert("RGB")
                img.save(str(img_path), "JPEG", quality=95)
            else:
                img_path = EXTRACTED_IMAGES_DIR / f"{elem_id_placeholder}.{image_ext}"
                img_path.write_bytes(image_bytes)

            elem_id = str(uuid.uuid4())
            entry = {
                "type": "image",
                "content": None,
                "path": str(img_path),
                "page": page_num + 1,
                "source_pdf": source_name,
            }
            store[elem_id] = entry
            new_elements.append({**entry, "uuid": elem_id})

    doc.close()

    # Save updated store
    _save_document_store(store)
    _update_pdf_registry(source_name, len(new_elements))

    text_count = sum(1 for e in new_elements if e["type"] == "text")
    image_count = sum(1 for e in new_elements if e["type"] == "image")
    print(f"Extraction complete for {source_name}: {text_count} text chunks, {image_count} images")
    return new_elements


def _chunk_text(text: str, chunk_size: int, overlap: int) -> list[str]:
    """Split text into overlapping chunks by word count."""
    words = text.split()
    if len(words) <= chunk_size:
        return [text]

    chunks = []
    start = 0
    while start < len(words):
        end = start + chunk_size
        chunk = " ".join(words[start:end])
        chunks.append(chunk)
        start = end - overlap
    return chunks


def remove_pdf(pdf_name: str) -> None:
    """Remove a PDF and all its elements from the document store and registry."""
    store = _load_document_store()
    store = {k: v for k, v in store.items() if v.get("source_pdf") != pdf_name}
    _save_document_store(store)

    registry = _load_pdf_registry()
    if pdf_name in registry:
        del registry[pdf_name]
        PDF_REGISTRY_PATH.write_text(json.dumps(registry, indent=2))


def get_pdf_registry() -> dict:
    """Return the PDF registry {pdf_name: {active, element_count}}."""
    return _load_pdf_registry()


def _load_document_store() -> dict:
    if DOCUMENT_STORE_PATH.exists():
        return json.loads(DOCUMENT_STORE_PATH.read_text())
    return {}


def _save_document_store(store: dict) -> None:
    DOCUMENT_STORE_PATH.write_text(json.dumps(store, indent=2, ensure_ascii=False))


def _load_pdf_registry() -> dict:
    if PDF_REGISTRY_PATH.exists():
        return json.loads(PDF_REGISTRY_PATH.read_text())
    return {}


def _update_pdf_registry(pdf_name: str, element_count: int) -> None:
    registry = _load_pdf_registry()
    registry[pdf_name] = {
        "active": True,
        "element_count": element_count,
    }
    PDF_REGISTRY_PATH.write_text(json.dumps(registry, indent=2))


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1:
        extract_pdf(Path(sys.argv[1]))
    else:
        extract_pdf()

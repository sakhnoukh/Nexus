import asyncio
import json
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel
from typing import Optional

from src.config import (
    DATA_DIR,
    PDF_REGISTRY_PATH,
    EXTRACTED_IMAGES_DIR,
    CHROMA_DB_DIR,
    DOCUMENT_STORE_PATH,
)
from src.extract import extract_pdf, extract_pdf_to_elements, merge_elements_into_store, remove_pdf, get_pdf_registry
from src.index import build_index, incremental_index
from src.retrieve import retrieve_and_answer_stream
from src.summarize import (
    generate_pdf_summary,
    get_summary,
    delete_summary,
    list_summaries,
    chat_with_summary_stream,
    regenerate_summary_with_feedback,
)
from src.explain import explain_stream

app = FastAPI(title="Multimodal RAG API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Request Models ---

class ChatRequest(BaseModel):
    query: str
    active_pdfs: Optional[list[str]] = None
    top_k: Optional[int] = None


class SummaryGenerateRequest(BaseModel):
    pdf_name: str
    focus_areas: Optional[list[str]] = None
    custom_instructions: str = ""


class SummaryChatRequest(BaseModel):
    pdf_name: str
    question: str
    history: Optional[list[dict]] = None


class SummaryFeedbackRequest(BaseModel):
    pdf_name: str
    feedback: str


class ToggleActiveRequest(BaseModel):
    active: bool


class ExplainRequest(BaseModel):
    type: str  # "text" or "image"
    content: str  # highlighted text or base64-encoded JPEG
    page: int
    source_pdf: str


# --- Helpers ---

def _load_registry() -> dict:
    if PDF_REGISTRY_PATH.exists():
        return json.loads(PDF_REGISTRY_PATH.read_text())
    return {}


def _save_registry(registry: dict) -> None:
    PDF_REGISTRY_PATH.write_text(json.dumps(registry, indent=2))


def _image_path_to_url(path: str) -> Optional[str]:
    if not path:
        return None
    filename = Path(path).name
    return f"/api/images/{filename}"


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


# --- Health ---

@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "chroma_db": CHROMA_DB_DIR.exists(),
        "document_store": DOCUMENT_STORE_PATH.exists(),
        "pdf_count": len(get_pdf_registry()),
    }


# --- PDF Management ---

@app.get("/api/pdfs")
async def list_pdfs():
    return get_pdf_registry()


@app.post("/api/upload")
async def upload_pdfs(files: list[UploadFile] = File(...)):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    registry = _load_registry()

    new_pdfs = []
    existing_pdfs = []

    for uploaded in files:
        filename = Path(uploaded.filename).name
        save_path = DATA_DIR / filename
        content = await uploaded.read()
        with open(save_path, "wb") as f:
            f.write(content)
        if filename in registry:
            existing_pdfs.append(filename)
        else:
            new_pdfs.append(filename)

    if not new_pdfs:
        return {
            "message": "All uploaded PDFs already exist in the database.",
            "new_pdfs": [],
            "existing_pdfs": existing_pdfs,
            "registry": _load_registry(),
        }

    # Extract all new PDFs in parallel (4 workers), then merge into store once
    from concurrent.futures import ThreadPoolExecutor, as_completed

    def _extract_one(pdf_name: str) -> tuple[str, list[dict]]:
        pdf_path = DATA_DIR / pdf_name
        elements = extract_pdf_to_elements(pdf_path)
        return pdf_name, elements

    elements_by_pdf: dict[str, list[dict]] = {}
    try:
        with ThreadPoolExecutor(max_workers=4) as executor:
            futures = {executor.submit(_extract_one, name): name for name in new_pdfs}
            for future in as_completed(futures):
                pdf_name = futures[future]
                try:
                    name, elements = future.result()
                    elements_by_pdf[name] = elements
                except Exception as e:
                    raise HTTPException(status_code=500, detail=f"Extraction failed for {pdf_name}: {e}")
    except HTTPException:
        raise

    # Single merge into document store
    await asyncio.to_thread(merge_elements_into_store, elements_by_pdf)

    # Incremental index (blocking — run in thread pool)
    try:
        new_count = await asyncio.to_thread(incremental_index)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Indexing failed: {e}")

    return {
        "message": f"Processed {len(new_pdfs)} new PDF(s). Indexed {new_count} new elements.",
        "new_pdfs": new_pdfs,
        "existing_pdfs": existing_pdfs,
        "new_elements": new_count,
        "registry": _load_registry(),
    }


@app.delete("/api/pdfs/{name}")
async def delete_pdf(name: str):
    try:
        await asyncio.to_thread(remove_pdf, name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to remove PDF: {e}")

    pdf_file = DATA_DIR / name
    if pdf_file.exists():
        pdf_file.unlink()

    return {"message": f"Removed {name}"}


@app.patch("/api/pdfs/{name}")
async def toggle_pdf_active(name: str, request: ToggleActiveRequest):
    registry = _load_registry()
    if name not in registry:
        raise HTTPException(status_code=404, detail=f"PDF not found: {name}")

    registry[name]["active"] = request.active
    _save_registry(registry)

    return {"message": f"Updated {name}", "active": request.active}


@app.post("/api/rebuild")
async def rebuild_index():
    try:
        await asyncio.to_thread(build_index)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Rebuild failed: {e}")

    return {"message": "Index rebuilt successfully"}


# --- Chat (SSE streaming) ---

@app.post("/api/chat")
async def chat(request: ChatRequest):
    top_k = request.top_k or 3

    try:
        retrieved_items, stream = await asyncio.to_thread(
            retrieve_and_answer_stream,
            request.query,
            top_k,
            request.active_pdfs,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Retrieval failed: {e}")

    # Prepare retrieved items for SSE (exclude base64, add image_url)
    items_for_frontend = []
    for item in retrieved_items:
        item_data = {
            "uuid": item["uuid"],
            "type": item["type"],
            "content": item["content"],
            "page": item["page"],
            "source_pdf": item["source_pdf"],
            "distance": item["distance"],
        }
        if item["type"] == "image":
            item_data["image_url"] = _image_path_to_url(item.get("path"))
        items_for_frontend.append(item_data)

    def event_stream():
        yield _sse({"type": "retrieved_items", "items": items_for_frontend})
        for chunk in stream:
            yield _sse({"type": "token", "content": chunk})
        yield _sse({"type": "done"})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# --- Summaries ---

@app.get("/api/summaries")
async def list_all_summaries():
    return {"summaries": list_summaries()}


@app.post("/api/summaries/generate")
async def generate_summary(request: SummaryGenerateRequest):
    try:
        summary = await asyncio.to_thread(
            generate_pdf_summary,
            request.pdf_name,
            request.focus_areas,
            request.custom_instructions,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Summary generation failed: {e}")

    return {"message": f"Summary generated for {request.pdf_name}", "summary": summary}


@app.get("/api/summaries/{name}")
async def get_summary_markdown(name: str):
    summary = get_summary(name)
    if summary is None:
        raise HTTPException(status_code=404, detail=f"Summary not found for {name}")
    return {"pdf_name": name, "summary": summary}


@app.delete("/api/summaries/{name}")
async def delete_summary_endpoint(name: str):
    try:
        delete_summary(name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete summary: {e}")
    return {"message": f"Deleted summary for {name}"}


# --- Summary Chat (SSE streaming) ---

@app.post("/api/summaries/chat")
async def summary_chat(request: SummaryChatRequest):
    summary = get_summary(request.pdf_name)
    if summary is None:
        raise HTTPException(status_code=404, detail=f"Summary not found for {request.pdf_name}")

    def event_stream():
        stream = chat_with_summary_stream(
            summary_text=summary,
            question=request.question,
            history=request.history,
        )
        for chunk in stream:
            yield _sse({"type": "token", "content": chunk})
        yield _sse({"type": "done"})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# --- Summary Feedback (regenerate) ---

@app.post("/api/summaries/feedback")
async def submit_summary_feedback(request: SummaryFeedbackRequest):
    try:
        summary = await asyncio.to_thread(
            regenerate_summary_with_feedback,
            request.pdf_name,
            request.feedback,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Feedback regeneration failed: {e}")

    return {"message": f"Summary regenerated for {request.pdf_name}", "summary": summary}


# --- Explain (SSE streaming) ---

@app.post("/api/explain")
async def explain(request: ExplainRequest):
    def event_stream():
        stream = explain_stream(
            content_type=request.type,
            content=request.content,
            page=request.page,
            source_pdf=request.source_pdf,
        )
        for chunk in stream:
            yield _sse({"type": "token", "content": chunk})
        yield _sse({"type": "done"})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# --- File Serving ---

@app.get("/api/pdf-file/{name}")
async def serve_pdf(name: str):
    pdf_path = DATA_DIR / name
    if not pdf_path.exists():
        raise HTTPException(status_code=404, detail=f"PDF file not found: {name}")
    return FileResponse(str(pdf_path), media_type="application/pdf")


@app.get("/api/images/{filename}")
async def serve_image(filename: str):
    image_path = EXTRACTED_IMAGES_DIR / filename
    if not image_path.exists():
        raise HTTPException(status_code=404, detail=f"Image not found: {filename}")
    return FileResponse(str(image_path))

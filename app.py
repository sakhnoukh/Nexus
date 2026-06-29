import json
from pathlib import Path

import streamlit as st

from src.config import (
    DATA_DIR,
    DOCUMENT_STORE_PATH,
    CHROMA_DB_DIR,
    PDF_REGISTRY_PATH,
)
from src.extract import extract_pdf, remove_pdf, get_pdf_registry
from src.index import build_index
from src.retrieve import retrieve_and_answer_stream


def load_registry() -> dict:
    if PDF_REGISTRY_PATH.exists():
        return json.loads(PDF_REGISTRY_PATH.read_text())
    return {}


def save_registry(registry: dict) -> None:
    PDF_REGISTRY_PATH.write_text(json.dumps(registry, indent=2))


st.set_page_config(
    page_title="Multimodal Support Engineer",
    page_icon="🔧",
    layout="wide",
)


# --- Sidebar: Pipeline Controls & Transparency ---
with st.sidebar:
    st.header("🔧 Pipeline Controls")

    # Multi-PDF upload
    uploaded_files = st.file_uploader(
        "Upload technical PDFs",
        type=["pdf"],
        accept_multiple_files=True,
        help="Upload one or more PDF manuals to ingest.",
    )
    if uploaded_files:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        for uploaded in uploaded_files:
            save_path = DATA_DIR / uploaded.name
            with open(save_path, "wb") as f:
                f.write(uploaded.getbuffer())
        st.success(f"Uploaded {len(uploaded_files)} PDF(s)")

    # PDF Database list
    st.subheader("📚 PDF Database")
    registry = load_registry()

    if not registry:
        st.info("No PDFs ingested yet. Upload and run the pipeline.")
    else:
        active_pdfs = []
        for pdf_name, info in registry.items():
            col1, col2 = st.columns([3, 1])
            with col1:
                is_active = st.checkbox(
                    f"{pdf_name} ({info.get('element_count', 0)} elements)",
                    value=info.get("active", True),
                    key=f"pdf_toggle_{pdf_name}",
                )
            with col2:
                if st.button("🗑️", key=f"del_{pdf_name}", help=f"Remove {pdf_name}"):
                    remove_pdf(pdf_name)
                    pdf_file = DATA_DIR / pdf_name
                    if pdf_file.exists():
                        pdf_file.unlink()
                    st.rerun()

            if is_active:
                active_pdfs.append(pdf_name)

        # Update registry active states
        for pdf_name in registry:
            registry[pdf_name]["active"] = pdf_name in active_pdfs
        save_registry(registry)

    # Pipeline buttons
    st.divider()
    col1, col2 = st.columns(2)

    with col1:
        if st.button("🔄 Ingest All", help="Extract + index all uploaded PDFs"):
            pdf_files = list(DATA_DIR.glob("*.pdf"))
            if not pdf_files:
                st.error("No PDFs in data/. Upload some first.")
            else:
                for pdf in pdf_files:
                    with st.spinner(f"Extracting {pdf.name}..."):
                        try:
                            extract_pdf(pdf)
                        except Exception as e:
                            st.error(f"Extraction failed for {pdf.name}: {e}")

                with st.spinner("Generating VLM summaries and indexing..."):
                    try:
                        build_index()
                        st.success("Pipeline complete! Ready to query.")
                        st.rerun()
                    except Exception as e:
                        st.error(f"Indexing failed: {e}")

    with col2:
        if st.button("🔨 Rebuild Index", help="Re-index from existing document store"):
            with st.spinner("Rebuilding index..."):
                try:
                    build_index()
                    st.success("Index rebuilt!")
                    st.rerun()
                except Exception as e:
                    st.error(f"Indexing failed: {e}")

    st.divider()

    # Transparency: show retrieved sources
    st.header("📋 Retrieved Sources")
    if "last_retrieved_items" in st.session_state and st.session_state.last_retrieved_items:
        for i, item in enumerate(st.session_state.last_retrieved_items):
            type_label = "📝 Text" if item["type"] == "text" else "🖼️ Image"
            source = item.get("source_pdf", "?")
            with st.expander(f"{type_label} — {source} p{item['page']} (score: {1 - item['distance']:.2%})"):
                if item["type"] == "text":
                    st.text(item["content"][:500] + ("..." if len(item["content"]) > 500 else ""))
                elif item["type"] == "image":
                    if item.get("path") and Path(item["path"]).exists():
                        st.image(item["path"], caption=f"{source} — Page {item['page']}")
                    st.caption(f"VLM Summary: {item['content'][:200]}...")
    else:
        st.info("Retrieved sources will appear here after you ask a question.")


# --- Main: Chat Interface ---
st.title("🔧 Multimodal Support Engineer")
st.markdown(
    "Ask questions about technical manuals. The system retrieves relevant "
    "text excerpts **and engineering diagrams** to answer your query."
)

# Check if pipeline has been run
pipeline_ready = DOCUMENT_STORE_PATH.exists() and CHROMA_DB_DIR.exists()

# Get active PDFs for querying
registry = load_registry()
active_pdfs = [name for name, info in registry.items() if info.get("active", True)]

if not pipeline_ready:
    st.info(
        "👆 Upload PDFs in the sidebar and click **Ingest All** to get started."
    )
elif not active_pdfs:
    st.warning("No PDFs are active. Toggle at least one PDF in the sidebar to query.")
else:
    st.caption(f"Querying {len(active_pdfs)} active PDF(s): {', '.join(active_pdfs)}")

# Initialize chat history
if "messages" not in st.session_state:
    st.session_state.messages = []

# Display chat history
for message in st.session_state.messages:
    with st.chat_message(message["role"]):
        st.markdown(message["content"])
        if "images" in message:
            for img_path in message["images"]:
                st.image(img_path, width=400)

# Chat input
if prompt := st.chat_input("Ask a question about the manuals..."):
    if not pipeline_ready:
        st.error("Pipeline not ready. Ingest PDFs first.")
    elif not active_pdfs:
        st.error("No active PDFs. Toggle at least one in the sidebar.")
    else:
        # Display user message
        with st.chat_message("user"):
            st.markdown(prompt)
        st.session_state.messages.append({"role": "user", "content": prompt})

        # Retrieve and stream answer
        with st.chat_message("assistant"):
            with st.spinner("Retrieving relevant context..."):
                retrieved_items, stream = retrieve_and_answer_stream(
                    prompt, active_pdfs=active_pdfs
                )

            # Store retrieved items for sidebar transparency
            st.session_state.last_retrieved_items = retrieved_items

            # Stream the answer
            full_response = st.write_stream(stream)

            # Show retrieved images inline
            image_paths = []
            for item in retrieved_items:
                if item["type"] == "image" and item.get("path") and Path(item["path"]).exists():
                    source = item.get("source_pdf", "?")
                    st.image(item["path"], caption=f"{source} — Page {item['page']}", width=400)
                    image_paths.append(item["path"])

        st.session_state.messages.append({
            "role": "assistant",
            "content": full_response,
            "images": image_paths,
        })

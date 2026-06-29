# Multimodal Support Engineer

A zero-cost multimodal RAG pipeline that ingests technical PDF manuals, extracts text and engineering diagrams, and answers user queries using both text context and visual reasoning.

## How It Works

1. **Extraction** — PDF is parsed with `pymupdf` to extract text per page and embedded images as JPGs
2. **Indexing** — Each image is sent to a Vision-Language Model (Qwen3-VL) to generate a descriptive text summary. Both text chunks and image summaries are embedded with `BAAI/bge-m3` and indexed in ChromaDB. A UUID document store maps every embedding back to its raw source
3. **Retrieval** — User query is embedded and matched against ChromaDB. Top-K results are resolved to their raw text/images via the document store
4. **Generation** — Retrieved text context + base64 images are sent to Qwen3-VL for a streamed answer

```
[PDF] → pymupdf → Text + Images
                    ↓
              Qwen-VL summarizes images
                    ↓
         bge-m3 embeds text + summaries
                    ↓
            ChromaDB indexes with UUIDs
                    ↓
         Query → Retrieve top-K → VLM answer
```

## Tech Stack

| Component | Technology |
|---|---|
| PDF Parsing | `pymupdf` (fitz) |
| Vector Database | ChromaDB (local persistent) |
| Embedding Model | `BAAI/bge-m3` via `sentence-transformers` |
| Vision-Language Model | `Qwen/Qwen3-VL-8B-Instruct` via SiliconFlow |
| Frontend | Streamlit |

## Setup

### Prerequisites

- Python 3.10+
- `poppler` and `tesseract` for PDF/image processing:
  ```bash
  brew install poppler tesseract
  ```

### Installation

```bash
git clone <repo-url>
cd multimodal
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### API Key

1. Sign up at [SiliconFlow](https://cloud.siliconflow.com/)
2. Create an API key under **API Keys**
3. Add it to `.env`:
   ```
   SILICONFLOW_API_KEY=sk-your-key-here
   ```

### Sample Data

Place a technical PDF in `data/sample_manual.pdf`. A sample Arduino Uno datasheet can be downloaded:
```bash
mkdir -p data
curl -L -o data/sample_manual.pdf "https://docs.arduino.cc/resources/datasheets/A000066-datasheet.pdf"
```

## Usage

### Option A: Command Line

```bash
# Step 1: Extract text and images from PDF
python -m src.extract

# Step 2: Generate VLM summaries and build ChromaDB index
python -m src.index

# Step 3: Query the system
python -m src.retrieve "What components are shown in the diagrams?"
```

### Option B: Streamlit UI

```bash
streamlit run app.py
```

The sidebar has buttons to run extraction and indexing. The chat interface streams answers and displays retrieved diagrams inline for transparency.

## Project Structure

```
multimodal/
├── src/
│   ├── config.py       # Central config (paths, models, API settings)
│   ├── extract.py      # Phase 1: PDF → text + images
│   ├── index.py        # Phase 2: VLM summaries + embeddings → ChromaDB
│   └── retrieve.py     # Phase 3: Query → retrieval → multimodal answer
├── app.py              # Phase 4: Streamlit chat UI
├── data/               # Input PDFs
├── extracted_images/   # Extracted diagram JPGs (auto-generated)
├── chroma_db/          # ChromaDB persistent storage (auto-generated)
├── document_store.json # UUID → content mapping (auto-generated)
├── requirements.txt
└── .env                # API key
```

## Cost

The entire pipeline runs at **$0**:
- Embeddings run locally via `sentence-transformers`
- ChromaDB runs locally (no cloud vector DB)
- SiliconFlow offers a free tier for Qwen-VL inference

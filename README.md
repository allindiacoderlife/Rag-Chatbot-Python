# DocuRAG • End-to-End Document Q&A with Hybrid RAG

An end-to-end Retrieval-Augmented Generation (RAG) system for querying PDF documents with strict factual grounding and page-level citations.

Built with **FastAPI**, **PostgreSQL (pgvector + full-text search)**, **Google Gemini Embeddings**, **Groq LLM generation**, and a modern **React Chatbot UI** featuring persistent conversation history and interactive citation accordions.

---

## 🌟 Key Features

- **Accurate Ingestion & Chunking**: Extracts text page-by-page with `pypdf`, chunks with 500-word sliding windows (50-word overlap), and embeds using Google's `gemini-embedding-2` (1536 dimensions).
- **Persistent Vector Database**: Stores embeddings in PostgreSQL using `pgvector` with **HNSW cosine indexing** for scalable sub-millisecond nearest-neighbor search.
- **Hybrid Search with Reciprocal Rank Fusion (RRF)**:
  - Dense semantic retrieval via vector cosine distance (`<=>`).
  - Lexical keyword retrieval via Postgres full-text search (`tsvector`, GIN index, and `ts_rank_cd`).
  - Rank fusion combining both candidate lists without arbitrary scale calibration.
- **Strict Grounding & Zero Hallucinations**:
  - LLM prompt enforces answers strictly from retrieved context and cites source documents and pages.
  - Returns `not found` if information is absent from the indexed documents.
- **Modern AI Chatbot UI**:
  - Persistent multi-session conversation history in `localStorage`.
  - "+ New Chat" session creation and automatic conversation titling.
  - Sidebar document knowledge-base drawer with PDF upload and chunk counts.
  - Interactive source citation accordions showing similarity match %, document name, and text snippets.
  - Responsive dark glassmorphic design system.
- **Automated Retrieval Evaluation Harness**:
  - Quantitative benchmark measuring **Hit@1**, **Hit@3**, **Hit@5**, and **MRR** across vector and hybrid modes.

---

## 📐 Architecture

```mermaid
flowchart TD
    subgraph Ingestion Pipeline
        A[PDF Document] --> B[pypdf Page Extraction]
        B --> C[500-Word Chunking + 50 Overlap]
        C --> D[Gemini Embedding 2 API]
        D --> E[(PostgreSQL + pgvector)]
        C -. Auto-generated .-> F[(Postgres tsvector GIN Index)]
    end

    subgraph Query & Fusion
        Q[User Question] --> V_EMB[Embed Question]
        V_EMB --> V_SEARCH[Vector HNSW Search]
        Q --> K_SEARCH[Postgres FTS ts_rank_cd]
        V_SEARCH --> RRF[Reciprocal Rank Fusion RRF]
        K_SEARCH --> RRF
    end

    subgraph Generation & UI
        RRF --> TOP_K[Top-K Chunks + Citations]
        TOP_K --> LLM[Groq LLM Generation]
        LLM --> RESP[Answer + Sources]
        RESP --> UI[React Chatbot UI]
    end
```

---

## 📊 Evaluation & Benchmark Results

Retrieval performance was evaluated using an automated 17-question test suite (`app/eval_set.json`), crafted from diverse sections across a multi-page document to test both dense semantic understanding and exact keyword retrieval:

| Metric | Vector Search Only | Hybrid Search (Vector + Postgres FTS via RRF) |
|---|:---:|:---:|
| **Hit@1** | **71%** | 53% |
| **Hit@3** *(Fed to LLM in `/ask`)* | **88%** | **94%** |
| **Hit@5** | **94%** | **94%** |
| **MRR (Mean Reciprocal Rank)** | **0.806** | **0.725** |

> **Note on Terminology**: The lexical search component utilizes native **PostgreSQL full-text search (`ts_rank_cd`)**, rather than standalone BM25.

### Evaluation Takeaways:
- **Critical Wins for `/ask` (Hit@3 improved from 88% to 94%)**:
  - **Lake Superior (Q15)**: Completely missed by vector search (`rank > 5`), but successfully **rescued to Rank 2** by hybrid search.
  - ***An American Life* (Q7)**: Promoted from **Rank 5 to Rank 2**, successfully pulling exact-title queries into the top-3 LLM context window.
- **The Trade-off**:
  - In queries composed of generic trivia keywords (e.g. *country*, *world*, *greatest*, *land*), lexical matching can introduce noise across dense pages, occasionally promoting competitor pages and lowering Hit@1.

---

## 📁 Repository Structure

```
Rag-Chatbot/
├── app/
│   ├── main.py          # FastAPI application & static asset endpoints
│   ├── ingest.py        # PDF parser, chunking, Gemini embeddings, and DB init
│   ├── retrieve.py      # Vector & hybrid search with Reciprocal Rank Fusion
│   ├── generate.py      # LLM generation with strict citation prompt
│   ├── evaluate.py      # Benchmark runner (Hit@K and MRR metrics)
│   └── eval_set.json    # 17-question evaluation dataset
├── frontend/
│   ├── src/
│   │   ├── App.jsx      # Chatbot interface with history, new chat, and citation drawer
│   │   ├── App.css      # Dark glassmorphic design system
│   │   ├── api.js       # Backend API client
│   │   └── main.jsx     # React entry point
│   ├── index.html       # HTML root with typography fonts
│   ├── package.json     # Vite + React dependencies
│   └── vite.config.js   # Vite server with proxy configuration
├── docker-compose.yml   # PostgreSQL 16 + pgvector container definition
├── requirements.txt     # Python backend dependencies
└── README.md
```

---

## 🚀 Quickstart Guide

### 1. Prerequisites
- Python 3.10+
- Node.js 18+ & npm
- Docker Desktop
- API Keys:
  - [Google AI Studio API Key](https://aistudio.google.com/) (for embeddings)
  - [Groq API Key](https://console.groq.com/) (for fast LLM responses)

---

### 2. Environment Configuration

Create a `.env` file in the project root:

```env
DATABASE_URL=postgresql://rag:rag@localhost:5432/ragdb
GEMINI_API_KEY=your_gemini_api_key_here
GROQ_API_KEY=your_groq_api_key_here
```

---

### 3. Start PostgreSQL with pgvector

Launch the vector database in Docker:

```powershell
docker compose up -d
```

Verify that the database container is running on port `5432`:
```powershell
docker ps
```

---

### 4. Backend Setup

Set up a Python virtual environment and install dependencies:

```powershell
# Create and activate virtual environment
python -m venv venv
.\venv\Scripts\Activate.ps1

# Install requirements
pip install -r requirements.txt
```

Initialize the database schema:
```powershell
python -c "from app.ingest import init_db; init_db()"
```

---

### 5. Ingest Sample Documents

Ingest a PDF from the terminal:
```powershell
python -c "from app.ingest import ingest_pdf; print(ingest_pdf('example.pdf'))"
```
*(Alternatively, you can upload PDFs directly through the web UI).*

---

### 6. Run the Benchmark Evaluation

Run the evaluation script to compare retrieval strategies:

```powershell
# Benchmark vector search baseline
python -m app.evaluate vector

# Benchmark hybrid search (Vector + Postgres FTS)
python -m app.evaluate hybrid
```

---

### 7. Run the Web Application

#### Option A: Production Build (Served via FastAPI)
Build the frontend bundle:
```powershell
cd frontend
npm install
npm run build
cd ..
```

Start the FastAPI server:
```powershell
python -m uvicorn app.main:app --port 8000
```
Open **`http://127.0.0.1:8000/`** in your browser.

#### Option B: Development Mode (Vite Hot-Reload)
In one terminal, run FastAPI:
```powershell
python -m uvicorn app.main:app --reload --port 8000
```

In a second terminal, run Vite dev server:
```powershell
cd frontend
npm run dev
```
Open **`http://localhost:5173/`** in your browser.

---

## 🛠️ API Reference

| Endpoint | Method | Description |
|---|---|---|
| `GET /` | `GET` | Serves the frontend web application |
| `GET /documents` | `GET` | Lists all indexed documents and their chunk counts |
| `POST /upload` | `POST` | Uploads and indexes a new PDF (`multipart/form-data`) |
| `POST /ask` | `POST` | Submits a question; returns answer with cited sources & scores |

---

## 💡 Known Limitations & Future Work

1. **Length Normalization in Lexical Scoring**: `ts_rank_cd` is unnormalized by default, meaning longer pages matching generic words can rank higher than compact pages. Adding length normalization flags or tuning weights can mitigate this.
2. **Dense Multi-topic Pages**: Pages packed with 15+ unrelated Q&As create blended embeddings. Sliding chunk windows across document structure or semantic chunking can improve topic isolation.
3. **Scanned PDFs**: Requires OCR (such as `tesseract` or vision models) for non-extractable scanned PDF documents.

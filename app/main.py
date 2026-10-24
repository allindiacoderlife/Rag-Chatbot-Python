import logging
import os
import tempfile
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from pypdf.errors import PdfReadError

from app.generate import answer
from app.ingest import document_exists, ingest_pdf, init_db, list_documents
from app.retrieve import top_k

log = logging.getLogger("rag")

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB
FRONTEND_DIST = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()  # make sure the table and index exist before serving
    yield


app = FastAPI(title="rag-doc-qa", lifespan=lifespan)


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    document_name: str | None = None


@app.get("/")
def index():
    index_file = os.path.join(FRONTEND_DIST, "index.html")
    if not os.path.exists(index_file):
        return {"message": "Frontend not built. Run 'npm run build' in frontend/, or use the Vite dev server."}
    return FileResponse(index_file)


@app.get("/documents")
def documents():
    return {"documents": list_documents()}


@app.post("/upload")
def upload(file: UploadFile = File(...)):
    name = os.path.basename(file.filename or "")
    if not name.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are accepted.")

    data = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File is larger than the 10 MB limit.")
    if not data.startswith(b"%PDF"):
        raise HTTPException(400, "This file is not a valid PDF.")
    if document_exists(name):
        raise HTTPException(409, f"'{name}' has already been uploaded.")

    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, name)
        with open(path, "wb") as f:
            f.write(data)
        try:
            chunk_count = ingest_pdf(path)
        except PdfReadError:
            raise HTTPException(400, "Could not read this PDF (corrupt or encrypted).")
        except RuntimeError:
            log.exception("Embedding failed during upload")
            raise HTTPException(502, "Embedding service failed. Try again in a minute.")

    if chunk_count == 0:
        raise HTTPException(422, "No extractable text found (is it a scanned PDF?).")
    return {"document_name": name, "chunks": chunk_count}


@app.post("/ask")
def ask(req: AskRequest):
    question = req.question.strip()
    if not question:
        raise HTTPException(400, "Question is empty.")
    if req.document_name and not document_exists(req.document_name):
        raise HTTPException(404, f"Document '{req.document_name}' not found.")

    try:
        hits = top_k(question, k=3, document_name=req.document_name)
        if not hits:
            return {"answer": "not found", "sources": []}
        text = answer(question, hits)
    except Exception:
        log.exception("Ask failed")
        raise HTTPException(502, "The AI service failed. Try again in a moment.")

    if text.strip().lower().rstrip(".") == "not found":
        return {"answer": "not found", "sources": []}

    sources = [
        {
            "document": h["document_name"],
            "page": h["page_number"],
            "snippet": h["chunk_text"][:200] + ("..." if len(h["chunk_text"]) > 200 else ""),
            "score": round(h["score"], 3),
        }
        for h in hits
    ]
    return {"answer": text, "sources": sources}


_assets = os.path.join(FRONTEND_DIST, "assets")
if os.path.isdir(_assets):
    app.mount("/assets", StaticFiles(directory=_assets), name="assets")
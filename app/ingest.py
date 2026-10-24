import os
import time
import psycopg
from dotenv import load_dotenv
from google import genai
from google.genai import types
from pgvector.psycopg import register_vector
from pypdf import PdfReader

load_dotenv()
client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
DATABASE_URL = os.environ["DATABASE_URL"]

EMBED_MODEL = "gemini-embedding-2"
EMBED_DIM = 1536
CHUNK_WORDS = 500
OVERLAP_WORDS = 50


# ---------- Database ----------

def get_conn() -> psycopg.Connection:
    """Open a connection, making sure the pgvector extension exists first."""
    conn = psycopg.connect(DATABASE_URL)
    conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
    conn.commit()
    register_vector(conn)
    return conn


def init_db() -> None:
    with get_conn() as conn:
        conn.execute(f"""
            CREATE TABLE IF NOT EXISTS chunks (
                id SERIAL PRIMARY KEY,
                document_name TEXT NOT NULL,
                page_number INT NOT NULL,
                chunk_text TEXT NOT NULL,
                embedding vector({EMBED_DIM}) NOT NULL
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS chunks_embedding_idx
            ON chunks USING hnsw (embedding vector_cosine_ops)
        """)
        conn.execute("""
            ALTER TABLE chunks ADD COLUMN IF NOT EXISTS tsv tsvector
            GENERATED ALWAYS AS (to_tsvector('english', chunk_text)) STORED
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS chunks_tsv_idx ON chunks USING gin (tsv)
        """)
        conn.commit()


def document_exists(doc_name: str) -> bool:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT 1 FROM chunks WHERE document_name = %s LIMIT 1", (doc_name,)
        ).fetchone()
    return row is not None


def list_documents() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT document_name, COUNT(*)
               FROM chunks GROUP BY document_name ORDER BY document_name"""
        ).fetchall()
    return [{"name": r[0], "chunks": r[1]} for r in rows]


def store_chunks(chunks: list[dict]) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.executemany(
                """INSERT INTO chunks (document_name, page_number, chunk_text, embedding)
                   VALUES (%s, %s, %s, %s)""",
                [
                    (c["document_name"], c["page_number"], c["chunk_text"], c["embedding"])
                    for c in chunks
                ],
            )
        conn.commit()


# ---------- PDF + chunking ----------

def load_pdf(path: str) -> list[tuple[int, str]]:
    """Return [(page_number, text), ...] with 1-based page numbers."""
    reader = PdfReader(path)
    pages = []
    for i, page in enumerate(reader.pages, start=1):
        text = (page.extract_text() or "").strip()
        if text:
            pages.append((i, text))
    return pages


def chunk_pages(pages, doc_name: str) -> list[dict]:
    """~500-word chunks with 50-word overlap, kept within a single page."""
    chunks = []
    step = CHUNK_WORDS - OVERLAP_WORDS
    for page_num, text in pages:
        words = text.split()
        for start in range(0, len(words), step):
            piece = words[start : start + CHUNK_WORDS]
            chunks.append({
                "document_name": doc_name,
                "page_number": page_num,
                "chunk_text": " ".join(piece),
            })
            if start + CHUNK_WORDS >= len(words):
                break
    return chunks


# ---------- Embeddings ----------

def _embed_one(text: str) -> list[float]:
    """Embed ONE text, retrying when rate-limited."""
    for attempt in range(5):
        try:
            resp = client.models.embed_content(
                model=EMBED_MODEL,
                contents=text,
                config=types.EmbedContentConfig(output_dimensionality=EMBED_DIM),
            )
            return list(resp.embeddings[0].values)
        except Exception as e:
            wait = 2 ** attempt * 5
            print(f"Embed error ({e}); retrying in {wait}s...")
            time.sleep(wait)
    raise RuntimeError("Embedding failed after 5 retries")


def embed_texts(texts: list[str]) -> list[list[float]]:
    vectors = []
    for i, t in enumerate(texts, start=1):
        vectors.append(_embed_one(t))
        if i % 10 == 0:
            print(f"  embedded {i}/{len(texts)}")
    assert len(vectors) == len(texts), "embedding count mismatch"
    return vectors


# ---------- Full ingestion ----------

def ingest_pdf(path: str) -> int:
    """Chunk, embed and store a PDF. Returns the number of chunks stored."""
    init_db()
    doc_name = os.path.basename(path)
    chunks = chunk_pages(load_pdf(path), doc_name)
    vectors = embed_texts([c["chunk_text"] for c in chunks])
    for c, v in zip(chunks, vectors, strict=True):
        c["embedding"] = v
    store_chunks(chunks)
    return len(chunks)
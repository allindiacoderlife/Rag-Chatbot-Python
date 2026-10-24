import re

from app.ingest import embed_texts, get_conn

CANDIDATES = 20  # how many results each search contributes before fusion
RRF_K = 60       # standard RRF constant


def _keyword_query(question: str) -> str:
    """Build an OR-style tsquery from the question's words.
    Only letters and digits are kept, so the string is safe for to_tsquery.
    Stopwords ('the', 'of', ...) are dropped by Postgres itself."""
    words = re.findall(r"[A-Za-z0-9]+", question.lower())
    return " | ".join(dict.fromkeys(words))  # de-duplicate, keep order


def _row_to_dict(r) -> dict:
    return {
        "document_name": r[0],
        "page_number": r[1],
        "chunk_text": r[2],
        "score": float(r[3]),  # cosine similarity (0 to 1)
    }


def _vector_only(q, k, document_name):
    sql = """
        SELECT document_name, page_number, chunk_text,
               1 - (embedding <=> %(q)s::vector) AS score
        FROM chunks
        WHERE (%(doc)s::text IS NULL OR document_name = %(doc)s)
        ORDER BY embedding <=> %(q)s::vector
        LIMIT %(k)s
    """
    with get_conn() as conn:
        rows = conn.execute(sql, {"q": q, "doc": document_name, "k": k}).fetchall()
    return [_row_to_dict(r) for r in rows]


def _hybrid(q, question, k, document_name):
    sql = """
        WITH vec AS (
            SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> %(q)s::vector) AS rnk
            FROM chunks
            WHERE (%(doc)s::text IS NULL OR document_name = %(doc)s)
            ORDER BY embedding <=> %(q)s::vector
            LIMIT %(cand)s
        ),
        kw AS (
            SELECT c.id,
                   ROW_NUMBER() OVER (ORDER BY ts_rank_cd(c.tsv, tq.query) DESC) AS rnk
            FROM chunks c, to_tsquery('english', %(tsq)s) AS tq(query)
            WHERE c.tsv @@ tq.query
              AND (%(doc)s::text IS NULL OR c.document_name = %(doc)s)
            ORDER BY ts_rank_cd(c.tsv, tq.query) DESC
            LIMIT %(cand)s
        )
        SELECT c.document_name, c.page_number, c.chunk_text,
               1 - (c.embedding <=> %(q)s::vector) AS score
        FROM chunks c
        LEFT JOIN vec ON vec.id = c.id
        LEFT JOIN kw  ON kw.id = c.id
        WHERE vec.id IS NOT NULL OR kw.id IS NOT NULL
        ORDER BY COALESCE(1.0 / (%(rrf)s + vec.rnk), 0)
               + COALESCE(1.0 / (%(rrf)s + kw.rnk), 0) DESC
        LIMIT %(k)s
    """
    params = {
        "q": q, "doc": document_name, "k": k, "cand": CANDIDATES,
        "rrf": RRF_K, "tsq": _keyword_query(question),
    }
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [_row_to_dict(r) for r in rows]


def top_k(question: str, k: int = 3, document_name: str | None = None,
          mode: str = "hybrid") -> list[dict]:
    """mode='hybrid' (vector + keyword, fused with RRF) or 'vector' (baseline)."""
    q = embed_texts([question])[0]
    if mode == "vector":
        return _vector_only(q, k, document_name)
    return _hybrid(q, question, k, document_name)
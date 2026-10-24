This project can be built in five phases. Each phase ends with a working version, so you always have something to show. Expect about 2 to 3 weeks at a few hours a day.

## Before you start

**Tech choices (one set, so you don't get stuck choosing):**

- **Backend:** Python with FastAPI
- **PDF parsing:** pypdf
- **Embeddings and LLM:** OpenAI API (or Gemini, which has a free tier)
- **Vector database:** PostgreSQL with the pgvector extension, run in Docker
- **Frontend:** a simple HTML/JavaScript page at first, then React or Next.js if you want to go further
- **Orchestration:** start without LangChain, so you understand each step, then add it later

**Prerequisites:** basic Python, a GitHub account, Docker Desktop installed, and an OpenAI or Gemini API key with a small budget set.

**Project folder layout to create on day one:**

```
rag-doc-qa/
├── app/
│   ├── main.py          # FastAPI routes
│   ├── ingest.py        # PDF loading, chunking, embedding
│   ├── retrieve.py      # vector search
│   └── generate.py      # LLM answer with citations
├── frontend/
│   └── index.html
├── docker-compose.yml
├── requirements.txt
├── .env                 # API keys (never commit this)
└── README.md
```

---

## Phase 1: Understand the core idea (Day 1 to 2)

Before code, learn what RAG is: **Retrieval-Augmented Generation** means you first find relevant text from your documents, then give that text to an LLM along with the question, so it answers from your data instead of guessing.

The pipeline has two halves:

1. **Ingestion (offline):** PDF → extract text → split into chunks → convert each chunk to an embedding (a list of numbers representing meaning) → store in the database.
2. **Query (online):** question → embed it → find the closest chunks → send chunks + question to the LLM → return the answer with the source page numbers.

**Checkpoint:** you can explain both halves in your own words, and draw them on paper.

---

## Phase 2: Minimal working script (Week 1, Days 1 to 3)

No database and no web app yet. Just a Python script.

1. Set up a virtual environment and install `openai`, `pypdf`, and `numpy`.
2. Extract text from one PDF, page by page, keeping the page number.
3. Split text into chunks of about 500 words with 50 words of overlap. Overlap prevents answers from being cut off at chunk boundaries.
4. Embed every chunk using the embeddings API.
5. Store the vectors in a Python list, and for a question, compute cosine similarity to find the top 3 chunks.
6. Send the top chunks and the question to the chat model with this instruction: answer only from the context, and say "not found" if the answer isn't there.

**Checkpoint:** you ask a question about your PDF in the terminal and get a correct answer with page numbers.

**Common mistake:** chunks that are too small lose context, and chunks that are too large dilute the search. Start with the sizes above and adjust later.

---

## Phase 3: Move to a real vector database (Week 1, Days 4 to 5)

1. Write a `docker-compose.yml` that runs the `pgvector/pgvector` image on port 5432.
2. Create a `chunks` table with columns: `id`, `document_name`, `page_number`, `chunk_text`, `embedding vector(1536)` (use the dimension of your embedding model).
3. Replace the Python list with inserts into Postgres.
4. Replace the manual similarity code with a SQL query using the cosine distance operator (`<=>`), and add an index (HNSW) for speed.

**Checkpoint:** you can restart the script and still query your documents without re-processing the PDF.

**Why this matters for your resume:** using a real vector store, not an in-memory list, is what makes the project look professional.

---

## Phase 4: Build the web app (Week 2)

**Backend (FastAPI):**

1. `POST /upload`: accepts a PDF, runs ingestion, and returns the document name and chunk count.
2. `POST /ask`: accepts a question and an optional document name, runs retrieval and generation, and returns the answer plus a list of sources (document, page, short snippet).
3. `GET /documents`: lists uploaded documents.
4. Add input validation: reject non-PDF files and files over a size limit (for example, 10 MB).
5. Test all endpoints with the auto-generated docs at `/docs`.

**Frontend (simple first):**

1. One HTML page with a file upload button, a document list, a question box, and an answer area.
2. Show the answer with its sources listed below it.
3. Show a loading indicator while the model responds.

**Checkpoint:** you can upload a PDF through the browser and ask questions about it.

---

## Phase 5: Make it advanced (Week 3)

Pick the features that matter most. Start with items 1 to 3, which carry the most weight for interviews.

1. **Citations you can verify:** return the exact passage and page for each claim, and let the user click a source to see the chunk.
2. **Better retrieval:** add metadata filtering (search only one document), and try a "hybrid" approach that combines keyword search with vector search.
3. **Evaluation:** create a small test set of 15 to 20 questions with known answers, and measure how often the right chunk is retrieved. Report the score in your README. This is rare in student projects and impressive to recruiters.
4. **Streaming responses:** stream the answer token by token using Server-Sent Events.
5. **Conversation memory:** remember the last few questions so follow-ups like "explain that more" work.
6. **Caching:** store embeddings and answers for repeated questions to reduce API cost.
7. **Tests:** write unit tests for chunking and retrieval, plus one end-to-end test.

---

## Phase 6: Deploy and document (Week 3, final days)

1. Write a `Dockerfile` for the FastAPI app and add it to `docker-compose.yml` alongside Postgres.
2. Deploy to Render, Railway, or a small VPS. Store API keys as environment variables, not in code.
3. Write a README with: a one-paragraph summary, an architecture diagram (a simple box diagram is enough), setup steps, a demo GIF or screenshot, your evaluation score, and known limitations.
4. Add the live link and GitHub repo to your resume header.

---

## Resume bullet, updated as you go

Start with your target version, then update the numbers once your evaluation is done:

> Built a RAG-based document Q&A app with FastAPI and PostgreSQL (pgvector), answering questions over uploaded PDFs with page-level citations; retrieved the correct chunk for **X%** of 20 evaluation questions.

---

## Weekly goals at a glance

| Week | Goal                           | Done when                                 |
| ---- | ------------------------------ | ----------------------------------------- |
| 1    | Script + pgvector storage      | Answers questions from a PDF via Postgres |
| 2    | FastAPI + web page             | Upload and ask in the browser             |
| 3    | Advanced features + deployment | Live link, README, evaluation score       |

If you tell me your current Python level and how many hours per day you can give, I can adjust the pace and tell you which phase to slow down on. I can also write the Phase 2 starter code with you once you're ready.

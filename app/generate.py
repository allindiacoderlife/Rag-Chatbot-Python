import os
from dotenv import load_dotenv
from groq import Groq

load_dotenv()
groq_client = Groq(api_key=os.environ["GROQ_API_KEY"])

GEN_MODEL = "qwen/qwen3.8-27b"  # if rejected, pick a current model at console.groq.com/docs/models

SYSTEM_PROMPT = (
    "You answer questions using ONLY the provided context. "
    "Cite the source for every claim as (document, page N). "
    "If the answer is not in the context, reply exactly: not found"
)


def answer(question: str, chunks: list[dict]) -> str:
    context = "\n\n".join(
        f"[{c['document_name']}, page {c['page_number']}]\n{c['chunk_text']}"
        for c in chunks
    )
    resp = groq_client.chat.completions.create(
        model=GEN_MODEL,
        temperature=0,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Context:\n{context}\n\nQuestion: {question}"},
        ],
    )
    return resp.choices[0].message.content
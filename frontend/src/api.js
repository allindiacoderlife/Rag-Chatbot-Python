async function request(path, options) {
  const res = await fetch(path, options);
  let body = null;
  try {
    body = await res.json();
  } catch {
    // response was not JSON
  }
  if (!res.ok) {
    const detail = body?.detail;
    throw new Error(
      typeof detail === "string" ? detail : `Request failed (${res.status})`,
    );
  }
  return body;
}

export const getDocuments = () => request("/documents");

export function uploadPdf(file) {
  const form = new FormData();
  form.append("file", file);
  return request("/upload", { method: "POST", body: form });
}

export const askQuestion = (question, documentName) =>
  request("/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, document_name: documentName || null }),
  });

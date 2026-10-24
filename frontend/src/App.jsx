import { useEffect, useRef, useState } from "react";
import { askQuestion, getDocuments, uploadPdf } from "./api";
import "./App.css";

const STORAGE_KEY = "rag_chatbot_sessions_v1";

function createNewSession(docScope = "") {
  return {
    id: "chat_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
    title: "New Conversation",
    createdAt: Date.now(),
    documentScope: docScope,
    messages: [],
  };
}

const STARTER_PROMPTS = [
  {
    title: "World Records & Geography",
    prompt: "Which country has the greatest land area and what are other major geographical records?",
    icon: "🌍",
  },
  {
    title: "History & Milestones",
    prompt: "What are some of the earliest recorded inventions mentioned in the document?",
    icon: "📜",
  },
  {
    title: "Science & Energy",
    prompt: "Which territories or regions are powered by renewable solar energy?",
    icon: "⚡",
  },
  {
    title: "Literature & Culture",
    prompt: "Who are the notable authors and award recipients mentioned in the text?",
    icon: "📚",
  },
];

export default function App() {
  // Chat sessions state
  const [sessions, setSessions] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore JSON parse error
    }
    return [createNewSession()];
  });

  const [activeSessionId, setActiveSessionId] = useState(() => {
    return sessions[0]?.id || "";
  });

  // Knowledge base documents state
  const [documents, setDocuments] = useState([]);
  const [docLoading, setDocLoading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState({ text: "", isError: false, busy: false });
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Input & message execution state
  const [inputQuestion, setInputQuestion] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [expandedSources, setExpandedSources] = useState({});

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);

  // Sync sessions to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    } catch (e) {
      console.error("Failed to save sessions to storage", e);
    }
  }, [sessions]);

  // Load documents on mount
  async function refreshDocuments() {
    setDocLoading(true);
    try {
      const data = await getDocuments();
      setDocuments(data.documents || []);
    } catch (err) {
      console.error("Could not fetch documents", err);
    } finally {
      setDocLoading(false);
    }
  }

  useEffect(() => {
    refreshDocuments();
  }, []);

  // Ensure active session exists
  const activeSession =
    sessions.find((s) => s.id === activeSessionId) || sessions[0] || createNewSession();

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeSession?.messages, isGenerating]);

  // Session actions
  function handleNewChat(docScope = "") {
    const newChat = createNewSession(docScope);
    setSessions((prev) => [newChat, ...prev]);
    setActiveSessionId(newChat.id);
    setInputQuestion("");
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function handleDeleteChat(sessionId, e) {
    e.stopPropagation();
    const updated = sessions.filter((s) => s.id !== sessionId);
    if (updated.length === 0) {
      const fresh = createNewSession();
      setSessions([fresh]);
      setActiveSessionId(fresh.id);
    } else {
      setSessions(updated);
      if (activeSessionId === sessionId) {
        setActiveSessionId(updated[0].id);
      }
    }
  }

  function handleClearChat() {
    if (!confirm("Are you sure you want to clear all messages in this conversation?")) return;
    setSessions((prev) =>
      prev.map((s) => (s.id === activeSession.id ? { ...s, messages: [] } : s))
    );
  }

  function updateActiveScope(newScope) {
    setSessions((prev) =>
      prev.map((s) => (s.id === activeSession.id ? { ...s, documentScope: newScope } : s))
    );
  }

  // Upload PDF Handler
  async function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadStatus({ text: `Uploading and indexing ${file.name}...`, isError: false, busy: true });
    try {
      const result = await uploadPdf(file);
      setUploadStatus({
        text: `Indexed "${result.document_name}" (${result.chunks} chunks created).`,
        isError: false,
        busy: false,
      });
      await refreshDocuments();
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setUploadStatus({ text: err.message || "Failed to upload file", isError: true, busy: false });
    }
  }

  // Question Submission
  async function handleSubmit(textToSend = null) {
    const query = (textToSend || inputQuestion).trim();
    if (!query || isGenerating) return;

    setInputQuestion("");

    // Create user message
    const userMsg = {
      id: "msg_" + Date.now() + "_u",
      role: "user",
      content: query,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    // Auto-title if it's the first message
    const shouldUpdateTitle =
      activeSession.messages.length === 0 &&
      (activeSession.title === "New Conversation" || !activeSession.title);

    const newTitle = shouldUpdateTitle
      ? query.slice(0, 34) + (query.length > 34 ? "..." : "")
      : activeSession.title;

    // Optimistically update session
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id === activeSession.id) {
          return {
            ...s,
            title: newTitle,
            messages: [...s.messages, userMsg],
          };
        }
        return s;
      })
    );

    setIsGenerating(true);

    try {
      const response = await askQuestion(query, activeSession.documentScope || null);
      const assistantMsg = {
        id: "msg_" + Date.now() + "_a",
        role: "assistant",
        content: response.answer || "No response received.",
        sources: response.sources || [],
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };

      setSessions((prev) =>
        prev.map((s) => {
          if (s.id === activeSession.id) {
            return {
              ...s,
              messages: [...s.messages, assistantMsg],
            };
          }
          return s;
        })
      );
    } catch (err) {
      const errorMsg = {
        id: "msg_" + Date.now() + "_err",
        role: "assistant",
        isError: true,
        content: `Error: ${err.message || "Unable to retrieve answer. Please verify the backend service is running."}`,
        sources: [],
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };

      setSessions((prev) =>
        prev.map((s) => {
          if (s.id === activeSession.id) {
            return {
              ...s,
              messages: [...s.messages, errorMsg],
            };
          }
          return s;
        })
      );
    } finally {
      setIsGenerating(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleCopy(text, index) {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  }

  function toggleSourceDetails(msgId) {
    setExpandedSources((prev) => ({
      ...prev,
      [msgId]: !prev[msgId],
    }));
  }

  return (
    <div className="app-container">
      {/* Mobile Backdrop */}
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}

      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? "open" : "collapsed"}`}>
        {/* Brand */}
        <div className="sidebar-brand">
          <div className="brand-logo">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/>
              <path d="M6 6h10"/>
              <path d="M6 10h10"/>
              <path d="M6 14h6"/>
            </svg>
          </div>
          <div className="brand-info">
            <span className="brand-title">DocuRAG</span>
            <span className="brand-badge">Hybrid RAG</span>
          </div>
          <button
            className="sidebar-toggle-btn mobile-only"
            onClick={() => setSidebarOpen(false)}
            title="Close sidebar"
          >
            ✕
          </button>
        </div>

        {/* New Chat Button */}
        <div className="sidebar-action">
          <button id="new-chat-btn" className="new-chat-btn" onClick={() => handleNewChat()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            <span>New Chat</span>
          </button>
        </div>

        {/* Chat History List */}
        <div className="sidebar-section-title">
          <span>Conversations</span>
          <span className="count-pill">{sessions.length}</span>
        </div>
        <div className="chat-history-list">
          {sessions.map((s) => {
            const isActive = s.id === activeSession.id;
            return (
              <div
                key={s.id}
                className={`chat-item ${isActive ? "active" : ""}`}
                onClick={() => {
                  setActiveSessionId(s.id);
                  if (window.innerWidth < 768) setSidebarOpen(false);
                }}
              >
                <div className="chat-item-icon">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                  </svg>
                </div>
                <div className="chat-item-title" title={s.title}>
                  {s.title}
                </div>
                <button
                  className="chat-delete-btn"
                  onClick={(e) => handleDeleteChat(s.id, e)}
                  title="Delete chat"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  </svg>
                </button>
              </div>
            );
          })}
        </div>

        {/* Knowledge Base Section */}
        <div className="sidebar-kb-card">
          <div className="kb-header">
            <div className="kb-title-row">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
              </svg>
              <span>Indexed Documents</span>
            </div>
            <button
              className="refresh-btn"
              onClick={refreshDocuments}
              disabled={docLoading}
              title="Refresh indexed documents"
            >
              <svg className={docLoading ? "spin" : ""} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
              </svg>
            </button>
          </div>

          <div className="kb-doc-list">
            {documents.length === 0 ? (
              <div className="kb-empty">No PDFs indexed yet.</div>
            ) : (
              documents.map((d) => (
                <div key={d.name} className="kb-doc-item">
                  <div className="kb-doc-name" title={d.name}>
                    {d.name}
                  </div>
                  <span className="kb-doc-chunks">{d.chunks} chunks</span>
                </div>
              ))
            )}
          </div>

          {/* Upload Button */}
          <div className="kb-upload-container">
            <input
              type="file"
              ref={fileInputRef}
              accept="application/pdf,.pdf"
              onChange={handleFileUpload}
              id="pdf-file-input"
              style={{ display: "none" }}
            />
            <button
              id="upload-doc-btn"
              className="kb-upload-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadStatus.busy}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
              </svg>
              <span>{uploadStatus.busy ? "Uploading..." : "Upload New PDF"}</span>
            </button>

            {uploadStatus.text && (
              <div className={`upload-status-pill ${uploadStatus.isError ? "error" : "success"}`}>
                {uploadStatus.text}
              </div>
            )}
          </div>
        </div>

        {/* Footer info */}
        <div className="sidebar-footer">
          <div className="status-indicator">
            <span className="status-dot"></span>
            <span>PostgreSQL · pgvector ready</span>
          </div>
        </div>
      </aside>

      {/* Main Chat View */}
      <main className="main-content">
        {/* Top Navigation Bar */}
        <header className="chat-header">
          <div className="header-left">
            <button
              className="sidebar-toggle-btn"
              onClick={() => setSidebarOpen((prev) => !prev)}
              title="Toggle sidebar"
              id="toggle-sidebar-btn"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="12" x2="21" y2="12"></line>
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <line x1="3" y1="18" x2="21" y2="18"></line>
              </svg>
            </button>
            <div className="header-title-box">
              <h1 className="header-chat-title">{activeSession.title}</h1>
              <span className="header-chat-subtitle">
                {activeSession.messages.length} {activeSession.messages.length === 1 ? "message" : "messages"}
              </span>
            </div>
          </div>

          <div className="header-right">
            {/* Document Scope Filter Selector */}
            <div className="scope-selector-wrap" title="Scope query search to a specific document">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
              </svg>
              <select
                id="doc-scope-select"
                className="scope-select"
                value={activeSession.documentScope || ""}
                onChange={(e) => updateActiveScope(e.target.value)}
              >
                <option value="">All Documents ({documents.length})</option>
                {documents.map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            {activeSession.messages.length > 0 && (
              <button
                id="clear-chat-btn"
                className="action-icon-btn"
                onClick={handleClearChat}
                title="Clear current messages"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            )}
          </div>
        </header>

        {/* Message Stream */}
        <section className="chat-messages-container">
          {activeSession.messages.length === 0 ? (
            <div className="empty-chat-hero">
              <div className="hero-icon-wrapper">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
                </svg>
              </div>
              <h2 className="hero-title">Ask anything about your documents</h2>
              <p className="hero-subtitle">
                Ask questions and receive instant answers grounded in your PDF knowledge base, with exact page citations and similarity rankings.
              </p>

              {documents.length > 0 ? (
                <div className="hero-context-badge">
                  <span className="dot active"></span>
                  <span>
                    Active knowledge base: <strong>{documents.length} document{documents.length > 1 ? "s" : ""}</strong> indexed ({documents.reduce((acc, d) => acc + d.chunks, 0)} searchable chunks)
                  </span>
                </div>
              ) : (
                <div className="hero-warning-box">
                  <span>💡 No PDFs are indexed yet. Use the <strong>Upload New PDF</strong> button in the sidebar to add knowledge to the assistant.</span>
                </div>
              )}

              {/* Starter Prompt Cards */}
              <div className="starter-prompts-grid">
                {STARTER_PROMPTS.map((item, idx) => (
                  <button
                    key={idx}
                    className="starter-prompt-card"
                    onClick={() => handleSubmit(item.prompt)}
                  >
                    <span className="starter-icon">{item.icon}</span>
                    <span className="starter-card-title">{item.title}</span>
                    <span className="starter-card-desc">{item.prompt}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="messages-stream">
              {activeSession.messages.map((msg, index) => {
                const isUser = msg.role === "user";
                const isExpanded = !!expandedSources[msg.id];

                return (
                  <div key={msg.id || index} className={`message-row ${isUser ? "user" : "assistant"}`}>
                    <div className="message-avatar">
                      {isUser ? (
                        <div className="avatar-user">You</div>
                      ) : (
                        <div className="avatar-bot">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="11" width="18" height="10" rx="2"></rect>
                            <circle cx="12" cy="5" r="2"></circle>
                            <path d="M12 7v4"></path>
                            <line x1="8" y1="16" x2="8" y2="16"></line>
                            <line x1="16" y1="16" x2="16" y2="16"></line>
                          </svg>
                        </div>
                      )}
                    </div>

                    <div className="message-bubble-wrapper">
                      <div className="message-bubble-header">
                        <span className="sender-name">{isUser ? "You" : "DocuRAG Assistant"}</span>
                        <span className="message-time">{msg.timestamp}</span>
                      </div>

                      <div className={`message-content ${msg.isError ? "error" : ""}`}>
                        {msg.content}
                      </div>

                      {/* Sources Accordion */}
                      {!isUser && msg.sources && msg.sources.length > 0 && (
                        <div className="sources-container">
                          <button
                            className="sources-toggle-btn"
                            onClick={() => toggleSourceDetails(msg.id)}
                            id={`toggle-sources-${index}`}
                          >
                            <span className="sources-toggle-icon">📚</span>
                            <span className="sources-toggle-label">
                              {msg.sources.length} Verified Source{msg.sources.length > 1 ? "s" : ""} Cited
                            </span>
                            <svg
                              className={`chevron-icon ${isExpanded ? "open" : ""}`}
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <polyline points="6 9 12 15 18 9"></polyline>
                            </svg>
                          </button>

                          {isExpanded && (
                            <div className="sources-list-drawer">
                              {msg.sources.map((src, sIdx) => {
                                const similarityPct = Math.round((src.score || 0) * 100);
                                return (
                                  <div key={sIdx} className="source-card">
                                    <div className="source-card-header">
                                      <div className="source-doc-badge">
                                        <span className="source-doc-name">{src.document}</span>
                                        <span className="source-page-tag">Page {src.page}</span>
                                      </div>
                                      <div className="source-score-badge" title="Vector cosine similarity score">
                                        {similarityPct}% match
                                      </div>
                                    </div>
                                    <div className="source-snippet">
                                      "{src.snippet}"
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Message Actions */}
                      {!isUser && !msg.isError && (
                        <div className="message-actions">
                          <button
                            className="action-btn"
                            onClick={() => handleCopy(msg.content, index)}
                            title="Copy response"
                          >
                            {copiedIndex === index ? (
                              <>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                  <polyline points="20 6 9 17 4 12"></polyline>
                                </svg>
                                <span>Copied!</span>
                              </>
                            ) : (
                              <>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                </svg>
                                <span>Copy</span>
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Shimmer Thinking Indicator */}
              {isGenerating && (
                <div className="message-row assistant generating">
                  <div className="message-avatar">
                    <div className="avatar-bot pulse">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="11" width="18" height="10" rx="2"></rect>
                        <circle cx="12" cy="5" r="2"></circle>
                        <path d="M12 7v4"></path>
                      </svg>
                    </div>
                  </div>
                  <div className="message-bubble-wrapper">
                    <div className="shimmer-thinking-box">
                      <div className="typing-dots">
                        <span></span>
                        <span></span>
                        <span></span>
                      </div>
                      <span className="thinking-text">Searching indexed chunks &amp; generating answer...</span>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </section>

        {/* Floating Input Dock */}
        <footer className="chat-input-wrapper">
          <div className="chat-input-dock">
            <div className="input-row">
              <textarea
                ref={inputRef}
                id="query-input"
                className="chat-textarea"
                rows={1}
                value={inputQuestion}
                placeholder={
                  activeSession.documentScope
                    ? `Ask about ${activeSession.documentScope}...`
                    : "Ask a question about your indexed documents..."
                }
                onChange={(e) => setInputQuestion(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isGenerating}
              />
              <button
                id="send-message-btn"
                className="send-btn"
                onClick={() => handleSubmit()}
                disabled={!inputQuestion.trim() || isGenerating}
                title="Send question (Enter)"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"></line>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                </svg>
              </button>
            </div>
            <div className="input-footer-legend">
              <span>Press <kbd>Enter</kbd> to send, <kbd>Shift</kbd> + <kbd>Enter</kbd> for new line.</span>
              <span>Scoped to: <strong>{activeSession.documentScope || "All indexed PDFs"}</strong></span>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}

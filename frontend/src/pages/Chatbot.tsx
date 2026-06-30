import { useState, useRef, useEffect } from "react";
import { Send, User, Bot } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import LeftSidebar from "../components/LeftSidebar";
import RightSidebar from "../components/RightSidebar";
import NavRail from "../components/NavRail";
import {
  streamChat,
  fetchPdfs,
  type ChatMessage,
  type RetrievedItem,
  type PdfInfo,
} from "../api/client";

export default function Chatbot() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isQuerying, setIsQuerying] = useState(false);
  const [retrievedItems, setRetrievedItems] = useState<RetrievedItem[]>([]);
  const [activePdfs, setActivePdfs] = useState<string[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loadActivePdfs = async () => {
      try {
        const pdfs = await fetchPdfs();
        const active = Object.entries(pdfs)
          .filter(([, info]: [string, PdfInfo]) => info.active)
          .map(([name]: [string, PdfInfo]) => name);
        setActivePdfs(active);
      } catch {
        // backend not ready
      }
    };
    loadActivePdfs();
  }, [refreshKey]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isQuerying) return;
    if (activePdfs.length === 0) {
      setError("No active PDFs. Toggle at least one PDF in the sidebar.");
      return;
    }

    const query = input.trim();
    setInput("");
    setError(null);
    setIsQuerying(true);
    setRetrievedItems([]);

    const userMsg: ChatMessage = { role: "user", content: query };
    setMessages((prev) => [...prev, userMsg]);

    const assistantMsg: ChatMessage = { role: "assistant", content: "" };
    setMessages((prev) => [...prev, assistantMsg]);

    await streamChat(query, activePdfs, null, {
      onRetrievedItems: (items) => {
        setRetrievedItems(items);
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            retrievedItems: items,
          };
          return updated;
        });
      },
      onToken: (token) => {
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            content: updated[updated.length - 1].content + token,
          };
          return updated;
        });
      },
      onDone: () => {
        setIsQuerying(false);
      },
      onError: (err) => {
        setError(err);
        setIsQuerying(false);
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            content: `Error: ${err}`,
          };
          return updated;
        });
      },
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-screen w-screen bg-zinc-950">
      {/* Nav Rail */}
      <div className="w-14 flex-shrink-0 bg-zinc-900 border-r border-zinc-800">
        <NavRail />
      </div>

      {/* Left Sidebar */}
      <div className="w-64 flex-shrink-0 bg-zinc-900 border-r border-zinc-800">
        <LeftSidebar refreshKey={refreshKey} onPdfsChanged={() => setRefreshKey((k) => k + 1)} />
      </div>

      {/* Center Chat */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Nav Bar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-zinc-200">Chat Engine</span>
            <span className="text-[10px] mono text-zinc-600">
              {activePdfs.length} active PDF(s)
            </span>
          </div>
          <span className="text-[10px] mono text-zinc-600">
            session: {new Date().toISOString().slice(0, 10)}
          </span>
        </div>

        {/* Chat Log */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <Bot size={32} className="text-zinc-700" />
              <p className="text-sm text-zinc-600">
                Ask a question about your technical manuals.
              </p>
              <p className="text-[10px] mono text-zinc-700">
                Powered by Local Embeddings & Qwen-VL
              </p>
            </div>
          ) : (
            <div className="space-y-4 max-w-3xl mx-auto">
              {messages.map((msg, idx) => (
                <MessageBlock key={idx} message={msg} isStreaming={isQuerying && idx === messages.length - 1} />
              ))}
              <div ref={chatEndRef} />
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="border-t border-zinc-800 bg-zinc-900 px-6 py-3">
          {error && (
            <p className="text-[10px] text-red-400 mono mb-2">{error}</p>
          )}
          <div className="flex gap-2 items-end max-w-3xl mx-auto">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question about the manuals..."
              rows={1}
              className="input-field flex-1 px-3 py-2 text-sm rounded resize-none mono"
              disabled={isQuerying}
            />
            <button
              onClick={handleSend}
              disabled={isQuerying || !input.trim()}
              className="btn btn-primary flex items-center gap-1.5 disabled:opacity-40"
            >
              <Send size={14} />
            </button>
          </div>
          <p className="text-[10px] mono text-zinc-700 text-center mt-1.5">
            Powered by Local Embeddings & Qwen-VL
          </p>
        </div>
      </div>

      {/* Right Sidebar */}
      <div className="w-80 flex-shrink-0 bg-zinc-900 border-l border-zinc-800">
        <RightSidebar items={retrievedItems} isQuerying={isQuerying} />
      </div>
    </div>
  );
}

function MessageBlock({
  message,
  isStreaming,
}: {
  message: ChatMessage;
  isStreaming: boolean;
}) {
  const isUser = message.role === "user";

  return (
    <div className="flex gap-3">
      {/* Avatar */}
      <div
        className={`flex-shrink-0 w-7 h-7 rounded flex items-center justify-center text-[10px] font-bold mono ${
          isUser
            ? "bg-zinc-700 text-zinc-300"
            : "bg-cyan-950/50 text-cyan-400 border border-cyan-800"
        }`}
      >
        {isUser ? <User size={14} /> : <Bot size={14} />}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] mono text-zinc-500">
            {isUser ? "USR" : "AI"}
          </span>
          {isStreaming && (
            <span className="text-[10px] mono text-cyan-500 animate-pulse-cyan">
              generating...
            </span>
          )}
        </div>
        {isUser ? (
          <p className="text-sm text-zinc-300 leading-relaxed">{message.content}</p>
        ) : (
          <div className="markdown-body text-sm">
            {message.content ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.content}
              </ReactMarkdown>
            ) : isStreaming ? (
              <span className="text-[10px] mono text-zinc-600 animate-pulse-cyan">
                Retrieving context...
              </span>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

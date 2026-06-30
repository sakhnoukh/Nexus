import { useState, useRef, useEffect } from "react";
import { Send, FileText, Trash2, Sparkles, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import NavRail from "../components/NavRail";
import {
  fetchSummaries,
  fetchSummary,
  generateSummary,
  deleteSummary,
  streamSummaryChat,
  fetchPdfs,
  type PdfInfo,
} from "../api/client";

interface SummaryChatMessage {
  role: "user" | "assistant";
  content: string;
}

export default function Summaries() {
  const [selectedPdf, setSelectedPdf] = useState<string | null>(null);
  const [summaryMd, setSummaryMd] = useState<string>("");
  const [pdfs, setPdfs] = useState<Record<string, PdfInfo>>({});
  const [chatMessages, setChatMessages] = useState<SummaryChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isChatting, setIsChatting] = useState(false);
  const [showGenForm, setShowGenForm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const loadData = async () => {
    try {
      const [sumData, pdfData] = await Promise.all([fetchSummaries(), fetchPdfs()]);
      setPdfs(pdfData);
      if (!selectedPdf && sumData.summaries.length > 0) {
        setSelectedPdf(sumData.summaries[0]);
      }
    } catch {
      setError("Failed to connect to backend");
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (selectedPdf) {
      fetchSummary(selectedPdf)
        .then((data) => setSummaryMd(data.summary))
        .catch(() => setSummaryMd(""));
      setChatMessages([]);
    }
  }, [selectedPdf]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const handleGenerate = async (
    pdfName: string,
    focusAreas: string[],
    customInstructions: string
  ) => {
    setIsGenerating(true);
    setError(null);
    try {
      await generateSummary(pdfName, focusAreas, customInstructions);
      await loadData();
      setSelectedPdf(pdfName);
      setShowGenForm(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDeleteSummary = async (name: string) => {
    try {
      await deleteSummary(name);
      await loadData();
      if (selectedPdf === name) setSelectedPdf(null);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleChatSend = async () => {
    if (!chatInput.trim() || !selectedPdf || isChatting) return;

    const question = chatInput.trim();
    setChatInput("");
    setIsChatting(true);

    const userMsg: SummaryChatMessage = { role: "user", content: question };
    const assistantMsg: SummaryChatMessage = { role: "assistant", content: "" };
    setChatMessages((prev) => [...prev, userMsg, assistantMsg]);

    const history = chatMessages.map((m) => ({ role: m.role, content: m.content }));

    await streamSummaryChat(selectedPdf, question, history, {
      onToken: (token) => {
        setChatMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            content: updated[updated.length - 1].content + token,
          };
          return updated;
        });
      },
      onDone: () => {
        setIsChatting(false);
      },
      onError: (err) => {
        setError(err);
        setIsChatting(false);
      },
    });
  };

  const handleChatKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleChatSend();
    }
  };

  return (
    <div className="flex h-screen w-screen bg-zinc-950">
      {/* Nav Rail */}
      <div className="w-14 flex-shrink-0 bg-zinc-900 border-r border-zinc-800">
        <NavRail />
      </div>

      {/* Left Sidebar — PDF list + summary controls */}
      <div className="w-64 flex-shrink-0 bg-zinc-900 border-r border-zinc-800 flex flex-col">
        <div className="px-4 py-3 border-b border-zinc-800">
          <span className="text-sm font-semibold text-zinc-200">Summaries</span>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mono px-2">
            PDFs
          </span>
          <div className="space-y-1 mt-1.5">
            {Object.entries(pdfs).map(([name, info]) => (
              <div key={name} className="card p-2 group">
                <div className="flex items-start gap-2">
                  <FileText size={12} className="text-zinc-500 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span
                      className="text-xs text-zinc-300 truncate block"
                      title={name}
                    >
                      {name}
                    </span>
                    <span className="text-[10px] mono text-zinc-600">
                      {info.element_count} elements
                      {info.has_summary && (
                        <span className="text-cyan-600 ml-1">| has summary</span>
                      )}
                    </span>
                  </div>
                </div>
                <div className="flex gap-1 mt-1.5">
                  {info.has_summary ? (
                    <>
                      <button
                        onClick={() => setSelectedPdf(name)}
                        className={`btn btn-secondary text-[10px] flex-1 ${
                          selectedPdf === name ? "border-cyan-700 text-cyan-400" : ""
                        }`}
                      >
                        View
                      </button>
                      <button
                        onClick={() => setShowGenForm(name)}
                        className="btn btn-secondary text-[10px] flex-1"
                      >
                        Regenerate
                      </button>
                      <button
                        onClick={() => handleDeleteSummary(name)}
                        className="btn btn-danger text-[10px] px-1.5"
                      >
                        <Trash2 size={11} />
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setShowGenForm(name)}
                      className="btn btn-secondary text-[10px] flex-1 flex items-center justify-center gap-1"
                    >
                      <Sparkles size={11} />
                      Generate
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {error && (
          <div className="border-t border-zinc-800 px-3 py-2">
            <p className="text-[10px] text-red-400 mono">{error}</p>
          </div>
        )}
      </div>

      {/* Center — Summary viewer + Chat */}
      <div className="flex-1 flex min-w-0">
        {!selectedPdf ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <FileText size={32} className="text-zinc-700" />
            <p className="text-sm text-zinc-600">
              Select a PDF summary to view, or generate one from the sidebar.
            </p>
          </div>
        ) : (
          <>
            {/* Summary Viewer */}
            <div className="flex-1 flex flex-col border-r border-zinc-800 min-w-0">
              <div className="px-4 py-2 border-b border-zinc-800 bg-zinc-900 flex items-center justify-between">
                <span className="text-sm font-semibold text-zinc-200 truncate">
                  {selectedPdf}
                </span>
                <span className="text-[10px] mono text-zinc-600">summary</span>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-4">
                <div className="markdown-body max-w-3xl mx-auto">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {summaryMd}
                  </ReactMarkdown>
                </div>
              </div>
            </div>

            {/* Chat with Summary */}
            <div className="w-96 flex-shrink-0 flex flex-col bg-zinc-900">
              <div className="px-4 py-2 border-b border-zinc-800 flex items-center justify-between">
                <span className="text-sm font-semibold text-zinc-200">Chat</span>
                <span className="text-[10px] mono text-zinc-600">
                  ctx: summary
                </span>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-3">
                {chatMessages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-2">
                    <p className="text-[10px] mono text-zinc-600 text-center">
                      Ask questions about {selectedPdf} based on its summary.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {chatMessages.map((msg, idx) => (
                      <div key={idx} className="flex gap-2">
                        <span
                          className={`text-[10px] mono flex-shrink-0 mt-0.5 ${
                            msg.role === "user" ? "text-zinc-500" : "text-cyan-500"
                          }`}
                        >
                          {msg.role === "user" ? "USR" : "AI"}
                        </span>
                        <div className="flex-1 min-w-0">
                          {msg.role === "user" ? (
                            <p className="text-xs text-zinc-300">{msg.content}</p>
                          ) : (
                            <div className="markdown-body text-xs">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {msg.content}
                              </ReactMarkdown>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    <div ref={chatEndRef} />
                  </div>
                )}
              </div>

              <div className="border-t border-zinc-800 px-3 py-2">
                <div className="flex gap-2 items-end">
                  <textarea
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={handleChatKeyDown}
                    placeholder="Ask about the summary..."
                    rows={1}
                    className="input-field flex-1 px-2.5 py-1.5 text-xs rounded resize-none mono"
                    disabled={isChatting}
                  />
                  <button
                    onClick={handleChatSend}
                    disabled={isChatting || !chatInput.trim()}
                    className="btn btn-primary px-2 py-1.5 disabled:opacity-40"
                  >
                    <Send size={12} />
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Generate Summary Modal */}
      {showGenForm && (
        <GenerateModal
          pdfName={showGenForm}
          isGenerating={isGenerating}
          onGenerate={(focusAreas, customInstructions) =>
            handleGenerate(showGenForm, focusAreas, customInstructions)
          }
          onCancel={() => setShowGenForm(null)}
        />
      )}
    </div>
  );
}

function GenerateModal({
  pdfName,
  isGenerating,
  onGenerate,
  onCancel,
}: {
  pdfName: string;
  isGenerating: boolean;
  onGenerate: (focusAreas: string[], customInstructions: string) => void;
  onCancel: () => void;
}) {
  const [overview, setOverview] = useState(true);
  const [topics, setTopics] = useState(true);
  const [components, setComponents] = useState(true);
  const [safety, setSafety] = useState(true);
  const [custom, setCustom] = useState("");

  const handleGenerate = () => {
    const areas: string[] = [];
    if (overview) areas.push("overview");
    if (topics) areas.push("topics");
    if (components) areas.push("components");
    if (safety) areas.push("safety");
    onGenerate(areas.length > 0 ? areas : ["overview"], custom);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="panel rounded-lg w-96 max-w-[90vw]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <span className="text-sm font-semibold text-zinc-200">
            Summary Options
          </span>
          <button onClick={onCancel} className="text-zinc-500 hover:text-zinc-300">
            <X size={16} />
          </button>
        </div>
        <div className="px-4 py-3 space-y-2">
          <p className="text-xs text-zinc-500 truncate">{pdfName}</p>
          <div className="space-y-1.5">
            <Checkbox label="Overview" checked={overview} onChange={setOverview} />
            <Checkbox label="Key Topics / TOC" checked={topics} onChange={setTopics} />
            <Checkbox label="Components & Specs" checked={components} onChange={setComponents} />
            <Checkbox label="Safety & Warnings" checked={safety} onChange={setSafety} />
          </div>
          <textarea
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="Custom instructions (optional)..."
            rows={2}
            className="input-field w-full px-2.5 py-1.5 text-xs rounded resize-none mono"
          />
        </div>
        <div className="flex gap-2 px-4 py-3 border-t border-zinc-800">
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="btn btn-primary flex-1 disabled:opacity-50"
          >
            {isGenerating ? "Generating..." : "Generate"}
          </button>
          <button onClick={onCancel} className="btn btn-secondary">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer group">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-cyan-500 w-3.5 h-3.5"
      />
      <span className="text-xs text-zinc-400 group-hover:text-zinc-300">{label}</span>
    </label>
  );
}

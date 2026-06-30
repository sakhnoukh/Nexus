import { useState, useEffect, useRef } from "react";
import {
  Upload,
  Trash2,
  RefreshCw,
  FileText,
  CheckCircle2,
  Circle,
  Database,
  Cpu,
  Eye,
  Activity,
} from "lucide-react";
import {
  fetchHealth,
  fetchPdfs,
  uploadPdfs,
  deletePdf,
  togglePdfActive,
  rebuildIndex,
  type PdfInfo,
  type HealthStatus,
} from "../api/client";

interface LeftSidebarProps {
  refreshKey: number;
  onPdfsChanged: () => void;
}

export default function LeftSidebar({ refreshKey, onPdfsChanged }: LeftSidebarProps) {
  const [pdfs, setPdfs] = useState<Record<string, PdfInfo>>({});
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [uploading, setUploading] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadData = async () => {
    try {
      const [pdfData, healthData] = await Promise.all([fetchPdfs(), fetchHealth()]);
      setPdfs(pdfData);
      setHealth(healthData);
      setError(null);
    } catch (e) {
      setError("Failed to connect to backend");
    }
  };

  useEffect(() => {
    loadData();
  }, [refreshKey]);

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      await uploadPdfs(Array.from(files));
      await loadData();
      onPdfsChanged();
    } catch (e: any) {
      setError(e.message || "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async (name: string) => {
    try {
      await deletePdf(name);
      await loadData();
      onPdfsChanged();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleToggle = async (name: string, active: boolean) => {
    try {
      await togglePdfActive(name, active);
      await loadData();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleRebuild = async () => {
    setRebuilding(true);
    setError(null);
    try {
      await rebuildIndex();
      await loadData();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRebuilding(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-cyan-500" />
          <span className="text-sm font-semibold text-zinc-200">Nexus RAG</span>
        </div>
        <p className="text-[10px] text-zinc-600 mono mt-0.5">Multimodal Support Engineer</p>
      </div>

      {/* Upload */}
      <div className="px-3 py-2 border-b border-zinc-800">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          multiple
          className="hidden"
          onChange={(e) => handleUpload(e.target.files)}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="btn btn-secondary w-full flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <Upload size={14} />
          {uploading ? "Ingesting..." : "Upload PDFs"}
        </button>
        <button
          onClick={handleRebuild}
          disabled={rebuilding}
          className="btn btn-secondary w-full flex items-center justify-center gap-2 mt-1.5 disabled:opacity-50"
        >
          <RefreshCw size={14} className={rebuilding ? "animate-spin" : ""} />
          {rebuilding ? "Rebuilding..." : "Rebuild Index"}
        </button>
      </div>

      {/* Knowledge Base */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-2 sticky top-0 bg-zinc-900 z-10">
          <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mono">
            Knowledge Base
          </span>
        </div>

        {Object.keys(pdfs).length === 0 ? (
          <p className="text-xs text-zinc-600 px-4 py-2">No PDFs ingested.</p>
        ) : (
          <div className="space-y-1 px-2">
            {Object.entries(pdfs).map(([name, info]) => (
              <div
                key={name}
                className="card p-2 group hover:border-zinc-600 transition-colors"
              >
                <div className="flex items-start gap-2">
                  <button
                    onClick={() => handleToggle(name, !info.active)}
                    className="mt-0.5 flex-shrink-0"
                    title={info.active ? "Active" : "Inactive"}
                  >
                    {info.active ? (
                      <CheckCircle2 size={15} className="text-emerald-400" />
                    ) : (
                      <Circle size={15} className="text-zinc-600" />
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <FileText size={12} className="text-zinc-500 flex-shrink-0" />
                      <span
                        className={`text-xs truncate ${
                          info.active ? "text-zinc-300" : "text-zinc-600"
                        }`}
                        title={name}
                      >
                        {name}
                      </span>
                    </div>
                    <span className="text-[10px] text-zinc-600 mono">
                      {info.element_count} elements
                      {info.has_summary && (
                        <span className="text-cyan-600 ml-1">| summary</span>
                      )}
                    </span>
                  </div>
                  <button
                    onClick={() => handleDelete(name)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                    title="Delete"
                  >
                    <Trash2 size={13} className="text-red-500/70 hover:text-red-400" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* System Vitals */}
      <div className="border-t border-zinc-800 px-4 py-2">
        <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mono">
          System Vitals
        </span>
        <div className="mt-1.5 space-y-1">
          <VitalRow
            icon={<Database size={11} />}
            label="Vector DB"
            online={health?.chroma_db ?? false}
          />
          <VitalRow
            icon={<Cpu size={11} />}
            label="Embeddings"
            online={health?.document_store ?? false}
          />
          <VitalRow
            icon={<Eye size={11} />}
            label="VLM API"
            online={health?.status === "ok"}
          />
          <VitalRow
            icon={<Activity size={11} />}
            label="Pipeline"
            online={(health?.pdf_count ?? 0) > 0}
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="border-t border-zinc-800 px-3 py-2">
          <p className="text-[10px] text-red-400 mono">{error}</p>
        </div>
      )}
    </div>
  );
}

function VitalRow({
  icon,
  label,
  online,
}: {
  icon: React.ReactNode;
  label: string;
  online: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-zinc-600">{icon}</span>
      <span className="text-[10px] mono text-zinc-500 flex-1">{label}</span>
      <span
        className={`text-[10px] mono ${
          online ? "text-emerald-400" : "text-zinc-600"
        }`}
      >
        {online ? "● online" : "● offline"}
      </span>
    </div>
  );
}

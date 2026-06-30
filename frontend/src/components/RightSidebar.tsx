import { useState } from "react";
import { ImageIcon, FileText, ChevronDown, ChevronRight } from "lucide-react";
import type { RetrievedItem } from "../api/client";
import { getImageUrl } from "../api/client";

interface RightSidebarProps {
  items: RetrievedItem[];
  isQuerying: boolean;
}

export default function RightSidebar({ items, isQuerying }: RightSidebarProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
        <span className="text-sm font-semibold text-zinc-200">Retrieval Inspector</span>
        <span className="text-[10px] mono text-cyan-500 bg-cyan-950/40 px-1.5 py-0.5 rounded">
          K={items.length}
        </span>
      </div>

      {/* Retrieved Assets */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {isQuerying && items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <div className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse-cyan" />
            <span className="text-[10px] mono text-zinc-600">Searching vectors...</span>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full">
            <span className="text-[10px] mono text-zinc-600 text-center px-4">
              Retrieved assets will appear here after a query.
            </span>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item, idx) => (
              <AssetCard key={item.uuid} item={item} rank={idx + 1} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AssetCard({ item, rank }: { item: RetrievedItem; rank: number }) {
  const [expanded, setExpanded] = useState(false);
  const similarity = 1 - item.distance;
  const simPercent = (similarity * 100).toFixed(1);

  return (
    <div className="card overflow-hidden">
      {/* Card Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-2.5 py-2 hover:bg-zinc-700/30 transition-colors"
      >
        {expanded ? (
          <ChevronDown size={12} className="text-zinc-500" />
        ) : (
          <ChevronRight size={12} className="text-zinc-500" />
        )}
        {item.type === "image" ? (
          <ImageIcon size={13} className="text-cyan-500" />
        ) : (
          <FileText size={13} className="text-zinc-400" />
        )}
        <span className="text-[11px] text-zinc-300 truncate flex-1 text-left">
          {item.source_pdf}
        </span>
        <span className="text-[10px] mono text-emerald-400 flex-shrink-0">
          sim: {simPercent}%
        </span>
      </button>

      {/* Card Body */}
      <div className="px-2.5 pb-2">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[9px] mono text-zinc-600">
            #{rank} | p{item.page} | {item.type}
          </span>
        </div>

        {item.type === "image" && item.image_url && (
          <div className="mb-1.5">
            <img
              src={getImageUrl(item.image_url.split("/").pop() || "")}
              alt={`Extracted from ${item.source_pdf} page ${item.page}`}
              className="w-full rounded border border-zinc-700"
              loading="lazy"
            />
          </div>
        )}

        {expanded ? (
          <p className="text-[11px] text-zinc-400 leading-relaxed mono">
            {item.content}
          </p>
        ) : (
          <p className="text-[11px] text-zinc-500 leading-relaxed mono line-clamp-3">
            {item.content}
          </p>
        )}
      </div>
    </div>
  );
}

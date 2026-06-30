import { NavLink } from "react-router-dom";
import { MessageSquare, FileText, BookOpen } from "lucide-react";

const navItems = [
  { to: "/", label: "Chat", icon: MessageSquare },
  { to: "/summaries", label: "Summaries", icon: FileText },
  { to: "/viewer", label: "Viewer", icon: BookOpen },
];

export default function NavRail() {
  return (
    <nav className="flex flex-col items-center gap-1 py-3">
      {navItems.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `flex flex-col items-center gap-0.5 w-16 py-2 rounded transition-colors ${
              isActive
                ? "text-cyan-400 bg-cyan-950/30"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
            }`
          }
        >
          <Icon size={18} />
          <span className="text-[10px] font-medium">{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

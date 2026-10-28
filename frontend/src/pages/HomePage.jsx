import { useEffect } from "react";
import { MessageCircle } from "lucide-react";
import useChatStore from "../store/chat";
import useChatSocket from "../hooks/useChatSocket";
import Sidebar from "../components/chat/Sidebar";
import ChatWindow from "../components/chat/ChatWindow";

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="grid h-20 w-20 place-items-center rounded-full bg-emerald-50 text-emerald-600">
        <MessageCircle className="h-10 w-10" />
      </div>
      <div className="text-lg font-bold text-slate-700">یک گفتگو را انتخاب کنید</div>
      <p className="max-w-xs text-sm leading-6 text-slate-400">
        از ستون کنار، گفتگوی موجود را باز کنید یا با دکمه «گفتگوی جدید» گفتگوی تازه‌ای شروع کنید.
      </p>
    </div>
  );
}

export default function HomePage() {
  useChatSocket();

  const activeId = useChatStore((s) => s.activeId);
  const connected = useChatStore((s) => s.connected);

  useEffect(() => {
    useChatStore.getState().loadConversations();
  }, []);

  return (
    <div className="flex h-[100dvh] w-full flex-col bg-slate-100">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-emerald-600 text-white">
            <MessageCircle className="h-5 w-5" />
          </span>
          <div className="leading-tight">
            <div className="font-extrabold text-slate-800">RAZ</div>
            <div className="text-[11px] text-slate-400">پیام‌رسان امن شما</div>
          </div>
        </div>
        <span
          className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
            connected ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500" : "animate-pulse bg-amber-500"}`}
          />
          {connected ? "متصل" : "در حال اتصال…"}
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside
          className={`${
            activeId ? "hidden md:flex" : "flex"
          } w-full shrink-0 flex-col border-l border-slate-200 bg-white md:w-80 lg:w-96`}
        >
          <Sidebar />
        </aside>

        <main className={`${activeId ? "flex" : "hidden md:flex"} min-w-0 flex-1`}>
          {activeId ? <ChatWindow /> : <EmptyState />}
        </main>
      </div>
    </div>
  );
}
import { Agentation } from "agentation";
import { useLocation } from "react-router-dom";
import "./visual-review.css";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Narzędzie developerskie: toolbar do zaznaczania elementów i opisywania zmian (agentation-mcp, lokalnie).
// Mounted only in `vite` dev with VITE_VISUAL_REVIEW=1. Sends nothing outside VITE_AGENTATION_ENDPOINT and the dev server.

type ThreadMessage = {
  id: string;
  role: "human" | "agent";
  content: string;
  timestamp: number;
  /** % of Claude's context window left when the reply was sent (chat replies only). */
  contextLeft?: number;
};
type ReviewAnnotation = {
  id: string;
  comment: string;
  element?: string;
  status?: string;
  thread?: ThreadMessage[];
};

const POLL_MS = 3000;
// Safety net: stop showing the loader if Claude never answers.
const MAX_IMAGES = 4;
const BUSY_TIMEOUT_MS = 10 * 60 * 1000;
const QUESTION = /^PYTANIE:\s*/i;

// Clarifying question from Claude: last thread message is from the agent and starts with "PYTANIE:".
function openQuestion(a: ReviewAnnotation): string | undefined {
  if (a.status === "resolved" || a.status === "dismissed") return undefined;
  const last = a.thread?.[a.thread.length - 1];
  const q = last && last.role === "agent" ? QUESTION.exec(last.content) : null;
  return last && q ? last.content.slice(q[0].length) : undefined;
}
function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}
const SIZE_KEY = "visual-review-panel-size";
const OPEN_KEY = "visual-review-panel-open";
const POS_KEY = "visual-review-pos";
const DRAG_THRESHOLD = 5;
const EDGE_GAP = 16;
// Position of the panel / the round icon, measured from the left and bottom edges of the window.
type Pos = { left: number; bottom: number };
const DEFAULT_POS: Pos = { left: EDGE_GAP, bottom: EDGE_GAP };
const STATUS_LABEL: Record<string, string> = {
  pending: "oczekuje",
  acknowledged: "w toku",
  review: "do sprawdzenia",
  resolved: "zrobione",
  dismissed: "odrzucone",
};

// Panel follows the Agentation toolbar theme, not the app theme: the toolbar sets `data-agentation-theme` on its root
// (default dark) and stores the choice in localStorage. We override the app's underlying token variables on the panel itself (the Tailwind tokens are `@theme inline`, so they read these directly).
const PALETTES: Record<"dark" | "light", Record<string, string>> = {
  dark: {
    "--surface-raised": "#1c1c1c",
    "--bg-page": "#303030",
    "--border-default": "rgba(255,255,255,0.1)",
    "--text-primary": "rgba(255,255,255,0.92)",
    "--text-secondary": "rgba(255,255,255,0.5)",
    "--surface-selected": "#262626",
    "--surface-inverse": "#f2f2f2",
    "--text-inverse": "#1a1a1a",
  },
  light: {
    "--surface-raised": "#ffffff",
    "--bg-page": "#ececec",
    "--border-default": "rgba(0,0,0,0.08)",
    "--text-primary": "#1a1a1a",
    "--text-secondary": "rgba(0,0,0,0.5)",
    "--surface-selected": "#f7f7f7",
    "--surface-inverse": "#1a1a1a",
    "--text-inverse": "#ffffff",
  },
};

// The Agentation toolbar lives in the shadow root of <agentation-toolbar>, invisible to document.querySelector.
function toolbarRoot(): ShadowRoot | null {
  return document.querySelector("agentation-toolbar")?.shadowRoot ?? null;
}

function useAgentationTheme(): "dark" | "light" {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    function read() {
      let value = toolbarRoot()
        ?.querySelector("[data-agentation-theme]")
        ?.getAttribute("data-agentation-theme");
      if (!value) {
        try {
          value = localStorage.getItem("feedback-toolbar-theme");
        } catch {
          // storage unavailable: keep the default
        }
      }
      if (value === "light" || value === "dark") setTheme(value);
    }
    read();
    // The attribute sits inside a shadow root that may mount later, so a light poll is simpler than an observer.
    const timer = setInterval(read, 500);
    return () => clearInterval(timer);
  }, []);
  return theme;
}

/**
 * Panel rozmowy: pokazuje odpowiedzi i statusy agenta dla adnotacji z tej strony i pozwala odpisać w wątku.
 * Toolbar Agentation sam ich nie wyświetla. Odpowiedź = wiadomość w wątku + powrót adnotacji do `pending`,
 * dzięki czemu sesja Claude (agentation_watch_annotations) odbiera ją jak nową.
 */
function AgentReplies({ endpoint, path }: { endpoint: string; path: string }) {
  const [items, setItems] = useState<ReviewAnnotation[]>([]);
  const [open, setOpen] = useState(true);
  // True during the 180 ms shrink animation before the panel turns into the round icon.
  const [leaving, setLeaving] = useState(false);
  const [panelPos, setPanelPos] = useState<Pos>(DEFAULT_POS);
  const [iconPos, setIconPos] = useState<Pos>(DEFAULT_POS);
  const drag = useRef<{
    x: number;
    y: number;
    start: Pos;
    moved: boolean;
  } | null>(null);
  const justDragged = useRef(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sending, setSending] = useState<string | null>(null);
  const [waking, setWaking] = useState(false);
  // Time a request was sent to Claude; cleared once Claude answers (chat reply, thread reply) or the timeout passes.
  const [busySince, setBusySince] = useState<number | null>(null);
  const [wakeInfo, setWakeInfo] = useState<string | null>(null);
  const [chat, setChat] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<
    { id: string; file: File; url: string }[]
  >([]);
  const theme = useAgentationTheme();
  const [markerBtns, setMarkerBtns] = useState<
    { id: string; x: number; y: number; kind: "question" | "review" }[]
  >([]);
  // Marker the pointer is over (or its "Zaakceptuj" button); the button is shown only then.
  const [hoverId, setHoverId] = useState<string | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function hoverOn(id: string) {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHoverId(id);
  }
  function hoverOff() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHoverId(null), 200);
  }

  // "Zaakceptuj" next to the Agentation marker of every annotation waiting for review. Markers live in the toolbar's
  // shadow root and are numbered by position among still-open annotations, so number N maps to open[N - 1].
  useEffect(() => {
    const open = items.filter(
      (a) => a.status !== "resolved" && a.status !== "dismissed",
    );
    function update() {
      const next: {
        id: string;
        x: number;
        y: number;
        kind: "question" | "review";
      }[] = [];
      toolbarRoot()
        ?.querySelectorAll("[data-annotation-marker]")
        .forEach((m) => {
          const n = Number(
            /annotation (\d+):/.exec(m.getAttribute("aria-label") ?? "")?.[1],
          );
          const a = open[n - 1];
          const thread = a?.thread ?? [];
          const last = thread[thread.length - 1];
          if (!a) return;
          const question = openQuestion(a) !== undefined;
          const review = a.status === "acknowledged" && last?.role === "agent";
          if (question || review) {
            const r = m.getBoundingClientRect();
            next.push({
              id: a.id,
              x: Math.round(r.right),
              y: Math.round(r.top),
              kind: question ? "question" : "review",
            });
            // Hover tracking on the marker itself (shadow DOM node); the id is re-read on each event because
            // marker numbers shift when annotations are resolved.
            const el = m as HTMLElement;
            el.dataset.vrId = a.id;
            if (!el.dataset.vrHover) {
              el.dataset.vrHover = "1";
              el.addEventListener("mouseenter", () =>
                hoverOn(el.dataset.vrId!),
              );
              el.addEventListener("mouseleave", hoverOff);
            }
          }
        });
      setMarkerBtns((prev) =>
        JSON.stringify(prev) === JSON.stringify(next) ? prev : next,
      );
    }
    update();
    const timer = setInterval(update, 300);
    window.addEventListener("scroll", update, true);
    return () => {
      clearInterval(timer);
      window.removeEventListener("scroll", update, true);
    };
  }, [items]);
  // Latest items for the card effect: it must not restart on every poll, or the injected node (and input focus) is rebuilt.
  const itemsRef = useRef<ReviewAnnotation[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  const [cardHost, setCardHost] = useState<{
    el: HTMLElement;
    id: string;
    messages: { who: "Ty" | "Claude"; text: string }[];
    editing: boolean;
  } | null>(null);
  const sendRef = useRef<(id: string, content: string) => Promise<void>>(
    async () => {},
  );

  // Conversation inside Agentation's own annotation card (hover preview and click editor): history above, and the
  // card's original textarea at the bottom becomes the reply input (Save/Enter sends a thread reply instead of
  // editing the comment). The card lives in the toolbar's shadow root and is owned by React there, so we append our
  // own host node, match the card to an annotation by its element label, and intercept Save/Enter in the capture phase.
  useEffect(() => {
    let host: HTMLElement | null = null;
    let attachedTo: ShadowRoot | null = null;

    function setNative(ta: HTMLTextAreaElement, value: string) {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(ta, value);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }
    function send(card: HTMLElement) {
      const id = card.dataset.vrReply;
      const ta = card.querySelector<HTMLTextAreaElement>(
        "[data-shared-note] textarea",
      );
      const text = ta?.value.trim();
      if (!id || !ta || !text) return;
      void sendRef.current(id, text).then(() => {
        card.querySelector<HTMLButtonElement>("button[class*=cancel]")?.click();
      });
    }
    function onClick(e: Event) {
      const t = e.target as Element;
      const card = t.closest<HTMLElement>("[data-annotation-card]");
      if (!card?.dataset.vrReply || !t.closest("button[class*=submit]")) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      send(card);
    }
    function onKey(e: Event) {
      const k = e as KeyboardEvent;
      const t = k.target as Element;
      const card = t.closest<HTMLElement>("[data-annotation-card]");
      if (
        !card?.dataset.vrReply ||
        k.key !== "Enter" ||
        k.shiftKey ||
        t.nodeName !== "TEXTAREA"
      )
        return;
      k.preventDefault();
      k.stopImmediatePropagation();
      send(card);
    }

    function update() {
      const root = toolbarRoot();
      // Hover preview card is 120-200px wide by default; widen it so the whole comment/thread is readable.
      if (root && !root.querySelector("[data-vr-wide]")) {
        const style = document.createElement("style");
        style.setAttribute("data-vr-wide", "");
        style.textContent =
          "[data-annotation-card][data-state=preview] { width: min(360px, calc(100vw - 24px)) !important; }";
        root.appendChild(style);
      }
      if (root && attachedTo !== root) {
        root.addEventListener("click", onClick, true);
        root.addEventListener("keydown", onKey, true);
        attachedTo = root;
      }
      const card = root?.querySelector<HTMLElement>("[data-annotation-card]");
      const label = card
        ?.querySelector("[data-editor-heading] [class*=element]")
        ?.textContent?.trim();
      const state = card?.getAttribute("data-state");
      const hit =
        card && state !== "hidden" && label
          ? itemsRef.current.find(
              (a) =>
                a.element?.trim() === label &&
                (a.thread?.length ?? 0) > 0 &&
                a.status !== "resolved" &&
                a.status !== "dismissed",
            )
          : undefined;
      const form = card?.querySelector<HTMLElement>("[data-annotation-editor]");
      if (!card || !form || !hit) {
        host?.remove();
        host = null;
        if (card) {
          delete card.dataset.vrReply;
          delete card.dataset.vrFor;
        }
        setCardHost((p) => (p ? null : p));
        return;
      }
      if (!host || host.parentElement !== form) {
        host?.remove();
        host = document.createElement("div");
        host.setAttribute("data-vr-question", "");
        form.insertBefore(host, form.querySelector("[data-shared-note]"));
      }
      const editing = state === "edit";
      card.dataset.vrReply = hit.id;
      const ta = card.querySelector<HTMLTextAreaElement>(
        "[data-shared-note] textarea",
      );
      if (editing && ta) {
        if (card.dataset.vrFor !== hit.id) {
          card.dataset.vrFor = hit.id;
          setNative(ta, "");
        }
        if (ta.placeholder !== "Odpowiedz Claude…")
          ta.placeholder = "Odpowiedz Claude…";
      } else {
        delete card.dataset.vrFor;
      }
      const messages: { who: "Ty" | "Claude"; text: string }[] = [
        { who: "Ty", text: hit.comment },
        ...(hit.thread ?? []).map((m) => ({
          who: m.role === "agent" ? ("Claude" as const) : ("Ty" as const),
          text: m.content.replace(QUESTION, ""),
        })),
      ];
      setCardHost((p) =>
        p &&
        p.el === host &&
        p.id === hit.id &&
        p.editing === editing &&
        JSON.stringify(p.messages) === JSON.stringify(messages)
          ? p
          : { el: host!, id: hit.id, messages, editing },
      );
    }
    update();
    const timer = setInterval(update, 300);
    return () => {
      clearInterval(timer);
      host?.remove();
      attachedTo?.removeEventListener("click", onClick, true);
      attachedTo?.removeEventListener("keydown", onKey, true);
    };
  }, []);
  const [chatLog, setChatLog] = useState<ThreadMessage[]>([]);
  const [size, setSize] = useState<{ w?: number; h?: number }>({});
  const asideRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const dragRef = useRef<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );

  // Opening the chat panel also expands the Agentation toolbar. Agentation has no prop for this, so we send its own
  // Ctrl/Cmd+Shift+F shortcut when the toolbar is collapsed (retrying briefly while it mounts).
  useEffect(() => {
    if (!open) return;
    let tries = 0;
    const timer = setInterval(() => {
      const bar = toolbarRoot()?.querySelector<HTMLElement>(
        '[class*="toolbarContainer"]',
      );
      tries += 1;
      if (bar) {
        clearInterval(timer);
        if (bar.className.includes("collapsed")) {
          document.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "F",
              ctrlKey: true,
              metaKey: true,
              shiftKey: true,
              bubbles: true,
            }),
          );
        }
      } else if (tries >= 20) {
        clearInterval(timer);
      }
    }, 150);
    return () => clearInterval(timer);
  }, [open]);

  // Scroll to the newest entry when the panel opens and whenever any message arrives (chat or annotation thread).
  const messageCount =
    chatLog.length + items.reduce((n, a) => n + 1 + (a.thread?.length ?? 0), 0);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, messageCount]);

  // The panel is anchored bottom-left, so dragging the right edge changes width and the top edge changes height.
  function startResize(e: React.PointerEvent<HTMLDivElement>) {
    const rect = asideRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      w: rect.width,
      h: rect.height,
    };
  }
  function moveResize(e: React.PointerEvent<HTMLDivElement>) {
    const start = dragRef.current;
    if (!start) return;
    const axis = e.currentTarget.dataset.resize;
    setSize((s) => ({
      w:
        axis === "y"
          ? s.w
          : Math.min(
              Math.max(start.w + e.clientX - start.x, 260),
              window.innerWidth - 32,
            ),
      h:
        axis === "x"
          ? s.h
          : Math.min(
              Math.max(start.h - (e.clientY - start.y), 160),
              window.innerHeight - 32,
            ),
    }));
  }
  function endResize() {
    if (!dragRef.current) return;
    dragRef.current = null;
    const rect = asideRef.current?.getBoundingClientRect();
    if (!rect) return;
    try {
      localStorage.setItem(
        SIZE_KEY,
        JSON.stringify({
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        }),
      );
    } catch {
      // storage unavailable: size just won't persist
    }
  }

  function toggleOpen() {
    const next = !open;
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    if (next) {
      setLeaving(false);
      setOpen(true);
    } else {
      setLeaving(true);
      leaveTimer.current = setTimeout(() => {
        setOpen(false);
        setLeaving(false);
      }, 180);
    }
    try {
      localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    } catch {
      // storage unavailable: state just won't persist
    }
  }

  function savePos(kind: "panel" | "icon", pos: Pos) {
    try {
      const all: Record<string, Pos> = JSON.parse(
        localStorage.getItem(POS_KEY) ?? "{}",
      );
      all[kind] = pos;
      localStorage.setItem(POS_KEY, JSON.stringify(all));
    } catch {
      // storage unavailable: position just won't persist
    }
  }

  // Drag by pointer: a move under DRAG_THRESHOLD stays a click. The icon snaps to the nearest side edge on release.
  type DragKind = "panel" | "icon";
  function placeDrag(
    kind: DragKind,
    d: { x: number; y: number; start: Pos },
    e: React.PointerEvent<HTMLElement>,
    snap: boolean,
  ) {
    const rect = (
      kind === "panel" ? e.currentTarget.closest("aside") : e.currentTarget
    )?.getBoundingClientRect();
    if (!rect) return undefined;
    const maxLeft = Math.max(0, window.innerWidth - rect.width);
    const maxBottom = Math.max(0, window.innerHeight - rect.height);
    let left = Math.min(Math.max(d.start.left + e.clientX - d.x, 0), maxLeft);
    const bottom = Math.min(
      Math.max(d.start.bottom - (e.clientY - d.y), 0),
      maxBottom,
    );
    if (snap) {
      left =
        left + rect.width / 2 < window.innerWidth / 2
          ? EDGE_GAP
          : Math.max(0, window.innerWidth - rect.width - EDGE_GAP);
    }
    return { left, bottom };
  }
  function startDrag(kind: DragKind, e: React.PointerEvent<HTMLElement>) {
    if (e.button !== 0) return;
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      start: kind === "panel" ? panelPos : iconPos,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function moveDrag(kind: DragKind, e: React.PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d) return;
    if (
      !d.moved &&
      Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_THRESHOLD
    )
      return;
    d.moved = true;
    const next = placeDrag(kind, d, e, false);
    if (next) (kind === "panel" ? setPanelPos : setIconPos)(next);
  }
  function endDrag(kind: DragKind, e: React.PointerEvent<HTMLElement>) {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    // The click that follows this pointerup must not toggle the panel.
    justDragged.current = true;
    setTimeout(() => (justDragged.current = false), 0);
    const next = placeDrag(kind, d, e, kind === "icon");
    if (next) {
      (kind === "panel" ? setPanelPos : setIconPos)(next);
      savePos(kind, next);
    }
  }

  // Restore the saved size after mount (not in useState init) to keep SSR and first client render identical.
  useEffect(() => {
    try {
      const saved: { w?: unknown; h?: unknown } = JSON.parse(
        localStorage.getItem(SIZE_KEY) ?? "{}",
      );
      const w =
        typeof saved.w === "number"
          ? Math.min(Math.max(saved.w, 260), window.innerWidth - 32)
          : undefined;
      const h =
        typeof saved.h === "number"
          ? Math.min(Math.max(saved.h, 160), window.innerHeight - 32)
          : undefined;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from localStorage after mount
      if (w || h) setSize({ w, h });
      if (localStorage.getItem(OPEN_KEY) === "0") setOpen(false);
      const pos: { panel?: Pos; icon?: Pos } = JSON.parse(
        localStorage.getItem(POS_KEY) ?? "{}",
      );
      const ok = (v: unknown): v is Pos =>
        typeof v === "object" &&
        v !== null &&
        typeof (v as Pos).left === "number" &&
        typeof (v as Pos).bottom === "number";
      if (ok(pos.panel)) setPanelPos(pos.panel);
      if (ok(pos.icon)) setIconPos(pos.icon);
    } catch {
      // storage unavailable or corrupt: keep default size
    }
  }, []);

  const loadRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const log: { messages?: ThreadMessage[] } = await (
          await fetch("/api/dev/visual-review/chat")
        ).json();
        if (!stop) setChatLog(log.messages ?? []);
      } catch {
        // chat endpoint unavailable: keep the last log
      }
      try {
        const sessions: { id: string; url?: string; createdAt?: string }[] =
          await (await fetch(`${endpoint}/sessions`)).json();
        const mine = sessions
          .filter((s) => {
            try {
              return new URL(s.url ?? "").pathname === path;
            } catch {
              return false;
            }
          })
          .sort((a, b) =>
            (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
          )[0];
        if (!mine) return;
        const session: { annotations?: ReviewAnnotation[] } = await (
          await fetch(`${endpoint}/sessions/${mine.id}`)
        ).json();
        if (!stop) setItems(session.annotations ?? []);
      } catch {
        // serwer niedostępny: panel zostaje z ostatnim stanem
      }
    }
    loadRef.current = load;
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [endpoint, path]);

  async function sendReply(id: string, content: string) {
    if (!content || sending) return;
    setSending(id);
    try {
      const headers = { "Content-Type": "application/json" };
      await fetch(`${endpoint}/annotations/${id}/thread`, {
        method: "POST",
        headers,
        body: JSON.stringify({ role: "human", content }),
      });
      await fetch(`${endpoint}/annotations/${id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: "pending" }),
      });
      setDrafts((d) => ({ ...d, [id]: "" }));
      await loadRef.current();
    } catch {
      // serwer niedostępny: szkic zostaje w polu
    } finally {
      setSending(null);
    }
  }
  useEffect(() => {
    sendRef.current = sendReply;
  });

  function reply(id: string) {
    return sendReply(id, (drafts[id] ?? "").trim());
  }

  async function accept(id: string) {
    if (sending) return;
    setSending(id);
    try {
      await fetch(`${endpoint}/annotations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "resolved" }),
      });
      await loadRef.current();
    } catch {
      // serwer niedostępny: status bez zmian
    } finally {
      setSending(null);
    }
  }

  function addImages(files: File[]) {
    const ok = files.filter((f) => /^image\/(png|jpeg|webp)$/.test(f.type));
    if (ok.length < files.length)
      setWakeInfo("Dozwolone obrazy: png, jpeg, webp.");
    setImages((prev) =>
      [
        ...prev,
        ...ok.map((file) => ({
          id: crypto.randomUUID(),
          file,
          url: URL.createObjectURL(file),
        })),
      ].slice(0, MAX_IMAGES),
    );
  }

  function removeImage(id: string) {
    setImages((prev) => {
      prev
        .filter((i) => i.id === id)
        .forEach((i) => URL.revokeObjectURL(i.url));
      return prev.filter((i) => i.id !== id);
    });
  }

  // Uploads the attached screenshots (dev route saves them in the OS temp dir) and returns Claude-readable path lines.
  async function uploadImages(): Promise<string> {
    const paths: string[] = [];
    for (const img of images) {
      const res = await fetch("/api/dev/visual-review/upload", {
        method: "POST",
        headers: { "Content-Type": img.file.type },
        body: img.file,
      });
      const body: { path?: string; error?: string } = await res
        .json()
        .catch(() => ({}));
      if (!res.ok || !body.path)
        throw new Error(body.error ?? "Nie udało się wysłać obrazu.");
      paths.push(body.path);
    }
    return paths.map((p) => `[Załączony obraz: ${p}]`).join("\n");
  }

  async function wakeClaude(typed?: string) {
    if (busy) return;
    setWaking(true);
    setWakeInfo(null);
    const sentAt = Date.now();
    try {
      let message = typed;
      if (images.length > 0) {
        const attached = await uploadImages();
        message = [typed?.trim(), attached].filter(Boolean).join("\n");
      }
      const res = await fetch("/api/dev/visual-review/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message ? { message } : {}),
      });
      const body: { error?: string } = await res.json().catch(() => ({}));
      if (res.ok) setBusySince(sentAt);
      setWakeInfo(
        res.ok ? "Wysłano do Claude." : (body.error ?? "Nie udało się wysłać."),
      );
      if (res.ok && message) {
        setChat("");
        images.forEach((i) => URL.revokeObjectURL(i.url));
        setImages([]);
        await loadRef.current();
      }
    } catch (err) {
      setWakeInfo(err instanceof Error ? err.message : "Nie udało się wysłać.");
    } finally {
      setWaking(false);
    }
  }

  // Claude answered after the request: a chat reply or a new agent message in any annotation thread.
  const answered =
    busySince !== null &&
    (chatLog.some((m) => m.role === "agent" && m.timestamp >= busySince) ||
      items.some((a) =>
        a.thread?.some((m) => m.role === "agent" && m.timestamp >= busySince),
      ));
  useEffect(() => {
    if (busySince === null) return;
    const left = busySince + BUSY_TIMEOUT_MS - Date.now();
    const timer = setTimeout(() => setBusySince(null), Math.max(left, 0));
    return () => clearTimeout(timer);
  }, [busySince]);
  const busy = waking || (busySince !== null && !answered);

  const pendingCount = items.filter(
    (a) => (a.status ?? "pending") === "pending",
  ).length;
  const withActivity = items.filter(
    (a) => (a.status && a.status !== "pending") || (a.thread?.length ?? 0) > 0,
  );

  return (
    <div data-vr-root style={{ display: "contents" }}>
      <style>{`
        @keyframes vr-in { from { opacity: 0; transform: scale(0.4); } to { opacity: 1; transform: scale(1); } }
        @keyframes vr-out { from { opacity: 1; transform: scale(1); } to { opacity: 0; transform: scale(0.4); } }
        .vr-in { animation: vr-in 200ms ease-out; transform-origin: bottom left; }
        .vr-out { animation: vr-out 180ms ease-in forwards; transform-origin: bottom left; }
        @media (prefers-reduced-motion: reduce) { .vr-in, .vr-out { animation-duration: 1ms; } }
      `}</style>
      {!open ? (
        <button
          type="button"
          onClick={() => {
            if (!justDragged.current) toggleOpen();
          }}
          onPointerDown={(e) => startDrag("icon", e)}
          onPointerMove={(e) => moveDrag("icon", e)}
          onPointerUp={(e) => endDrag("icon", e)}
          onPointerCancel={() => (drag.current = null)}
          data-feedback-toolbar=""
          aria-label="Otwórz rozmowę z Claude"
          title={`Claude (${withActivity.length})${pendingCount > 0 ? `, do wysłania: ${pendingCount}` : ""}`}
          style={{
            ...PALETTES[theme],
            left: iconPos.left,
            bottom: iconPos.bottom,
          }}
          className="vr-in touch-none !cursor-grab active:!cursor-grabbing fixed z-[2147483000] flex size-11 items-center justify-center rounded-full border border-border bg-surface-raised text-text-primary shadow-lg"
        >
          {busy ? (
            <Spinner />
          ) : (
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
            </svg>
          )}
          {pendingCount > 0 ? (
            <span
              aria-label={`Adnotacje do wysłania: ${pendingCount}`}
              title={`Adnotacje do wysłania: ${pendingCount}`}
              className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#0a84ff] px-1 text-xs font-medium leading-none text-white"
            >
              {pendingCount}
            </span>
          ) : null}
        </button>
      ) : null}
      <aside
        ref={asideRef}
        style={{
          ...PALETTES[theme],
          width: size.w,
          height: open ? size.h : undefined,
          left: panelPos.left,
          bottom: panelPos.bottom,
        }}
        aria-label="Rozmowa z Claude"
        // Agentation w trybie adnotacji przechwytuje kliknięcia na całej stronie; ten atrybut wyłącza dla panelu
        // zaznaczanie elementów (jak dla własnego toolbara), a select-text przywraca pisanie przy `user-select: none` na body.
        // Agentation ustawia `body { cursor: crosshair !important }`; klasy `!cursor-*` przywracają zwykły kursor na całym panelu.
        data-feedback-toolbar=""
        className={`${open ? (leaving ? "vr-out" : "vr-in") : "hidden"} !cursor-default select-text [&_*]:!cursor-default [&_button]:!cursor-pointer [&_button:disabled]:!cursor-not-allowed [&_input]:!cursor-text [&_textarea]:!cursor-text[&_[data-resize=x]]:!cursor-ew-resize [&_[data-resize=y]]:!cursor-ns-resize [&_[data-resize=xy]]:!cursor-nesw-resize [&_*:focus-visible]:!outline-2 [&_*:focus-visible]:!outline-offset-2 [&_*:focus-visible]:!outline-[#0a84ff] flex flex-col fixed z-[2147483000] w-80 max-w-[calc(100vw-2rem)] rounded-[20px] border border-border bg-surface-raised text-body-sm text-text-primary shadow-lg`}
      >
        {/* Collapsed panel is just the header bar: no height to resize, so only the width handle stays. */}
        {(
          [
            ["x", "absolute -right-1 top-3 bottom-3 w-2"],
            ["y", "absolute -top-1 left-3 right-3 h-2"],
            ["xy", "absolute -right-1 -top-1 h-3 w-3"],
          ] as const
        )
          .filter(([axis]) => open || axis === "x")
          .map(([axis, cls]) => (
            <div
              key={axis}
              data-resize={axis}
              aria-hidden
              className={`${cls} touch-none`}
              onPointerDown={startResize}
              onPointerMove={moveResize}
              onPointerUp={endResize}
              onPointerCancel={endResize}
            />
          ))}
        <button
          type="button"
          onClick={() => {
            if (!justDragged.current) toggleOpen();
          }}
          onPointerDown={(e) => startDrag("panel", e)}
          onPointerMove={(e) => moveDrag("panel", e)}
          onPointerUp={(e) => endDrag("panel", e)}
          onPointerCancel={() => (drag.current = null)}
          className="flex w-full touch-none !cursor-grab active:!cursor-grabbing items-center justify-between rounded-t-[20px] bg-surface-raised px-4 text-text-primary py-3 font-medium"
        >
          <span className="flex items-center gap-2">
            Claude ({withActivity.length}){busy ? <Spinner /> : null}
          </span>
          <span aria-hidden>{open ? "–" : "+"}</span>
        </button>
        {open ? (
          <div className="flex items-center gap-2 border-t border-border bg-surface-raised p-4">
            <button
              type="button"
              disabled={busy || pendingCount === 0}
              onClick={() => void wakeClaude()}
              className={`rounded-xl border px-3 py-1.5 font-medium disabled:opacity-50 ${pendingCount > 0 && !busy ? "border-[#0a84ff] bg-[#0a84ff] text-white" : "border-border bg-page"}`}
            >
              Sprawdź adnotacje ({pendingCount})
            </button>
            {busy ? (
              <span
                role="status"
                className="flex items-center gap-2 text-text-secondary"
              >
                <Spinner /> Claude przetwarza…
                <button
                  type="button"
                  onClick={() => {
                    setBusySince(null);
                    setWaking(false);
                  }}
                  className="rounded-xl border border-border bg-page px-2 py-0.5 text-text-secondary"
                >
                  Anuluj
                </button>
              </span>
            ) : wakeInfo ? (
              <span className="text-text-secondary">{wakeInfo}</span>
            ) : null}
          </div>
        ) : null}
        {open ? (
          <ul
            ref={listRef}
            className={`flex min-h-0 flex-col gap-3 overflow-y-auto border-t border-border p-4 ${size.h ? "flex-1" : "max-h-80"}`}
          >
            {withActivity.map((a) => {
              const thread = a.thread ?? [];
              const inReview =
                a.status === "acknowledged" &&
                thread[thread.length - 1]?.role === "agent";
              const statusKey = inReview ? "review" : (a.status ?? "pending");
              return (
                <li key={a.id} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-text-secondary">
                      {a.element ?? a.comment}
                    </span>
                    <span className="shrink-0 rounded-xl border border-border bg-page px-2 py-0.5 text-xs">
                      {STATUS_LABEL[statusKey] ?? a.status}
                    </span>
                  </div>
                  <p className="text-text-secondary">„{a.comment}”</p>
                  {(a.thread ?? []).map((m) => (
                    <p
                      key={m.id}
                      className={
                        m.role === "agent"
                          ? "rounded-xl bg-surface-selected px-3 py-1.5"
                          : "px-2 text-text-secondary"
                      }
                    >
                      <strong>{m.role === "agent" ? "Claude" : "Ty"}:</strong>{" "}
                      {m.content}
                    </p>
                  ))}
                  <form
                    className="flex gap-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void reply(a.id);
                    }}
                  >
                    <input
                      value={drafts[a.id] ?? ""}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [a.id]: e.target.value }))
                      }
                      placeholder={inReview ? "Co poprawić?" : "Odpisz Claude…"}
                      aria-label="Odpowiedź do Claude"
                      className="min-w-0 flex-1 rounded-xl border border-border bg-surface-selected px-3 py-2 focus:!outline-2 focus:!outline-offset-2 focus:!outline-[#0a84ff] focus:!rounded-xl focus:!border-transparent"
                    />
                    <button
                      type="submit"
                      disabled={sending === a.id}
                      className="shrink-0 rounded-xl border border-border bg-page px-3 py-1.5 font-medium"
                    >
                      {inReview ? "Popraw" : "Wyślij"}
                    </button>
                  </form>
                  {inReview ? (
                    <button
                      type="button"
                      disabled={sending === a.id}
                      onClick={() => void accept(a.id)}
                      className="rounded-xl border border-border bg-page px-3 py-1.5 font-medium"
                    >
                      Zaakceptuj
                    </button>
                  ) : null}
                </li>
              );
            })}
            {chatLog.map((m) => (
              <li
                key={m.id}
                className={
                  m.role === "agent"
                    ? "rounded-xl bg-surface-selected px-3 py-1.5"
                    : "px-2 text-text-secondary"
                }
              >
                <strong>{m.role === "agent" ? "Claude" : "Ty"}:</strong>{" "}
                <span className="whitespace-pre-wrap break-words">
                  {m.content}
                </span>
                {m.role === "agent" && m.contextLeft !== undefined ? (
                  <span
                    className="mt-1 block text-[10px] text-text-secondary"
                    title="Wolny kontekst sesji Claude w chwili odpowiedzi"
                  >
                    kontekst: {m.contextLeft}% wolne
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {open ? (
          <form
            className="flex items-end gap-2 rounded-b-[20px] border-t border-border bg-surface-raised p-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (chat.trim() || images.length > 0) void wakeClaude(chat);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              addImages(Array.from(e.dataTransfer.files));
            }}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {images.length > 0 ? (
                <ul className="flex flex-wrap gap-1">
                  {images.map((img) => (
                    <li key={img.id} className="relative">
                      <img
                        src={img.url}
                        alt="Załącznik"
                        className="size-12 rounded-xl border border-border object-cover"
                      />
                      <button
                        type="button"
                        aria-label="Usuń obraz"
                        onClick={() => removeImage(img.id)}
                        className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full border border-border bg-surface-raised leading-none"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <textarea
                value={chat}
                onChange={(e) => setChat(e.target.value)}
                onPaste={(e) => {
                  const files = Array.from(e.clipboardData.files);
                  if (files.length > 0) {
                    e.preventDefault();
                    addImages(files);
                  }
                }}
                onKeyDown={(e) => {
                  // Enter sends, Shift+Enter inserts a newline (the server keeps newlines and indentation).
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    if ((chat.trim() || images.length > 0) && !busy)
                      void wakeClaude(chat);
                  }
                }}
                rows={3}
                placeholder="Napisz do Claude…"
                aria-label="Wiadomość do Claude"
                className="min-w-0 flex-1 resize-y rounded-xl border border-border bg-surface-selected px-3 py-2 focus:!outline-2 focus:!outline-offset-2 focus:!outline-[#0a84ff] focus:!rounded-xl focus:!border-transparent"
              />
            </div>
            <div className="flex shrink-0 flex-col gap-1">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                hidden
                onChange={(e) => {
                  addImages(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                aria-label="Dołącz obraz"
                title="Dołącz obraz (lub wklej Ctrl+V / przeciągnij)"
                disabled={busy || images.length >= MAX_IMAGES}
                onClick={() => fileRef.current?.click()}
                className="rounded-xl border border-border bg-page px-3 py-1.5 disabled:opacity-50"
              >
                Obraz
              </button>
              <button
                type="submit"
                disabled={busy || (!chat.trim() && images.length === 0)}
                className="shrink-0 rounded-xl border border-border bg-page px-3 py-1.5 font-medium disabled:opacity-50"
              >
                Wyślij
              </button>
            </div>
          </form>
        ) : null}
      </aside>
      {markerBtns.map((b) => (
        <div
          key={b.id}
          data-feedback-toolbar=""
          style={{ ...PALETTES[theme], left: b.x - 8, top: b.y - 8 }}
          className="pointer-events-none fixed z-[2147483000] flex items-start gap-1"
          onMouseEnter={() => hoverOn(b.id)}
          onMouseLeave={hoverOff}
        >
          {/* Attention badge: "?" = Claude asked a question, "✓" = ready for your approval. */}
          <span
            role="img"
            aria-label={
              b.kind === "question"
                ? "Claude czeka na Twoją odpowiedź"
                : "Do zaakceptowania"
            }
            title={
              b.kind === "question"
                ? "Claude czeka na Twoją odpowiedź"
                : "Do zaakceptowania"
            }
            className="pointer-events-auto flex size-4 items-center justify-center rounded-full border border-white bg-amber-500 text-[10px] font-bold leading-none text-white shadow"
          >
            {b.kind === "question" ? "?" : "✓"}
          </span>
          {b.kind === "review" && hoverId === b.id ? (
            <button
              type="button"
              disabled={sending === b.id}
              onClick={() => void accept(b.id)}
              className="!cursor-pointer pointer-events-auto ml-1 mt-1 rounded-xl border border-border bg-surface-raised px-2 py-1 text-body-sm font-medium text-text-primary shadow-lg disabled:opacity-50"
            >
              Zaakceptuj
            </button>
          ) : null}
        </div>
      ))}
      {cardHost
        ? createPortal(
            <div
              style={{
                padding: "8px 12px 12px",
                font: "13px/1.4 system-ui, sans-serif",
                // Explicit colours from the Agentation theme: inheriting would pick up the app's (possibly opposite) theme.
                color: PALETTES[theme]["--text-primary"],
              }}
            >
              {/* Feedback mode sets a crosshair cursor on everything; override it inside our own block. */}
              <style>{`[data-vr-question], [data-vr-question] * { cursor: default !important; }`}</style>
              <div
                ref={(el) => {
                  if (el) el.scrollTop = el.scrollHeight;
                }}
                style={{
                  maxHeight: 200,
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                {cardHost.messages.map((m, i) => (
                  <div
                    key={i}
                    style={{
                      whiteSpace: "pre-wrap",
                      padding: "4px 8px",
                      borderRadius: 6,
                      background:
                        theme === "dark"
                          ? m.who === "Claude"
                            ? "rgba(255,255,255,0.14)"
                            : "rgba(255,255,255,0.07)"
                          : m.who === "Claude"
                            ? "rgba(0,0,0,0.1)"
                            : "rgba(0,0,0,0.05)",
                    }}
                  >
                    <b>{m.who}:</b> {m.text}
                  </div>
                ))}
              </div>
              {!cardHost.editing ? (
                <div style={{ opacity: 0.6, margin: "6px 0" }}>
                  Kliknij znacznik, by odpowiedzieć.
                </div>
              ) : null}
            </div>,
            cardHost.el,
          )
        : null}
    </div>
  );
}

// `path` empty = toolbar on every page; panel then follows the current route (SPA navigation).
export function VisualReview({
  endpoint,
  path,
}: {
  endpoint: string;
  path?: string;
}) {
  const { pathname } = useLocation();
  if (path && pathname !== path) return null;
  return (
    <>
      <Agentation endpoint={endpoint} />
      <AgentReplies endpoint={endpoint} path={pathname} />
    </>
  );
}

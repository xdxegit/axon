import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Bot,
  BookOpen,
  BrainCircuit,
  Check,
  ChevronDown,
  Copy,
  Cpu,
  AlertCircle,
  Download,
  Eraser,
  FileText,
  Image as ImageIcon,
  Info,
  KeyRound,
  Loader2,
  MessageSquarePlus,
  Minus,
  Moon,
  Paperclip,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Send,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  Sun,
  Terminal,
  Trash2,
  Wand2,
  X
} from "lucide-react";
import mammoth from "mammoth";
import "./styles.css";

const STORAGE_KEY = "axon:v1";
const PROVIDER_GUIDE_KEY = "axon:provider-guide-seen";
const NICKNAME_KEY = "axon:nickname";

const welcomeMessage = {
  role: "assistant",
  content: "Готов к работе. Выберите модель OmniRoute и отправьте первый запрос."
};

const defaultState = {
  settings: {
    baseUrl: "http://localhost:20128/v1",
    apiKey: "",
    model: "github/gpt-5-mini",
    temperature: 0.6,
    maxTokens: 1600,
    systemPrompt: "Ты полезный, точный и дружелюбный AI-ассистент."
  },
  messages: [welcomeMessage],
  contextStartIndex: 0,
  theme: "dark"
};

function loadInitialState() {
  try {
    const legacy = JSON.parse(localStorage.getItem("omniroute-studio:v2")) ||
                   JSON.parse(localStorage.getItem("omniroute-studio:v1"));
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || legacy;
    const messages =
      Array.isArray(saved?.messages) && saved.messages.length ? saved.messages : defaultState.messages;

    return {
      settings: { ...defaultState.settings, ...saved?.settings },
      messages,
      contextStartIndex: Number(saved?.contextStartIndex || 0),
      theme: saved?.theme === "light" ? "light" : "dark"
    };
  } catch {
    return defaultState;
  }
}

function persist(next) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

function cls(...parts) {
  return parts.filter(Boolean).join(" ");
}

function getChatModels(modelList) {
  return modelList.filter((model) => model?.id && model.type !== "embedding");
}

// Map raw OmniRoute provider prefixes to human-friendly provider names shown in parens.
const PROVIDER_LABELS = {
  kr: "Kiro AI",
  kiro: "Kiro AI",
  github: "GitHub Models",
  gh: "GitHub Models",
  copilot: "GitHub Copilot",
  openai: "OpenAI",
  oai: "OpenAI",
  anthropic: "Anthropic",
  claude: "Anthropic",
  google: "Google",
  gemini: "Google",
  vertex: "Google Vertex",
  groq: "Groq",
  mistral: "Mistral",
  meta: "Meta",
  llama: "Meta",
  xai: "xAI",
  grok: "xAI",
  deepseek: "DeepSeek",
  qwen: "Alibaba Qwen",
  cohere: "Cohere",
  perplexity: "Perplexity",
  pplx: "Perplexity",
  openrouter: "OpenRouter",
  azure: "Azure OpenAI",
  bedrock: "AWS Bedrock",
  aws: "AWS Bedrock",
  ollama: "Ollama",
  lmstudio: "LM Studio",
  together: "Together AI",
  fireworks: "Fireworks AI",
  replicate: "Replicate"
};

// Words that should keep specific casing (acronyms, brand names) when we title-case a model id.
const SPECIAL_CASING = {
  gpt: "GPT",
  llm: "LLM",
  ai: "AI",
  ui: "UI",
  api: "API",
  hd: "HD",
  xl: "XL",
  lts: "LTS",
  rc: "RC",
  mini: "Mini",
  nano: "Nano",
  pro: "Pro",
  ultra: "Ultra",
  flash: "Flash",
  haiku: "Haiku",
  sonnet: "Sonnet",
  opus: "Opus",
  turbo: "Turbo",
  vision: "Vision",
  instruct: "Instruct",
  chat: "Chat",
  thinking: "Thinking",
  reasoning: "Reasoning",
  preview: "Preview",
  exp: "Exp",
  experimental: "Experimental",
  claude: "Claude",
  gemini: "Gemini",
  llama: "Llama",
  mistral: "Mistral",
  mixtral: "Mixtral",
  grok: "Grok",
  qwen: "Qwen",
  deepseek: "DeepSeek",
  phi: "Phi",
  command: "Command",
  embed: "Embed",
  o1: "o1",
  o2: "o2",
  o3: "o3",
  o4: "o4"
};

function prettifyModelToken(token) {
  if (!token) return "";
  const lower = token.toLowerCase();
  if (SPECIAL_CASING[lower]) return SPECIAL_CASING[lower];
  // Pure version numbers like "4.7", "3.5" pass through unchanged.
  if (/^\d+(\.\d+)*$/.test(token)) return token;
  // Mixed alpha+numeric like "gpt5", "claude4", "v3": split alpha vs digits.
  // Short prefixes (v, o, r, etc.) stay glued ("V3"); longer brand names get a space ("GPT 5"),
  // which a later post-pass may rewrite to "GPT-5".
  const mix = /^([a-z]+)(\d.*)$/i.exec(token);
  if (mix) {
    const head = mix[1].toLowerCase();
    const pretty = SPECIAL_CASING[head] || head.charAt(0).toUpperCase() + head.slice(1);
    const sep = head.length <= 2 ? "" : " ";
    return pretty + sep + mix[2];
  }
  return token.charAt(0).toUpperCase() + token.slice(1);
}

// Turn raw OmniRoute ids like "kr/claude-opus-4.7" into "Claude Opus 4.7 (Kiro AI)".
// Unknown providers still render the model nicely; "auto" stays as-is.
function formatModelName(rawId) {
  if (!rawId) return "auto";
  if (rawId === "auto") return "Auto";

  const id = String(rawId).trim();
  const slashIdx = id.indexOf("/");

  let providerKey = "";
  let modelPart = id;
  if (slashIdx >= 0) {
    providerKey = id.slice(0, slashIdx).toLowerCase();
    modelPart = id.slice(slashIdx + 1);
  }

  const rawTokens = modelPart.split(/[-_\s]+/).filter(Boolean);

  // Pre-pass: join consecutive single-digit numeric tokens into a dotted version,
  // so "claude-3-5-sonnet" → ["claude","3.5","sonnet"] before prettification.
  const joinedTokens = [];
  for (let i = 0; i < rawTokens.length; i++) {
    const t = rawTokens[i];
    const next = rawTokens[i + 1];
    if (/^\d$/.test(t) && next && /^\d$/.test(next)) {
      joinedTokens.push(`${t}.${next}`);
      i++;
    } else {
      joinedTokens.push(t);
    }
  }

  const pretty = joinedTokens
    .map(prettifyModelToken)
    .join(" ")
    // "GPT 5" / "GPT 4o" → "GPT-5" / "GPT-4o" — the canonical brand spelling.
    .replace(/\bGPT\s+(\d)/g, "GPT-$1")
    // "Claude 4" / "Claude 4.7" stays with a space — matches Anthropic's own naming.
    .replace(/\s+/g, " ")
    .trim();

  const providerLabel = PROVIDER_LABELS[providerKey];
  if (providerLabel) return `${pretty} (${providerLabel})`;
  if (providerKey) return `${pretty} (${providerKey})`;
  return pretty;
}

// ── Attachments ──────────────────────────────────────────────────────────────
// Limits chosen to stay well under typical provider request size caps. Images get
// base64-encoded so 4 MB of raw bytes becomes ~5.4 MB of payload per image; docx
// text is unbounded in the file but we cap extracted text at ~120 K chars (~30 K
// tokens) before splitting / truncating with an explicit notice.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;     // 4 MB per image
const MAX_DOCX_BYTES  = 25 * 1024 * 1024;    // 25 MB per docx file
const MAX_DOCX_CHARS  = 120_000;             // hard cap on extracted text per file
const ACCEPTED_IMAGE_MIME = /^image\/(png|jpe?g|gif|webp|bmp|svg\+xml)$/i;

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function isDocxFile(file) {
  if (!file) return false;
  if (file.name?.toLowerCase().endsWith(".docx")) return true;
  return file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

function isImageFile(file) {
  if (!file) return false;
  if (file.type && ACCEPTED_IMAGE_MIME.test(file.type)) return true;
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name || "");
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

// Downscale large screenshots before encoding to dataUrl. Many providers cap
// per-image bytes around 5 MB and downscale internally — doing it here keeps
// the request body small and avoids 413/400 errors from OmniRoute or whichever
// backend it routes to. SVGs and animated GIFs are left untouched.
async function loadImageBitmap(file) {
  // SVG / GIF: skip downscale entirely — preserves vector / animation.
  if (/svg|gif/i.test(file.type)) return null;
  try {
    return await createImageBitmap(file);
  } catch {
    return null;
  }
}

async function fileToCompactDataUrl(file, maxEdge = 1600, jpegQuality = 0.85) {
  const bitmap = await loadImageBitmap(file);
  if (!bitmap) return readFileAsDataURL(file);

  const { width, height } = bitmap;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);

  // ALWAYS re-encode through canvas to JPEG. PNGs passed through verbatim sometimes
  // get mangled by OmniRoute's PNG→Anthropic MIME-translation step: the request
  // arrives at Claude, tokens are billed for it, but the image content silently
  // becomes "unavailable" in the model's view. JPEG round-trip dodges the bug.
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  // Transparent PNGs would otherwise turn black on a JPEG; paint a white floor.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", jpegQuality);
}

// Crude vision-capability hint based on the model id. Used only to warn the user
// — we don't block sending. Models in OmniRoute can be arbitrary; this is a
// best-effort heuristic, returning true (assume vision) when we're not sure.
function isLikelyVisionModel(modelId) {
  if (!modelId || modelId === "auto") return true;
  const id = modelId.toLowerCase();
  // These OmniRoute provider routes advertise image input in /v1/models, but
  // data-URI images currently arrive at the backend as "(unavailable)".
  // Keep this conservative and route image requests through known-good Gemini
  // variants instead of letting the user burn a request on a blind model.
  if (/^(kr|kiro|gh|github)\//.test(id)) return false;
  if (/^antigravity\/claude/.test(id)) return false;
  if (/(vision|vl\b|multimodal|image)/.test(id)) return true;
  if (/claude-(3|4|5|6|7|opus|sonnet|haiku)/.test(id)) return true;
  if (/gpt-?(4o|5|5-mini|5-nano|4\.\d|4-turbo)/.test(id)) return true;
  if (/gemini-?(1\.5|2|2\.5|3)/.test(id)) return true;
  if (/grok-?(2|3|4|vision)/.test(id)) return true;
  if (/pixtral|llava|qwen.*-?vl/.test(id)) return true;
  // Text-only families we know about.
  if (/(^|\/)(o1|o3|o4)(-|$)/.test(id)) return false;
  if (/-embed|-tts|whisper|-instruct(?!-vision)/.test(id)) return false;
  if (/gpt-3\.5/.test(id)) return false;
  return true; // err on the side of trusting the user
}

function isKnownWorkingImageRoute(modelId) {
  const id = String(modelId || "").toLowerCase();
  return /^antigravity\/gemini-3-flash-preview$/.test(id);
}

function pickImageRoute(modelId, availableModels = []) {
  if (isKnownWorkingImageRoute(modelId)) return modelId;

  const ids = availableModels.map((model) => model?.id).filter(Boolean);
  const priority = [
    "antigravity/gemini-3-flash-preview",
    "antigravity/gemini-3.1-flash-image",
    "antigravity/gemini-3-pro-image-preview",
    "github/gemini-3-flash-preview",
    "gh/gemini-3-flash-preview"
  ];

  return priority.find((id) => ids.includes(id)) || ids.find((id) => /gemini.*flash/i.test(id)) || modelId;
}

async function extractDocxText(file) {
  const arrayBuffer = await file.arrayBuffer();
  const { value } = await mammoth.extractRawText({ arrayBuffer });
  const clean = (value || "").replace(/\u0000/g, "").trim();
  if (clean.length > MAX_DOCX_CHARS) {
    return clean.slice(0, MAX_DOCX_CHARS) + `\n\n[…усечено: показано ${MAX_DOCX_CHARS} из ${clean.length} символов]`;
  }
  return clean;
}

// Process raw File objects from the OS into renderer-friendly attachment records.
// Returns { ok: [...], errors: [...] } so the caller can toast each error.
async function buildAttachmentsFromFiles(files, idGen) {
  const ok = [];
  const errors = [];
  for (const file of files) {
    try {
      if (isImageFile(file)) {
        if (file.size > MAX_IMAGE_BYTES) {
          errors.push(`Картинка "${file.name}" слишком большая (${formatBytes(file.size)}). Максимум ${formatBytes(MAX_IMAGE_BYTES)}.`);
          continue;
        }
        const dataUrl = await fileToCompactDataUrl(file);
        ok.push({
          id: idGen(),
          type: "image",
          name: file.name || "screenshot.png",
          size: file.size,
          mime: file.type || "image/png",
          dataUrl
        });
      } else if (isDocxFile(file)) {
        if (file.size > MAX_DOCX_BYTES) {
          errors.push(`DOCX "${file.name}" слишком большой (${formatBytes(file.size)}). Максимум ${formatBytes(MAX_DOCX_BYTES)}.`);
          continue;
        }
        const text = await extractDocxText(file);
        ok.push({
          id: idGen(),
          type: "docx",
          name: file.name,
          size: file.size,
          text,
          chars: text.length
        });
      } else {
        errors.push(`Файл "${file.name || "без имени"}" не поддерживается. Можно прикреплять только DOCX и картинки.`);
      }
    } catch (e) {
      errors.push(`Не удалось прочитать "${file.name}": ${e?.message || e}`);
    }
  }
  return { ok, errors };
}

// Compose the OpenAI chat completion `content` for a single user message that
// may carry attachments. Returns a plain string when there are no images (max
// provider compatibility) and a multi-modal content array when at least one
// image is attached. DOCX text always gets inlined into a leading text part.
function composeUserContent(text, attachments) {
  const images = attachments.filter((a) => a.type === "image");
  const docs   = attachments.filter((a) => a.type === "docx");

  let combined = text || "";
  if (docs.length) {
    const docBlocks = docs.map((d) => `--- Прикреплённый документ: ${d.name} ---\n${d.text}\n--- Конец документа ---`);
    combined = [...docBlocks, combined].filter(Boolean).join("\n\n");
  }

  if (!images.length) return combined;

  // Multimodal — leading text part (with all docx contents) + each image.
  // `detail: "auto"` is OpenAI's vision spec — some backends require it explicitly
  // (Anthropic/Gemini behind OmniRoute) instead of treating it as the default.
  const parts = [{ type: "text", text: combined || " " }];
  for (const img of images) {
    parts.push({ type: "image_url", image_url: { url: img.dataUrl, detail: "auto" } });
  }
  return parts;
}

function getSetupDemoState() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("setupDemo");
  if (!mode) return null;

  const states = {
    missingNode: {
      bootstrap: { localReady: false, nodeAvailable: false, npmAvailable: false, omniRouteAvailable: false },
      busy: "",
      log: ""
    },
    missingOmniRoute: {
      bootstrap: { localReady: false, nodeAvailable: true, npmAvailable: true, omniRouteAvailable: false },
      busy: "",
      log: ""
    },
    installingOmniRoute: {
      bootstrap: { localReady: false, nodeAvailable: true, npmAvailable: true, omniRouteAvailable: false },
      busy: "Установка OmniRoute",
      log: "npm install -g omniroute@3.7.7\nDownloading package metadata...\nInstalling OmniRoute CLI..."
    },
    ready: {
      bootstrap: { localReady: true, nodeAvailable: true, npmAvailable: true, omniRouteAvailable: true },
      busy: "",
      log: "OmniRoute установлен и локальный API отвечает на http://localhost:20128/v1/models"
    }
  };

  return states[mode] || null;
}

function App() {
  const initial = useMemo(loadInitialState, []);
  const setupDemo = useMemo(getSetupDemoState, []);
  const [settings, setSettings] = useState(initial.settings);
  const [messages, setMessages] = useState(initial.messages);
  const [contextStartIndex, setContextStartIndex] = useState(initial.contextStartIndex);
  const [theme, setTheme] = useState(initial.theme);
  const [draft, setDraft] = useState("");
  const [models, setModels] = useState([]);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bootstrap, setBootstrap] = useState(setupDemo?.bootstrap || null);
  const [bootstrapBusy, setBootstrapBusy] = useState(setupDemo?.busy || "");
  const [bootstrapLog, setBootstrapLog] = useState(setupDemo?.log || "");
  const [setupDismissed, setSetupDismissed] = useState(false);
  const [providerGuideOpen, setProviderGuideOpen] = useState(
    () => localStorage.getItem(PROVIDER_GUIDE_KEY) !== "true"
  );
  const [aboutOpen, setAboutOpen] = useState(false);
  const [logsPath, setLogsPath] = useState("");
  const [status, setStatus] = useState("Готово");
  const [claudeBusy, setClaudeBusy] = useState(false);
  const [claudeAvailable, setClaudeAvailable] = useState(true);
  const [isMaximized, setIsMaximized] = useState(false);
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);

  // Nickname — persisted across sessions. `null` triggers the first-run welcome
  // modal. After save it gets injected into the system prompt so the model
  // addresses the user by name.
  const [nickname, setNickname] = useState(() => {
    const stored = localStorage.getItem(NICKNAME_KEY);
    return stored ? stored.trim() : null;
  });
  const [nicknameDraft, setNicknameDraft] = useState("");
  // The welcome modal only shows on the very first run (no value stored).
  const [welcomeOpen, setWelcomeOpen] = useState(() => !localStorage.getItem(NICKNAME_KEY));

  function saveNickname(value) {
    const cleaned = (value || "").trim().slice(0, 40);
    if (cleaned) {
      localStorage.setItem(NICKNAME_KEY, cleaned);
      setNickname(cleaned);
    } else {
      localStorage.removeItem(NICKNAME_KEY);
      setNickname(null);
    }
  }

  function finishWelcome() {
    saveNickname(nicknameDraft);
    setWelcomeOpen(false);
  }

  function skipWelcome() {
    // Mark the welcome as seen even when skipped, so we don't nag on every launch.
    if (!localStorage.getItem(NICKNAME_KEY)) {
      localStorage.setItem(NICKNAME_KEY, "");
    }
    setWelcomeOpen(false);
  }

  // Attachments staged for the next outgoing message. Cleared after send.
  // Each item: { id, type: 'image'|'docx', name, size, dataUrl?, text?, chars? }.
  const [attachments, setAttachments] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const attachmentIdRef = useRef(0);
  const nextAttachmentId = () => ++attachmentIdRef.current;

  // Centralised entry point for any incoming files (picker, drop, paste). Reads
  // them in parallel via buildAttachmentsFromFiles and toasts per-file failures.
  async function addFiles(fileList) {
    const files = Array.from(fileList || []).filter(Boolean);
    if (!files.length) return;
    const { ok, errors } = await buildAttachmentsFromFiles(files, nextAttachmentId);
    if (ok.length) setAttachments((prev) => [...prev, ...ok]);
    for (const msg of errors) pushToast(msg, "error");
  }

  function removeAttachment(id) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  function clearAttachments() {
    setAttachments([]);
  }

  // Toast queue. Use `pushToast(text, type?)` where type ∈ {info, error, success}.
  // Errors auto-dismiss after 7s, others after 4s. Click any toast to dismiss it manually.
  function pushToast(text, type = "info") {
    if (!text) return;
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, text, type }]);
    const ttl = type === "error" ? 7000 : 4000;
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, ttl);
  }

  function dismissToast(id) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  // Subscribe to native maximize/unmaximize so the maximize/restore icon stays in sync.
  useEffect(() => {
    if (!window.winctl?.onMaximizedChange) return;
    window.winctl.isMaximized().then(setIsMaximized).catch(() => {});
    return window.winctl.onMaximizedChange(setIsMaximized);
  }, []);

  // Pre-check whether the Claude Code CLI is installed so we can disable the launch
  // button (with a helpful tooltip) instead of throwing a "remote method" error
  // when the user clicks it.
  useEffect(() => {
    if (!window.omni?.claudeCheck) return;
    window.omni.claudeCheck()
      .then((r) => setClaudeAvailable(Boolean(r?.available)))
      .catch(() => setClaudeAvailable(false));
  }, []);

  // Fetch the userData path once so we can render it inside About — saves users
  // from manually figuring out where %APPDATA%\Axon\axon-main.log actually lives.
  useEffect(() => {
    if (!window.omni?.logsPath) return;
    window.omni.logsPath()
      .then((r) => { if (r?.ok && r.path) setLogsPath(r.path); })
      .catch(() => {});
  }, []);

  // Forward main-process toasts (background events like the OmniRoute auto-pin
  // downgrade) through the same toast UI the renderer uses for its own errors.
  // Errors get longer TTL (7s) via pushToast's internal switch — matches renderer
  // semantics so users have time to read failure details.
  useEffect(() => {
    if (!window.omni?.onAppToast) return;
    return window.omni.onAppToast(({ type, text }) => {
      if (text) pushToast(text, type || "info");
    });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    refreshBootstrapStatus();
  }, []);

  function saveAppState(nextState) {
    const merged = {
      settings,
      messages,
      contextStartIndex,
      theme,
      ...nextState
    };
    persist(merged);
  }

  function saveSettings(nextSettings) {
    setSettings(nextSettings);
    saveAppState({ settings: nextSettings });
  }

  function saveMessages(nextMessages, nextContextStartIndex = contextStartIndex) {
    setMessages(nextMessages);
    setContextStartIndex(nextContextStartIndex);
    saveAppState({ messages: nextMessages, contextStartIndex: nextContextStartIndex });
  }

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    saveAppState({ theme: nextTheme });
  }

  function closeProviderGuide() {
    localStorage.setItem(PROVIDER_GUIDE_KEY, "true");
    setProviderGuideOpen(false);
  }

  async function refreshBootstrapStatus() {
    if (setupDemo) return;
    if (!window.omni?.bootstrapStatus) return;

    try {
      const nextStatus = await window.omni.bootstrapStatus();
      setBootstrap(nextStatus);
    } catch (error) {
      setBootstrapLog(error.message || "Не удалось проверить окружение.");
    }
  }

  async function runBootstrapAction(action, label) {
    setBootstrapBusy(label);
    setBootstrapLog("");

    try {
      const result = await action();
      setBootstrap(result);
      if (result?.output) setBootstrapLog(result.output);
      if (result?.localReady) {
        setSetupDismissed(true);
        setStatus("OmniRoute запущен");
      }
    } catch (error) {
      setBootstrapLog(error.message || "Действие не выполнено.");
    } finally {
      setBootstrapBusy("");
    }
  }

  async function refreshModels() {
    setStatus("Запрашиваю модели OmniRoute...");
    try {
      if (!window.omni?.listModels) {
        throw new Error("Electron bridge не найден. Запустите приложение командой npm.cmd start.");
      }
      const result = await window.omni.listModels(settings);
      const chatModels = getChatModels(result);
      setModels(chatModels);
      if (chatModels.length) {
        const hasSelectedModel = chatModels.some((model) => model.id === settings.model);
        if (!hasSelectedModel || settings.model === "auto") {
          saveSettings({ ...settings, model: chatModels[0].id });
        }
        setStatus(`Найдено моделей: ${chatModels.length}`);
      } else {
        setStatus("OmniRoute ответил, но текстовых моделей не найдено");
      }
    } catch (error) {
      setStatus(error.message || "Не удалось получить модели");
    }
  }

  async function sendMessage() {
    const text = draft.trim();
    // Allow sending an attachment-only message (e.g. "what's in this screenshot?")
    if ((!text && attachments.length === 0) || busy) return;

    // Pre-flight: warn (don't block) if the user attached images but the selected
    // model probably can't see them. OmniRoute will still route the request, but
    // most likely the backend will respond with a generic "I can't see images"
    // message — surface a hint so the user knows to switch model.
    const hasImage = attachments.some((a) => a.type === "image");
    if (hasImage && !isLikelyVisionModel(settings.model)) {
      pushToast(
        `Модель «${formatModelName(settings.model)}» может не видеть картинки. Если ассистент скажет «не могу прочитать изображение» — выберите Claude, GPT-4o, Gemini или Grok Vision.`,
        "info"
      );
    }

    // Build OpenAI-compatible content (string OR array for multimodal) once and
    // reuse it for both the chat display and the outgoing API payload.
    const userContent = composeUserContent(text, attachments);

    // The user-facing chat entry keeps a display-friendly snapshot of the
    // attachments alongside the raw text the user typed — this way we can render
    // thumbnails in history without re-decoding the content array.
    const userMessage = {
      role: "user",
      content: userContent,
      displayText: text,
      attachments: attachments.length ? attachments.map((a) => ({
        id: a.id,
        type: a.type,
        name: a.name,
        size: a.size,
        dataUrl: a.type === "image" ? a.dataUrl : undefined,
        chars: a.type === "docx" ? a.chars : undefined
      })) : undefined
    };

    const nextMessages = [...messages, userMessage];
    setDraft("");
    clearAttachments();
    saveMessages(nextMessages);
    setBusy(true);
    setStatus("Модель думает...");

    const contextMessages = nextMessages
      .slice(contextStartIndex)
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({ role: message.role, content: message.content }));

    // Compose the system prompt: user's own prompt + a nickname directive so
    // the assistant addresses the user by name. The nickname comes from the
    // first-run welcome modal and is persisted in localStorage.
    const systemParts = [];
    if (settings.systemPrompt) systemParts.push(settings.systemPrompt);
    if (nickname) systemParts.push(`Имя пользователя: ${nickname}. Обращайся к нему по имени.`);
    const systemPrompt = systemParts.join("\n\n");

    const apiMessages = [
      ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
      ...contextMessages
    ];

    try {
      if (!window.omni?.chat) {
        throw new Error("Electron bridge не найден. Запустите приложение командой npm.cmd start.");
      }
      let model = settings.model;
      if (!model || model === "auto") {
        const result = await window.omni.listModels(settings);
        const chatModels = getChatModels(result);
        if (!chatModels.length) {
          throw new Error("OmniRoute не вернул доступных текстовых моделей.");
        }
        model = chatModels[0].id;
        setModels(chatModels);
        saveSettings({ ...settings, model });
      }

      if (hasImage && !isKnownWorkingImageRoute(model)) {
        let chatModels = models;
        if (!chatModels.length) {
          const result = await window.omni.listModels(settings);
          chatModels = getChatModels(result);
          setModels(chatModels);
        }

        const routedModel = pickImageRoute(model, chatModels);
        if (routedModel !== model) {
          pushToast(
            `Для картинки Axon временно использует ${formatModelName(routedModel)}: выбранный route ${formatModelName(model)} сейчас получает изображения как unavailable.`,
            "info"
          );
          model = routedModel;
        }
      }

      const response = await window.omni.chat({
        settings,
        model,
        temperature: settings.temperature,
        maxTokens: settings.maxTokens,
        messages: apiMessages
      });

      const content =
        response?.choices?.[0]?.message?.content ||
        response?.output_text ||
        "Ответ получен, но текст не найден в стандартном формате.";
      saveMessages([...nextMessages, { role: "assistant", content }]);
      setStatus("Ответ получен");

      // Heuristic vision-failure detection: if the user attached an image and
      // the assistant's reply hints the image didn't actually arrive, OmniRoute
      // most likely substituted "(unavailable)" or stubbed the image_url part.
      // Surface a strong toast with a link to the request/response dump.
      if (hasImage && typeof content === "string") {
        const lower = content.toLowerCase();
        const failureSignals = [
          "(unavailable)",
          "не могу видеть",
          "не могу прочитать изображение",
          "не вижу изображение",
          "не загрузилось",
          "i can't see",
          "i cannot see",
          "i'm unable to view",
          "no image",
          "image is not available"
        ];
        if (failureSignals.some((s) => lower.includes(s))) {
          pushToast(
            `Картинка не дошла до модели (${formatModelName(settings.model)}). Откройте About → «Открыть папку с логами» и посмотрите last-chat-request.json / last-chat-response.json.`,
            "error"
          );
        }
      }
    } catch (error) {
      const cleanMsg = cleanIpcError(error) || error.message || "Ошибка запроса";
      saveMessages([...nextMessages, { role: "error", content: cleanMsg }]);
      setStatus("Ошибка запроса");
      pushToast(cleanMsg, "error");
    } finally {
      setBusy(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  // Electron wraps IPC handler exceptions with "Error invoking remote method 'X': Error: …".
  // The real message is what we put in `new Error(...)` on the main side — extract it.
  function cleanIpcError(error) {
    const raw = error?.message || "";
    return raw.replace(/^Error invoking remote method '[^']+':\s*Error:\s*/, "").trim();
  }

  async function launchClaudeCode() {
    if (claudeBusy) return;
    const model = settings.model;
    if (!model || model === "auto") {
      pushToast("Выберите конкретную модель перед запуском Claude Code", "error");
      return;
    }
    if (!claudeAvailable) {
      pushToast("Claude Code CLI не установлен. Поставьте через: npm install -g @anthropic-ai/claude-code", "error");
      return;
    }
    if (!window.omni?.claudeLaunch) {
      pushToast("Electron bridge не найден. Запустите приложение через npm.cmd start.", "error");
      return;
    }

    setClaudeBusy(true);
    setStatus(`Запускаю Claude Code с моделью ${formatModelName(model)}…`);

    try {
      await window.omni.claudeLaunch({ settings, model });
      setStatus(`Claude Code запущен (${formatModelName(model)})`);
      pushToast(`Claude Code запущен (${formatModelName(model)})`, "success");
    } catch (error) {
      const clean = cleanIpcError(error) || "Не удалось запустить Claude Code";
      pushToast(clean, "error");
      setStatus("Не удалось запустить Claude Code");
      if (/not found|не найден/i.test(clean)) setClaudeAvailable(false);
    } finally {
      setClaudeBusy(false);
    }
  }

  function clearChat() {
    saveMessages([welcomeMessage], 0);
    setStatus("Чат очищен");
  }

  function clearContext() {
    const notice = {
      role: "notice",
      content: "Контекст очищен. Следующий запрос не будет учитывать сообщения выше."
    };
    const nextMessages = [...messages, notice];
    saveMessages(nextMessages, nextMessages.length);
    setStatus("Контекст очищен");
  }

  const selectedModelName = settings.model || "auto";
  const selectedModelLabel = formatModelName(selectedModelName);
  const needsLocalSetup =
    Boolean(setupDemo) ||
    (settings.baseUrl.includes("localhost") && bootstrap && !bootstrap.localReady && !setupDismissed);

  return (
    <main className="app-shell">
      <aside className="sidebar glass">
        <div className="brand">
          <div className="brand-mark">
            <BrainCircuit size={22} />
          </div>
          <div>
            <h1>Axon</h1>
          </div>
        </div>

        <div className="quick-actions">
          <button className="primary-action" onClick={clearChat}>
            <MessageSquarePlus size={18} />
            Новый чат
          </button>
          <button className="soft-action" onClick={clearContext}>
            <Eraser size={18} />
            Стереть контекст
          </button>
        </div>

        <section className="panel">
          <div className="panel-title">
            <Cpu size={16} />
            Маршрут
          </div>
          <div className="endpoint-card">
            <span>Endpoint</span>
            <strong>{settings.baseUrl.includes("localhost") ? "Local OmniRoute" : "Cloud OmniRoute"}</strong>
          </div>
          <div className="endpoint-card">
            <span>Model</span>
            <strong title={selectedModelName}>{selectedModelLabel}</strong>
          </div>
          <button className="ghost-button" onClick={refreshModels}>
            <RefreshCw size={16} />
            Обновить модели
          </button>
          <button
            className="claude-launch sidebar-claude"
            onClick={launchClaudeCode}
            disabled={claudeBusy || selectedModelName === "auto" || !claudeAvailable}
            title={
              !claudeAvailable
                ? "Установите Claude Code CLI: npm install -g @anthropic-ai/claude-code"
                : selectedModelName === "auto"
                  ? "Выберите конкретную модель"
                  : `Открыть Claude Code с ${selectedModelLabel}`
            }
          >
            {claudeBusy ? <Loader2 className="spin" size={16} /> : <Terminal size={16} />}
            <span>Открыть в Claude Code</span>
          </button>
        </section>

        <section className="panel">
          <div className="panel-title">
            <ShieldCheck size={16} />
            Аккаунт
          </div>
          <p className="muted">
            API key хранится локально и отправляется только на выбранный OmniRoute endpoint.
          </p>
          <button className="ghost-button guide-button" onClick={() => setProviderGuideOpen(true)}>
            <BookOpen size={16} />
            Подключить провайдеры
          </button>
        </section>

        <div className="sidebar-footer">
          crafted by{" "}
          <button className="about-link" onClick={() => setAboutOpen(true)}>xdxegit</button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar glass">
          <div className="model-picker">
            <button onClick={() => setModelsOpen((value) => !value)} title={selectedModelName}>
              <Sparkles size={17} />
              <span>{selectedModelLabel}</span>
              <ChevronDown size={16} />
            </button>
            {modelsOpen && (
              <div className="model-menu glass">
                <button
                  className={cls(settings.model === "auto" && "active")}
                  onClick={() => {
                    saveSettings({ ...settings, model: "auto" });
                    setModelsOpen(false);
                  }}
                >
                  <span className="model-label">
                    <span className="model-name">Auto</span>
                    <span className="model-id">auto</span>
                  </span>
                  {settings.model === "auto" && <Check size={15} />}
                </button>
                {models.map((model) => (
                  <button
                    key={model.id}
                    className={cls(settings.model === model.id && "active")}
                    onClick={() => {
                      saveSettings({ ...settings, model: model.id });
                      setModelsOpen(false);
                    }}
                    title={model.id}
                  >
                    <span className="model-label">
                      <span className="model-name">{formatModelName(model.id)}</span>
                      <span className="model-id">{model.id}</span>
                    </span>
                    {settings.model === model.id && <Check size={15} />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="status-pill">
            {busy && <Loader2 className="spin" size={15} />}
            {status}
          </div>

          <div className="top-actions">
            <button className="icon-button" onClick={clearContext} title="Очистить контекст">
              <RotateCcw size={18} />
            </button>
            <button className="theme-toggle" onClick={toggleTheme} title="Переключить тему">
              {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
              <span>{theme === "dark" ? "Light" : "Dark"}</span>
            </button>
            <button className="icon-button" onClick={() => setAboutOpen(true)} title="About Axon">
              <Info size={18} />
            </button>
            <button className="icon-button" onClick={() => setSettingsOpen((value) => !value)} title="Настройки">
              <Settings size={18} />
            </button>

            {/* Custom window controls — replace the native min/max/close overlay we
                disabled in electron/main.js. The .window-controls wrapper is
                -webkit-app-region: no-drag so the buttons stay clickable. */}
            <div className="window-controls">
              <button
                className="winbtn"
                onClick={() => window.winctl?.minimize()}
                title="Свернуть"
              >
                <Minus size={14} strokeWidth={2.4} />
              </button>
              <button
                className="winbtn"
                onClick={() => window.winctl?.toggleMaximize()}
                title={isMaximized ? "Восстановить" : "Развернуть"}
              >
                {isMaximized ? <Copy size={12} strokeWidth={2.4} /> : <Square size={12} strokeWidth={2.4} />}
              </button>
              <button
                className="winbtn close"
                onClick={() => window.winctl?.close()}
                title="Закрыть"
              >
                <X size={14} strokeWidth={2.4} />
              </button>
            </div>
          </div>
        </header>

        <div className="content-grid">
          <section className="chat-surface">
            <div className="messages">
              {messages.map((message, index) => {
                // For the user side we have a richer record: `displayText` is what
                // they typed, `attachments` is a thumbnail-ready snapshot. For
                // assistant/system messages we just render content as a string.
                const isUser = message.role === "user";
                let bodyText = "";
                if (isUser) {
                  bodyText = message.displayText
                    ?? (typeof message.content === "string"
                      ? message.content
                      // Legacy or recovered message — pull text part out of array content.
                      : (Array.isArray(message.content)
                          ? message.content.filter((p) => p.type === "text").map((p) => p.text).join("\n")
                          : ""));
                } else {
                  bodyText = typeof message.content === "string" ? message.content : String(message.content ?? "");
                }
                const atts = isUser ? (message.attachments || []) : [];
                return (
                  <article key={`${message.role}-${index}`} className={cls("message", message.role)}>
                    <div className="avatar">
                      {isUser ? "Вы" : message.role === "error" ? "!" : <Bot size={18} />}
                    </div>
                    <div className="bubble">
                      <div className="role">
                        {isUser
                          ? "Пользователь"
                          : message.role === "error"
                            ? "Ошибка"
                            : message.role === "notice"
                              ? "Контекст"
                              : "Ассистент"}
                      </div>
                      {atts.length > 0 && (
                        <div className="message-attachments">
                          {atts.map((a) => (
                            a.type === "image" && a.dataUrl ? (
                              <a
                                key={a.id}
                                className="msg-img"
                                href={a.dataUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={a.name}
                              >
                                <img src={a.dataUrl} alt={a.name} />
                              </a>
                            ) : (
                              <div key={a.id} className="msg-doc">
                                <FileText size={16} />
                                <span className="msg-doc-name" title={a.name}>{a.name}</span>
                                {a.chars != null && <span className="msg-doc-meta">{a.chars.toLocaleString()} симв.</span>}
                              </div>
                            )
                          ))}
                        </div>
                      )}
                      {bodyText && <p>{bodyText}</p>}
                    </div>
                  </article>
                );
              })}
            </div>

            <div
              className={cls("composer glass", dragActive && "drag-active")}
              onDragEnter={(event) => {
                if (event.dataTransfer?.types?.includes("Files")) {
                  event.preventDefault();
                  setDragActive(true);
                }
              }}
              onDragOver={(event) => {
                if (event.dataTransfer?.types?.includes("Files")) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                }
              }}
              onDragLeave={(event) => {
                // Only clear when the drag leaves the composer itself, not a child.
                if (event.currentTarget.contains(event.relatedTarget)) return;
                setDragActive(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDragActive(false);
                const dropped = event.dataTransfer?.files;
                if (dropped?.length) addFiles(dropped);
              }}
            >
              {attachments.length > 0 && (
                <div className="attachment-row">
                  {attachments.map((a) => (
                    <div key={a.id} className={cls("attachment-chip", `attachment-${a.type}`)}>
                      {a.type === "image" ? (
                        <img className="attachment-thumb" src={a.dataUrl} alt={a.name} />
                      ) : (
                        <div className="attachment-icon"><FileText size={16} /></div>
                      )}
                      <div className="attachment-info">
                        <span className="attachment-name" title={a.name}>{a.name}</span>
                        <span className="attachment-meta">
                          {a.type === "docx" ? `DOCX · ${a.chars.toLocaleString()} симв.` : formatBytes(a.size)}
                        </span>
                      </div>
                      <button
                        className="attachment-remove"
                        onClick={() => removeAttachment(a.id)}
                        title="Убрать"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="composer-row">
                <button
                  className="composer-attach"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy}
                  title="Прикрепить DOCX или картинку"
                >
                  <Paperclip size={18} />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".docx,image/*"
                  style={{ display: "none" }}
                  onChange={(event) => {
                    addFiles(event.target.files);
                    event.target.value = ""; // allow re-selecting the same file
                  }}
                />
                <textarea
                  ref={inputRef}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) sendMessage();
                  }}
                  onPaste={(event) => {
                    // Pull files out of the clipboard — covers Win+Shift+S screenshot,
                    // Snipping Tool, drag-from-Explorer copies, etc. We DON'T preventDefault
                    // unconditionally so text paste still works normally.
                    const items = event.clipboardData?.items || [];
                    const files = [];
                    for (const item of items) {
                      if (item.kind === "file") {
                        const f = item.getAsFile();
                        if (f) files.push(f);
                      }
                    }
                    if (files.length) {
                      event.preventDefault();
                      addFiles(files);
                    }
                  }}
                  placeholder={
                    attachments.length
                      ? "Опишите запрос к прикреплённым файлам…"
                      : nickname
                        ? `${nickname}, напишите запрос к модели… (Ctrl+V для картинок, скрепка для файлов)`
                        : "Напишите запрос к модели… (вставка картинок через Ctrl+V, DOCX и картинки через скрепку)"
                  }
                />
                <button
                  onClick={sendMessage}
                  disabled={busy || (!draft.trim() && attachments.length === 0)}
                  title="Отправить (Ctrl+Enter)"
                >
                  {busy ? <Loader2 className="spin" size={20} /> : <Send size={20} />}
                </button>
              </div>

              {dragActive && (
                <div className="drop-overlay">
                  <Paperclip size={28} />
                  <span>Отпустите, чтобы прикрепить</span>
                </div>
              )}
            </div>
          </section>

          <aside className={cls("settings-drawer glass", settingsOpen && "open")}>
            <div className="drawer-heading">
              <Wand2 size={18} />
              <h2>Настройки</h2>
            </div>

            <label>
              <span>OmniRoute endpoint</span>
              <input
                value={settings.baseUrl}
                onChange={(event) => saveSettings({ ...settings, baseUrl: event.target.value })}
                placeholder="http://localhost:20128/v1"
              />
            </label>

            <label>
              <span>API key</span>
              <div className="secret-input">
                <KeyRound size={16} />
                <input
                  type="password"
                  value={settings.apiKey}
                  onChange={(event) => saveSettings({ ...settings, apiKey: event.target.value })}
                  placeholder="Можно оставить пустым для local"
                />
              </div>
            </label>

            <label>
              <span>Модель</span>
              <input
                value={settings.model}
                onChange={(event) => saveSettings({ ...settings, model: event.target.value })}
                placeholder="auto"
              />
            </label>

            <label>
              <span>Temperature: {settings.temperature}</span>
              <input
                type="range"
                min="0"
                max="1.5"
                step="0.1"
                value={settings.temperature}
                onChange={(event) => saveSettings({ ...settings, temperature: event.target.value })}
              />
            </label>

            <label>
              <span>Max tokens</span>
              <input
                type="number"
                min="128"
                max="16000"
                value={settings.maxTokens}
                onChange={(event) => saveSettings({ ...settings, maxTokens: event.target.value })}
              />
            </label>

            <label>
              <span>System prompt</span>
              <textarea
                className="system-prompt"
                value={settings.systemPrompt}
                onChange={(event) => saveSettings({ ...settings, systemPrompt: event.target.value })}
              />
            </label>

            <div className="drawer-actions">
              <button className="soft-action" onClick={clearContext}>
                <Eraser size={16} />
                Очистить контекст
              </button>
              <button className="danger-button" onClick={clearChat}>
                <Trash2 size={16} />
                Очистить чат
              </button>
            </div>
          </aside>
        </div>
      </section>

      {/* First-run welcome — asks for a nickname so the assistant can address
          the user by name. Shown only when no nickname has been saved yet. */}
      {welcomeOpen && (
        <div className="setup-overlay">
          <section className="welcome-modal glass">
            <div className="welcome-icon">
              <BrainCircuit size={28} />
            </div>
            <h2 className="welcome-title">Добро пожаловать в Axon</h2>
            <p className="welcome-tagline">be better with me</p>
            <p className="welcome-desc">
              Как к вам обращаться? Имя сохранится локально и будет добавлено в системный промпт, чтобы ассистент знал, как вас называть.
            </p>
            <input
              className="welcome-input"
              value={nicknameDraft}
              onChange={(event) => setNicknameDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") finishWelcome(); }}
              placeholder="Например, Klaiz"
              autoFocus
              maxLength={40}
            />
            <div className="welcome-actions">
              <button className="primary-action" onClick={finishWelcome} disabled={!nicknameDraft.trim()}>
                Продолжить
              </button>
              <button className="ghost-link" onClick={skipWelcome}>
                Пропустить
              </button>
            </div>
          </section>
        </div>
      )}

      {needsLocalSetup && (
        <div className="setup-overlay">
          <section className="setup-card glass">
            <div className="setup-icon">
              <Server size={28} />
            </div>
            <div className="setup-copy">
              <h2>Настройка локального OmniRoute</h2>
              <p>
                Приложение может подготовить окружение: поставить Node.js через winget, установить OmniRoute через npm
                и запустить локальный API.
              </p>
            </div>

            <div className="setup-checks">
              <div className={cls("setup-check", bootstrap.nodeAvailable && "ready")}>
                {bootstrap.nodeAvailable ? <Check size={16} /> : <AlertCircle size={16} />}
                Node.js
              </div>
              <div className={cls("setup-check", bootstrap.npmAvailable && "ready")}>
                {bootstrap.npmAvailable ? <Check size={16} /> : <AlertCircle size={16} />}
                npm
              </div>
              <div className={cls("setup-check", bootstrap.omniRouteAvailable && "ready")}>
                {bootstrap.omniRouteAvailable ? <Check size={16} /> : <AlertCircle size={16} />}
                OmniRoute CLI
              </div>
              <div className={cls("setup-check", bootstrap.localReady && "ready")}>
                {bootstrap.localReady ? <Check size={16} /> : <AlertCircle size={16} />}
                Local API
              </div>
            </div>

            {bootstrapLog && <pre className="setup-log">{bootstrapLog}</pre>}

            <div className="setup-actions">
              {!bootstrap.npmAvailable && (
                <button
                  className="soft-action"
                  disabled={Boolean(bootstrapBusy)}
                  onClick={() => runBootstrapAction(window.omni.installNode, "Установка Node.js")}
                >
                  {bootstrapBusy === "Установка Node.js" ? <Loader2 className="spin" size={17} /> : <Download size={17} />}
                  Установить Node.js
                </button>
              )}
              {bootstrap.npmAvailable && !bootstrap.omniRouteAvailable && (
                <button
                  className="primary-action"
                  disabled={Boolean(bootstrapBusy)}
                  onClick={() => runBootstrapAction(window.omni.installOmniRoute, "Установка OmniRoute")}
                >
                  {bootstrapBusy === "Установка OmniRoute" ? (
                    <Loader2 className="spin" size={17} />
                  ) : (
                    <Download size={17} />
                  )}
                  Установить OmniRoute
                </button>
              )}
              {bootstrap.omniRouteAvailable && (
                <button
                  className="primary-action"
                  disabled={Boolean(bootstrapBusy)}
                  onClick={() => runBootstrapAction(window.omni.startOmniRoute, "Запуск OmniRoute")}
                >
                  {bootstrapBusy === "Запуск OmniRoute" ? <Loader2 className="spin" size={17} /> : <PlayCircle size={17} />}
                  Запустить OmniRoute
                </button>
              )}
              <button className="soft-action" disabled={Boolean(bootstrapBusy)} onClick={refreshBootstrapStatus}>
                <RefreshCw size={17} />
                Проверить снова
              </button>
              <button className="ghost-link" disabled={Boolean(bootstrapBusy)} onClick={() => setSetupDismissed(true)}>
                Позже
              </button>
            </div>
          </section>
        </div>
      )}

      {providerGuideOpen && !needsLocalSetup && (
        <div className="setup-overlay">
          <section className="provider-guide glass">
            <button className="guide-close" onClick={closeProviderGuide} title="Закрыть">
              <X size={18} />
            </button>
            <div className="setup-icon">
              <BookOpen size={28} />
            </div>
            <div className="setup-copy">
              <h2>Подключение провайдеров</h2>
              <p>
                После установки OmniRoute добавьте нужные аккаунты, затем вернитесь сюда и обновите список моделей.
              </p>
            </div>

            <div className="guide-steps">
              <article>
                <span>1</span>
                <div>
                  <h3>Откройте OmniRoute</h3>
                  <p>Запустите локальный API командой omniroute или кнопкой мастера и проверьте список провайдеров.</p>
                </div>
              </article>
              <article>
                <span>2</span>
                <div>
                  <h3>Добавьте аккаунты</h3>
                  <p>Для каждого провайдера используйте официальный вход или API key. После добавления нажмите «Обновить модели».</p>
                </div>
              </article>
              <article>
                <span>3</span>
                <div>
                  <h3>Kiro через AWS</h3>
                  <p>Kiro поддерживает AWS Builder ID и AWS IAM Identity Center. Для CLI выполните kiro-cli login, выберите Builder ID или организацию IAM Identity Center, затем проверьте вход через kiro-cli whoami.</p>
                </div>
              </article>
              <article>
                <span>4</span>
                <div>
                  <h3>Headless/API key</h3>
                  <p>Для режима без браузера создайте API key в Kiro и задайте переменную KIRO_API_KEY. После этого OmniRoute сможет использовать доступный Kiro CLI/provider flow.</p>
                </div>
              </article>
            </div>

            <div className="setup-actions">
              <button className="primary-action" onClick={refreshModels}>
                <RefreshCw size={17} />
                Обновить модели
              </button>
              <button className="soft-action" onClick={() => window.open("https://kiro.dev/docs/cli/authentication/")}>
                Документация Kiro CLI
              </button>
              <button className="soft-action" onClick={() => window.open("https://kiro.dev/docs/getting-started/authentication/")}>
                Kiro + AWS вход
              </button>
              <button className="ghost-link" onClick={closeProviderGuide}>
                Готово
              </button>
            </div>
          </section>
        </div>
      )}
      {aboutOpen && (
        <div className="setup-overlay" onClick={(e) => e.target === e.currentTarget && setAboutOpen(false)}>
          <section className="about-modal glass">
            <button className="guide-close" onClick={() => setAboutOpen(false)} title="Закрыть">
              <X size={18} />
            </button>
            <div className="about-icon">
              <BrainCircuit size={32} />
            </div>
            <h2 className="about-title">Axon</h2>
            <p className="about-tagline">be better with me</p>
            <div className="about-meta">
              <span>v1.1.1-beta</span>
              <span>·</span>
              <span>crafted by{" "}
                <button className="about-link" onClick={() => window.open("https://github.com/xdxegit")}>
                  xdxegit
                </button>
              </span>
            </div>
            <p className="about-desc">Desktop AI workspace powered by OmniRoute.</p>
            <div className="about-nickname">
              <span className="about-nickname-label">Имя обращения</span>
              <input
                className="about-nickname-input"
                value={nickname || ""}
                onChange={(event) => saveNickname(event.target.value)}
                placeholder="Без обращения"
                maxLength={40}
              />
            </div>
            <button
              className="ghost-button about-logs-button"
              onClick={() => window.omni?.openLogsFolder?.()}
              title="Откроется в Проводнике"
            >
              <FileText size={15} />
              Открыть папку с логами
            </button>
            {logsPath && (
              <div className="about-logs-path" title="Скопируйте путь в Проводник">
                {logsPath}
              </div>
            )}
            <p className="about-logs-hint">
              В папке появятся axon-main.log, last-chat-request.json и last-chat-response.json после первого запроса с прикреплённой картинкой.
            </p>
          </section>
        </div>
      )}

      {/* Toasts — non-blocking, auto-dismissing notifications. Click to dismiss early.
          Stack bottom-right above the chat surface so the topbar stays uncluttered. */}
      {toasts.length > 0 && (
        <div className="toast-stack">
          {toasts.map((t) => (
            <button
              key={t.id}
              className={cls("toast", `toast-${t.type}`)}
              onClick={() => dismissToast(t.id)}
              title="Нажмите чтобы скрыть"
            >
              <span className="toast-icon">
                {t.type === "error" ? <AlertCircle size={16} /> :
                 t.type === "success" ? <Check size={16} /> :
                 <Info size={16} />}
              </span>
              <span className="toast-text">{t.text}</span>
              <span className="toast-close"><X size={14} /></span>
            </button>
          ))}
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);

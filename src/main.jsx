import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clipboard,
  Copy,
  LogOut,
  Loader2,
  MessageSquareText,
  Plus,
  RefreshCw,
  Save,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2
} from "lucide-react";
import "./styles.css";

const storageKey = "kuaiwen.config";
const autoSendDelayMs = 3000;

function createId() {
  return `profile-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadConfig() {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || "{}");
    if (Array.isArray(stored.profiles)) return stored;

    if (stored.apiKey || stored.baseUrl || stored.model) {
      const id = createId();
      return {
        activeProfileId: id,
        profiles: [
          {
            id,
            name: stored.model || "默认模型",
            apiKey: stored.apiKey || "",
            baseUrl: stored.baseUrl || "",
            model: stored.model || "",
            models: []
          }
        ]
      };
    }
  } catch {
    return { profiles: [], activeProfileId: "" };
  }

  return { profiles: [], activeProfileId: "" };
}

function emptyDraft() {
  return { id: createId(), name: "新模型", apiKey: "", baseUrl: "", model: "", models: [] };
}

function App() {
  const savedConfig = useMemo(loadConfig, []);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);
  const [password, setPassword] = useState("");
  const [profiles, setProfiles] = useState(savedConfig.profiles || []);
  const [activeProfileId, setActiveProfileId] = useState(savedConfig.activeProfileId || savedConfig.profiles?.[0]?.id || "");
  const [draft, setDraft] = useState(savedConfig.profiles?.[0] || emptyDraft());
  const [view, setView] = useState(savedConfig.profiles?.length ? "ask" : "settings");
  const [content, setContent] = useState("");
  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [isAsking, setIsAsking] = useState(false);
  const inputRef = useRef(null);
  const autoSendTimerRef = useRef(null);
  const lastSentContentRef = useRef("");

  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) || profiles[0];

  useEffect(() => {
    fetch("/api/session")
      .then((response) => response.json())
      .then((payload) => setIsAuthenticated(Boolean(payload.authenticated)))
      .catch(() => setIsAuthenticated(false))
      .finally(() => setIsCheckingSession(false));
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      loadServerConfig();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    return () => {
      if (autoSendTimerRef.current) clearTimeout(autoSendTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (view === "ask") {
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [view, activeProfileId]);

  const canAsk = canAskFor(content);

  function canAskFor(nextContent) {
    return (
      activeProfile?.apiKey?.trim() &&
      activeProfile?.baseUrl?.trim() &&
      activeProfile?.model?.trim() &&
      String(nextContent || "").trim() &&
      !isAsking
    );
  }

  async function requestJson(url, body, method = "POST") {
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "请求失败");
    return payload;
  }

  function applyConfig(config) {
    const nextProfiles = Array.isArray(config.profiles) ? config.profiles : [];
    const nextActiveId = config.activeProfileId || nextProfiles[0]?.id || "";
    setProfiles(nextProfiles);
    setActiveProfileId(nextActiveId);
    setDraft(nextProfiles.find((profile) => profile.id === nextActiveId) || nextProfiles[0] || emptyDraft());
    setView(nextProfiles.length ? "ask" : "settings");
    lastSentContentRef.current = "";
  }

  async function persistConfig(nextProfiles, nextActiveProfileId) {
    const config = await requestJson(
      "/api/config",
      { profiles: nextProfiles, activeProfileId: nextActiveProfileId },
      "PUT"
    );
    applyConfig(config);
    return config;
  }

  async function loadServerConfig() {
    setIsLoadingConfig(true);
    setError("");

    try {
      const config = await requestJson("/api/config", undefined, "GET");

      if (!config.profiles?.length && savedConfig.profiles?.length) {
        const migrated = await persistConfig(savedConfig.profiles, savedConfig.activeProfileId || savedConfig.profiles[0]?.id || "");
        applyConfig(migrated);
        localStorage.removeItem(storageKey);
      } else {
        applyConfig(config);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoadingConfig(false);
    }
  }

  async function login(event) {
    event.preventDefault();
    setError("");
    setStatus("");

    try {
      await requestJson("/api/login", { password });
      setIsAuthenticated(true);
      setPassword("");
      setStatus("登录成功。");
    } catch (err) {
      setError(err.message);
    }
  }

  async function logout() {
    await requestJson("/api/logout", {});
    setIsAuthenticated(false);
    setAnswer("");
    setStatus("");
  }

  function editProfile(profile = emptyDraft()) {
    setDraft({ ...profile, models: profile.models || [] });
    setError("");
    setStatus("");
    setView("settings");
  }

  async function saveProfile() {
    const nextDraft = {
      ...draft,
      name: draft.name.trim() || draft.model.trim() || "未命名模型",
      apiKey: draft.apiKey.trim(),
      baseUrl: draft.baseUrl.trim(),
      model: draft.model.trim(),
      models: draft.models || []
    };

    if (!nextDraft.apiKey || !nextDraft.baseUrl || !nextDraft.model) {
      setError("请填写 API Key、Base URL 和模型名。");
      return;
    }

    try {
      const exists = profiles.some((profile) => profile.id === nextDraft.id);
      const nextProfiles = exists
        ? profiles.map((profile) => (profile.id === nextDraft.id ? nextDraft : profile))
        : [...profiles, nextDraft];
      await persistConfig(nextProfiles, nextDraft.id);
      setStatus("模型配置已保存到服务器。");
      setError("");
      setView("ask");
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteProfile(id) {
    try {
      const nextProfiles = profiles.filter((profile) => profile.id !== id);
      const nextActiveId = activeProfileId === id ? nextProfiles[0]?.id || "" : activeProfileId;
      await persistConfig(nextProfiles, nextActiveId);
      setDraft(emptyDraft());
    } catch (err) {
      setError(err.message);
    }
  }

  async function selectProfile(profile) {
    try {
      await persistConfig(profiles, profile.id);
      editProfile(profile);
    } catch (err) {
      setError(err.message);
    }
  }

  async function fetchModels() {
    setError("");
    setStatus("");
    setIsLoadingModels(true);

    try {
      const payload = await requestJson("/api/models", {
        apiKey: draft.apiKey,
        baseUrl: draft.baseUrl
      });
      const nextModels = payload.models || [];
      setDraft((current) => ({
        ...current,
        models: nextModels,
        model: current.model || nextModels[0] || ""
      }));
      setStatus(nextModels.length ? `已获取 ${nextModels.length} 个模型。` : "已连接，但没有返回模型。");
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoadingModels(false);
    }
  }

  async function askAi(nextContent = content, options = {}) {
    const normalizedContent = String(nextContent || "").trim();
    if (!canAskFor(normalizedContent)) return;
    if (!options.force && normalizedContent === lastSentContentRef.current) return;

    if (autoSendTimerRef.current) {
      clearTimeout(autoSendTimerRef.current);
      autoSendTimerRef.current = null;
    }

    setError("");
    setStatus("");
    setAnswer("");
    setIsAsking(true);
    lastSentContentRef.current = normalizedContent;

    try {
      const payload = await requestJson("/api/ask", {
        apiKey: activeProfile.apiKey,
        baseUrl: activeProfile.baseUrl,
        model: activeProfile.model,
        content: normalizedContent
      });
      setAnswer(payload.answer || "没有收到回答。");
    } catch (err) {
      setError(err.message);
      lastSentContentRef.current = "";
    } finally {
      setIsAsking(false);
    }
  }

  function scheduleAutoSend(nextContent) {
    if (autoSendTimerRef.current) clearTimeout(autoSendTimerRef.current);
    autoSendTimerRef.current = setTimeout(() => askAi(nextContent), autoSendDelayMs);
  }

  function handleContentChange(event) {
    const nextContent = event.target.value;
    setContent(nextContent);
    scheduleAutoSend(nextContent);
  }

  function handlePaste(event) {
    const pastedText = event.clipboardData?.getData("text") || "";
    if (!pastedText) return;

    const target = event.currentTarget;
    const nextContent = target.value.slice(0, target.selectionStart) + pastedText + target.value.slice(target.selectionEnd);
    setTimeout(() => askAi(nextContent, { force: true }), 0);
  }

  function handleEditorKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      askAi(content, { force: true });
    }
  }

  async function pasteFromClipboard() {
    setError("");
    try {
      const text = await navigator.clipboard.readText();
      setContent(text);
      inputRef.current?.focus();
      setTimeout(() => askAi(text, { force: true }), 0);
    } catch {
      setError("浏览器没有允许读取剪贴板，请手动粘贴。");
    }
  }

  async function copyAnswer() {
    if (!answer) return;
    await navigator.clipboard.writeText(answer);
    setStatus("回答已复制。");
  }

  function clearAll() {
    setContent("");
    setAnswer("");
    setError("");
    setStatus("");
    lastSentContentRef.current = "";
    inputRef.current?.focus();
  }

  if (isCheckingSession || (isAuthenticated && isLoadingConfig)) {
    return (
      <main className="login-shell">
        <div className="login-panel">
          <div className="brand-mark">
            <Sparkles size={22} />
          </div>
          <h1>快问</h1>
          <p>{isCheckingSession ? "正在确认登录状态..." : "正在读取服务器模型配置..."}</p>
        </div>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="login-shell">
        <form className="login-panel" onSubmit={login}>
          <div className="brand-mark">
            <Sparkles size={22} />
          </div>
          <div>
            <h1>快问</h1>
            <p>公网访问前先登录。</p>
          </div>
          <label>
            <span>访问密码</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="请输入访问密码"
              autoFocus
            />
          </label>
          {error && (
            <div className="notice error flat">
              <AlertTriangle size={17} />
              <span>{error}</span>
            </div>
          )}
          <button type="submit" className="primary-button login-button" disabled={!password.trim()}>
            <ShieldCheck size={18} />
            <span>进入快问</span>
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="topbar" aria-label="应用标题">
        <div className="brand-mark">
          <Sparkles size={22} />
        </div>
        <div>
          <h1>快问</h1>
          <p>快问，问你想问</p>
        </div>
        <div className="top-actions">
          {view === "settings" && (
            <button type="button" className="icon-button" onClick={() => setView("ask")} title="返回快问">
              <ArrowLeft size={18} />
            </button>
          )}
          <button type="button" className="icon-button" onClick={() => editProfile(activeProfile)} title="模型设置">
            <Settings size={18} />
          </button>
          <button type="button" className="icon-button" onClick={logout} title="退出登录">
            <LogOut size={18} />
          </button>
        </div>
      </section>

      {view === "settings" ? (
        <section className="settings-page">
          <div className="settings-form">
            <div className="panel-heading compact">
              <div>
                <span className="eyebrow">设置</span>
                <h2>模型档案</h2>
              </div>
              <button type="button" className="icon-button strong" onClick={() => editProfile(emptyDraft())} title="新增模型">
                <Plus size={18} />
              </button>
            </div>

            <label>
              <span>显示名称</span>
              <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：GPT 主力" />
            </label>

            <label>
              <span>API Key</span>
              <input
                type="password"
                value={draft.apiKey}
                onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
                placeholder="sk-..."
                autoComplete="off"
              />
            </label>

            <label>
              <span>Base URL</span>
              <input
                value={draft.baseUrl}
                onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
                placeholder="https://api.openai.com"
                autoComplete="off"
              />
            </label>

            <label>
              <span>模型</span>
              <div className="model-row">
                <input
                  list="draft-models"
                  value={draft.model}
                  onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                  placeholder="点击右侧刷新获取"
                />
                <button type="button" className="icon-button strong" onClick={fetchModels} disabled={isLoadingModels} title="获取模型">
                  {isLoadingModels ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}
                </button>
                <datalist id="draft-models">
                  {(draft.models || []).map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
              </div>
            </label>

            {(status || error) && (
              <div className={error ? "notice error flat" : "notice flat"}>
                {error ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}
                <span>{error || status}</span>
              </div>
            )}

            <div className="settings-actions">
              <button type="button" className="secondary-button" onClick={() => setView("ask")}>
                <ArrowLeft size={18} />
                <span>返回</span>
              </button>
              <button type="button" className="primary-button" onClick={saveProfile}>
                <Save size={18} />
                <span>保存模型</span>
              </button>
            </div>
          </div>

          <aside className="profile-list">
            <div className="panel-heading compact">
              <div>
                <span className="eyebrow">已保存</span>
                <h2>选择当前模型</h2>
              </div>
            </div>
            {profiles.length ? (
              profiles.map((profile) => (
                <div className={profile.id === activeProfileId ? "profile-item active" : "profile-item"} key={profile.id}>
                  <button
                    type="button"
                    className="profile-main"
                    onClick={() => {
                      lastSentContentRef.current = "";
                      selectProfile(profile);
                    }}
                  >
                    <strong>{profile.name}</strong>
                    <span>{profile.model}</span>
                  </button>
                  <button type="button" className="icon-button" onClick={() => deleteProfile(profile.id)} title="删除模型">
                    <Trash2 size={17} />
                  </button>
                </div>
              ))
            ) : (
              <div className="empty-state">还没有保存模型。</div>
            )}
          </aside>
        </section>
      ) : (
        <>
          {!activeProfile ? (
            <section className="empty-config">
              <h2>先添加一个模型</h2>
              <p>保存 API Key、Base URL 和模型名后，快问就能粘贴即答。</p>
              <button type="button" className="primary-button" onClick={() => editProfile(emptyDraft())}>
                <Plus size={18} />
                <span>添加模型</span>
              </button>
            </section>
          ) : (
            <>
              <section className="editor-panel solo">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">输入</span>
                    <h2>把命令、英文、报错或日志丢进来</h2>
                  </div>
                  <div className="toolbar">
                    <button type="button" className="icon-button" onClick={pasteFromClipboard} title="从剪贴板粘贴">
                      <Clipboard size={18} />
                    </button>
                    <button type="button" className="icon-button" onClick={clearAll} title="清空">
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>

                <textarea
                  ref={inputRef}
                  value={content}
                  onChange={handleContentChange}
                  onPaste={handlePaste}
                  onKeyDown={handleEditorKeyDown}
                  placeholder="例如：rm -rf ./dist && npm run build&#10;或者粘贴一段英文、报错信息、日志、配置片段..."
                  spellCheck="false"
                />

                <div className="action-row">
                  <div className="input-meta">
                    <MessageSquareText size={16} />
                    <span>{content.trim() ? `${content.trim().length} 字符，停 3 秒自动发送` : "等待输入"}</span>
                  </div>
                  <button type="button" className="primary-button" onClick={() => askAi(content, { force: true })} disabled={!canAsk}>
                    {isAsking ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
                    <span>{isAsking ? "正在思考" : "快问一下"}</span>
                  </button>
                </div>
              </section>

              <section className="answer-panel">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">回答</span>
                    <h2>快问的判断和解释</h2>
                  </div>
                  <button type="button" className="icon-button" onClick={copyAnswer} disabled={!answer} title="复制回答">
                    <Copy size={18} />
                  </button>
                </div>
                {(status || error) && (
                  <div className={error ? "notice error flat inline-notice" : "notice flat inline-notice"}>
                    {error ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}
                    <span>{error || status}</span>
                  </div>
                )}
                <article className={answer ? "answer-content" : "answer-content empty"}>
                  {isAsking ? (
                    <div className="thinking">
                      <Loader2 className="spin" size={22} />
                      <span>正在识别内容类型并组织回答...</span>
                    </div>
                  ) : answer ? (
                    answer
                  ) : (
                    "回答会显示在这里。"
                  )}
                </article>
              </section>
            </>
          )}
        </>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);

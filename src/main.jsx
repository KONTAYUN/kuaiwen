import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Clipboard,
  ChevronDown,
  History,
  LogOut,
  Settings as SettingsIcon,
  Send,
  Square,
  Trash2,
  X,
  Loader2,
  Zap,
  Clock3
} from "lucide-react";
import { requestJson } from "./api";
import { useAsk } from "./useAsk";
import { readPreferences, preferenceKey, readHistory, writeHistory, historyKey } from "./storage";
import Settings from "./Settings";
import Answer, { intentLabels } from "./Answer";
import "./styles.css";

function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <Zap size={24} fill="currentColor" />
      </span>
      <div>
        <h1>快问</h1>
        <p>问你想问</p>
      </div>
    </div>
  );
}

function ModelMenu({ profile, profiles, disabled, onSelect }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  useEffect(() => {
    const close = (event) => {
      if (!root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  return (
    <div className="model-menu" ref={root}>
      <span className="field-caption">使用模型</span>
      <button
        type="button"
        role="combobox"
        aria-label="当前模型"
        aria-expanded={open}
        aria-controls="active-model-options"
        className="model-menu-trigger"
        disabled={disabled || !profiles.length}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="model-menu-copy">
          <strong>{profile?.name || "尚未配置模型"}</strong>
          <small>{profile?.model || "前往设置添加模型"}</small>
        </span>
        <ChevronDown size={17} className={`menu-chevron ${open ? "open" : ""}`} />
      </button>
      {open && profiles.length > 0 && (
        <div className="model-menu-popover" id="active-model-options" role="listbox" aria-label="模型列表">
          <div className="popover-heading">已保存的模型</div>
          {profiles.map((item) => (
            <button
              type="button"
              role="option"
              aria-selected={item.id === profile?.id}
              className="model-option"
              key={item.id}
              onClick={() => {
                setOpen(false);
                onSelect(item.id);
              }}
            >
              <span>
                <strong>{item.name}</strong>
                <small>{item.model}</small>
              </span>
              {item.id === profile?.id && <Check size={16} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Login({ onLogin, initialError }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(initialError || "");
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await requestJson("/api/login", { password });
      onLogin();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-shell">
      <form className="login-panel panel" onSubmit={submit}>
        <Brand />
        <div className="login-intro">
          <h2>把疑问，放进来</h2>
          <p>命令、英文、报错，一贴即答</p>
        </div>
        <label>
          访问密码
          <input
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="输入你的访问密码"
          />
        </label>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <button className="primary-button" disabled={busy || !password}>
          {busy ? <Loader2 className="spin" size={17} /> : <ArrowUpRight size={18} />}进入快问
        </button>
      </form>
    </main>
  );
}

function Workspace({ onLogout }) {
  const [config, setConfig] = useState({ profiles: [], activeProfileId: "" });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [view, setView] = useState("ask");
  const [content, setContent] = useState("");
  const [intent, setIntent] = useState("auto");
  const [preferences, setPreferences] = useState(readPreferences);
  const [history, setHistory] = useState(() => (readPreferences().saveHistory ? readHistory() : []));
  const [notice, setNotice] = useState("");
  const [switching, setSwitching] = useState(false);
  const [remaining, setRemaining] = useState(null);
  const [search, setSearch] = useState("");
  const input = useRef(null);
  const timer = useRef(null);
  const deadline = useRef(0);
  const composing = useRef(false);
  const latest = useRef({});
  const historyRef = useRef(history);
  const profile = config.profiles.find((p) => p.id === config.activeProfileId) || config.profiles[0];
  function record(item) {
    if (!latest.current.preferences.saveHistory) return;
    try {
      const next = writeHistory([item, ...historyRef.current.filter((entry) => entry.id !== item.id)]);
      historyRef.current = next;
      setHistory(next);
      if (!next.some((entry) => entry.id === item.id))
        setNotice("本次回答过长，未保存到历史。你仍可复制回答。");
    } catch {
      setNotice("浏览器存储空间不足，本次历史未保存。你仍可复制回答。");
    }
  }
  const ask = useAsk({ onRecord: record });
  latest.current = { content, profile, intent, preferences, view, loading, switching };
  function cancelTimer() {
    clearTimeout(timer.current);
    timer.current = null;
    deadline.current = 0;
    setRemaining(null);
  }
  function send(value = latest.current.content, force = true) {
    cancelTimer();
    const state = latest.current;
    if (state.loading || state.switching || state.view !== "ask" || composing.current) return;
    ask.ask({ content: value, profile: state.profile, intent: state.intent }, { force });
  }
  function schedule() {
    cancelTimer();
    const state = latest.current;
    if (
      !state.preferences.autoSend ||
      !state.content.trim() ||
      state.content.length > 50000 ||
      !state.profile ||
      composing.current
    )
      return;
    const delay = state.preferences.delay * 1000;
    deadline.current = Date.now() + delay;
    setRemaining(state.preferences.delay);
    timer.current = setTimeout(() => send(latest.current.content, false), delay);
  }
  function changeContent(value, pasted = false) {
    cancelTimer();
    if (ask.busy) ask.stop();
    latest.current.content = value;
    setContent(value);
    if (pasted && latest.current.preferences.autoSend) send(value, false);
    else schedule();
  }
  function clear() {
    cancelTimer();
    ask.clear();
    setContent("");
    latest.current.content = "";
    setNotice("");
    input.current?.focus();
  }
  function navigate(next) {
    cancelTimer();
    ask.stop();
    setNotice("");
    setView(next);
  }
  function updatePreferences(patch) {
    cancelTimer();
    const next = { ...preferences, ...patch };
    latest.current.preferences = next;
    setPreferences(next);
    try {
      localStorage.setItem(preferenceKey, JSON.stringify(next));
      if (!next.saveHistory) {
        localStorage.removeItem(historyKey);
        historyRef.current = [];
        setHistory([]);
      }
    } catch {
      setNotice("浏览器不允许保存偏好设置，本次会话仍可使用。");
    }
  }
  async function loadConfig(signal) {
    setLoading(true);
    setLoadError("");
    try {
      let next = await requestJson("/api/config", undefined, "GET", signal);
      // One-time migration from the original browser-only configuration.
      let legacy;
      try {
        legacy = JSON.parse(localStorage.getItem("kuaiwen.config") || "null");
      } catch {
        /* Ignore malformed legacy data. */
      }
      if (!next.profiles.length && legacy) {
        const profiles = Array.isArray(legacy.profiles) ? legacy.profiles : legacy.apiKey ? [legacy] : [];
        if (profiles.length)
          next = await requestJson(
            "/api/migrate",
            { profiles, activeProfileId: legacy.activeProfileId },
            "POST",
            signal
          );
      }
      if (legacy && next.profiles.length) {
        try {
          localStorage.removeItem("kuaiwen.config");
        } catch {
          /* Storage may be restricted. */
        }
      }
      if (signal?.aborted) return;
      setConfig(next);
      if (!next.profiles.length) setView("settings");
    } catch (err) {
      if (!signal?.aborted) setLoadError(err.message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    loadConfig(controller.signal);
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const interval = setInterval(() => {
      if (deadline.current) setRemaining(Math.max(1, Math.ceil((deadline.current - Date.now()) / 1000)));
    }, 200);
    const hide = () => {
      if (document.hidden) cancelTimer();
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      clearTimeout(timer.current);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);
  useEffect(() => {
    if (view === "ask" && !loading) input.current?.focus();
  }, [view, loading]);
  async function switchProfile(id) {
    cancelTimer();
    ask.stop();
    setSwitching(true);
    setNotice("");
    latest.current.switching = true;
    try {
      setConfig(await requestJson("/api/active-profile", { profileId: id }, "PUT"));
    } catch (err) {
      setNotice(err.message);
    } finally {
      setSwitching(false);
    }
  }
  async function paste() {
    try {
      changeContent(await navigator.clipboard.readText(), true);
      input.current?.focus();
    } catch {
      setNotice("无法读取剪贴板，请在输入框中使用 Ctrl / ⌘ + V 粘贴。");
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(ask.result.answer);
      setNotice("回答已复制。");
    } catch {
      setNotice("复制失败，请选中回答后手动复制。");
    }
  }
  function openHistory(item) {
    cancelTimer();
    ask.restore(item);
    setContent(item.content);
    setIntent(intentLabels[item.intent] ? item.intent : "auto");
    setView("ask");
    setNotice("已打开历史记录，不会自动发送。");
  }
  function removeHistory(id) {
    try {
      const next = writeHistory(historyRef.current.filter((item) => item.id !== id));
      historyRef.current = next;
      setHistory(next);
    } catch {
      setNotice("删除历史失败，请检查浏览器存储权限。");
    }
  }
  function clearHistory() {
    if (!window.confirm("清空此浏览器的全部历史记录？此操作无法撤销。")) return;
    try {
      localStorage.removeItem(historyKey);
      historyRef.current = [];
      setHistory([]);
    } catch {
      setNotice("清空历史失败，请检查浏览器存储权限。");
    }
  }
  function retry() {
    const result = ask.result;
    cancelTimer();
    const originalProfile = config.profiles.find((p) => p.id === result.profileId);
    if (originalProfile)
      ask.ask({ content: result.content, profile: originalProfile, intent: result.intent }, { force: true });
  }
  const filteredHistory = history.filter((item) =>
    `${item.content}\n${item.answer}`.toLowerCase().includes(search.toLowerCase())
  );
  return (
    <main className="app-shell">
      <header className="topbar">
        <Brand />
        <nav aria-label="主导航">
          <button
            aria-label="历史"
            className={`nav-button ${view === "history" ? "active" : ""}`}
            onClick={() => navigate(view === "history" ? "ask" : "history")}
          >
            <History size={17} />
            <span>历史</span>
          </button>
          <button
            aria-label="设置"
            className={`nav-button ${view === "settings" ? "active" : ""}`}
            onClick={() => navigate(view === "settings" ? "ask" : "settings")}
          >
            <SettingsIcon size={17} />
            <span>设置</span>
          </button>
          <button
            className="icon-button"
            aria-label="退出登录"
            title="退出登录"
            onClick={async () => {
              cancelTimer();
              ask.clear();
              try {
                await requestJson("/api/logout", {});
                onLogout();
              } catch (err) {
                setNotice(err.message);
              }
            }}
          >
            <LogOut size={17} />
          </button>
        </nav>
      </header>
      {notice && (
        <div className="notice dismissible" role="status">
          <span>{notice}</span>
          <button aria-label="关闭提示" className="icon-button" onClick={() => setNotice("")}>
            <X size={15} />
          </button>
        </div>
      )}
      {loading ? (
        <div className="loading-state">
          <Loader2 className="spin" />
          正在读取模型配置…
        </div>
      ) : loadError ? (
        <div className="panel empty-state">
          <h2>暂时无法读取模型配置</h2>
          <p role="alert">{loadError}</p>
          <button className="primary-button" onClick={() => loadConfig()}>
            重新加载
          </button>
        </div>
      ) : view === "settings" ? (
        <>
          <div className="page-heading">
            <button className="text-button" onClick={() => navigate("ask")}>
              <ArrowLeft size={16} />
              返回快问
            </button>
            <h2>把快问调成你的习惯</h2>
            <p>模型配置跨设备共享，使用偏好仅保存在当前浏览器</p>
          </div>
          <Settings config={config} onConfig={setConfig} />
          <section className="panel preferences">
            <h2>使用偏好</h2>
            <div className="preference-row">
              <div>
                <strong>自动发送</strong>
                <p>粘贴立即发送；手动输入停顿后发送</p>
              </div>
              <label className="switch-label">
                <input
                  type="checkbox"
                  checked={preferences.autoSend}
                  onChange={(e) => updatePreferences({ autoSend: e.target.checked })}
                />
                开启自动发送
              </label>
            </div>
            <div className="preference-row">
              <div>
                <strong>输入停顿时长</strong>
                <p>中文输入法选字时不会自动发送</p>
              </div>
              <select
                aria-label="自动发送延迟"
                value={preferences.delay}
                disabled={!preferences.autoSend}
                onChange={(e) => updatePreferences({ delay: Number(e.target.value) })}
              >
                {[1, 3, 5, 10].map((value) => (
                  <option value={value} key={value}>
                    {value} 秒
                  </option>
                ))}
              </select>
            </div>
            <div className="preference-row">
              <div>
                <strong>保存最近记录</strong>
                <p>最多 30 条，仅保存在此浏览器，关闭后清除已有记录</p>
              </div>
              <label className="switch-label">
                <input
                  type="checkbox"
                  checked={preferences.saveHistory}
                  onChange={(e) => updatePreferences({ saveHistory: e.target.checked })}
                />
                保存历史
              </label>
            </div>
          </section>
        </>
      ) : view === "history" ? (
        <>
          <div className="page-heading">
            <button className="text-button" onClick={() => navigate("ask")}>
              <ArrowLeft size={16} />
              返回快问
            </button>
            <h2>最近问过的</h2>
            <p>单次问答，随时回看，记录仅在当前浏览器保存</p>
          </div>
          <section className="panel history-panel">
            <div className="history-toolbar">
              <input
                aria-label="搜索历史"
                placeholder="搜索输入或回答…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button className="secondary-button" disabled={!history.length} onClick={clearHistory}>
                <Trash2 size={16} />
                清空历史
              </button>
            </div>
            {filteredHistory.length ? (
              filteredHistory.map((item) => (
                <div className="history-item" key={item.id}>
                  <button className="history-main" onClick={() => openHistory(item)}>
                    <div className="history-meta">
                      <span>{intentLabels[item.intent] || "自动识别"}</span>
                      <span>{item.profileName}</span>
                      <time>
                        {new Date(item.createdAt).toLocaleString("zh-CN", {
                          month: "numeric",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit"
                        })}
                      </time>
                      {item.status !== "complete" && <span>未完成</span>}
                    </div>
                    <strong>{item.content}</strong>
                    <p>{item.answer}</p>
                  </button>
                  <button
                    className="icon-button"
                    aria-label="删除这条记录"
                    onClick={() => removeHistory(item.id)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))
            ) : (
              <div className="empty-state">
                <Clock3 size={28} />
                <h3>{search ? "没有匹配的记录" : "这里留给下一次回看"}</h3>
                <p>
                  {preferences.saveHistory
                    ? "完成一次快问后，回答会出现在这里"
                    : "历史保存已关闭，可以在设置中开启"}
                </p>
              </div>
            )}
          </section>
        </>
      ) : (
        <>
          <div className="workspace-heading">
            <div>
              <span className="eyebrow">快速提问</span>
              <h2>把问题放在这里</h2>
              <p>命令、英文、报错或日志，直接贴进来</p>
            </div>
            <ModelMenu
              profile={profile}
              profiles={config.profiles}
              disabled={switching}
              onSelect={switchProfile}
            />
          </div>
          {!profile ? (
            <section className="panel empty-state">
              <Zap size={28} />
              <h2>先连接一个模型</h2>
              <p>填好 API Key、接口地址和模型名称，就可以开始</p>
              <button className="primary-button" onClick={() => navigate("settings")}>
                添加模型 <ArrowUpRight size={17} />
              </button>
            </section>
          ) : (
            <div className="workspace">
              <section className="editor-panel panel" aria-label="输入">
                <div className="panel-heading">
                  <div className="section-title">
                    <span className="input-marker">问</span>
                    <h2>你的内容</h2>
                  </div>
                  <div className="toolbar">
                    <button
                      className="icon-button"
                      title="从剪贴板粘贴"
                      aria-label="从剪贴板粘贴"
                      onClick={paste}
                      disabled={switching}
                    >
                      <Clipboard size={17} />
                    </button>
                    <button className="icon-button" title="清空" aria-label="清空输入和回答" onClick={clear}>
                      <Trash2 size={17} />
                    </button>
                  </div>
                </div>
                <div className="intent-tabs" role="group" aria-label="处理方式">
                  {Object.entries(intentLabels).map(([key, label]) => (
                    <button
                      key={key}
                      aria-pressed={intent === key}
                      disabled={switching}
                      onClick={() => {
                        cancelTimer();
                        ask.stop();
                        setIntent(key);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <textarea
                  ref={input}
                  aria-label="输入内容"
                  value={content}
                  disabled={switching}
                  spellCheck="false"
                  placeholder={"粘贴命令、英文、报错或日志…\n\n例如：\nPermission denied (publickey)."}
                  onChange={(e) => changeContent(e.target.value)}
                  onPaste={(e) => {
                    const text = e.clipboardData.getData("text");
                    if (!text) return;
                    e.preventDefault();
                    const target = e.currentTarget;
                    const start = target.selectionStart;
                    const value =
                      target.value.slice(0, start) + text + target.value.slice(target.selectionEnd);
                    changeContent(value, true);
                    requestAnimationFrame(() =>
                      input.current?.setSelectionRange(start + text.length, start + text.length)
                    );
                  }}
                  onCompositionStart={() => {
                    composing.current = true;
                    cancelTimer();
                  }}
                  onCompositionEnd={(e) => {
                    composing.current = false;
                    changeContent(e.currentTarget.value);
                  }}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing &&
                      !composing.current &&
                      e.keyCode !== 229
                    ) {
                      e.preventDefault();
                      send();
                    }
                  }}
                />
                <div className="editor-meta">
                  <span className={content.length > 50000 ? "error-text" : ""}>
                    {content.length.toLocaleString()} / 50,000 字符
                  </span>
                  <span>Enter 发送 · Shift + Enter 换行</span>
                </div>
                <div className="action-row">
                  <button
                    className={`auto-button ${preferences.autoSend ? "enabled" : ""}`}
                    aria-pressed={preferences.autoSend}
                    onClick={() => updatePreferences({ autoSend: !preferences.autoSend })}
                  >
                    <span className="status-dot" />
                    {remaining
                      ? `${remaining} 秒后发送`
                      : preferences.autoSend
                        ? "自动发送已开启"
                        : "手动发送"}
                  </button>
                  {ask.busy ? (
                    <button
                      className="stop-button"
                      onClick={() => {
                        cancelTimer();
                        ask.stop();
                      }}
                    >
                      <Square size={15} fill="currentColor" />
                      停止生成
                    </button>
                  ) : (
                    <button
                      className="primary-button"
                      disabled={switching || !content.trim() || content.length > 50000}
                      onClick={() => send()}
                    >
                      <Send size={16} />
                      快问一下
                    </button>
                  )}
                </div>
                <div className="editor-footnote">
                  {preferences.autoSend
                    ? "粘贴即发，需要整理内容时可先关闭自动发送"
                    : "准备好后，按 Enter 或点击“快问一下”"}
                </div>
              </section>
              <Answer
                result={ask.result}
                busy={ask.busy}
                onRetry={retry}
                onCopy={copy}
                canRetry={!switching && !!config.profiles.find((p) => p.id === ask.result?.profileId)}
              />
            </div>
          )}
          <footer className="app-footer">
            <span>快问，问你想问</span>
            <span>AI 的判断可能有误，执行命令前请确认影响</span>
          </footer>
        </>
      )}
    </main>
  );
}

function App() {
  const [session, setSession] = useState("checking");
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    requestJson("/api/session", undefined, "GET", controller.signal)
      .then((data) => setSession(data.authenticated ? "yes" : "no"))
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError("无法连接服务器，请检查服务是否启动。");
          setSession("no");
        }
      });
    const expired = () => {
      setError("登录已失效，请重新登录。");
      setSession("no");
    };
    window.addEventListener("session-expired", expired);
    return () => {
      controller.abort();
      window.removeEventListener("session-expired", expired);
    };
  }, []);
  if (session === "checking")
    return (
      <div className="login-shell">
        <Loader2 className="spin" aria-label="正在检查登录状态" />
      </div>
    );
  return session === "yes" ? (
    <Workspace
      onLogout={() => {
        setError("");
        setSession("no");
      }}
    />
  ) : (
    <Login
      initialError={error}
      onLogin={() => {
        setError("");
        setSession("yes");
      }}
    />
  );
}
createRoot(document.getElementById("root")).render(<App />);

import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, PlugZap, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { requestJson } from "./api";

const emptyDraft = () => ({ name: "", baseUrl: "", model: "", apiKey: "" });

function ModelCombobox({ value, options, disabled, onChange }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  useEffect(() => {
    if (options.length) setOpen(true);
  }, [options]);
  useEffect(() => {
    const close = (event) => {
      if (!root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  function keyDown(event) {
    if (event.key === "Escape") setOpen(false);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
    }
  }
  return (
    <div className="model-combobox" ref={root}>
      <div className="model-combobox-input">
        <input
          role="combobox"
          aria-label="模型名称"
          aria-expanded={open}
          aria-controls="available-models"
          required
          value={value}
          disabled={disabled}
          onFocus={() => setOpen(options.length > 0)}
          onKeyDown={keyDown}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
          }}
          placeholder="手动输入或选择模型"
        />
        <button
          type="button"
          className="combobox-toggle"
          aria-label="展开模型列表"
          disabled={disabled || !options.length}
          onClick={() => setOpen((current) => !current)}
        >
          <ChevronDown size={17} className={open ? "open" : ""} />
        </button>
      </div>
      {open && options.length > 0 && (
        <div className="model-options" id="available-models" role="listbox" aria-label="可用模型">
          <div className="model-options-heading">已获取 {options.length} 个模型</div>
          {options.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={value === option}
              className="model-option"
              key={option}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
            >
              <span>{option}</span>
              {value === option && <Check size={16} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Settings({ config, onConfig }) {
  const [draft, setDraft] = useState(
    () => config.profiles.find((p) => p.id === config.activeProfileId) || emptyDraft()
  );
  const [models, setModels] = useState([]);
  const [pending, setPending] = useState("");
  const [notice, setNotice] = useState(null);
  const operation = useRef(null);

  useEffect(() => () => operation.current?.abort(), []);
  function edit(profile) {
    setDraft({ ...profile, apiKey: "" });
    setModels([]);
    setNotice(null);
  }
  function field(key, value) {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setNotice(null);
  }
  async function run(kind, callback) {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setPending(kind);
    setNotice(null);
    try {
      await callback(controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) setNotice({ error: true, message: error.message });
    } finally {
      if (!controller.signal.aborted) setPending("");
      operation.current = null;
    }
  }
  function save(event) {
    event.preventDefault();
    run("save", async (signal) => {
      const next = await requestJson("/api/profiles", draft, "POST", signal);
      onConfig(next);
      const profile = next.profiles.find((item) => item.id === draft.id) || next.profiles.at(-1);
      setDraft({ ...profile, apiKey: "" });
      setNotice({ message: "模型已保存。" });
    });
  }
  function remove(profile) {
    if (!window.confirm(`删除模型“${profile.name}”？历史记录会保留。`)) return;
    run("delete", async (signal) => {
      const next = await requestJson(
        `/api/profiles/${encodeURIComponent(profile.id)}`,
        undefined,
        "DELETE",
        signal
      );
      onConfig(next);
      if (draft.id === profile.id) edit(next.profiles[0] || emptyDraft());
      setNotice({ message: "模型已删除。" });
    });
  }
  return (
    <section className="settings-surface" aria-label="模型设置">
      <aside className="settings-index">
        <div className="settings-index-heading">
          <span className="eyebrow">模型</span>
          <h2>模型档案</h2>
          <p>选择一个模型作为当前回答引擎</p>
        </div>
        <button
          type="button"
          className="add-profile-button"
          disabled={!!pending}
          onClick={() => edit(emptyDraft())}
        >
          <Plus size={17} />
          新增模型
        </button>
        <div className="profile-items">
          {!config.profiles.length && <p className="muted">还没有模型档案</p>}
          {config.profiles.map((profile) => (
            <div className={`profile-item ${draft.id === profile.id ? "selected" : ""}`} key={profile.id}>
              <button className="profile-main" disabled={!!pending} onClick={() => edit(profile)}>
                <span className="profile-name-line">
                  <strong>{profile.name}</strong>
                  {profile.id === config.activeProfileId && <Check size={14} />}
                </span>
                <small>{profile.model}</small>
              </button>
              <button
                className="icon-button subtle"
                aria-label={`删除 ${profile.name}`}
                disabled={!!pending}
                onClick={() => remove(profile)}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      </aside>
      <form className="settings-editor" onSubmit={save}>
        <div className="settings-editor-heading">
          <div>
            <span className="eyebrow">连接</span>
            <h2>{draft.id ? "编辑模型" : "添加模型"}</h2>
            <p>连接你自己的 OpenAI 兼容服务</p>
          </div>
          <span className="settings-editor-icon">
            <PlugZap size={20} />
          </span>
        </div>
        <fieldset disabled={!!pending}>
          <div className="settings-fields">
            <label>
              <span>显示名称</span>
              <input
                aria-label="显示名称"
                value={draft.name}
                maxLength={200}
                onChange={(event) => field("name", event.target.value)}
                placeholder="例如：日常快问"
              />
            </label>
            <label>
              <span>Base URL</span>
              <input
                aria-label="Base URL"
                type="url"
                required
                value={draft.baseUrl}
                onChange={(event) => field("baseUrl", event.target.value)}
                placeholder="https://api.example.com/v1"
              />
              <em>根地址会自动补上 /v1，也可以填写服务商的完整基础路径</em>
            </label>
            <label>
              <span>API Key</span>
              <input
                aria-label="API Key"
                type="password"
                autoComplete="new-password"
                required={!draft.hasApiKey}
                value={draft.apiKey || ""}
                onChange={(event) => field("apiKey", event.target.value)}
                placeholder={draft.hasApiKey ? "已保存，留空保留原密钥" : "输入 API Key"}
              />
              <em>密钥只保存在服务器，编辑时留空即可保留</em>
            </label>
            <label className="model-field">
              <span>模型名称</span>
              <ModelCombobox
                value={draft.model}
                options={models}
                disabled={!!pending}
                onChange={(value) => field("model", value)}
              />
            </label>
          </div>
          <div className="settings-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                run("models", async (signal) => {
                  const payload = await requestJson("/api/models", draft, "POST", signal);
                  setModels(payload.models);
                  setNotice({
                    message: payload.models.length
                      ? `已获取 ${payload.models.length} 个模型，点击模型名称即可选择。`
                      : "模型列表为空，可手动填写。"
                  });
                })
              }
            >
              {pending === "models" ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
              获取列表
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                run("test", async (signal) => {
                  const result = await requestJson("/api/test", draft, "POST", signal);
                  setNotice({
                    message: `连接成功，模型可以回答（${(result.elapsedMs / 1000).toFixed(1)} 秒）。`
                  });
                })
              }
            >
              {pending === "test" ? <Loader2 size={16} className="spin" /> : <PlugZap size={16} />}
              测试连接
            </button>
            <button type="submit" className="primary-button">
              {pending === "save" ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
              保存模型
            </button>
          </div>
          <p className="settings-footnote">测试连接会向模型发送一条简短请求，可能产生少量用量</p>
        </fieldset>
        {notice && (
          <div role={notice.error ? "alert" : "status"} className={`notice ${notice.error ? "error" : ""}`}>
            {notice.message}
          </div>
        )}
      </form>
    </section>
  );
}

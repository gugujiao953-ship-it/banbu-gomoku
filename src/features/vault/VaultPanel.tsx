/**
 * **本机凭证**面板（2026-10-11 第六轮重写）。
 *
 * 用户这一轮定的形态：
 * 「把凭证做成一个入口吧，就是，想啥时候生成凭证就啥时候生成凭证，还可以给凭证命名，
 *  理论上我们可以用别人的凭证去登入。然后这个有导入凭证和导出凭证，这个凭证一般就导出
 *  关于棋魂，成就，战绩等这些数值类的，但是也可以选择连同备份一起导出，就是导出后，
 *  即使换机，也可以全部导入，和之前一模一样」
 *
 * 所以面板是**两栏事**，不再是"一份自动维护的档案"：
 *
 * ```
 * ┌─ 我的凭证 ──────────────────────────────┐
 * │ 我的主力号        导出 10-11 · 数值 · 重新导出 │
 * │ 给孩子用的        还没导出过 · 导出          │
 * │ [ + 新建一份凭证 ]                        │
 * └────────────────────────────────────────┘
 * ┌─ 导入凭证（换机 / 用别人的）──────────────┐
 * │ [选择凭证文件] → 输恢复码 → 看是谁的 → 确认  │
 * └────────────────────────────────────────┘
 * ```
 *
 * ## 三个必须让用户看清的点（都不是装饰）
 *
 * ① **范围**：这份凭证含不含棋谱。它决定恢复时是"只覆盖数值"还是"整份替换" ——
 *    也就是"会不会动我的棋谱"。所以它写在名字旁边，导出前还要再选一次。
 * ② **恢复码**：默认打点、可显示、可复制。丢了这个码，那份文件就是废纸。
 * ③ **导入的是谁的**：解开之后先显示"名字 + 导出时间 + 范围"，
 *    再让用户确认 —— "用别人的凭证登入"意味着选错人是有代价的。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Copy, Download, FileKey2, Lock, RefreshCw, Trash2, Upload, UserPlus } from "lucide-react";
import {
  applyVaultSnapshot, canEncrypt, codeHintOf, createVaultEntry, exportVault, formatCodeOf,
  isWellFormedCode, loadVaultRegistry, markVaultExported, normalizeCode, parseVaultFile, readVault,
  registerImportedVault, removeVaultEntry, renameVaultEntry, vaultFilename,
  type VaultEntry, type VaultFile,
} from "./vault";
import type { BackupSnapshot, BackupScope } from "../../backup";
import { describeVaultFailure, type VaultCryptoFailure } from "./vault-crypto";
import "./vault.css";

/** 导出/导入时选的范围。**默认"只数值"**（用户原话"一般就导出……数值类的"）。 */
const SCOPE_LABEL: Record<BackupScope, string> = {
  state: "只含数值（棋魂 / 成就 / 战绩 / 进度 / 设置）",
  full: "连棋谱一起（换机可完全一样）",
};

const formatWhen = (iso: string | null): string => {
  if (!iso) return "还没导出过";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "时间未知";
  const delta = Date.now() - date.getTime();
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return date.toLocaleDateString("zh-CN");
};

export interface VaultPanelProps {
  appVersion: string;
  /** 恢复成功后刷新页面（数据换了，内存里的 state 不会自动重读）。 */
  onRestored: () => void;
}

export function VaultPanel({ appVersion, onRestored }: VaultPanelProps) {
  const [entries, setEntries] = useState<VaultEntry[]>(() => loadVaultRegistry());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  /** 哪一条的码正在显示（默认全打点）。 */
  const [revealed, setRevealed] = useState<string | null>(null);
  /** 哪一条正在改名。 */
  const [renaming, setRenaming] = useState<string | null>(null);
  /** 导出范围选择（新建或再次导出时用）。 */
  const [scope, setScope] = useState<BackupScope>("state");
  /** 新建时的名字输入。 */
  const [newName, setNewName] = useState("");
  /** 刚建好、等着导出的那一条（要把码给用户看）。 */
  const [pending, setPending] = useState<VaultEntry | null>(null);
  /** 导入：选好的文件与输入的码。 */
  const [importFile, setImportFile] = useState<VaultFile | null>(null);
  const [importCode, setImportCode] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  /** 解开之后的预览（等用户确认）。 */
  const [preview, setPreview] = useState<{ file: VaultFile; code: string; snapshot: BackupSnapshot; summary: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const supported = canEncrypt();

  useEffect(() => { setEntries(loadVaultRegistry()); }, []);
  const refresh = useCallback(() => setEntries(loadVaultRegistry()), []);

  // ── 新建 + 导出 ──────────────────────────────────────────────────
  const handleCreate = () => {
    setError(null);
    const entry = createVaultEntry(newName);
    setNewName("");
    setPending(entry);
    refresh();
  };

  const handleExport = async (entry: VaultEntry, targetScope: BackupScope) => {
    setBusy(true);
    setError(null);
    const result = await exportVault({ entry, appVersion, scope: targetScope });
    setBusy(false);
    if (!result.ok) { setError(result.error ?? "导出失败"); return; }
    markVaultExported(entry.vaultId, targetScope, result.exportedAt ?? new Date().toISOString());
    refresh();
    setPending(null);
    setError(null);
  };

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch { setError("复制失败，请手动抄写。"); }
  };

  // ── 导入 ─────────────────────────────────────────────────────────
  const handleFilePicked = async (file: File | undefined) => {
    if (!file) return;
    setImportError(null);
    setPreview(null);
    try {
      setImportFile(parseVaultFile(await file.text()));
      setImportCode("");
    } catch (failure) {
      setImportFile(null);
      setImportError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  const handleUnlock = async () => {
    if (!importFile) return;
    setBusy(true);
    setImportError(null);
    const result = await readVault(importFile, importCode);
    setBusy(false);
    if (!result.ok || !result.snapshot) {
      /**
       * ⚠ **优先用 `result.error`（那句是具体成因），只有在它缺失时才回落类别话术**。
       *
       * `describeVaultFailure` 是"按类别给一句通用话"，而 `readVault` 里已经
       * 针对具体成因写了更准的话（比如"恢复码不完整：应该是 16 位"）。
       * 第一版只按类别显示，于是"码抄漏了几位"被说成"文件不像凭证"——
       * 把用户引去查文件，白折腾一圈（门禁抓到的就是这个）。
       */
      const base = result.error || describeVaultFailure((result.failure ?? "bad-code") as VaultCryptoFailure);
      /** 解不开时先分清一件事：**这台机器认不认识这份凭证**。认识（登记过、还存着码）而刚才那次又没解开，
       *  那多半是"粘贴的码不是这一份的"——把话指向下面那颗按钮，而不是让用户去怀疑文件。 */
      const known = entries.find((entry) => entry.vaultId === importFile.vaultId && entry.code);
      setImportError(known && normalizeCode(known.code) !== normalizeCode(importCode) && result.failure === "bad-code"
        ? `${base} 这台机器还记着这一份的码（${codeHintOf(known.code)}），点下面那颗直接用它。`
        : base);
      return;
    }
    const summary = result.snapshot.contentSummary;
    const when = result.exportedAt ? new Date(result.exportedAt).toLocaleString("zh-CN", { hour12: false }) : "时间未知";
    const lines = [
      `来自「${result.name}」· 导出于 ${when}`,
      `应用版本 ${result.snapshot.appVersion}`,
      summary ? `棋谱 ${summary.records} 份 · 题集 ${summary.puzzles} 道 · 草稿 ${summary.drafts} 份` : "内容摘要不可用",
      SCOPE_LABEL[result.scope ?? "state"],
    ];
    setPreview({ file: { ...importFile, scope: result.scope ?? importFile.scope }, code: importCode, snapshot: result.snapshot, summary: lines.join(" · ") });
  };

  const handleApply = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      await applyVaultSnapshot({ snapshot: preview.snapshot, scope: preview.file.scope });
      // 记进登记表：之后随时能再看码/再导出（**不是自动续写**，见 vault.ts 的说明）。
      registerImportedVault(preview.file, preview.code);
      onRestored();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setBusy(false);
    }
  };

  if (!supported) {
    return <div className="vault-panel" data-vault-panel="">
      <div className="vault-note vault-note--warn" role="note">
        <AlertTriangle size={15}/>
        <span><b>这台设备或这个地址不支持加密凭证</b>
          <small>凭证要加密（WebCrypto 的 AES-GCM），而它只在 HTTPS 或应用内环境可用。
            网页版请改用 https 地址；应用内出现这句说明系统 WebView 过旧。</small></span>
      </div>
      <p className="vault-foot">在支持之前，请继续用「一键备份」手动导出 —— 那条路不依赖加密。</p>
    </div>;
  }

  return <div className="vault-panel" data-vault-panel="">
    <p className="vault-intro">
      凭证是一份**加密的小文件**：导出后存到哪儿由你决定，换机时导入它就能把
      棋魂、成就、战绩、进度这些数值搬过去。它不进云端、不上传，全在你手里。
    </p>

    {/* ── 我的凭证（列表）────────────────────────────────────────── */}
    <section className="vault-list" aria-label="我的凭证" data-vault-list>
      <h3 className="vault-list-title">我的凭证</h3>
      {entries.length === 0 && <p className="vault-foot">还没有凭证。下面建一份，想什么时候导出就什么时候导出。</p>}
      {entries.map((entry) => {
        const revealing = revealed === entry.vaultId;
        const isRenaming = renaming === entry.vaultId;
        return <div className="vault-card" key={entry.vaultId} data-vault-entry={entry.vaultId}>
          <div className="vault-card-head">
            {isRenaming
              ? <input className="vault-name-input" defaultValue={entry.name} autoFocus data-vault-nameinput
                onBlur={(event) => { renameVaultEntry(entry.vaultId, event.target.value); setRenaming(null); refresh(); }}
                onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }}/>
              : <b className="vault-card-name" data-vault-name>{entry.name}</b>}
            <small className="vault-card-when" data-vault-when>
              {formatWhen(entry.lastExportedAt)}
              {entry.lastScope ? ` · ${entry.lastScope === "state" ? "只数值" : "含棋谱"}` : " · 还没导出"}
            </small>
          </div>

          <div className="vault-code-row">
            <span className="vault-code-label"><Lock size={13}/> 恢复码</span>
            <code className="vault-code" data-vault-code>{revealing ? formatCodeOf(entry.code) : `${entry.code.slice(0, 4)}············`}</code>
            <button type="button" className="vault-mini" data-vault-reveal onClick={() => setRevealed(revealing ? null : entry.vaultId)}>
              {revealing ? "隐藏" : "显示"}
            </button>
            <button type="button" className="vault-mini" data-vault-copy onClick={() => { void copy(entry.code, entry.vaultId); }}>
              {copied === entry.vaultId ? <Check size={12}/> : <Copy size={12}/>} {copied === entry.vaultId ? "已复制" : "复制"}
            </button>
          </div>

          <div className="vault-actions">
            <button type="button" className="vault-button vault-button--primary" disabled={busy} data-vault-export
              onClick={() => { void handleExport(entry, scope); }}>
              <Download size={14}/> {busy ? "正在导出…" : entry.lastExportedAt ? "重新导出" : "导出"}
            </button>
            <button type="button" className="vault-mini" onClick={() => setRenaming(entry.vaultId)} data-vault-rename>改名</button>
            <button type="button" className="vault-mini" data-vault-forget
              onClick={() => {
                if (!window.confirm(`从列表里移除「${entry.name}」？\n\n已导出的文件不会被删除，恢复码也不会失效；只是这里不再列出它。`)) return;
                removeVaultEntry(entry.vaultId);
                refresh();
              }}><Trash2 size={11}/> 移除</button>
          </div>
          {/* ⚠ 这句必须写在每张卡上：恢复码丢了那份文件就是废纸，没有后门。 */}
          <p className="vault-code-warn"><AlertTriangle size={12}/>这串码是这份凭证唯一的钥匙，请抄下来。丢了就打不开。</p>
        </div>;
      })}
    </section>

    {/* ── 范围选择（导出用；默认只数值）──────────────────────────── */}
    <section className="vault-scope" aria-label="导出范围">
      <b>导出范围</b>
      {(["state", "full"] as BackupScope[]).map((value) => <label className="vault-toggle" key={value}>
        <input type="radio" name="vault-scope" checked={scope === value} data-vault-scope={value}
          onChange={() => setScope(value)}/>
        <span>
          <b>{value === "state" ? "只含数值" : "连棋谱一起"}</b>
          <small>{value === "state"
            ? "棋魂、成就、战绩、进度与设置。导入时**只覆盖这些，不动你的棋谱**。"
            : "数值 + 棋谱库 + 大型棋谱。导入时**整份替换**，换机之后和之前一模一样。"}</small>
        </span>
      </label>)}
    </section>

    {/* ── 新建 ──────────────────────────────────────────────────── */}
    <section className="vault-create" aria-label="新建凭证">
      <b><FileKey2 size={14}/> 新建一份凭证</b>
      <p className="vault-foot">可以给凭证起名字（"我的主力号""平板那份"），方便在文件列表里认出来。</p>
      <div className="vault-actions">
        <input className="vault-name-input" placeholder="凭证名字（可留空）" value={newName} data-vault-newname
          onChange={(event) => setNewName(event.target.value)}/>
        <button type="button" className="vault-button vault-button--primary" onClick={handleCreate} data-vault-create>
          <FileKey2 size={14}/> 生成恢复码
        </button>
      </div>
    </section>

    {/* ── 刚建好：把码给用户看，然后导出 ─────────────────────────── */}
    {pending && <section className="vault-created" data-vault-created>
      <b>「{pending.name}」已生成 —— 请先抄下恢复码</b>
      <code className="vault-code vault-code--big" data-vault-newcode>{formatCodeOf(pending.code)}</code>
      <div className="vault-actions">
        <button type="button" className="vault-mini" onClick={() => { void copy(pending.code, "new"); }}>
          {copied === "new" ? <Check size={12}/> : <Copy size={12}/>} 复制
        </button>
      </div>
      {pending.codeSource === "weak" && <p className="vault-error">⚠ 这台环境没有密码学随机源，这串码强度不足，建议换环境重新生成。</p>}
      <label className="vault-toggle">
        <input type="checkbox" id="vault-ack" data-vault-ack/><span><b>我已抄下恢复码</b><small>丢了它，这份凭证就打不开了。</small></span>
      </label>
      <button type="button" className="vault-button vault-button--primary" disabled={busy} data-vault-first-export
        onClick={() => {
          const ack = document.getElementById("vault-ack") as HTMLInputElement | null;
          if (!ack?.checked) { setError("请先确认已抄下恢复码。"); return; }
          void handleExport(pending, scope);
        }}>
        <Download size={14}/> 导出这份凭证（{scope === "state" ? "只数值" : "连棋谱"}）
      </button>
    </section>}

    {/* ── 导入（换机 / 用别人的凭证）────────────────────────────── */}
    <section className="vault-import" aria-label="导入凭证">
      <b><UserPlus size={14}/> 导入凭证</b>
      <p className="vault-foot">换机之后、或者用别人的凭证登入：选那份文件，输入它的恢复码。</p>
      <button type="button" className="vault-button" onClick={() => fileInput.current?.click()} data-vault-pick>
        <Upload size={14}/> 选择凭证文件
      </button>
      {importError && <p className="vault-error" role="alert">{importError}</p>}

      {importFile && !preview && <div className="vault-restoring" data-vault-restoring>
        <p className="vault-foot" data-vault-fileinfo>
          文件：「{importFile.name}」· {formatWhen(importFile.exportedAt)} 导出 · {SCOPE_LABEL[importFile.scope]}
          {/* 文件里带着「码的前 4 位」（不足以还原码子）。先把它亮出来，用户一眼就能判断
              手上那份码到底是不是这一份的 —— 这是"中途又点了一次新建、结果复制的是另一份的码"
              唯一的自查手段（用户 2026-10-15 报的"粘贴回去说码错误"最可能就是这一类）。 */}
          {importFile.codeHint && <b data-vault-codehint> · 这份的码以 {importFile.codeHint.slice(0, 4)} 开头</b>}
        </p>
        {(() => {
          const known = entries.find((entry) => entry.vaultId === importFile.vaultId && entry.code);
          if (!known) return null;
          return <button type="button" className="vault-button vault-button--quiet" data-vault-use-registry
            onClick={() => { setImportCode(known.code); setImportError(null); }}>
            用这台机器记着的码（「{known.name}」，{codeHintOf(known.code)}）
          </button>;
        })()}
        <input className="vault-input" type="text" autoComplete="off" spellCheck={false}
          placeholder="7K2M-9QX4-H3VP-NB6T" value={importCode} data-vault-codeinput
          onChange={(event) => { setImportCode(event.target.value); setImportError(null); }}/>
        <div className="vault-actions">
          <button type="button" className="vault-button vault-button--primary" disabled={busy} data-vault-unlock
            onClick={() => { void handleUnlock(); }}>
            {busy ? "正在解开…" : "解开看看"}
          </button>
          <button type="button" className="vault-button vault-button--quiet"
            onClick={() => { setImportFile(null); setImportCode(""); }}>取消</button>
        </div>
        {!isWellFormedCode(importCode) && importCode.length > 0 &&
          <p className="vault-hint">恢复码应该是 16 位（连字符可以不管）。</p>}
      </div>}

      {preview && <div className="vault-preview" data-vault-preview>
        <b>确认要导入这份凭证吗</b>
        <p className="vault-preview-summary" data-vault-preview-summary>{preview.summary}</p>
        {/* ⚠ 恢复语义必须在这里讲清 —— 用户要能一眼看出"这次会不会动我的棋谱"。 */}
        <p className="vault-foot" data-vault-scope-warning>
          {preview.file.scope === "full"
            ? "这是「连棋谱一起」的凭证：导入会用它的内容**整份替换**本机数据（失败会自动回滚）。"
            : "这是「只含数值」的凭证：导入只覆盖棋魂、成就、战绩、进度与设置，**不会动你的棋谱**。"}
        </p>
        <div className="vault-actions">
          <button type="button" className="vault-button vault-button--primary" disabled={busy} data-vault-apply
            onClick={() => { void handleApply(); }}>
            {busy ? "正在导入…" : "确认导入"}
          </button>
          <button type="button" className="vault-button vault-button--quiet"
            onClick={() => { setPreview(null); setImportFile(null); setImportCode(""); }}>取消</button>
        </div>
      </div>}
    </section>

    {/* 文件名提示：用户要能把"列表里这条"和"下载夹里那个文件"对上。 */}
    {entries.length > 0 && <p className="vault-hint" data-vault-filenames>
      导出的文件名形如：{vaultFilename(entries[0])}（名字 + 凭证 id，一个文件夹里能放多份）。
    </p>}

    {error && <p className="vault-error" role="alert">{error}</p>}
    {copied && <p className="vault-ok" role="status">恢复码已复制到剪贴板。<RefreshCw size={12}/></p>}

    <input ref={fileInput} type="file" hidden accept=".json,application/json" data-vault-file
      onChange={(event) => { void handleFilePicked(event.target.files?.[0]); event.target.value = ""; }}/>
  </div>;
}

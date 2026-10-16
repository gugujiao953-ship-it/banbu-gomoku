/**
 * iKataGo 云引擎的连接设置（用户填自己的服务器地址自连）。
 *
 * 与 KataTuning（本机旗舰的线程/缓存）分开：这是**网络连接**参数，改动后
 * 下一次分析请求就会带上新配置（worker 侧 pinIkatago 检测到变化会重连），
 * 不需要重启进程——所以这里不触发引擎重启。
 *
 * 凭据处理：只存本机 localStorage，不回传任何第三方；明文 ws:// 会给出风险提示。
 */
import { useEffect, useState } from "react";
import {
  IKATAGO_DEFAULT_CONFIG,
  IKATAGO_PLATFORM_CHOICES,
  ikatagoUrlProblem,
  loadIkatagoConfig,
  saveIkatagoConfig,
  type IkatagoConfig,
} from "./ikatago";

export function IkatagoTuning({ onNotice }: { onNotice?: (message: string) => void }) {
  const [config, setConfig] = useState<IkatagoConfig>(loadIkatagoConfig);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setConfig(loadIkatagoConfig()); }, []);

  const problem = ikatagoUrlProblem(config.serverUrl);
  const insecure = problem === "INSECURE";
  const invalid = problem !== null && problem !== "INSECURE";

  const update = (patch: Partial<IkatagoConfig>) => {
    setConfig((current) => ({ ...current, ...patch }));
    setDirty(true);
  };

  const save = () => {
    if (invalid) { onNotice?.(problem || "服务器地址无效"); return; }
    saveIkatagoConfig(config);
    setDirty(false);
    onNotice?.(insecure ? "已保存（明文 ws:// 会暴露凭据，建议改用 wss://）" : "云端引擎配置已保存，下一次分析生效");
  };

  return (
    <div className="ikatago-tuning">
      <label className="ikatago-field">
        <span>服务器地址</span>
        <input
          type="url"
          inputMode="url"
          placeholder="wss://example.com:8080"
          value={config.serverUrl}
          onChange={(event) => update({ serverUrl: event.target.value })}
        />
      </label>
      {invalid && <p className="ikatago-note warn" role="alert">{problem}</p>}
      {insecure && <p className="ikatago-note warn" role="alert">明文 ws:// 会让用户名密码与棋谱在网络上裸奔，建议用 wss:// 或仅在可信局域网使用</p>}
      <div className="ikatago-row">
        <label className="ikatago-field">
          <span>用户名</span>
          <input type="text" autoComplete="off" value={config.username} onChange={(event) => update({ username: event.target.value })}/>
        </label>
        <label className="ikatago-field">
          <span>密码</span>
          <input type="password" autoComplete="off" value={config.password} onChange={(event) => update({ password: event.target.value })}/>
        </label>
      </div>
      <label className="ikatago-field">
        <span>平台</span>
        <select value={config.platform} onChange={(event) => update({ platform: event.target.value })}>
          {IKATAGO_PLATFORM_CHOICES.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
        </select>
      </label>
      <div className="ikatago-actions">
        <button type="button" className="ikatago-save" disabled={!dirty} onClick={save}>{dirty ? "保存" : "已保存"}</button>
        <button type="button" className="ikatago-reset" onClick={() => { setConfig({ ...IKATAGO_DEFAULT_CONFIG }); saveIkatagoConfig({ ...IKATAGO_DEFAULT_CONFIG }); setDirty(false); onNotice?.("已清空云端引擎配置"); }}>清空</button>
      </div>
      <p className="ikatago-note">连接你自己的 KataGo 服务器（iKataGo 协议，WebSocket）。算力在远端，本机不跑引擎；配置只存本机，不上传任何第三方。</p>
    </div>
  );
}

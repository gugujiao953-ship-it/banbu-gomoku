/**
 * iKataGo 云引擎：把 GTP 命令流通过 WebSocket 送到**用户自己的**远程 KataGo 服务器。
 *
 * 与本地引擎的关系：worker 侧看到的是同一个「发命令 / 收 stdout」接口，
 * 所以 `rapfi-worker.js` 里那套解析（info 帧、候选、胜率、访问数）**完全复用**，
 * 不需要为云引擎再写一套解析——这是选 WebSocket 而不是自定义协议的主要原因。
 *
 * 协议（与 iKataGo 生态一致）：
 *   · 连接 `ws(s)://<host>:<port>/<path>?username=…&password=…&platform=…`
 *     （凭据走 query，是 iKataGo 的既有约定；服务端据此鉴权与计量）
 *   · 连上后服务端起一个 KataGo 进程，之后**双向透传 GTP 文本行**：
 *     我们发 `boardsize 15` / `kata-analyze 20`，服务端回 `=` / `info move …`
 *   · 任何一端关闭即整条链路结束。
 *
 * 安全与隐私（重要）：
 *   · 地址与凭据**只存在本机**（localStorage），不上传任何第三方；
 *   · 明文 ws:// 会给出警告（凭据与棋谱都是明文过网），默认建议 wss://；
 *   · 这是「用户自己连自己的服务器」，我们不经手、不代理、不托管算力。
 *
 * 为什么不做成原生插件：WebSocket 在 WebView/Worker 里就是原生能力，
 * 不需要 Java 侧任何代码——少一层进程/管道，也少一处可能出错的边界。
 */

export interface IkatagoConfig {
  /** 服务器地址，形如 `ws://1.2.3.4:8080` 或 `wss://example.com/katago`。 */
  serverUrl: string;
  username: string;
  password: string;
  /** 平台标识（iKataGo 用于选择服务端的引擎配置，如 `linux-x64`）。 */
  platform: string;
}

export const IKATAGO_STORAGE_KEY = "banbu-ikatago-config-v1";

/** 平台档（iKataGo 服务端据此挑后端）。智子手机版暴露的就是这一项 + 用户名/密码
 *  （解包核实：i18n 键为 `ikatago_platform` / `ikatago_username` / `ikatago_password`），
 *  说明它的服务器地址是**内置**的。我们额外把地址也开放出来，方便自建服务器。 */
export const IKATAGO_DEFAULT_CONFIG: IkatagoConfig = {
  serverUrl: "",
  username: "",
  password: "",
  platform: "linux-x64",
};

export const IKATAGO_PLATFORM_CHOICES = ["linux-x64", "linux-arm64", "windows-x64", "darwin-arm64"] as const;

// 不内置任何服务器预设：地址必须由用户提供。
// 说明：智子的 iKataGo 在手机上只暴露「平台 + 用户名 + 密码」（解包核实 i18n 键
// `ikatago_platform`/`ikatago_username`/`ikatago_password`），服务器地址是它内置的、
// 且**未在包里明文出现**（只搜到 www.zhizigomoku.com / app.gog361.com 两个域名，
// 但无法确认哪个是 iKataGo 端点、更不知道路径）。凭猜测填一个预设，用户点了连不上
// 反而像是我们的功能坏了——所以这里留空，由用户填自己的服务器。 */

export const loadIkatagoConfig = (): IkatagoConfig => {
  try {
    const raw = localStorage.getItem(IKATAGO_STORAGE_KEY);
    if (!raw) return { ...IKATAGO_DEFAULT_CONFIG };
    const parsed = JSON.parse(raw) as Partial<IkatagoConfig>;
    return {
      serverUrl: typeof parsed.serverUrl === "string" ? parsed.serverUrl : "",
      username: typeof parsed.username === "string" ? parsed.username : "",
      password: typeof parsed.password === "string" ? parsed.password : "",
      platform: typeof parsed.platform === "string" && parsed.platform ? parsed.platform : IKATAGO_DEFAULT_CONFIG.platform,
    };
  } catch {
    return { ...IKATAGO_DEFAULT_CONFIG };
  }
};

export const saveIkatagoConfig = (config: IkatagoConfig): void => {
  try { localStorage.setItem(IKATAGO_STORAGE_KEY, JSON.stringify(config)); } catch { /* 隐私模式：内存里用 */ }
};

/** 地址是否可用于连接（纯函数，可测）。 */
export const ikatagoUrlProblem = (serverUrl: string): string | null => {
  const url = serverUrl.trim();
  if (!url) return "请填写服务器地址";
  if (!/^wss?:\/\//i.test(url)) return "地址必须以 ws:// 或 wss:// 开头";
  if (/^ws:\/\//i.test(url) && !/^ws:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(url)) {
    // 不阻断（局域网/自建服务常用明文），但要让用户知道风险
    return "INSECURE";
  }
  return null;
};

/** 拼出带凭据的连接 URL（纯函数，可测）。凭据按 iKataGo 约定走 query。 */
export const buildIkatagoUrl = (config: IkatagoConfig): string => {
  const base = config.serverUrl.trim();
  const params = new URLSearchParams();
  if (config.username) params.set("username", config.username);
  if (config.password) params.set("password", config.password);
  if (config.platform) params.set("platform", config.platform);
  const query = params.toString();
  if (!query) return base;
  return base.includes("?") ? `${base}&${query}` : `${base}?${query}`;
};

export type IkatagoEvent =
  | { type: "open" }
  | { type: "line"; line: string }
  | { type: "error"; message: string }
  | { type: "close"; code: number; reason: string };

/** 一条到远程 KataGo 的 GTP 连接。用法与原生插件同构：sendLine / onEvent / close。 */
export interface IkatagoConnection {
  sendLine(line: string): void;
  close(): void;
}

/**
 * 建立连接。`onEvent` 会把远端每个 GTP 行原样交给调用方（worker 侧按本地引擎同款解析）。
 *
 * 注意：WebSocket 在 Worker 里可用（Android WebView 支持），所以这套东西
 * 能直接在分析 worker 内跑，不必回主线程。
 */
export const openIkatago = (config: IkatagoConfig, onEvent: (event: IkatagoEvent) => void): IkatagoConnection => {
  const url = buildIkatagoUrl(config);
  let socket: WebSocket | null = null;
  let closed = false;
  // 收到的数据可能一次含多行（GTP 是行协议，但 TCP 不保边界）——必须缓冲后按行切，
  // 否则「一行多候选」那种超长行会被截断，候选解析全乱。
  let buffer = "";

  try {
    socket = new WebSocket(url);
  } catch (error) {
    onEvent({ type: "error", message: `无法建立连接：${error instanceof Error ? error.message : String(error)}` });
    return { sendLine: () => undefined, close: () => undefined };
  }

  socket.onopen = () => { if (!closed) onEvent({ type: "open" }); };
  socket.onmessage = (event) => {
    if (closed) return;
    const text = typeof event.data === "string" ? event.data : "";
    if (!text) return;
    buffer += text;
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index).replace(/\r$/, "");
      buffer = buffer.slice(index + 1);
      onEvent({ type: "line", line });
      index = buffer.indexOf("\n");
    }
  };
  socket.onerror = () => {
    if (!closed) onEvent({ type: "error", message: "连接出错（地址/端口/凭据是否正確？）" });
  };
  socket.onclose = (event) => {
    if (closed) return;
    closed = true;
    // 尾缓冲可能还有一行没换行结尾——补发，别丢引擎的最后一帧
    if (buffer.trim()) onEvent({ type: "line", line: buffer.trim() });
    onEvent({ type: "close", code: event.code, reason: event.reason || "" });
  };

  return {
    sendLine: (line: string) => {
      if (closed || !socket || socket.readyState !== WebSocket.OPEN) return;
      socket.send(line + "\n");
    },
    close: () => {
      if (closed) return;
      closed = true;
      try { socket?.close(); } catch { /* 已关 */ }
    },
  };
};

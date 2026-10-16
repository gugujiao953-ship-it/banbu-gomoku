/** Outbound-request guard shared by every feature that fetches a URL.
 *
 * Requests must target a public http(s) host: localhost, loopback, private and
 * reserved ranges are refused before anything leaves the app. The `label`
 * argument keeps each caller's user-facing wording (引擎包 / 在线棋谱 …). */
export const assertPublicHttpUrl = (rawUrl: string, label = "网址") => {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`${label}地址无效`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error(`${label}地址必须是 http/https`);
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]" || hostname.endsWith(".local") || hostname.endsWith(".localhost") || hostname.endsWith(".internal")) {
    throw new Error(`${label}地址不允许指向本机`);
  }
  const ipv6 = hostname.replace(/^\[|\]$/g, "");
  if (/^(?:fc|fd|fe80)/.test(ipv6) && ipv6.includes(":")) throw new Error(`${label}地址不允许指向内网或保留地址`);
  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    if (octets.some((value) => value > 255)) throw new Error(`${label}地址无效`);
    const [a, b] = octets;
    if (a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224) {
      throw new Error(`${label}地址不允许指向内网或保留地址`);
    }
  }
  return parsed.toString();
};

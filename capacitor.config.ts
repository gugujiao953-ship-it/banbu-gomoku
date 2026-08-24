import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "cn.renjunote.mobile",
  appName: "半步五子棋",
  webDir: "dist",
  backgroundColor: "#f8f6f1",
  android: {
    allowMixedContent: false,
    backgroundColor: "#f8f6f1",
  },
};

export default config;

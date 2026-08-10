import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const root = dirname(fileURLToPath(import.meta.url));
const binary = join(root, "src-tauri", "target", "debug", process.platform === "win32" ? "rune.exe" : "rune");
const linux = process.platform === "linux";
const stateDir = process.env.RUNE_WDIO_STATE_DIR ?? join(root, "src-tauri", "target", "wdio-state");
mkdirSync(stateDir, { recursive: true });

export const config = {
  runner: "local",
  specs: ["./e2e/workbench.smoke.mjs"],
  maxInstances: 1,
  services: [["@wdio/tauri-service", {
    appBinaryPath: binary,
    driverProvider: linux ? "external" : "embedded",
    autoInstallTauriDriver: linux,
    embeddedPort: 4445,
    env: {
      RUNE_WDIO_SETTINGS_PATH: join(stateDir, "settings.json"),
      RUNE_WDIO_HOT_EXIT_PATH: join(stateDir, "hot-exit.json"),
    },
  }]],
  capabilities: [{
    browserName: "tauri",
    "tauri:options": { application: binary },
  }],
  logLevel: "warn",
  framework: "jasmine",
  reporters: ["spec"],
  waitforTimeout: 15_000,
  connectionRetryTimeout: 90_000,
  connectionRetryCount: 2,
  jasmineOpts: { defaultTimeoutInterval: 90_000 },
};

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const binary = join(root, "src-tauri", "target", "debug", process.platform === "win32" ? "rune.exe" : "rune");

export const config = {
  runner: "local",
  specs: ["./e2e/workbench.smoke.mjs"],
  maxInstances: 1,
  services: [["@wdio/tauri-service", {
    appBinaryPath: binary,
    driverProvider: "embedded",
    embeddedPort: 4445,
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

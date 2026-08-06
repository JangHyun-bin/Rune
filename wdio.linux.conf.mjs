import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const binary = join(root, "src-tauri", "target", "debug", "rune");
let driver;

export const config = {
  hostname: "127.0.0.1",
  port: 4444,
  specs: ["./e2e/workbench.smoke.mjs"],
  maxInstances: 1,
  capabilities: [{ "tauri:options": { application: binary } }],
  logLevel: "warn",
  framework: "jasmine",
  reporters: ["spec"],
  waitforTimeout: 15_000,
  connectionRetryTimeout: 90_000,
  connectionRetryCount: 2,
  jasmineOpts: { defaultTimeoutInterval: 90_000 },
  beforeSession() {
    driver = spawn(join(homedir(), ".cargo", "bin", "tauri-driver"), [], { stdio: "inherit" });
  },
  afterSession() {
    driver?.kill();
  },
};

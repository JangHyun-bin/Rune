import { invoke } from "@tauri-apps/api/core";

export type Result<T> =
  | { status: "ok"; data: T }
  | { status: "error"; error: string };

async function call<T>(cmd: string, args: Record<string, unknown>): Promise<Result<T>> {
  try {
    return { status: "ok", data: (await invoke(cmd, args)) as T };
  } catch (error) {
    return { status: "error", error: String(error) };
  }
}

export const commands = {
  readFile: (path: string) => call<string>("read_file", { path }),
  writeFile: (path: string, contents: string) =>
    call<null>("write_file", { path, contents }),
  saveAsset: (docPath: string, bytes: number[], ext: string) =>
    call<string>("save_asset", { docPath, bytes, ext }),
};

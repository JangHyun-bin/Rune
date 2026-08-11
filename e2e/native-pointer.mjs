import { spawnSync } from "node:child_process";

const wait = (milliseconds) => Atomics.wait(
  new Int32Array(new SharedArrayBuffer(4)),
  0,
  0,
  milliseconds,
);

const checkedSpawn = (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(`${command} failed: ${result.stderr || result.stdout}`);
  }
  return result;
};

export const nativePointerDrag = (start, end, scaleFactor = 1) => {
  const delta = { x: end.x - start.x, y: end.y - start.y };
  if (process.platform === "win32") {
    const typeDefinition = `
using System;
using System.Runtime.InteropServices;
public static class RuneNativePointer {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr value);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr value, int command);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr value, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
`;
    const steps = Array.from({ length: 18 }, (_, index) => {
      const ratio = (index + 1) / 18;
      return `[RuneNativePointer]::SetCursorPos(${Math.round(start.x + delta.x * ratio)}, ${Math.round(start.y + delta.y * ratio)}) | Out-Null; Start-Sleep -Milliseconds 55`;
    }).join("\n");
    const command = `$typeDefinition = @'\n${typeDefinition}\n'@\nAdd-Type -TypeDefinition $typeDefinition\n[RuneNativePointer]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null\n$windows = Get-Process -Name rune | Where-Object { $_.MainWindowHandle -ne 0 }\nforeach ($process in $windows) { $rect = New-Object RuneNativePointer+RECT; if ([RuneNativePointer]::GetWindowRect($process.MainWindowHandle, [ref]$rect) -and ${Math.round(start.x)} -ge $rect.Left -and ${Math.round(start.x)} -lt $rect.Right -and ${Math.round(start.y)} -ge $rect.Top -and ${Math.round(start.y)} -lt $rect.Bottom) { [RuneNativePointer]::ShowWindow($process.MainWindowHandle, 9) | Out-Null; [RuneNativePointer]::SetForegroundWindow($process.MainWindowHandle) | Out-Null; break } }\nStart-Sleep -Milliseconds 250\n[RuneNativePointer]::SetCursorPos(${Math.round(start.x)}, ${Math.round(start.y)}) | Out-Null\nStart-Sleep -Milliseconds 250\n[RuneNativePointer]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)\nStart-Sleep -Milliseconds 350\n${steps}\nStart-Sleep -Milliseconds 250\n[RuneNativePointer]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)`;
    checkedSpawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command]);
    return;
  }
  if (process.platform === "darwin") {
    const logicalStart = { x: start.x / scaleFactor, y: start.y / scaleFactor };
    const logicalEnd = { x: end.x / scaleFactor, y: end.y / scaleFactor };
    const python = `
import ctypes, time
class CGPoint(ctypes.Structure):
    _fields_ = [("x", ctypes.c_double), ("y", ctypes.c_double)]
cg = ctypes.cdll.LoadLibrary("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
cf = ctypes.cdll.LoadLibrary("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
cg.CGEventCreateMouseEvent.restype = ctypes.c_void_p
cg.CGEventCreateMouseEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint32, CGPoint, ctypes.c_uint32]
cg.CGEventPost.argtypes = [ctypes.c_uint32, ctypes.c_void_p]
cf.CFRelease.argtypes = [ctypes.c_void_p]
def post(kind, x, y):
    event = cg.CGEventCreateMouseEvent(None, kind, CGPoint(x, y), 0)
    cg.CGEventPost(0, event)
    cf.CFRelease(event)
sx, sy = ${logicalStart.x}, ${logicalStart.y}
ex, ey = ${logicalEnd.x}, ${logicalEnd.y}
post(5, sx, sy)
time.sleep(.25)
post(1, sx, sy)
time.sleep(.35)
for step in range(1, 19):
    ratio = step / 18
    post(6, sx + (ex - sx) * ratio, sy + (ey - sy) * ratio)
    time.sleep(.055)
time.sleep(.25)
post(2, ex, ey)
`;
    checkedSpawn("python3", ["-c", python]);
    return;
  }

  const activeWindow = checkedSpawn("xdotool", ["getactivewindow"]).stdout.trim();
  if (!/^\d+$/.test(activeWindow)) throw new Error(`xdotool returned an invalid active window: ${activeWindow}`);
  checkedSpawn("xdotool", ["windowactivate", "--sync", activeWindow]);
  checkedSpawn("xdotool", ["mousemove", "--sync", String(Math.round(start.x)), String(Math.round(start.y))]);
  wait(250);
  checkedSpawn("xdotool", ["mousedown", "1"]);
  wait(350);
  for (let step = 1; step <= 32; step += 1) {
    const ratio = step / 32;
    checkedSpawn("xdotool", [
      "mousemove",
      "--sync",
      String(Math.round(start.x + delta.x * ratio)),
      String(Math.round(start.y + delta.y * ratio)),
    ]);
    wait(75);
  }
  wait(800);
  checkedSpawn("xdotool", ["mouseup", "1"]);
};

export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

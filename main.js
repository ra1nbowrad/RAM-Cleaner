const { app, BrowserWindow, Menu, dialog, ipcMain } = require("electron");
const path = require("path");
const { execFile } = require("child_process");
const fs = require("fs");

const { createOSUtils } = require("node-os-utils");
const osUtils = createOSUtils();

let mainWindow = null;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

const defaultSettings = {
  autoClearEnabled: false,
  autoClearThresholdGb: 8,
  openAtLogin: false,
};

function settingsFilePath() {
  try {
    return path.join(app.getPath("userData"), "settings.json");
  } catch {
    return path.join(__dirname, "settings.json");
  }
}

function readSettings() {
  const filePath = settingsFilePath();
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return { ...defaultSettings, ...(parsed || {}) };
  } catch {
    return { ...defaultSettings };
  }
}

function writeSettings(next) {
  const filePath = settingsFilePath();
  const current = readSettings();
  const merged = { ...current, ...(next || {}) };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), "utf8");
  return merged;
}

function applyLoginItemSettings(openAtLogin) {
  if (process.platform !== "win32") return;
  try {
    app.setLoginItemSettings({
      openAtLogin: Boolean(openAtLogin),
    });
  } catch {
    // ignore
  }
}

function bytesToMb(bytes) {
  const n = Number(bytes ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n / 1024 / 1024);
}

function scriptPath(relativePath) {
  const candidates = [
    path.join(process.resourcesPath || "", relativePath),
    path.join(__dirname, relativePath),
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}

let lastCacheSample = { ts: 0, cacheBytes: null };

async function getWindowsCacheBytes() {
  const now = Date.now();
  if (lastCacheSample.cacheBytes != null && now - lastCacheSample.ts < 2500) {
    return lastCacheSample.cacheBytes;
  }

  return await new Promise((resolve) => {
    const cacheScriptPath = scriptPath(path.join("scripts", "get-system-cache-bytes.ps1"));
    if (!cacheScriptPath) {
      resolve(null);
      return;
    }

    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", cacheScriptPath],
      { windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }

        try {
          const obj = JSON.parse(String(stdout || "").trim());
          const cacheBytes = Number(obj?.cacheBytes);
          if (!Number.isFinite(cacheBytes) || cacheBytes < 0) {
            resolve(null);
            return;
          }
          lastCacheSample = { ts: now, cacheBytes };
          resolve(cacheBytes);
        } catch {
          resolve(null);
        }
      }
    );
  });
}

async function getRamInfoForUi() {
  const result = await osUtils.memory.info();
  const data = result?.data ?? {};

  const totalBytes = data?.total?.bytes;
  const usedBytes = data?.used?.bytes;
  const freeBytes = (data?.available ?? data?.free)?.bytes;

  let cacheBytes = null;
  if (process.platform === "win32") {
    cacheBytes = await getWindowsCacheBytes();
  }

  return {
    totalMemMb: bytesToMb(totalBytes),
    usedMemMb: bytesToMb(usedBytes),
    freeMemMb: bytesToMb(freeBytes),
    usedMemPercentage: Number(data?.usagePercentage ?? 0),
    cachedMemMb: bytesToMb(cacheBytes),
  };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 600,
    height: 400,
    frame: false,
    icon: path.join(__dirname, "assets", "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = win;

  if (!app.isPackaged && process.env.RAM_CLEANER_DEVTOOLS === "1") {
    win.webContents.openDevTools({ mode: "detach" });
  }

  win.setMenuBarVisibility(false);
  win.setAutoHideMenuBar(true);

  win.on("maximize", () => {
    win.webContents.send("win-maximized-changed", true);
  });
  win.on("unmaximize", () => {
    win.webContents.send("win-maximized-changed", false);
  });

  win.loadFile(path.join(__dirname, "dist", "index.html"));
}

function createAppMenu() {
  // Remove native menu bar (we render our own titlebar/menu in the renderer).
  Menu.setApplicationMenu(null);
}

async function clearRamCacheBestEffort() {
  if (process.platform !== "win32") {
    return {
      ok: false,
      message: "Not supported: cache clearing is only available on Windows.",
    };
  }

  const candidatePaths = [
    path.join(process.resourcesPath || "", "EmptyStandbyList.exe"),
    path.join(__dirname, "EmptyStandbyList.exe"),
  ].filter(Boolean);

  const emptyStandbyListPath = candidatePaths.find((p) => fs.existsSync(p));
  if (emptyStandbyListPath) {
    if (await isRunningAsAdmin()) {
      return await new Promise((resolve) => {
        execFile(
          emptyStandbyListPath,
          ["standbylist"],
          { windowsHide: true },
          (error) => {
            if (error) {
              resolve({
                ok: false,
                message: `Failed to clear cache: ${error.message}`,
              });
              return;
            }

            execFile(
              emptyStandbyListPath,
              ["modifiedpagelist"],
              { windowsHide: true },
              (error2) => {
                if (error2) {
                  resolve({
                    ok: false,
                    message: `Failed to clear cache: ${error2.message}`,
                  });
                  return;
                }

                resolve({ ok: true, message: "Cache cleared." });
              }
            );
          }
        );
      });
    }

    return await new Promise((resolve) => {
      const escPath = emptyStandbyListPath.replace(/'/g, "''");
      const ps = [
        "$ErrorActionPreference='Stop'",
        `Start-Process -FilePath '${escPath}' -ArgumentList 'standbylist' -Verb RunAs -Wait`,
        `Start-Process -FilePath '${escPath}' -ArgumentList 'modifiedpagelist' -Verb RunAs -Wait`,
        "[pscustomobject]@{ok=$true; message='Cache cleared.'} | ConvertTo-Json -Compress",
      ].join("; ");

      execFile(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
        { windowsHide: true },
        (error, stdout) => {
          if (error) {
            resolve({
              ok: false,
              message:
                "Could not run as administrator (UAC was cancelled or failed).",
            });
            return;
          }

          try {
            const obj = JSON.parse(String(stdout || "").trim());
            resolve({
              ok: Boolean(obj?.ok),
              message: obj?.message ? String(obj.message) : "Fertig.",
            });
          } catch {
            resolve({ ok: true, message: "Cache cleared." });
          }
        }
      );
    });
  }

  return {
    ok: false,
    message:
      "EmptyStandbyList.exe not found. Put it at C:\\Users\\youri\\ram-cleaner\\EmptyStandbyList.exe and restart the app.",
  };
}

async function getProcessesForUi() {
  if (process.platform !== "win32") {
    return { ok: false, message: "Not supported (Windows only).", data: [] };
  }

  return await new Promise((resolve) => {
    const ps = [
      "$ErrorActionPreference='Stop'",
      "$p = Get-Process | Select-Object Id,ProcessName,WorkingSet64,PrivateMemorySize64",
      "$p = $p | Sort-Object WorkingSet64 -Descending | Select-Object -First 1000",
      "$p | ConvertTo-Json -Compress",
    ].join("; ");

    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
      { windowsHide: true, maxBuffer: 5 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve({
            ok: false,
            message: `Could not load process list: ${error.message}`,
            data: [],
          });
          return;
        }

        try {
          const parsed = JSON.parse(String(stdout || "").trim());
          const items = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
          const data = items
            .map((p) => ({
              pid: Number(p?.Id ?? 0),
              name: p?.ProcessName ? String(p.ProcessName) : "",
              workingSetBytes: Number(p?.WorkingSet64 ?? 0),
              privateBytes: Number(p?.PrivateMemorySize64 ?? 0),
            }))
            .filter(
              (p) =>
                Number.isFinite(p.pid) &&
                p.pid > 0 &&
                p.name &&
                Number.isFinite(p.workingSetBytes) &&
                p.workingSetBytes >= 0 &&
                Number.isFinite(p.privateBytes) &&
                p.privateBytes >= 0
            );

          resolve({ ok: true, message: "ok", data });
        } catch (e) {
          resolve({
            ok: false,
            message: e?.message ? String(e.message) : "JSON parse error",
            data: [],
          });
        }
      }
    );
  });
}

async function endProcessForUi(pid) {
  const numericPid = Number(pid);
  if (!Number.isFinite(numericPid) || numericPid <= 0) {
    return { ok: false, message: "Invalid PID." };
  }

  if (process.platform !== "win32") {
    return { ok: false, message: "Not supported (Windows only)." };
  }

  return await new Promise((resolve) => {
    const ps = [
      "$ErrorActionPreference='Stop'",
      `Stop-Process -Id ${numericPid} -Force`,
      "[pscustomobject]@{ok=$true; message='Process terminated.'} | ConvertTo-Json -Compress",
    ].join("; ");

    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
      { windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve({ ok: false, message: `Failed: ${error.message}` });
          return;
        }

        try {
          const obj = JSON.parse(String(stdout || "").trim());
          resolve({
            ok: Boolean(obj?.ok),
            message: obj?.message ? String(obj.message) : "Done.",
          });
        } catch {
          resolve({ ok: true, message: "Process terminated." });
        }
      }
    );
  });
}

async function isRunningAsAdmin() {
  if (process.platform !== "win32") return false;

  return await new Promise((resolve) => {
    const ps =
      "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)";
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
      { windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve(false);
          return;
        }
        resolve(String(stdout || "").trim().toLowerCase() === "true");
      }
    );
  });
}

app.whenReady().then(() => {
  const settings = readSettings();
  applyLoginItemSettings(settings.openAtLogin);
  createAppMenu();

  if (!app.isPackaged) {
    isRunningAsAdmin().then((isAdmin) => {
      if (process.platform === "win32" && !isAdmin) {
        dialog.showErrorBox("RAM Cleaner", "Please run as Administrator.");
        app.quit();
        return;
      }
      createWindow();
    });
  } else {
    // Packaged app uses the Windows manifest (requestedExecutionLevel=requireAdministrator).
    // Avoid showing a confusing "run as admin" message during UAC elevation.
    createWindow();
  }

  ipcMain.handle("get-ram", async () => {
    return await getRamInfoForUi();
  });

  ipcMain.handle("clear-ram-cache", async () => {
    return await clearRamCacheBestEffort();
  });

  ipcMain.handle("get-processes", async () => {
    return await getProcessesForUi();
  });

  ipcMain.handle("end-process", async (_event, pid) => {
    return await endProcessForUi(pid);
  });

  ipcMain.handle("get-settings", async () => {
    return readSettings();
  });

  ipcMain.handle("set-settings", async (_event, next) => {
    const saved = writeSettings(next);
    applyLoginItemSettings(saved.openAtLogin);
    return saved;
  });

  ipcMain.handle("win-minimize", async () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
    return true;
  });

  ipcMain.handle("win-toggle-maximize", async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return true;
  });

  ipcMain.handle("win-close", async () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    return true;
  });

  ipcMain.handle("win-is-maximized", async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    return mainWindow.isMaximized();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

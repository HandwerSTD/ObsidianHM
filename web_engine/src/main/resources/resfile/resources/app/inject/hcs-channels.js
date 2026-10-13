// Copyright (c) 2026 HandwerSTD
//
// 华为云同步的 12 个 ipcMain 通道。
//
// 这套通道由 ArkTS 侧的 CloudSyncAdapter.ets 发起，读写目录取 userData，
// 与 ArkTS 侧的 getApplicationContext().filesDir 指向同一处。
//
// 本文件由外层 main.js 在加载 asar 之前 require 并调用，返回值是待注册的
// [通道名, 处理函数] 列表。之所以不在文件内直接注册，是因为外层需要先
// removeAllListeners，而 ipcMain 要由外层传入，避免本文件再持有 electron 的引用。
//
// 局部变量一律加下划线前缀：外层把 fs 与 path 作为参数传入，压缩产物里的名字
// 逐版重排，前缀可以避免与调用方的变量发生引用混乱。

'use strict';

module.exports = function buildHcsChannels(fs, path, dataPath) {
  function readJson(file, fallback) {
    try {
      return JSON.parse(fs.readFileSync(path.join(dataPath, file), 'utf8'));
    } catch (e) {
      return fallback;
    }
  }

  function writeJson(file, value) {
    fs.writeFileSync(path.join(dataPath, file), JSON.stringify(value));
  }

  const statusFile = 'hcs-sync-status.json';
  const autoSyncFile = 'hcs-auto-sync.json';
  const excludedFile = 'hcs-excluded.json';
  const userFile = 'hcs-user.json';
  const pendingFile = '.hcs-login-pending';
  const mirrorDir = 'cloud-sync-mirror';

  function mirrorPath() {
    return path.join(dataPath, mirrorDir);
  }

  return [
    ['hcs-get-status', function (event) {
      const status = readJson(statusFile, null) || {
        status: '就绪', lastSync: null, files: [], totalSize: 0, autoSync: false
      };
      const autoSync = readJson(autoSyncFile, null);
      status.autoSync = !!(autoSync && autoSync.enabled);
      const excluded = readJson(excludedFile, null);
      status.excluded = (excluded && excluded.folders) || [];
      try {
        const mirror = mirrorPath();
        status.cloudFiles = fs.existsSync(mirror)
          ? fs.readdirSync(mirror).filter(function (name) {
              return fs.statSync(path.join(mirror, name)).isFile();
            }).length
          : 0;
      } catch (e) {
        status.cloudFiles = 0;
      }
      const user = readJson(userFile, null);
      status.userId = user ? user.userId : null;
      event.returnValue = status;
    }],

    ['hcs-sync-all', function (event, vaultPath) {
      let excluded = [];
      const excludedConfig = readJson(excludedFile, null);
      if (excludedConfig && excludedConfig.folders) {
        excluded = excludedConfig.folders;
      }
      const mirror = mirrorPath();
      const files = [];
      let totalSize = 0;
      try {
        if (!fs.existsSync(mirror)) {
          fs.mkdirSync(mirror, { recursive: true });
        }
        const entries = fs.readdirSync(vaultPath, { recursive: true });
        for (const entry of entries) {
          const source = path.join(vaultPath, entry);
          try {
            const stat = fs.statSync(source);
            if (!stat.isFile()) continue;
            if (excluded.some(function (prefix) { return entry.startsWith(prefix); })) continue;
            const buffer = fs.readFileSync(source);
            const target = path.join(mirror, entry);
            const targetDir = path.dirname(target);
            if (!fs.existsSync(targetDir)) {
              fs.mkdirSync(targetDir, { recursive: true });
            }
            fs.copyFileSync(source, target);
            files.push({
              path: entry,
              hash: 'md5_' + buffer.length + '_' + stat.mtimeMs,
              size: stat.size,
              modified: stat.mtimeMs
            });
            totalSize += stat.size;
          } catch (e) {
            // 单个文件读取失败不中断整次同步
          }
        }
      } catch (e) {
        // 仓库目录不可读时返回空结果
      }
      const status = {
        status: '已同步 (' + files.length + '个文件)',
        lastSync: Date.now(),
        files: files,
        totalSize: totalSize
      };
      writeJson(statusFile, status);
      event.returnValue = status;
    }],

    ['hcs-get-auto-sync', function (event) {
      const config = readJson(autoSyncFile, null);
      event.returnValue = !!(config && config.enabled);
    }],

    ['hcs-set-auto-sync', function (event, enabled) {
      const value = !!enabled;
      writeJson(autoSyncFile, { enabled: value });
      event.returnValue = value;
    }],

    ['hcs-get-excluded', function (event) {
      const config = readJson(excludedFile, null);
      event.returnValue = (config && config.folders) || [];
    }],

    ['hcs-set-excluded', function (event, folders) {
      writeJson(excludedFile, { folders: folders || [] });
      event.returnValue = true;
    }],

    ['hcs-get-userid', function (event) {
      const user = readJson(userFile, null);
      event.returnValue = user ? user.userId : null;
      const pending = path.join(dataPath, pendingFile);
      try {
        if (fs.existsSync(pending)) {
          const startedAt = parseInt(fs.readFileSync(pending, 'utf8'));
          if (Date.now() - startedAt < 3e4) {
            event.returnValue = 'pending';
          }
        }
      } catch (e) {
      }
    }],

    ['hcs-set-userid', function (event, userId) {
      writeJson(userFile, { userId: userId, loginTime: Date.now() });
      event.returnValue = true;
    }],

    ['hcs-login', function (event) {
      fs.writeFileSync(path.join(dataPath, pendingFile), Date.now().toString());
      event.returnValue = null;
    }],

    ['hcs-restore-list', function (event) {
      const mirror = mirrorPath();
      event.returnValue = fs.existsSync(mirror)
        ? fs.readdirSync(mirror).filter(function (name) {
            return fs.statSync(path.join(mirror, name)).isFile();
          })
        : [];
    }],

    ['hcs-restore-file', function (event, request) {
      const source = path.join(mirrorPath(), request.path);
      const status = readJson(statusFile, null);
      const record = status && status.files
        ? status.files.find(function (item) { return item.path === request.path; })
        : null;
      if (!record) {
        event.returnValue = false;
        return;
      }
      const target = path.join(request.vaultPath, record.path);
      const targetDir = path.dirname(target);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      try {
        fs.copyFileSync(source, target);
        event.returnValue = true;
      } catch (e) {
        event.returnValue = false;
      }
    }],

    ['hcs-code', function (event) {
      const status = readJson(statusFile, null) || { lastSync: null, files: [], status: '就绪' };
      event.returnValue = JSON.stringify({
        lastSync: status.lastSync,
        count: status.files ? status.files.length : 0,
        status: status.status
      });
    }]
  ];
};

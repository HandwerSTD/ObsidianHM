<!-- Copyright (c) 2026 HandwerSTD -->

# 检测更新

## 1. 机制

```mermaid
flowchart LR
  A[ArkTS UpdateChecker] -->|GET 远端 app.json5| B[取远端 versionCode]
  B --> C[与本机 versionCode 比较]
  C --> D[写 filesDir/update-check.json]
  D --> E[Electron main.js 每 500ms 轮询读文件]
  E --> F[ohsidian-update-status 通道]
  F --> G[dom-ready.js 接管关于页更新条目]
  H[关于页「检查更新」按钮] -->|ohsidian-update-check-now| I[main.js 写 filesDir/update-check.now]
  I -->|每 3 秒轮询| A
```

判定规则：远端 `app.versionCode` 大于本机时 `hasUpdate` 为真。

两条流量共用一个目录：ArkTS 写结果文件，外层读；外层写触发文件，ArkTS 读。

## 2. ArkTS 侧

`web_engine/src/main/ets/adapter/UpdateChecker.ets`，由 `WebAbility.onCreate` 调用 `startPolling`。

| 项 | 值 |
|----|-----|
| 远端地址 | `https://raw.gitcode.com/handwer/ObsidianHM/raw/main/AppScope/app.json5` |
| 首次检查 | 启动后延迟 30 秒 |
| 检查间隔 | 6 小时（`setInterval`） |
| 触发文件轮询 | 3 秒（`setInterval`），与上面的定时检查各跑各的 |
| 解析 | `JSON.parse`，取 `app.versionCode` |
| 本机版本 | `bundleManager.getBundleInfoForSelfSync(GET_BUNDLE_INFO_DEFAULT).versionCode` |
| 结果文件 | `getApplicationContext().filesDir + '/update-check.json'` |
| 触发文件 | `getApplicationContext().filesDir + '/update-check.now'` |
| 网络权限 | `ohos.permission.INTERNET`，已在 `web_engine/src/main/module.json5` |

结果文件内容：

```json
{
  "checkedAt": 1770000000000,
  "remoteVersionCode": 11404002,
  "localVersionCode": 11404001,
  "hasUpdate": true
}
```

`checkedAt` 是写入时刻的毫秒数，外层用它判断文件是否被重写。

拉取与解析失败只记日志，不抛出，不写结果文件。上一次的结果因此保留。

手动触发的处理在 `checkTriggerFile`：触发文件存在时先删掉，再调 `checkOnce`。删除排在检查之前，拉取失败也不会让文件积压成下一轮重复触发。

## 3. 解析远端清单

远端 `AppScope/app.json5` 由本仓库控制，约定保持纯 JSON（无注释、无尾逗号），因此直接用 `JSON.parse`。不必为此引入 JSON5 解析库：`@wolfx/json5` 是 bytecode HAR，引入它需要把工程级 `useNormalizedOHMUrl` 改为 true，会切换全工程的 ohmurl 格式。

解析位置在 `UpdateChecker.ets` 的 `checkOnce`。将来远端清单确实需要写注释时，在那里先剥离注释再解析，不要改 `useNormalizedOHMUrl`。

## 4. 目录约定

`app.getPath('userData')` 与 `getApplicationContext().filesDir` 指向设备上同一个目录（应用级 `files/`）。两端靠这个约定交接，与 deeplink 队列（`obsidian-deeplink.pending`）一致。改文件名需要同时改 `UpdateChecker.ets` 与 `main.js`。

两个文件名各自有命名常量，配对关系如下：

| 文件 | `UpdateChecker.ets` | `main.js` |
|------|---------------------|-----------|
| 结果（ArkTS 写，外层读） | `RESULT_FILE_NAME` | `UPDATE_CHECK_FILE` |
| 触发（外层写，ArkTS 读） | `TRIGGER_FILE_NAME` | `UPDATE_CHECK_TRIGGER_FILE` |

传输只能走文件：Electron 的渲染进程里没有按名调用 ArkTS 绑定的入口，`JsBindingUtils` 注册的名字仅供运行时 C++ binding 内部反查。

## 5. 外层读取

`web_engine/src/main/resources/resfile/resources/app/main.js`：

- `readUpdateCheckStatus()` 读文件并 `JSON.parse`，失败返回 `null`。
- `refreshUpdateCheckStatus()` 每 500ms 执行，`checkedAt` 变化时刷新模块级缓存 `updateCheckStatus` 并记一条日志。
- ipcMain 通道 `ohsidian-update-status` 返回缓存，注册位置在 `loadApp()` 之后的通道注册区。通道名与官方无重名。
- ipcMain 通道 `ohsidian-update-check-now`（`installUpdateCheckNowChannel`）写触发文件 `update-check.now`，内容为时间戳字符串，返回布尔值表示写入是否成功。写入用 `fs.writeFileSync`，失败记日志并返回 `false`。该通道注册在同一区域，通道名与官方无重名。

## 6. 关于页显示

`inject/dom-ready.js` 的 `patchAbout()`。

官方 1.14.4 的「关于」页在版本项之后就是更新条目（平铺项 index 1）：名称由 `interface.label-update-available` 生成，`visible` 是比较渲染进程 Electron 版本的函数，`desc` 是一句说明加「了解更多」链接，`render` 造一个「下载」按钮打开 `obsidian.md/download`。本机 Electron 为 `5.0.0-Release`，那个比较恒为真，条目因此常显。

`patchAbout` 对这个条目做接管，不隐藏也不删除：

| 字段 | 接管后的值 |
|------|------------|
| `visible` | 函数，`sendSync('ohsidian-update-status')` 有结果且 `hasUpdate` 为真时显示 |
| `desc` | `createFragment` 加一段说明与「了解更多」链接，链接指向 `https://github.com/HandwerSTD/ObsidianHM/releases` |
| `render` | 保留官方实现（按钮文案仍是官方的「下载」），随后把按钮点击换成 `window.open` 到 releases |

定位方式是「平铺项 index 1 + 名称校验」，名称按中英两种语言比对（`可以更新`、`Update available`）；名称不符时再全表扫一遍，都找不到就放弃接管并记一条日志。接管排在插入「贡献作者」之前，那一步会把 index 1 占掉。

条目的 `visible` 每次渲染都会重新求值，因此在关于页停留时刷新一次页面即可看到最新结果。

### 6.1 「检查更新」按钮

版本行本身由官方维护，`render` 里调 `updateVersionSetting()` 重建按钮。`patchAbout` 在官方 render 之后把该按钮的 `clickCallback` 换成：

1. `sendSync('ohsidian-update-check-now')`，请外层写下触发文件；
2. 弹一条「正在检查更新...」提示；
3. 每 1 秒读一次 `ohsidian-update-status`，最多 30 次，`checkedAt` 变化即认为结果落地；
4. 调关于页对象的 `update()` 重画该页，更新条目的 `visible` 随之重算，然后提示「发现新版本」或「已是最新版本」。

按钮文案由 preload.js 的 i18n 覆盖控制。`setting.about.button-check-for-updates` 这个键已从覆盖表里移除，按钮取官方本地化文案（中文「检查更新」、英文 `Check for updates`）。

`update` 通道返回 `update-downloaded` 时（官方已下载好内核包），按钮由官方换成「重新启动」，此时不做替换。

## 7. 版本号编排

`AppScope/app.json5` 的 `versionCode` 是十进制整数，位数含义：

| 段 | 位数 | 含义 |
|----|------|------|
| major | 1 | Obsidian 主版本 |
| minor | 2 | Obsidian 次版本 |
| patch | 2 | Obsidian 修订号 |
| appPatch | 3 | 本项目自身的 bugfix 重发序号 |

当前 `versionCode` 是 `11404001`，按上面的分段读出 `1|14|04|001`，对应 `versionName` `1.14.4.1`。

本项目只改 AppScope 的 `versionCode` 与 `versionName`；`appPatch` 递增时 `versionName` 的第四段同步递增。

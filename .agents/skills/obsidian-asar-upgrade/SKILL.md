---
name: obsidian-asar-upgrade
description: 升级 OHsidian 内置的 Obsidian 内核版本（升级 asar、跟随官方新版本、换 Obsidian 版本、asar 升级、托盘或华为云同步设置页缺失、设置页白屏、remote is disabled 报错）。项目使用官方发布版 asar 原样、定制由外层运行时注入施加，本技能说明替换 asar 后要复核哪些注入点，以及如何在设备上验证。
---

# Obsidian 内核升级

本仓库把官方 Obsidian 发布版 asar 原样放进 app 目录，全部定制由外层运行时注入施加。asar 内没有任何补丁。

- 官方内部机制（通道、全局、i18n 取词、设置页、标题栏、版本号、平台差异）：`docs/obsidian-internals.md`
- 归属判定与最终状态：`docs/asar-customization-runtime.md`
- 实测记录：`docs/runtime-inject-verification.md`
- 升级过程积累的官方两版差异：`docs/asar-upgrade.md`（第 3、4 节仍有参考价值；第 5 节起的构建脚本说明对应的是已停用的构建期打补丁路线，构建脚本在 `tools/`）

## 先做这件事

升级开始前读一遍 `docs/asar-customization-runtime.md`。它逐项说明了每一项定制的归属与依据，是判断「某个注入点为什么这么写」的唯一来源。本文件只写操作流程与复核点。

## 涉及的文件

| 路径 | 作用 |
|------|------|
| `web_engine/src/main/resources/resfile/resources/app/obsidian.asar` | 官方发布版 asar，逐字节原样 |
| `web_engine/src/main/resources/resfile/resources/app/main.js` | 外层引导脚本，主进程侧的全部定制 |
| `web_engine/src/main/resources/resfile/resources/app/inject/preload.js` | 最早注入渲染进程：包装 `i18next.t` |
| `web_engine/src/main/resources/resfile/resources/app/inject/dom-ready.js` | 页面就绪后注入：设置页、标题栏、窗口按钮 |
| `web_engine/src/main/resources/resfile/resources/app/inject/hcs-channels.js` | 十二个 `hcs-*` 通道的工厂函数 |
| `web_engine/src/main/resources/resfile/resources/app/tray.png` | 托盘图标，放在 asar 之外 |
| `web_engine/src/main/resources/resfile/resources/app/package.json` | 外层清单，`version` 必须与内核版本一致 |

## 流程

### 1. 取得官方 asar

素材位于 `~/Download/com.huawei.hmos.browser/obsidian/`。各版本的存放形式不同（有 `.asar.gz` 压缩件、arm64 tar 安装包、解包后的目录）。用 `ls` 确认目标版本的实际位置，不要照抄路径。

替换 asar 前记下基准值：

```bash
md5sum web_engine/src/main/resources/resfile/resources/app/obsidian.asar
```

1.13.4 的基准是 25783388 字节、md5 `bbae59d36fe60500436a82cb841d5ad6`。

替换后确认新文件里不含本项目任何字符串，命中数都应为 0：

```bash
python3 -c "
d=open('web_engine/src/main/resources/resfile/resources/app/obsidian.asar','rb').read()
for s in [b'hcs-login',b'huawei-cloud-sync',b'OHsidian',b'qtray',b'exit-to-tray']:
    print(s.decode(), d.count(s))
"
```

### 2. 改外层 package.json 的版本号

`version` 必须改成目标版本。它同时是外层 `currentBaseVersion` 与 `app.getVersion()` 的来源，启动扫描 userData 时用 `isV2MoreRecent` 判断新 asar 是否被采用。漏改会导致新 asar 不生效。

### 3. 复核注入点

asar 换代后压缩变量会重排，但外层与注入脚本都不引用 asar 内部的压缩变量，因此**通常无需改动**。需要复核的是它们依赖的官方接口与结构是否还在。

下面给出注入点到官方接口的对照。每一项的官方机制细节（通道清单、全局对象、i18n 取词、设置页结构、标题栏、版本号、平台分支）见 `docs/obsidian-internals.md`。

逐项对照：

**主进程（`main.js`）**

| 注入点 | 依赖的官方接口 |
|--------|----------------|
| `windowKind` | 三种页面的 URL：`index.html`、`starter.html`、`help.html`，设置弹窗为 `about:blank` |
| `installTray` | `Tray`、`Menu.buildFromTemplate`，以及 `tray.png` 的相对位置 |
| `installCloseToTray` | `BrowserWindow` 的 `close` 事件可被外部追加监听 |
| `injectRenderer` | `webContents.executeJavaScript`、`browser-window-created`、`dom-ready` |
| `installHcsChannels` | `ipcMain.removeAllListeners` 与 `ipcMain.on` |
| `installExitChannels` | 同上。`exit-to-tray` 与 `force-quit` 是官方没有的通道名 |
| `installDisableUpdate` | 官方有 `disable-update` 通道，需先 `removeAllListeners` 再注册 |
| `installFontFaceGuard` | 同 `injectRenderer` |
| `pollDeeplinkQueue` | `app.emit('open-url', ...)` 与 `app.listenerCount('open-url')` |

**渲染进程（`inject/`）**

| 注入点 | 依赖的官方接口 |
|--------|----------------|
| `preload.js` 的 i18next 包装 | 全局 `i18next`、`i18next.t` 的调用形态、键的 kebab-case 拼法（`setting.about.label-version`） |
| `dom-ready.js` 的设置页注册 | `window.app.setting.settingTabs`、`addSettingTab`、设置页基类（从原型链回溯） |
| `dom-ready.js` 的两页包装 | `getSettingDefinitions`、`update()`、设置项的 `render(setting)` 回调 |
| `dom-ready.js` 的插入定位 | 「外观」页与「关于」页的条目名（中文界面下为「半透明效果」）、`type:"group"` 的分组结构 |
| `dom-ready.js` 的窗口按钮 | `ipcRenderer.sendSync('frame')`、`remote.getCurrentWindow().setWindowButtonVisibility`、CSS 变量 `--frame-right-space`，以及隐藏官方自绘的 `.titlebar-button-container.mod-right .titlebar-button` |
| `dom-ready.js` 的标题栏 | `.titlebar-text` 元素 |

改动任何一项之前，先在官方 asar 里核对新版的写法。解包查看：

```bash
cd tools && node -e "
import('@electron/asar').then(a => {
  console.log(a.extractFile('<$HOME>/Download/com.huawei.hmos.browser/obsidian/<版本>/obsidian.asar','main.js').toString().includes('BrowserWindow'))
})
"
```

### 4. 检查语法

外层与注入脚本都是可以直接用 `node --check` 检查的普通 JavaScript：

```bash
cd web_engine/src/main/resources/resfile/resources/app
for f in main.js inject/preload.js inject/dom-ready.js inject/hcs-channels.js; do
  node --check "$f" || echo "FAIL $f"
done
```

注意：`node --check` 只验证语法，不验证接口。注入脚本里用到的 `window`、`document`、`electron` 都只在设备上存在，Node 下运行会报未定义，这是正常的。

### 5. 构建与安装

```bash
devecocli build
devecocli run --skip-build --device <设备>
```

`node --check` 通过不代表构建会通过。ArkTS 只编译 `electron/` 与 `web_engine/src/main/ets/`，js 文件是资源，构建不会检查它们。

### 6. 设备验证

```bash
hdc shell "tail -n 60 /data/app/el2/100/base/com.mikannqaq.obsidian/files/obsidian.log"
```

判据见 `references/verification.md`。界面交互需要用户确认，不要自行操作设备。

## 三条设计约束

改动注入代码时遵守这三条，违反会导致构建通过但运行时报错。

**一、remote 必须在 WebContents 创建时开启。** 外层用 `app.on('web-contents-created', ...)` 调用 `remote.enable(contents)`，注册位置在 asar 加载之前。任何更晚的时机（`did-create-window`、`dom-ready`）都可能排在渲染进程首个脚本之后。设置页默认在独立窗口打开，其渲染进程建立后立即同步调 `remote.getCurrentWindow()`，来不及就会抛「@electron/remote is disabled for this WebContents」。

**二、覆盖官方同名通道时要先 `removeAllListeners`，并且在 asar 加载之后做。** 官方的 `ipcMain.on` 发生在 `loadApp()` 调用 `module.exports` 时。在这之前清空，官方随后会补上一个，`sendSync` 通道上出现两个监听器，结果不可预测。当前只有 `disable-update` 一个通道与官方重名。

**三、注入脚本里不要覆盖 `window.close`。** 覆盖会作用于每个渲染进程，连带破坏三处：起始窗口打开仓库后不关闭、「切换仓库」命令走不完、设置弹窗关不掉。需要「关窗不退出」的只有仓库窗口，那件事由外层对 `close` 事件的拦截与托盘完成。

## 诊断方式

**注入脚本的诊断输出必须写 `obsidian.log`，不能用 `console.log`。** 后者走标准输出，在设备上既不进日志文件，也不出现在 hilog 里。渲染进程经 `ohsidian-log` 通道把消息交给主进程写盘，用法是 `window.__ohsidianLog('消息')`。

主进程侧的 `log()` 定义在 `main.js` 中部，在它之前执行的代码用不了，需要自备写入函数（文件顶部的 `probe()` 就是这样一个例子）。

日志时间戳是 UTC，北京时间是 UTC+8。

## 已停用的路线

`tools/build-asar.mjs` 与 `tools/lib/` 是构建期打补丁的实现，改为运行时注入后不再参与构建，保留作参考。若日后需要把某项定制改回补丁（例如窗口复用这类外层拿不到等价接口的改动），可以复用那里的符号解析机制。构建脚本与补丁清单的说明见 `docs/asar-upgrade.md` 第 5 节。

## 参考文件

- `references/verification.md`：替换 asar 后的核对清单与设备判据
- `references/troubleshooting.md`：运行期报错对应的处置
- `scripts/verify-asar.mjs`：官方原版 asar 的纯净度校验脚本，可独立运行

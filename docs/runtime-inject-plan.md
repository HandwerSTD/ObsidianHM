<!-- Copyright (c) 2026 HandwerSTD -->

# 改为运行时注入并升级到 1.13.4 的实施计划

## 1. 目标与范围

基于 `feat/harmony-port-fixes`（`29195e8`）改造项目，把 asar 的定制改为运行时注入，并把内置内核从 1.12.7 升级到 1.13.4。

改造后：

- `web_engine/src/main/resources/resfile/resources/app/obsidian.asar` 是**未经修改的官方 1.13.4 发布版 asar**（从 `~/Download/com.huawei.hmos.browser/obsidian/gz13/obsidian.asar` 原样复制，25783388 字节，md5 `bbae59d36fe60500436a82cb841d5ad6`，无任何补丁）。
- 全部定制由外层引导脚本 `web_engine/src/main/resources/resfile/resources/app/main.js` 与它注入渲染进程的脚本施加。
- 升级内核时，只需替换 asar 文件与改一个版本号，不需要重新定位任何补丁。

计划的决策依据在 `docs/asar-customization-runtime.md`。

**路线已经过实测验证。** 官方原版 1.13.4 asar 放进现有外壳后能正常启动并显示界面，外层注入能真正执行。实测细节见 `docs/runtime-inject-verification.md`。

## 2. 起点状态

### 2.1 基分支

`feat/harmony-port-fixes` 的 `web_engine/src/main/resources/resfile/resources/app/` 下有五个条目：`icon.png`、`main.js`、`node_modules/`、`obsidian.asar`、`package.json`。没有 `tray.png`，没有 `docs/`、`tools/`、`.agents/`。

其中 `obsidian.asar` 是 **1.12.7 的全定制成品**（25988612 字节，md5 `61c06169d474533de9806b3d7bd255d0`），不是官方原版（官方 1.12.7 是 md5 `914de0dca5b6471ded847317ce6d7a9f`）。它内含十二个 `hcs-*` 通道、托盘初始化、`exit-to-tray` 与 `force-quit` 通道、`if(false&&` 版本短路、`[HMOS-FRAME]`、`HcsSettingsTab`、「贡献作者」、社区许可证等全部定制。

外层 `main.js` 780 行，已承载回收站兼容、PDF 字体兼容、deeplink 队列派发、自动更新短路四项定制；不含 1.13.4 需要的 `web-contents-created` 开启 remote。

`package.json` 的 `version` 为 `1.12.7`。

### 2.2 已有的工作成果

`dev/upgrade13-by-inject`（`f429e09`）上有三部分成果：

| 目录 | 内容 |
|------|------|
| `tools/` | 补丁式构建脚本 `build-asar.mjs` 与三个符号解析文件、`hcs-settings-tab.js`、`README.md` |
| `docs/` | `asar-upgrade.md`（升级说明）、`asar-customization-runtime.md`（归属决策） |
| `.agents/skills/` | `obsidian-asar-upgrade` 技能与产物校验脚本 |

这份计划的做法与 `tools/` 的补丁路线不同：`tools/` 用构建期打补丁产出定制 asar，本计划改用运行时注入、asar 保持官方原样。`docs/` 与 `.agents/` 的内容仍然适用，继续保留。

### 2.3 素材

| 素材 | 路径 | 大小 |
|------|------|------|
| 官方 1.13.4 asar | `~/Download/com.huawei.hmos.browser/obsidian/gz13/obsidian.asar` | 25783388 |
| 官方 1.12.7 asar | 同目录 `gz12/obsidian.asar` | 24060763 |
| 1.14.4 asar | 同目录 `obsidian-extracted/resources/obsidian.asar` | 27477966 |
| 基分支 asar（1.12.7 全定制） | 工作区 | 25988612 |
| 官方 1.12.7 原版备份 | `~/.tmp/backup-before-deploy/obsidian-1.12.7-original.asar` | 25988612 |

基分支 asar 内的 `icon.png`（1606146 字节）与 `tray.png`（314843 字节）需要解出，放到 asar 之外。

`~/.tmp/asarwork/` 下有解包好的工作目录 `official12`、`official13`、`repo127`、`vf3`，可直接用于比对。

## 3. 技术判据

以下判据均已核实。第 3.1、3.2、3.5 三条已经过设备实测（见 `docs/runtime-inject-verification.md`），其余来自对官方 asar 的静态阅读。

### 3.1 asar 的对外接口只有两处

`asar/main.js` 的导出是 `module.exports=function(asarPath, updateEvents)`。外层 `loadApp()` 调用它之后，`app`、`ipcMain`、`BrowserWindow`、`Tray`、`Menu`、`webContents` 全部可用。

渲染进程侧由 official asar 自己挂载：`window.app`、`window.require`（返回 158 项 obsidian 导出模块，含 `Setting`、`PluginSettingTab`、`Modal`、`Notice`）、`window.Notice`、`window.FS`、`window.moment`，以及 UMD 形式的全局 `i18next`。

**实测确认**：官方 asar 能被加载运行，能创建渲染进程，界面正常显示。

### 3.2 `process.versions.electron` 必须用 `Object.defineProperty` 改写

该属性只读（Node 下描述符为 `{writable:false, configurable:true}`），直接赋值会静默失败。官方 `main.js` 里 `fo` 的唯一用途是 `if(fo<18){`，改写后版本下限弹窗与跳转下载页都不触发。改写只作用于主进程。

**实测确认**：设备上的真实值是 `5.0.0-Release`，主版本 5。版本下限检查确实会触发，改写是必需步骤。探针记录到 `真实值 5.0.0-Release -> 现值 18.0.0`。

**连带事项**：渲染进程读的是它自己的 `process.versions.electron`，主进程的改写不影响它。渲染进程里 `uf=process.versions.electron` 后 `pf=uf`，因此 `qy(pf, "28.2.3")` 比较的是 5 与 28，结果为真。实测 `qy("5.0.0-Release", "28.2.3")` 为 `true`。处理 `disable-update` 通道是必需的，不是可选项。

### 3.3 窗口识别依据

官方 1.13.4 用 `new l.BrowserWindow` 创建两类窗口，`BrowserWindow` 构造出现 2 次。三类页面的地址可区分：

| 窗口 | 加载地址 |
|------|---------|
| 仓库窗口 | `<前缀>obsidian.md/index.html`，前缀为 `Be + "://"` |
| starter 窗口 | `<前缀>obsidian.md/starter.html` |
| help 窗口 | `<前缀>obsidian.md/help.html` |
| 设置弹出窗口 | `about:blank`，`features` 以 `popup` 开头 |

因此外层可用 `app.on('browser-window-created')` 加 `webContents.getURL()` 判定窗口类别。设置弹出窗口在 `webContents-created` 阶段地址还是 `about:blank`，判定时需要容纳这一情形。

官方在窗口内部直接注册 `close` 处理器（形如 `b.on("close",v=>{b.closing=!0,s(),ee(o,u),setTimeout(...)})`），外部无法改这段代码，但可以额外注册自己的 `close` 监听。

### 3.4 官方已提供可复用的通道

| 通道 | 用途 |
|------|------|
| `is-quitting` | 返回官方退出标志 `be` |
| `is-closing` | 返回 `be \|\| 该窗口的 closing` |
| `disable-update` | 置 `D.updateDisabled`，官方据此隐藏更新入口 |
| `update` / `check-update` | 供「关于」页取版本状态 |

`disable-update` 可在外层用 `ipcMain.removeAllListeners` 后重新注册为恒返回 `true`，从而规避 installer 版本过低提示。

### 3.5 设置页可以整体移到运行时

`Setting.prototype.addSettingTab` 只读取 `e.navEl`、`e.id`、`e.icon`、`e.name`、`e.update()`、`e.containerEl`，不做 `instanceof` 检查（只有 `isPluginSettingTab` 用 instanceof 决定归入哪一组）。公开导出 `SettingTab` 与 `PluginSettingTab` 都是 `c4`（`SettingTab:()=>c4` 与 `PluginSettingTab:()=>c4`），它的父类是内部设置页基类 `i6`（`c4=function(e){...}(i6)`）。设置页按 `id` 定位（`"appearance"`、`"about"`）。

i18n 应包装 `i18next.t`：官方在 `dom-ready` 之后异步 `fetch("/i18n/<lang>.txt")` 后 `addResourceBundle`，覆盖资源包会被冲掉；而 `md` 是 Proxy，最终都经 `i18next.t`，包装可拦住全部取值点，也不依赖命名空间划分。

### 3.6 设置弹窗的实际创建路径

实测确认：设置弹窗**不经过**主进程的 `setWindowOpenHandler`。渲染进程直接构造窗口，随后立刻使用 `electronWindow`：

```
function WJ(e){
  var o=["popup"];
  o.push("width="+t), o.push("height="+n), o.push("x="+i), o.push("y="+r);
  var s=window.open("about:blank","_blank",o.join(","));
  if(!s) return null;
  ...
  s.electronWindow&&(s.electron.webFrame.setZoomLevel(...),Cl(()=>s.electronWindow.show()));
}
```

`s.electronWindow` 是 `remote.getCurrentWindow()` 的产物，在 `window.open` 返回后立即访问。`o.join(",")` 以 `"popup"` 开头，与主进程侧 `setWindowOpenHandler` 的判定条件一致。这是设置弹窗需要 remote 提前开启的原因。

### 3.7 remote 的开启状态可查询

`@electron/remote` 内部有 `isRemoteModuleEnabled(contents)`，它不在包入口的转发列表里，需直接引 `dist/src/main/server`：

```
const isRemoteModuleEnabledImpl = function (contents) {
    const webPreferences = contents.getLastWebPreferences() || {};
    return webPreferences.enableRemoteModule != null ? !!webPreferences.enableRemoteModule : false;
};
```

`webPreferences.enableRemoteModule` 未设置时默认 `false`。官方 asar 自己也有开启路径，挂在窗口接线函数上（`function re(o){if(l.remote)try{l.remote.enable(o)}`），由 `did-create-window` 触发，这个时刻晚于设置弹窗渲染进程的首个脚本。

**实测确认**：三次观测（两个 `window`、一个 `remote`）全部是「开启前 false、开启后 true」。

## 4. 改造后的结构

```
web_engine/src/main/resources/resfile/resources/app/
├── icon.png            不变（自定义图标）
├── tray.png            新增（托盘图标）
├── main.js             外层引导脚本，承载全部定制
├── inject/             新增目录，注入渲染进程的脚本
│   ├── preload.js          最早的注入点（版本短路、window.close 覆盖）
│   ├── dom-ready.js        设置页注入、i18n 包装、文档标题
│   ├── hcs-tab.js          HcsSettingsTab 类定义
│   └── app.css.css         样式覆盖（或用 insertCSS 内联）
├── node_modules/       不变
├── obsidian.asar       官方 1.13.4 原版，无补丁
└── package.json        version 改为 1.13.4
```

外层 `main.js` 的分工：

| 区域 | 承载内容 |
|------|---------|
| 顶部初始化 | 版本号改写、remote 开启、回收站兼容 |
| `browser-window-created` | 窗口登记、托盘、关窗到托盘、字体兼容、注入脚本注册、CSS 注入 |
| `require(asarPath)` 之前 | 十二个 `hcs-*` 通道、`exit-to-tray`、`force-quit`、`disable-update` 覆盖 |
| `require(asarPath)` 之后 | `starter` 与 `help` 通道重新注册 |
| 独立定时器 | deeplink 队列轮询、自动更新短路 |

## 5. 逐项改造清单

三十项定制的施加位置，按决策分类。详细依据见 `docs/asar-customization-runtime.md`。

### 5.1 主进程（15 项）

| 项 | 施加方式 |
|----|---------|
| 版本下限短路 | 入口处 `Object.defineProperty(process.versions, 'electron', ...)` |
| 十二个 `hcs-*` 通道 | `ipcMain.on(...)`，注册前先 `removeAllListeners` |
| `exit-to-tray`、`force-quit` | 同上 |
| 托盘初始化 | `new Tray(path.join(APP_PATH, 'tray.png'))`，菜单「显示」「退出软件」 |
| 关窗最小化到托盘 | `browser-window-created` 里对仓库窗口注册 `close`，判断退出标志后 `preventDefault` + `hide` |
| `before-quit` 标记 | `app.on('before-quit')` 置标志 |
| `starter` 与 `help` 通道 | `require` 之后 `removeAllListeners` 再按 `fromWebContents` 重新注册 |
| installer 版本提示 | `disable-update` 覆盖为恒真 |
| 自动更新短路 | 已有，保留 |
| 回收站兼容 | 已有，保留 |
| PDF 字体兼容 | 已有，保留，改为经 `inject/` 目录统一注入 |
| deeplink 队列派发 | 已有，保留 |
| remote 开启 | 已有（来自 `dfa2425`），保留 |
| `package.json` 三个字段 | author 改 `OHsidian`，description 改 `OHsidian HarmonyOS Edition`，version 改 `1.13.4` |
| `icon.png`、`tray.png`、移除 `icon.png.bak` 与 `harmonyos-sync-bridge.js` | 文件操作 |

### 5.2 渲染进程（12 项）

| 项 | 施加方式 |
|----|---------|
| `HcsSettingsTab` 类定义 | `inject/hcs-tab.js`，基类与 `Setting` 从 `window.require('obsidian')` 取 |
| `HcsSettingsTab` 注册 | `window.app.setting.addSettingTab(...)` |
| 「退出软件」开关 | 包装「外观」页的 `getSettingDefinitions`，在 translucency 项之前插入 |
| 「关于」页版本项改写 | 包装「关于」页的 `getSettingDefinitions`，替换版本项 |
| 「贡献作者」条目 | 同一处，追加一项 |
| 标题栏文字 `OHsidian` | `dom-ready` 后改写 `.titlebar-text` 文本 |
| 五处 `window.close()` | 在最早注入点覆盖 `window.close` 为空函数 |
| i18n 的 7 个键 | 包装 `i18next.t`，按语言查表 |
| `i18n/zh.txt` 的 4 块 | 同一处包装，中文表 |
| app.css 的两处 | `webContents.insertCSS` |
| 三个 HTML 的标题 | `dom-ready` 后改写 `document.title` |
| `[HMOS-FRAME]` 窗口按钮 | 见 5.3 |

### 5.3 `[HMOS-FRAME]`：可以移出

仓库版本改的是 `app.js` 里 `e.parent===e` 分支内的一段逻辑（渲染进程代码）。与官方 1.13.4 对比，仓库版本只多两件事：

```
// 官方
e.parent===e&&function(e){var t=e.electron.ipcRenderer.sendSync("frame")||"hidden";
e.titlebarStyle=t,"native"!==t&&(e.frameDom=new FRAME(e.electronWindow,e),
"hidden"===t&&e.document.body.addClass("is-hidden-frameless"))}(e)

// 仓库多出的两处
"function"==typeof e.electronWindow.setWindowButtonVisibility&&
  "native"!==t&&e.electronWindow.setWindowButtonVisibility("hidden"===t)

e.document.body.style.setProperty("--frame-right-space","126px")
```

两件事都能在运行时做到，且不依赖 asar 内部变量：

- `e.electronWindow` 就是 `window.electron.remote.getCurrentWindow()`，取其 `setWindowButtonVisibility` 即可。
- `--frame-right-space` 只是一个 CSS 变量，直接 `document.body.style.setProperty(...)`。
- 前置条件 `"native"!==t` 中的 `t` 取自 `ipcRenderer.sendSync("frame")`，这是官方通道，注入脚本可以用同样的方式读到值。

施加时机用 `dom-ready`，或在官方那段代码之后。官方不设置 `--frame-right-space` 也不调用 `setWindowButtonVisibility`，不会与注入互相覆盖。

### 5.4 三项窗口复用：效果待验证，必要时退回补丁

三项窗口复用（help 复用 starter、starter 复用为仓库窗口、打开最近仓库时复用 starter）改的是 asar 内部分支结构，官方在窗口创建函数内部完成，外部没有等价接口。

在「asar 保持官方原样」的前提下，外部能做的是从行为上逼近：在 `browser-window-created` 里检测到仓库窗口新建时，隐藏或销毁已存在的 starter 窗口。这与正式的窗口复用有差别（窗口标识、IPC 通道的发送方定位、尺寸与位置继承都会不同），实际表现需要设备验证。

因此分两方案：

- **方案 A（默认）：先不处理。** 保留官方行为：冷启动时 starter 窗口先出现，随后打开仓库窗口；help 与 starter 各用独立窗口。先跑通其余改动，在设备上看这三项的实际影响，再决定是否值得处理。
- **方案 B：把三项窗口复用作为唯一的补丁。** asar 不再是官方原样，而是「1.13.4 + 3 处补丁」。`docs/asar-customization-runtime.md` 第 9 节已列出这三个位置。

计划默认采用方案 A；三项的实际影响看得清楚之后，再决定是否改用方案 B。本计划的其余部分不受这一项选择影响。

## 6. 实施步骤

### 第 1 步：建立分支与基线（已完成）

已从 `feat/harmony-port-fixes` 创建 `feat/runtime-inject-13`。改动前的产物备份在 `~/.tmp/minimal-verify/`。

### 第 2 步：替换 asar 与资源（部分完成）

- 官方 1.13.4 asar 已原样复制到 `web_engine/src/main/resources/resfile/resources/app/obsidian.asar`。
- `package.json` 的 `version` 已改为 `1.13.4`。
- 待办：从基分支 asar 解出 `icon.png`（1606146 字节）与 `tray.png`（314843 字节）放到 asar 之外；把 `tray.png` 也放到仓库根；把 `package.json` 的 `author` 与 `description` 改掉。

验证方式：`md5sum` 与官方 1.13.4 一致（已确认）；asar 内不含任何本项目的字符串（`hcs-`、`HMOS`、`qtray`、`OHsidian` 全为 0，待确认）。

### 第 3 步：主进程注入

改外层 `main.js`，按 5.1 与 4 节的分区施加。要点：

- 版本号改写放在文件最开头，早于 `require(asarPath)`。**已完成并实测生效**，探针记录到 `真实值 5.0.0-Release -> 现值 18.0.0`。
- `web-contents-created` 里开启 remote。**已完成并实测生效**，三次观测均为「开启前 false 开启后 true」。注册位置在 asar 加载之前，因此比官方自己注册的同类监听先执行。
- `disable-update` 覆盖为恒返回 `true`。**实测确认必需**：设备上 Electron 版本为 `5.0.0-Release`，官方在渲染进程侧的比较会触发 installer 版本过低提示。
- 十二个 `hcs-*` 通道的处理函数从 `tools/build-asar.mjs` 的 `buildHcsBlock()` 移出，本地变量统一加下划线前缀，避免遮蔽。
- 通道读写的目录用外层已有的 `dataPath`（`app.getPath('userData')`），与 ArkTS 侧 `CloudSyncAdapter.ets` 的 `getApplicationContext().filesDir` 指向同一处（已在设备上确认二者是同一目录）。
- 托盘与关窗处理挂在已有的 `installFontFaceGuard` 同一处 `browser-window-created` 上，共用窗口登记。
- 窗口类别用 `webContents.getURL()` 判定，容错 `about:blank`（设置弹出窗口）。

验证：`node --check` 通过；`devecocli build` 通过。

### 第 4 步：渲染进程注入

创建 `inject/` 目录，按 5.2 编写。要点：

- 注入时机沿用 `installFontFaceGuard` 的三点法：`browser-window-created` 时立即注入一次，再挂 `did-start-navigation` 与 `dom-ready` 各一次，脚本自身用标志位做幂等。
- 设置页注入必须晚于 `window.app` 赋值（在 `ready()` 回调内）。先轮询 `window.app` 出现再执行，或挂 `dom-ready`。
- 包装 `getSettingDefinitions` 之后必须再调一次 `tab.update()`，否则渲染的是 `addSettingTab` 期间缓存的旧结果。
- `HcsSettingsTab` 的基类取法：优先 `window.require('obsidian').PluginSettingTab`；不成立时从 `window.app.setting.settingTabs[0]` 用 `Object.getPrototypeOf` 取。
- i18n 包装在语言包异步加载之前或之后施加都成立。

验证：`node --check` 通过；`devecocli build` 通过。

### 第 5 步：设备验证（方法已验证）

```bash
devecocli build
devecocli run --skip-build --device 127.0.0.1:42021
hdc shell "cat /data/app/el2/100/base/com.mikannqaq.obsidian/files/obsidian.log"
```

这套流程已跑通两轮。日志中的探针行前缀是 `[PROBE]`，排在每轮启动块的最前面。

**关键要点：注入的诊断输出必须写 `obsidian.log`，不能用 `console.log`。** 后者走标准输出，在设备上既不进该文件，也不出现在 hilog 里。

另一处细节：`log()` 定义在外层 `main.js` 的第 280 行，早期执行的探针用不了它，需要自备写入函数。

日志时间戳是 UTC，北京时间是 UTC+8。读日志用 `tail -n 60 <文件>`，不要用 `cat -A` 之类的参数，设备侧的 `cat` 不支持。

检查项：

| 检查 | 判据 |
|------|------|
| asar 加载 | `Loaded main app package` 后跟路径 |
| 自动更新关闭 | `HarmonyOS port: desktop auto-update is disabled` |
| remote 已开启 | `remote 开启前 false 开启后 true` |
| 字体补丁 | `字体兼容补丁已注入渲染进程 N` 多次 |
| 无异常 | 不含 `TypeError`、`is not a function`、`is not defined`、`Cannot read` |
| 托盘出现 | 界面确认 |
| 设置页能打开 | 界面确认，含「华为云同步」页 |
| 「退出软件」开关存在 | 界面确认 |
| 「关于」页版本显示 | 界面确认，显示 `HarmonyOS-1.13.4` |
| PDF 渲染 | 打开含非内嵌字体的 PDF |
| `obsidian://` 派发 | 界面确认 |

界面项需要你确实看见后告知，我不自行操作设备界面。

### 第 6 步：提交

分两次提交：一次是 asar 与资源替换，一次是注入脚本与 `main.js`。提交前核对 `git status`，`web_engine/BuildProfile.ets`、`.bitfun/`、`.pi/` 不纳入。

## 7. 风险与未验证事项

已由实测排除：设备 Electron 主版本未知（实为 `5.0.0-Release`）；官方 asar 能否加载运行（能）；外层注入能否执行（能）；remote 能否被开启（能）。

| 风险 | 影响 | 应对 |
|------|------|------|
| 设置页注入时机与缓存 | 包装 `getSettingDefinitions` 后不刷新会渲染旧结果 | 包装后调 `tab.update()` |
| `window.require('obsidian')` 是否含所需类 | 影响 `HcsSettingsTab` 基类取法 | 已有回退取法（`Object.getPrototypeOf`） |
| `[HMOS-FRAME]` 的判据不完整 | 注入可能判错前置条件的值 | 先查清 `D.frame` 由谁在何时设置 |
| 三项窗口复用在运行时无等价接口 | 冷启动可能出现多余窗口、help 与 starter 不共用窗口 | 见 5.4，先保留官方行为，在设备上看实际影响后决定是否退回补丁 |
| ArkTS 侧 `hcs-*` 链路 | 两套机制都没有调用方，实际未联通 | 本次不处理，仅保证通道注册 |
| 1.13.4 的设置页返回形状 | 「外观」「关于」页的 `getSettingDefinitions` 返回值需实测 | 按实测形状写，不写跨版本兼容分支 |

## 8. 交付物

1. 改造后的工作区：官方 1.13.4 asar + 外层注入脚本。
2. 提交记录：asar 与资源替换一次，注入实现一次。
3. 文档：`docs/runtime-inject-verification.md`（实测记录，已产出）、`docs/asar-customization-runtime.md`（归属决策）、本文。
4. 设备验证记录。

## 9. 与既有 `tools/` 的关系

`tools/build-asar.mjs` 在本次改造后不再需要用于产出 asar。它的三部分价值仍需保留：

- `tools/lib/` 的符号解析逻辑：本计划不需要（运行时不依赖压缩符号）。
- `tools/hcs-settings-tab.js`：改为 `inject/hcs-tab.js` 的模板来源。
- `.agents/skills/obsidian-asar-upgrade/scripts/verify-asar.mjs`：校验目标从「定制是否施加」改为「asar 是否为官方原样」，脚本需要重写判据。

`tools/README.md` 需要说明两条路线的关系，避免后来者误用。

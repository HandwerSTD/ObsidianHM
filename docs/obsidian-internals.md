<!-- Copyright (c) 2026 HandwerSTD -->

# Obsidian 内部机制记录

本文件记录在升级与注入过程中从官方 asar 里读出的内部机制。这些是理解官方行为、判断改动位置、排查报错所需要的依据，与具体某一项定制无关，因此单独成文。

除特别说明，内容来自官方 1.14.4 的 asar（md5 `a2bde3f94594c1d697492998ea6e20aa`）。1.12.7 与 1.13.4 的对应差异列在需要对照的地方。

- 定制的归属判定：`docs/asar-customization-runtime.md`
- 内核升级流程：`.agents/skills/obsidian-asar-upgrade/SKILL.md`
- 1.12.7 与 1.13.4 的逐项差异：`docs/asar-upgrade.md` 第 3 节
- 1.13.4 升级到 1.14.4 的差异：`docs/asar-upgrade.md` 第 4 节

## 1. 主进程

### 1.1 入口与调用方式

`main.js` 的导出只有一个函数：

```js
module.exports = function (i, e) { ... }
```

`i` 是 asar 路径，`e` 是外层创建的 `EventEmitter`（外层传入的是 `updateEvents`）。外层 `require(asarPath + '/main.js')` 之后拿到它并调用。

`main.js` 的模块级段落只有函数定义与常量（38 个 `function` 与路径、版本号等常量），占文件前 81%。全部运行时动作都在导出函数里：46 个 `ipcMain.on`、1 个 `ipcMain.handle`、9 个 `app.on`、`app.whenReady`、2 个 `protocol.register` 与 1 个 `protocol.handle`、CLI 的 `listen`，都在这一段内。

这一结构直接决定了覆盖官方通道的时机（见 1.4）：外层 `require(asarPath + '/main.js')` 拿到的只是函数，调用它之前官方一个监听器都还没注册。

1.12.7 的签名是 `function (c, i, l)`，第三个参数在官方实现中未被使用，两版对外层的调用方式兼容。

### 1.2 依赖的模块

```
child_process   electron   fs   net   original-fs   os   path   url   util
```

两版完全相同。asar 对运行时的要求没有变化。

### 1.3 46 个 ipcMain 通道

```
terms              is-quitting        is-closing         desktop-dir
documents-dir      resources          version            policy
set-language       file-url           relaunch           update
check-update       disable-update     copy-asar          disable-gpu
insider-build      cli                frame              adblock-lists
adblock-frequency  print-to-pdf       vault              vault-list
vault-remove       vault-move         vault-open         vault-message
starter            help               sandbox            context-menu
request-url        open-url           trash              get-documents-path
get-sandbox-vault-path                get-default-vault-path
set-menu           update-menu-items  render-menu        set-icon
get-icon           create-browser-session                latest-public-version
open-file
```

另有 `ipcMain.handle("register-cli")` 一个。

与 1.12.7 的差别：仅 1.12.7 有 `is-dev`；仅 1.13.4 有 `is-closing`、`policy`、`set-language`、`terms`；仅 1.14.4 有 `latest-public-version`、`open-file`。

其中几条可以直接复用，外层不必自己实现：

| 通道 | 用途 |
|------|------|
| `is-quitting` | 返回官方的退出标志 |
| `is-closing` | 返回退出标志与该窗口的 `closing` 标志的并 |
| `disable-update` | 读写更新禁用开关，官方据此隐藏更新入口 |
| `update` | 返回更新状态字符串 |
| `check-update` | 返回是否有更新在检查中 |
| `frame` | 读写标题栏样式 |

### 1.4 覆盖官方通道的时机

官方的 `ipcMain.on` 全部在 `module.exports` 调用的那个函数里（见 1.1）。想让自己的处理取代官方的，必须满足两条：先 `removeAllListeners(name)`，且这段代码在 `loadApp()` 之后执行。

在这之前清空，官方随后会补上一个。`sendSync` 通道上出现两个监听器时，以先设置 `returnValue` 者为准，结果不可预测。

当前与本项目重名的只有 `disable-update` 一个通道。

### 1.5 版本下限检查

```js
go = process.versions.electron, fo = parseInt(go.split(".")[0]);
if (fo < 18) { dialog.showErrorBox("Manual update required", ...); shell.openExternal(...); app.quit(); return }
```

`go` 与 `fo` 都只在一处赋值、一处使用。`fo` 是主进程读 Electron 版本的唯一位置。

`process.versions` 上的既有属性是只读的，描述符为 `{ writable: false, configurable: true }`。直接赋值在非严格模式下静默失败，严格模式下抛错。改写用：

```js
Object.defineProperty(process.versions, 'electron', {
  value: '18.0.0', writable: true, configurable: true, enumerable: true
});
```

改写只作用于主进程。渲染进程是独立进程，它自己的 `process.versions.electron` 不受影响。

### 1.6 平台判定

```js
var W = process.platform === "darwin"
app.on("window-all-closed", () => { W || app.quit() })
app.on("activate", () => { be = !1; BrowserWindow.getAllWindows().length === 0 && _e() })
```

非 macOS 上关掉最后一个窗口就退出应用；macOS 上不退出，点 Dock 图标时若窗口数为 0 则重走启动逻辑。

主进程另有 `xe = D.frame === "native"`（即 `frame`）与 `Ue = xe ? "default" : "hidden"`（即 `titleBarStyle`），两者随每个 `BrowserWindow` 的构造参数一起传入。

### 1.7 三个窗口打开函数

三个函数都是单例：已存在时还原并聚焦，不新建。

```js
// 起始窗口，800x650
function ye() {
  if (se) { se.isMinimized() && se.restore(), se.focus(); return }
  let o = se = dt({ width: 800, height: 650 });
  o.on("closed", () => { se = null });
  let r = () => o.show();
  o.loadURL(ae + "starter.html").then(r, r)
}

// 帮助窗口，600x680
function pt() {
  if (we) { we.isMinimized() && we.restore(), we.focus(); return }
  let o = we = dt({ width: 600, height: 680 });
  o.on("closed", () => { we = null });
  let r = () => o.show();
  o.loadURL(ae + "help.html").then(r, r)
}

// 仓库窗口，800x600
function he(o, r = !0) {
  if (Y[o]) { let v = Y[o]; return r && (v.isMinimized() && v.restore(), v.focus()), v }
  ...
  Y[o] = b; ... b.loadURL(tt)
}
```

`ye()` 与 `pt()` 都不含平台分支，两个窗口在所有平台上都是独立窗口。`dt()` 是它们的公共构造器：`resizable: false, maximizable: false, fullscreenable: false`。

启动逻辑：

```js
let _e = () => { for (let o in O) O[o].open && he(o); Object.keys(Y).length === 0 && ye() }
```

先打开标记为已打开的仓库，一个都没有时才打开起始窗口。

`he` 的关闭处理：

```js
b.on("close", v => { b.closing = !0, s(), ee(o, u), setTimeout(() => { !v.defaultPrevented && !b.isDestroyed() && b.destroy() }, 3e3) })
b.on("closed", () => { delete Y[o], !be && (se || Object.keys(Y).length > 0) && lt(o, !1) })
```

### 1.8 命令行接口

入口是「关于」页高级分组里的「命令行界面」项（i18n 键 `setting.about.option-cli`）。开关本身走 `ipcMain.on("cli")`，写 `C.cli` 并落到用户配置。打开开关时渲染进程弹一个 Notice，点「注册」调 `ipcMain.handle("register-cli")`。

`register-cli` 的第一句是 argv 判定：

```js
u = F.basename(process.argv0),
p = u.toLowerCase().includes("obsidian")
if (!p) return { success: false, message: `Unable to add to command line because the executable is "${u}" instead of "obsidian".` }
```

`p` 在它的宿主函数内只有这一处读取。`process.argv0` 在全文件只出现这一次，消息里的 `${u}` 是 argv 的原样回显。同段的参数清洗函数

```js
F.basename(argv[0]).toLowerCase().includes("electron") && t.shift()
```

说明这个判定的原意是识别 `electron .` 开发模式下 argv 多出的那个元素。

`p` 为真后的注册动作按平台分三支：`oe` 为真（Windows）用 powershell 改用户 PATH；`W` 为真（macOS）在 `/usr/local/bin/obsidian` 建符号链接并要管理员授权；其余（Linux）在 `~/.local/bin/obsidian` 建符号链接，或把随包发布的 `obsidian-cli` 复制过去加 `chmod 0755`。

`obsidian-cli` 是随 Linux 包发布的一个独立小可执行文件，只做三件事：按 `XDG_RUNTIME_DIR`（取不到则 home）拼出 `.obsidian-cli.sock`，`connect` 后把 `{argv, tty, cwd}` 写进去，再把 stdin/stdout 接上。另一端在主进程：抢不到 `requestSingleInstanceLock()` 的那个进程负责连套接字，主进程收到后执行命令并把结果写回。

Windows 走的是另一条路：`app.on("second-instance")` 里取 argv 里的 `session=` 参数，连具名管道。非 Windows 上该监听器第一句即 `return`。

渲染进程侧的命令清单在 app.js，由 `registerCliHandler` 逐个注册，1.14.4 有 44 个（`search`、`daily:append`、`base:query`、`publish:site`、`sync:restore`、`workspace:save` 等）。

本机（HarmonyOS）无法提供这条链路，归属判定与依据见 `docs/asar-customization-runtime.md` 的 4.6.1。

## 2. 渲染进程

### 2.1 全局对象

| 全局 | 出处 |
|------|------|
| `window.app` | `ready(() => { window.app = new Rie(d, n) })` |
| `window.require` | `window.require = function () { return u }` |
| `window.Notice` | `window.Notice = xw` |
| `window.FS` | `window.FS = aC` |
| `window.applyCss` | `window.applyCss = function (e) { t.applyCss(e) }` |
| `window.moment`、`window.Prism`、`window.MathJax` | app.js 内多处赋值 |
| `i18next` | `lib/i18next.min.js` 是 UMD，在无 `module` 的页面环境里走 `(e = e \|\| self).i18next = t()` 分支，挂到 `self` |

**`window.require('obsidian')` 在设备上不可用。** 它抛：

```
Cannot find module 'obsidian'
Require stack:
- electron/js2c/renderer_init
```

`window.require` 返回的模块实例含 158 项导出（`Setting`、`PluginSettingTab`、`SettingTab`、`SettingPage`、`SettingGroup`、`Notice`、`Modal`、`Platform`、`moment` 等），但把模块名交给它解析时会失败，因为官方把实例放在 webpack 闭包里，未注册为可解析的模块。

因此从渲染进程取官方类型要走别的路径：`Notice` 直接从 `window` 取；设置页基类从已有设置页回溯原型链（见 2.3.2）。

### 2.2 i18n 的取词方式

取词是三层代理：

```js
var md = (vd = function (e, t) { return i18next.t(e, t) },
  function e(t) {
    var n = {};
    return new Proxy(function (e, n) { return typeof e === "string" ? vd(t + e, n) : t ? vd(t.slice(0, -1), e) : "" },
      { get: function (i, r) { if (typeof r !== "symbol") return Object.hasOwn(n, r) ? n[r] : n[r] = e(t + Up(r) + ".") } })
  }(""));
```

```
Up(e) = e.replace(/[A-Z]/g, c => "-" + c.toLowerCase()).replace(/_[0-9]/g, c => "-" + c.substring(1))
```

属性访问逐级返回子代理，调用才产生取词。驼峰转 kebab-case 后补一个点，最终交给 `i18next.t` 的键形如 `setting.about.label-version`。（取样结果：`db.setting.about.labelVersion({version:"1.14.4"})` → `"setting.about.label-version"`，`db.setting.about.optionAutoUpdateDescription()` → `"setting.about.option-auto-update-description"`。）

常用存取器：

```js
var kne = db.setting.about, Cne = db.setting.account
```

1.12.7 用 `O7`（about）与 `F7`（account），1.13.4 改为 `Fee` 与 `Ree`，1.14.4 为 `kne` 与 `Cne`。

另有 `Kp(e)` 把点分平铺的键表展开为嵌套对象，与取词方向相反。

### 2.3 设置页

#### 2.3.1 注册

```js
t.prototype.addSettingTab = function (e) {
  var t = this;
  e.navEl || (e.navEl = createDiv({ cls: "vertical-tab-nav-item tappable", attr: { tabIndex: -1 } },
    function (n) {
      n.setAttr("data-setting-id", e.id),
      e.icon && n.createDiv("vertical-tab-nav-item-icon", function (t) { xg(t, e.icon) }),
      n.createDiv({ cls: "vertical-tab-nav-item-title", text: e.name }),
      n.createDiv("vertical-tab-nav-item-chevron", function (e) { return xg(e, "lucide-chevron-right") }),
      n.addEventListener("click", function () { ... }),
      t.isPluginSettingTab(e) && n.addEventListener("contextmenu", function (i) {
        var r = e instanceof u4 ? "plugins" : "community-plugins", o = e.id;
        dy.forEvent(i).setParentElement(n).addItem(function (e) { ... })
      })
    })),
  e.update(),
  this.searchIndex.addTab(e),
  this.isPluginSettingTab(e) ? this.pluginTabs.push(e) : (this.settingTabs.push(e), this.tabContainer.appendChild(e.navEl)),
  this.updatePluginSection(),
  this.refreshSearch()
}
```

它读取 `e.navEl`、`e.id`、`e.icon`、`e.name`、`e.update()`、`e.containerEl`。函数体内没有对入参的 `instanceof` 检查，出现的那处 `instanceof` 在右键菜单回调里，用于区分 `plugins` 与 `community-plugins`。

判定集中在 `isPluginSettingTab`：

```js
isPluginSettingTab = function (e) { return e instanceof u4 || e instanceof c4 }
```

它只决定归入 `pluginTabs` 还是 `settingTabs`。

注意 `Plugin.prototype.addSettingTab`（插件实例上的同名方法）实现不同，是转发加注销注册，只接受一个参数。

#### 2.3.2 基类

公开导出的 `SettingTab` 就是内部的 `c4`：

```js
c4 = function (e) {
  function t(t, n) { var i = e.call(this, t, t.setting) || this;
    return i.plugin = n, i.name = n.manifest.name, i.id = n.manifest.id, i }
  return v(t, e), t.prototype.getSettingDefinitions = function () { return [] }, ...
}(i6)
```

构造签名是 `(app, plugin)`，读取 `plugin.manifest.name` 与 `plugin.manifest.id`。

不依赖 `window.require` 的取法：

```js
Object.getPrototypeOf(app.setting.settingTabs[0]).constructor
```

`settingTabs` 的元素都是内部基类的实例。注册一个继承它的新类之后，页签列表会多出一项。这一步是必需的：`isPluginSettingTab` 用 `instanceof` 判定，类必须真的继承内部基类。

1.12.7 的基类是 `_1`，容器是 `zk`，通知是 `fb`，i18n 是 `gm`。

#### 2.3.3 渲染流程

1.13.4 起把设置页从「在 `display()` 里逐项 `addSetting`」改为「实现 `getSettingDefinitions()` 返回定义数组」：

```js
t.prototype.getSettingDefinitions = function () { ... return t }
```

基类的 `update()` 做 `this.settingItems = this.getSettingDefinitions()`，随后渲染。

| 统计项 | 1.12.7 | 1.13.4 | 1.14.4 |
|--------|--------|--------|--------|
| `getSettingDefinitions` | 0 | 23 | 23 |
| `prototype.display = function` | 29 | 11 | 13 |
| `t.push({ name:` | 5 | 44 | 45 |
| `s.addSetting(` | 6 | 1 | 24 |

**设置项的取值在 `Setting` 构造期间就被算出并缓存。** 因此包装 `getSettingDefinitions` 之后必须再调一次 `tab.update()`，否则渲染的仍是包装之前的旧结果。

#### 2.3.4 定义项的结构

平铺项：

```js
{ name: "...", desc: "...", render: function (setting) { setting.addToggle(...) } }
```

分组项：

```js
{ type: "group", heading: "...", items: [ ... ] }
```

「外观」页与「关于」页都是混合结构，前面是平铺项，后面跟着 `type:"group"` 的分组。遍历时必须同时检查顶层与分组内层，在第一个分组就返回会漏掉后面的分组。

`Setting` 容器（类名 `_b`）的完整方法集（27 个，已逐个核对）：

```
addButton      addColorPicker  addComponent   addDisplayValue  addDropdown
addExtraButton addMomentFormat addProgressBar addSearch        addSlider
addText        addTextArea     addToggle      clear            setAction
setClass       setDesc         setDisabled    setErrorMessage  setHeading
setName        setNavigable    setNoInfo      setRowClick      setTooltip
setVisibility  then
```

`addButton`、`addExtraButton`、`addToggle`、`addText` 等传入的是回调，回调参数才是组件实例（`ButtonComponent` 等），`setButtonText`、`setCta`、`setIcon`、`onClick` 属于组件而不属于 `Setting` 容器。

#### 2.3.5 定义项里的实例引用

定义项的 `render` 除了画界面，还会把当时的 `Setting` 实例存到页面对象的属性上，供随后重画时使用。「关于」页的两个例子：

| 定义项 | 存入的属性 | 随后的使用 |
|--------|------------|------------|
| 账号分组里的商用许可证项 | `this.commercialLicenseSetting` | `render` 末尾直接调用 `this.updateAccountSettings()` |
| 版本项 | `this.currentVersionSetting` | 由 `updateVersionSetting()` 调用 |

`updateAccountSettings()` 第一句就是：

```js
this.accountSetting.clear(), this.catalystSetting.clear(), this.commercialLicenseSetting.clear()
```

因此该条目即使不显示，`render` 也必须执行、必须把实例存进去。把这一项从定义列表里删掉，`render` 不会调用，属性保持 `undefined`，随后 `clear()` 就抛出异常，账号分组里其余条目的渲染一并中断。

`Setting.clear()` 只清空控件（`controlEl.empty()`、`components=[]`）并保留行本身。

#### 2.3.6 隐藏某一行的正确做法

定义项上有一个 `visible` 字段，渲染流程每次都会用它重置该行的显示状态：

```js
function _2(e) {
  var n = z2(e.def.visible, true);
  e.settingEl.toggle(n);
  ...
}
```

`z2(e, t)` 在字段为 `undefined` 时返回默认值 `t`（此处为 `true`）；字段是函数时调用它取返回值。分组的显示条件类似（`U2`），且额外要求组内至少有一行可见。

因此隐藏一行应当在定义项上置 `visible: false`。在 `render` 里调 `setting.setVisibility(false)` 会被随后的 `_2` 重新显示，因为该定义项没有 `visible` 字段，`z2` 按 `true` 处理。

同一套 `visible` 字段也是官方自己控制显示的方式，例如导出设置里的 `n.setVisibility(t)` 配合渲染时的重置。

### 2.4 弹窗

设置界面在 1.13.4 起默认在独立窗口打开，路径是：

```js
window.open("about:blank", "_blank", ["popup", "width=...", "height=...", ...].join(","))
```

这个窗口不加载任何脚本，因此其中没有 `i18next`、没有 `window.require`。它的样式由官方从主窗口 `head` 克隆过来（`YJ` 里的 `cloneNode`），类名带 `is-popout-modal`。

关闭弹窗走 `Modal.close` → 弹窗的 `cleanup` → `y.close()`。

### 2.5 标题栏

官方自绘标题栏类的构造函数：

```js
var i = this.isMac = "darwin" === window.process.platform;
...
this.leftButtonContainerEl = s.createDiv("titlebar-button-container mod-left");
var c = s.createDiv("titlebar-button-container mod-right");
if (!i) {
  if (e.minimizable) { var u = c.createDiv({ cls: "titlebar-button mod-minimize", onclick: () => e.minimize() }); ... }
  if (e.maximizable) { var h = c.createDiv({ cls: "titlebar-button mod-maximize", onclick: () => e.isMaximized() ? e.unmaximize() : e.maximize() }); ... }
  if (e.closable)    { var d = c.createDiv({ cls: "titlebar-button mod-close",    onclick: () => e.close() }); ... }
}
```

非 macOS 上会自绘最小化、最大化、关闭三个按钮，放在 `.titlebar-button-container.mod-right`。左端的菜单按钮（`mod-logo`）由 `Aie` 单独追加到 `mod-left`。

标题栏的创建点是：

```js
e.parent === e && function (e) {
  var t = e.electron.ipcRenderer.sendSync("frame") || "hidden";
  e.titlebarStyle = t, "native" !== t && (e.frameDom = new OI(e.electronWindow, e), "hidden" === t && e.document.body.addClass("is-hidden-frameless"))
}(e)
```

`frame` 取 `native` 时不创建自绘标题栏。

官方 CSS 把三个按钮藏起来的规则带 `:not(.starter, .is-popout-modal)`：

```css
.is-hidden-frameless:not(.starter, .is-popout-modal).mod-windows .titlebar-button.mod-back,
.is-hidden-frameless:not(.starter, .is-popout-modal).mod-linux .titlebar-button.mod-back,
... , .titlebar-text { display: none; }
```

设置子窗口带 `is-popout-modal`，被排除在外。隐藏它需要自己处理，且要 `!important`，因为 `.mod-linux .titlebar-button { display: flex }` 优先级更高。

平台类由 `Gp()` 决定（`win32` → `win`，`darwin` → `mac`，`linux` → `linux`，其余非空值 → `unknown`），加在 `body` 上成为 `mod-windows` / `mod-macos` / `mod-linux`。

### 2.6 拖动区域

窗口装饰被隐藏时（`hideTitleBar` 为真，`setWindowDecorVisible(false)`），整个窗口只有一处可以拖动：官方自绘标题栏那条 `.titlebar` 元素。官方 `app.css` 给它设了：

```css
.titlebar {
  -webkit-app-region: drag;
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  ...
}
```

写作 `no-drag` 的元素把自身从拖动区域里排除，例如 `.titlebar-button`、`.workspace-tab-header`、`button`、各类输入框。因此窗口里可以点击的控件不会被拖动区域吞掉。

`.titlebar` 被 `display: none` 时拖动区域一并消失，窗口拖不动。起始窗口与帮助窗口都需要保留这条元素。

标题栏内三条子元素与窗口拖动的关系：

| 选择器 | 作用 |
|--------|------|
| `.titlebar-inner` | 标题栏的内容容器，标题文字在它里面 |
| `.titlebar-text` | 居中的标题文字，宽高铺满标题栏 |
| `.titlebar-button-container.mod-left` | 左端的菜单按钮容器 |

`.titlebar-text` 覆盖整个标题栏，它没有声明 `no-drag`，因此不会破坏拖动。真正会把拖动切掉的只有元素上的 `-webkit-app-region: no-drag`。

## 3. 版本号

官方有两个版本概念：

| 名称 | 来源 | 用途 |
|------|------|------|
| Obsidian 版本 | `td.version = ipcRenderer.sendSync("version")` | about 页 `labelVersion` |
| installer 版本 | `td.build = remote.app.getVersion()` | about 页 `labelInstallVersion` |

`remote.app.getVersion()` 读的是外层 `package.json` 的 `version`。因此外层改这个字段会同时影响 about 页显示的 installer 版本与启动扫描 userData 时的版本比较。

官方的版本比较函数 `qy(a, b)`：

- `b` 无法解析为版本时返回 `false`
- `a` 无法解析时返回 `true`
- 其余情况逐位比较，`a` 小于 `b` 时为真，逐位相等时以位数短者为小

拿 `"28.2.3"` 实测：

| a | `qy(a, "28.2.3")` |
|---|---|
| `"18.0.0"` | `true` |
| `"26.0.0"` | `true` |
| `"28.0.0"` | `true` |
| `"28.2.2"` | `true` |
| `"28.2.3"` | `false` |
| `"28.2.4"` | `false` |
| `"29.0.0"` | `false` |

asar 内另有 Obsidian 版本常量（`goe`，初值 `"1.14.4"`，启动时被 `sendSync("version")` 的结果覆盖）与 installer 版本比较对象 `"28.2.3"`。

1.13.4 新增 `policy.json` 读取，用于企业策略配置（`plugins`、`themes`、`snippets`、`sync`、`publish`、`webViewer`、`devTools`、`insider` 八项开关）。HarmonyOS 上该文件不存在，读取失败后走默认值，八项全部关闭。

## 4. 平台差异一览

最直接的一对：

| 行为 | macOS | 其他平台 |
|------|-------|----------|
| 关闭最后一个窗口 | 不退出 | 退出应用 |
| 自绘三键（最小化、最大化、关闭） | 不创建 | 创建，位于 `mod-right` |
| `File` 菜单的退出项 | 不插入（应用菜里有 `Cmd+Q`） | 插入 `role:"quit"` |
| `File` 菜单的最近文档项 | 插入 | 插入 |

这几个菜单条件都由 `ce(cond, fn)` 控制（`ce(i,e){return i?e():[]}`，条件为真时展开 `fn()` 的结果）：

```js
...ce(W||X, () => [{ role: "recentDocuments", ... }]),   // macOS 与 Windows
...ce(r,     () => [{ id: "close-window", role: "close" }]),
...ce(!W,    () => [{ type: "separator" }, { id: "quit", role: "quit" }])
```

其中 `r` 由 `ut(o, r = !1)` 的调用方传入。`W` 为真时应用菜单含 `Quit Obsidian`（`Cmd+Q`）。

主进程里另有若干处按平台分叉：

```js
var W = process.platform === "darwin", X = process.platform === "win32"
```

其余分叉涉及命令行接口（Windows 用具名管道，其他平台用 `$XDG_RUNTIME_DIR` 下的套接字文件）、可执行文件扩展名白名单、`policy.json` 的读取路径（macOS 用 `~/Library/Application Support`，Windows 用 `Program Files`，其余用 `/etc`）、打开本地文件时用 `shell.openExternal` 还是 `shell.openPath`、以及快捷键的 `metaKey` 与 `ctrlKey`。

渲染进程侧按 `window.process.platform` 分叉的地方同样不止一处，例如标题栏的 `isMac` 与设置页的若干 `td.isMacOS` 判定。

因此查找平台相关行为时，除了搜 `process.platform`，还要看 `W` / `X` 这两个短标识符在上下文中的含义。它们在压缩产物里不含语义，只凭名字搜不到。

## 5. 读代码的方式

asar 内的 js 是压缩产物，变量名逐版重排，按名字定位改动位置会在下次升级时失效。稳定的定位依据是：

- **方法名与属性名**：构造函数名之外的 `prototype.xxx`、对象字面量的键名都会被保留
- **字符串字面量**：通道名、CSS 类名、i18n 键、错误文案
- **结构特征**：`module.exports=function(...)`、`e.parent===e`、`type:"group"` 这类形态

解包查看：

```bash
cd tools && node -e "
import('@electron/asar').then(a => {
  console.log(a.extractFile('<asar 路径>', 'main.js').toString().includes('BrowserWindow'))
})
"
```

`@electron/asar` 4.3.1 是 ESM（`"type":"module"`），必须用 `import`。

## 6. 已确认不存在的东西

以下在本项目里常被假定存在，实际官方没有：

| 项 | 情况 |
|----|------|
| `Tray` | 官方 `main.js` 里 `new l.Tray` 命中 0 次。全部 380 个文件里搜「Tray」只有两处，都在第三方库（`lib/prism.min.js`、`lib/pdfjs/pdf.worker.min.mjs`），与托盘无关 |
| `setSkipTaskbar`、`statusBar` | 各 0 次 |
| `is-dev` 通道 | 1.13.4 中不存在 |
| `window.require('obsidian')` | 存在但不可解析，抛 `Cannot find module` |
| `vault-move` 通道 | 两版都存在，未删除 |
| `policy.json` | 文件不存在，读取失败走默认值 |

`ipcMain.on("frame", ...)` 是官方自带，1 处。

`enhance.js` 与 `sim.js` 在 1.12.7 与 1.13.4 两版中 md5 相同（分别为 `fb7a3408e1b0d75662897444e8cd86da` 与 `12d22674f0ce5cabd62a5613df8b91c6`）。

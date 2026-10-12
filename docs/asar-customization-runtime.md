# asar 定制的归属决策

本文件对仓库在 Obsidian 1.12.7 上做过的全部定制逐项做出决定：改为运行时注入、保留补丁、或者本轮暂缓。

运行时注入指由外层引导脚本（`web_engine/src/main/resources/resfile/resources/app/main.js`）或由它注入渲染进程的脚本施加改动，asar 内的官方文件保持原样。这样升级内核时不需要因为官方改写而重新定位这些改动。

本文件的判定已完成设备实测验证，实测细节见 `docs/runtime-inject-verification.md`。实测确认：官方原版 asar 能被加载运行，外层注入能执行，remote 能被开启，设备上的 Electron 真实版本为 `5.0.0-Release`。

## 1. 判定依据

asar 向外暴露的接口只有两处。

### 1.1 主进程入口

`asar/main.js` 的导出是 `module.exports=function(i,e){...}`，`i` 是 asar 路径，`e` 是外层创建的 `EventEmitter`。外层 `loadApp()` 调用它之后，`app`、`ipcMain`、`BrowserWindow`、`Tray`、`Menu`、`webContents.insertCSS`、`webContents.executeJavaScript` 全部可用。

`main.js` 顶部的模块级代码在 `require` 期间就执行完毕，外层拿到控制权时已经跑过。托盘创建、`ipcMain` 注册、`app.on` 监听都在这段里。

### 1.2 渲染进程的全局

asar 自己在渲染进程挂载了这些：

| 全局 | 出处 |
|------|------|
| `window.app` | `ready((function(){window.app=new Rie(d,n)}))` |
| `window.require` | `window.require=function(){return u}` |
| `window.Notice`、`window.FS`、`window.applyCss`、`window.moment`、`window.Prism`、`window.MathJax` | app.js 内多处赋值 |
| `i18next` | `lib/i18next.min.js` 是 UMD，`index.html` 与 `starter.html` 以 `defer` 引入；在无 `module` 的页面环境里走 `(e=e||self).i18next=t()` 分支，挂到 `self` |

`window.require()` 返回的模块包含 158 项导出，其中与本项目相关的是 `Setting`、`PluginSettingTab`、`SettingTab`、`SettingPage`、`SettingGroup`、`Notice`、`Modal`、`Platform`、`moment`。

### 1.3 设置页基类的可达路径

`Setting.prototype.addSettingTab` 的完整实现（1.13.4）：

```
t.prototype.addSettingTab=function(e){
  var t=this;
  e.navEl||(e.navEl=createDiv({cls:"vertical-tab-nav-item tappable",...},
    function(n){n.setAttr("data-setting-id",e.id),e.icon&&n.createDiv(...),
    n.createDiv({cls:"vertical-tab-nav-item-title",text:e.name}),...})),
  e.update(),
  this.searchIndex.addTab(e),
  this.isPluginSettingTab(e)?this.pluginTabs.push(e):(this.settingTabs.push(e),this.tabContainer.appendChild(e.navEl)),
  ...}
```

它读取的是 `e.navEl`、`e.id`、`e.icon`、`e.name`、`e.update()`、`e.containerEl`。`isPluginSettingTab` 用 `e instanceof u4||e instanceof c4` 判定，这只决定归入 `pluginTabs` 还是 `settingTabs`。

公开导出 `SettingTab` 就是 `c4`（`SettingTab:()=>c4`），它的定义是：

```
c4=function(e){function t(t,n){var i=e.call(this,t,t.setting)||this;
  return i.plugin=n,i.name=n.manifest.name,i.id=n.manifest.id,i}
  return v(t,e),t.prototype.getSettingDefinitions=function(){return[]},
  t.prototype.getControlValue=function(e){var t=this.plugin.settings;...},
  t.prototype.setControlValue=function(e,t){...},t}(i6)
```

构造签名是 `(app, plugin)`，并且读取 `plugin.manifest.name` 与 `plugin.manifest.id`，因此需要一个带 `manifest` 字段的对象。

不依赖 `window.require` 的取法：从 `window.app.setting.settingTabs` 取任一个已注册项，用 `Object.getPrototypeOf(tab)` 拿到基类构造器。`Setting` 类可从已渲染的设置项取得，或用 `window.require('obsidian').Setting`。

### 1.4 版本下限检查的可改写点

asar `main.js` 只在一处读取 Electron 版本：

```
go=process.versions.electron,fo=parseInt(go.split(".")[0]);
...
module.exports=function(i,e){var bt;if(fo<18){l.dialog.showErrorBox("Manual update required",...
```

`go` 与 `fo` 都只在一处赋值、一处使用。`fo` 的词边界命中恰好 2 次：赋值与 `if(fo<18)` 判断，这是它唯一的用途。

改写方式必须是 `Object.defineProperty`。`process.versions` 上的既有属性是只读的：Node 下 `node` 属性的描述符为 `{writable:false, configurable:true}`，直接赋值在非严格模式下静默失败，在严格模式下抛错。Electron 下的构建方式与此相同。可配置为真，因此：

```js
Object.defineProperty(process.versions, 'electron', {
  value: '18.0.0', writable: true, configurable: true, enumerable: true
});
```

改写只作用于主进程。渲染进程是独立进程，它自己的 `process.versions.electron` 不受影响，这一点关系到 4.8 节。

### 1.5 installer 版本的两处来源

`app.js` 的 `about` 页显示两项版本：

- `Fee.labelVersion({version:td.version})`：Obsidian 版本，来自 `td.version=e.ipcRenderer.sendSync("version")`
- `Fee.labelInstallVersion({version:td.build})`：installer 版本，来自 `td.build=e.remote.app.getVersion()`，即外层 `package.json` 的 `version`

另有 `Sie="1.13.4"`（Obsidian 版本常量）与 `xie="28.2.3"`（installer 版本比较对象）。

`qy(a,b)` 的实际语义是：`b` 无法解析为版本时返回 `false`；`a` 无法解析时返回 `true`；其余情况逐位比较，`a` 小于 `b` 时为真，逐位相等时以位数短者为小。拿 `"28.2.3"` 实测：

| a | `qy(a, "28.2.3")` |
|---|---|
| `"18.0.0"` | `true` |
| `"26.0.0"` | `true` |
| `"28.0.0"` | `true` |
| `"28.2.2"` | `true` |
| `"28.2.3"` | `false` |
| `"28.2.4"` | `false` |
| `"29.0.0"` | `false` |
| `"30.0.0"` | `false` |

判定处为：

```
td.isDesktopApp&&qy(pf,xie)&&(m+="\tUpdate installer: installer version too low, ...")
qy(pf,xie)&&!electron.ipcRenderer.sendSync("disable-update")?K():(...)
```

其中 `pf=uf`，`uf=process.versions.electron`。因此 `qy(pf,xie)` 比较的是 Electron 版本与 `"28.2.3"`。主版本为 28 且补丁号低于 3 时结果为真，主版本不低于 29 时为假。

`disable-update` 是官方通道，asar `main.js` 里有 `ipcMain.on("disable-update",...)`，读 `D.updateDisabled`。外层可以在 `require(asarPath)` 之后用 `ipcMain.removeAllListeners("disable-update")` 再注册自己的处理，令其恒返回 `true`，从而在层内规避 installer 版本提示。

### 1.6 官方是否自带托盘

官方 1.13.4 的 `main.js` 里 `new l.Tray` 命中 0 次。托盘完全是本项目的定制。

`ipcMain.on("frame",...)` 在官方与仓库版本里都是 1 处，是官方自带。

## 2. 决策总表

| 项目 | 决策 |
|------|------|
| 12 个 `hcs-*` 通道 | 运行时注入 |
| `exit-to-tray`、`force-quit` 通道 | 运行时注入 |
| `starter`、`help` 通道的处理逻辑 | 运行时注入 |
| 托盘初始化 | 运行时注入 |
| 关窗最小化到托盘 | 运行时注入 |
| `before-quit` 标记 | 运行时注入 |
| 短路 Electron 版本下限检查 | 运行时注入 |
| `HcsSettingsTab` 类定义 | 运行时注入 |
| `HcsSettingsTab` 注册 | 运行时注入 |
| 「退出软件」开关 | 运行时注入 |
| 「关于」页版本项改写 | 运行时注入 |
| 「贡献作者」条目 | 运行时注入 |
| 标题栏文字 `OHsidian` | 运行时注入 |
| 5 处 `window.close()` | 不处理，保留官方行为。详见 5.2 |
| i18n 的 7 个键 | 运行时注入 |
| `i18n/zh.txt` 的 4 块 | 运行时注入 |
| app.css 的 3 处 | 运行时注入 |
| 三个 HTML 的标题 | 运行时注入 |
| installer 版本比较对象 `xie` | 运行时注入 |
| help 窗口复用 starter 窗口 | 保留补丁 |
| starter 窗口复用为仓库窗口 | 保留补丁 |
| 打开最近仓库时复用 starter 窗口 | 保留补丁 |
| `[HMOS-FRAME]` 窗口按钮处理 | 保留补丁 |
| `package.json` 的 author / description / version | 保留补丁 |
| `icon.png` 替换、`tray.png` 新增 | 保留（复制文件） |
| 移除 `icon.png.bak`、`harmonyos-sync-bridge.js` | 保留（删除文件） |
| starter 品牌 logo 改写 | 暂缓 |
| 商业许可证改名「社区许可证」 | 暂缓 |
| 许可证激活弹窗改为静态说明 | 暂缓 |
| `vault-move` 通道删除 | 已消除 |

外层引导脚本已经承载的五项，在表中单列：

| 项目 | 状态 |
|------|------|
| 回收站兼容 | 已在外层，不变 |
| PDF 字体兼容 | 已在外层，不变 |
| deeplink 队列派发 | 已在外层，不变 |
| 自动更新短路 | 已在外层，不变 |
| remote 开启 | 已在外层，1.14.4 需复核 |

## 3. main.js 的十项

### 3.1 12 个 `hcs-*` 通道

**决策：运行时注入。**

`ipcMain.on` 是公开接口。把 `buildHcsBlock()` 产出的十二行从 `tools/build-asar.mjs` 抽出，放到外层引导脚本或它引用的模块里，在 `require(asarPath)` 之前或之后注册。

改到外层之后的三项收益：

- 通道文本不再随版本变化，`vault-open` 那套正则定位与 `assertAbsent('main.dup-prefix-*')` 自检都可以去掉。
- 通道与外层脚本同处一个进程，两边读写文件的目录取值可以统一到一处，便于核对。`dataPath` 已在外层定义为 `app.getPath('userData')`，通道移到外层后直接使用它。
- 改动隔离在项目代码里，升级内核时不触碰。

**文件目录已经是对接正确的，不需要调整。** 通道当前读写的 `app.getPath('userData')` 与 ArkTS 侧 `CloudSyncAdapter.ets` 用的 `context.getApplicationContext().filesDir` 指向同一个目录，即应用级 `files/`。设备上确认了这一点：应用级 `files/` 里有 `obsidian.log`、`obsidian.json`、`id`，而模块级的 `haps/electron/files/` 是空的。

deeplink 链路的代码已经把这个区别写明并用它做对了选择：

```
// 必须用 applicationContext 的目录：UIAbilityContext.filesDir 带模块前缀
// （haps/electron/files），而 Electron 的 userData 是应用级目录（files），
// 两者在磁盘上是两个不同的位置。
DeeplinkBridge.enqueue(this.context.getApplicationContext().filesDir, url);
```

**十二个通道与 ArkTS 侧的 `CloudSync.*` 绑定是两套独立机制。** ArkTS 侧 `CloudSyncAdapterBind.ets` 通过 `JsBindingUtils.bindFunction` 注册了八个入口：`CloudSync.InitSync`、`SetUserId`、`UploadFile`、`DownloadFile`、`ListFiles`、`DeleteFile`、`GetStatus`、`TriggerLogin`。仓库内除绑定自身外无任何调用；官方 asar 的 `main.js` 与 `app.js` 里 `CloudSync` 命中均为 0。因此两套都没有调用方，`hcs-*` 通道的调用方只有注入进渲染进程的设置页代码。

**注意**：`ipcMain.on` 允许同一通道存在多个处理函数，全部会被调用。asar 内已经注册的监听不会自动让位，因此注册前先 `ipcMain.removeAllListeners(通道名)`。十二个 `hcs-*` 通道都是本项目新增的，官方源码里没有同名通道；`starter` 与 `help` 是官方通道，必须显式替换。

### 3.2 `exit-to-tray` 与 `force-quit`

**决策：运行时注入。** 同上，公开接口。

### 3.3 `starter` 与 `help` 通道的处理逻辑

**决策：运行时注入。**

仓库版本把这两个通道改为按 `BrowserWindow.fromWebContents(t.sender)` 定位发送窗口，全局打开函数只作兜底。既然改的是 `ipcMain` 的处理函数，外层可以在 `require` 之后 `removeAllListeners("starter")` 与 `removeAllListeners("help")`，再注册自己的实现。

`BrowserWindow.fromWebContents`、`win.loadURL`、`win.once` 都是公开接口。

仓库版本还引用了 asar 内部的窗口表（`IDENT.windowTable`）。改到外层后，用 `app.on("browser-window-created")` 自己维护一张表，或者直接用 `fromWebContents` 的结果，不必读 asar 内部变量。

### 3.4 托盘初始化

**决策：运行时注入。**

官方完全没有托盘代码，整项都是定制。`new Tray()`、`Tray.setContextMenu`、`Menu.buildFromTemplate` 都是公开接口。

仓库版本从 `IDENT.starterWindow || Object.values(IDENT.windowTable)[0]` 取窗口引用。改到外层后改用 `BrowserWindow.getAllWindows()`，配合 `webContents.getURL()` 判定窗口类型，不依赖 asar 内部结构。

外层已有 `installFontFaceGuard()` 使用 `app.on("browser-window-created")`，托盘初始化可以挂在同一处。当前托盘是 `whenReady` 之后延迟 1 秒创建，改到外层后可改为在首个窗口出现时创建。

### 3.5 关窗最小化到托盘

**决策：运行时注入。**

`win.on("close")` 是公开接口。外层在 `app.on("browser-window-created")` 里给每个窗口挂 `close` 处理，判断托盘开关与退出标志后 `event.preventDefault()` 加 `win.hide()`。

与 3.4 共用同一份窗口登记逻辑。

### 3.6 `before-quit` 标记

**决策：运行时注入。**

`app.on("before-quit")` 是公开接口。外层引导脚本本来就在 `app` 上注册监听。

仓库版本插入了一个新的 `before-quit` 监听，与 asar 自带的那个共存。外层注册不受 asar 内部写法影响。

### 3.7 短路 Electron 版本下限检查

**决策：运行时注入。**

当前做法是把 `if(fo<18){` 改成 `if(false&&fo<18){`。改为在外层入口最开头写入：

```js
Object.defineProperty(process.versions, 'electron', {
  value: '18.0.0', writable: true, configurable: true, enumerable: true
});
```

`go` 与 `fo` 因此算出 18，判断不成立，强制弹窗与跳转下载页都不触发。

不用直接赋值。该属性只读，赋值会静默失败，`fo` 仍是真实值，弹窗照旧出现。

**实测确认**：设备上的 Electron 真实版本为 `5.0.0-Release`，主版本 5，低于 18。这一项**必须处理**，不是防御性措施。探针记录到 `真实值 5.0.0-Release -> 现值 18.0.0`。

写入之后主进程里 `process.versions.electron` 的值不再是真实值。当前 asar 内只有 `fo` 一处使用，因此没有其它影响。探针需要在改写前把真实值读出来留存，实测用的是在 `Object.defineProperty` 之前先赋一个变量。

这一项与 3.1 的 `hcs-*` 通道、3.4 的托盘都无关，只消除版本下限判断两处后果：强制弹窗与跳转下载页。

### 3.8 help 窗口复用 starter 窗口

**决策：保留补丁。**

改动位于 `function <help打开函数>(){if(<help窗口>){...}let <临时变量>=<help窗口>=<辅助窗口创建>({width:600,height:680});` 这段内部分支里，判断闭包内的 starter 窗口变量是否存在并复用。没有外部等价物。

### 3.9 starter 窗口复用为仓库窗口

**决策：保留补丁。**

改动位于启动时按目录结构打开仓库窗口的函数 `let ke=()=>{for(let o in <仓库表>)...}` 内，改写为收集待打开仓库、复用 starter 窗口、并调用内部的窗口接线与打开标记函数。这些函数都是 asar 内部的压缩变量。

### 3.10 打开最近仓库时复用 starter 窗口

**决策：保留补丁。**

改动位于打开函数的两个分支内，插入的代码调用 `<窗口接线>`、`<打开标记>`、`<配置读取>`、`<配置保存>` 四个内部函数。同样没有外部等价物。

第 3.8 至 3.10 三项集中在 asar `main.js` 的窗口创建流程，是同一片代码。三项合计仍是当前补丁里最脆弱的部分：它们依赖 `starterOpen`、`starterWindow`、`windowTable`、`vaultWindowCreator`、`windowWiring`、`markVaultOpen`、`configSave`、`configRead`、`vaultUrl`、`helpOpen`、`helpWindow`、`auxWindowCreator`、`help` 这些角色的结构定位。

### 3.11 第 3.1 项附带的通道增删

**决策：已消除。**

1.12.7 上删除了 `vault-move` 通道，并把 12 个 `hcs-*` 通道插在它原来的位置。1.13.4 的产物中 `vault-move` 仍然存在，`hcs-*` 改为插在 `vault-open` 之前。

`hcs-*` 移到外层后，asar 内不再做任何通道增删，这一项自动消失。

## 4. app.js 的八项

### 4.1 `HcsSettingsTab` 类定义

**决策：运行时注入。**

本轮调研中收益最大的一项。

`tools/hcs-settings-tab.js` 当前用五个占位符（`__EXTEND__`、`__NOTICE__`、`__SETTINGS_TAB_BASE__`、`__SETTING_ITEM__`、`__REFRESH__(self)`）加一个条件分支（`__DISPLAY_FALLBACK__`）适配两版差异。改为注入脚本后：

| 占位符 | 替换为 |
|--------|--------|
| `__EXTEND__` | `Object.setPrototypeOf(子类.prototype, 基类.prototype)` 或注入脚本内的等价继承写法 |
| `__NOTICE__` | `obsidian.Notice` |
| `__SETTINGS_TAB_BASE__` | 设置页基类（见 1.3 的取法） |
| `__SETTING_ITEM__` | `obsidian.Setting` |
| `__REFRESH__(self)` | 基类的 `update()`（1.13.4 起由基类提供） |
| `__DISPLAY_FALLBACK__` | 空。跨 1.12.7 与 1.13.4 不再是需求 |

顺带删掉的机制：

- `buildHcsSettingsTab()` 的占位符替换与未替换占位符检查
- `settingsTabBaseMode` 的 `'definitions'` / `'display'` 双形态分支
- 注释行剔除与换行去除（注入脚本是独立文件，不经压缩产物）
- `verifyInjectedSymbols()` 的注入符号校验

基类构造签名是 `(app, plugin)` 且读取 `plugin.manifest.name` 与 `plugin.manifest.id`。注入脚本传入的对象需要带 `manifest` 字段，或者改用不带 plugin 的第 4.6 节取法版本。

### 4.2 `HcsSettingsTab` 注册

**决策：运行时注入。**

改为 `window.app.setting.addSettingTab(new HcsSettingsTab(window.app, window.app.setting))` 形式。`app.setting` 是渲染进程里 `Setting` 控制器的实例，`addSettingTab` 是它的公开方法。

### 4.3 「退出软件」开关

**决策：运行时注入。**

1.13.4 的「外观」页用 `getSettingDefinitions()` 返回定义数组，其中一项形如（原文摘录）：

```
vf()&&p.push({name:md.plugins.translucency.name(),desc:md.plugins.translucency.desc(),
  render:function(e){e.addToggle((function(e){return e.setValue(t.vault.getConfig("translucency"))
  .onChange((function(e){t.customCss.setTranslucency(e)}))}))}})),
p.length>0&&n.push({type:"group",heading:tie.optionAdvanced(),items:p}),n}
```

仓库版本把 `vf()&&p.push(...)` 换成 `p.push({name:"退出软件",...}),vf()&&p.push(...)`，即在同一个数组的中段插入一项（注意末尾的括号数量：插入项以 `}}),` 收尾，后接原有的 `vf()&&`）。

注入脚本按 `id` 找到「外观」页对象（`app.setting.settingTabs` 里 `id === "appearance"` 的那一项），包装它的 `getSettingDefinitions`，在 translucency 项之前插入一项，`render` 里用 `obsidian.Setting` 的 `addToggle`。

`Setting` 与 `ToggleComponent` 都是公开导出。

### 4.4 「关于」页版本项改写

**决策：运行时注入。**

官方这一项在 1.13.4 里包含更新分支与检查更新按钮。仓库版本去掉了更新分支，只保留版本号与 installer 版本。

注入脚本按 `id === "about"` 找到该页对象，包装 `getSettingDefinitions`，用它自己构造的定义中属于版本项的那一项替换为精简版本。识别方式是该项的 `name` 由 `labelVersion` 生成，或者用它在数组中的位置。

与 4.5 是同一处改动位置的两个项目，可以合并为一次注入。

### 4.5 「贡献作者」条目

**决策：运行时注入。**

在「关于」页的版本项之后追加一项，内容为 `@MikannQAQ` 与仓库地址按钮。做法与 4.4 相同。

### 4.6 商业许可证改名「社区许可证」

**决策：暂缓。**

1.13.4 里相关文案键仍在（`labelCommercialLicense` 命中 2 次，值 `"Commercial license"`；`labelYourCommercialLicenseKey`、`labelActivateLicense` 等同样存在）。日后的做法是在注入脚本里覆盖这几个键，写法同 6.1。

### 4.7 许可证激活弹窗改为静态说明

**决策：暂缓。**

日后的做法是替换弹窗类的 `open()` 或 `onOpen()`。`Modal` 是公开导出。

### 4.8 installer 版本比较对象

**决策：运行时注入。**

改法有两处可选，建议同时用：

- 外层 `require(asarPath)` 之后 `ipcMain.removeAllListeners("disable-update")`，重新注册为恒返回 `true`。官方判定处 `qy(pf,xie)&&!electron.ipcRenderer.sendSync("disable-update")?K():(...)` 因此走另一分支。
- 若仍需要在「关于」页隐藏「installer 版本过低」的提示，与 4.4 在同一处注入点处理。

**不能用主进程覆写 `process.versions.electron` 的办法处理此项。** `pf` 是渲染进程里的值：

```
var uf="0.0.0",hf=0;
of((function(e){uf=process.versions.electron,hf=parseInt(uf.split(".")[0]),...}));
var pf=uf,df=hf;
```

`of` 在 app.js 求值时同步调用，`pf` 随即固定。渲染进程是独立进程，主进程的覆写不影响它；而用 `executeJavaScript` 在渲染进程里覆写又排在 app.js 之后（app.js 以 `defer` 加载），改不到已经算出的 `pf`。

官方判定处 `qy(pf,xie)` 比较的是渲染进程的 Electron 版本与 `"28.2.3"`。`qy` 的语义：逐位比较，左侧小于右侧时为真；逐位相等时以位数短者为小。拿 `"28.2.3"` 实测：`"28.0.0"`、`"28.2.2"` 为真，`"28.2.3"` 起为假，`"29.0.0"` 及以上为假。

**实测确认此项必需**：设备上的 Electron 是 `5.0.0-Release`，`zy` 解析出 `[5,0,0]`，`qy("5.0.0-Release", "28.2.3")` 为 `true`。渲染进程读的是它自己的 `process.versions.electron`，主进程的覆写不影响它。因此 installer 版本过低的提示与下载入口都会出现，处理 `disable-update` 通道是必需的。

## 5. starter.js 的五项

### 5.1 标题栏文字

**决策：运行时注入。**

官方写法是 `this.titleBarTextEl=l.createDiv({cls:"titlebar-text",text:"Obsidian"})`。注入脚本在 `dom-ready` 后改写该元素的文本。

值得注意的是，1.12.7 与 1.13.4 的 `app.css` 里都有 `.starter .titlebar-inner .titlebar-text { display: none; }`，即这个元素本来就不显示；`prototype.updateTitle=function(){this.titleBarTextEl.setText(this.win.document.title)}` 又会用文档标题覆盖它的文本。这项改动属于跟随 upstream 的完整替换，不是当前界面可见性的决定因素。

### 5.2 五处 `window.close()`

**决策：不处理。**

这五处是官方打开仓库成功后的关窗动作，形态为 `!0===<结果>?window.close():new wt(...)`，所在上下文分别是：仓库列表项点击、localStorage 恢复路径、打开目录后走 `vault-message` 或 `vault-open`、打开文件夹对话框、同步设置完成。

仓库原先把 `window.close` 整体覆盖为空函数，让这些调用全部失效。实测确认这个做法会连带破坏三处：

- 起始窗口打开仓库后不关闭，而是残留下来（因为原来的窗口复用逻辑没有一起迁过来）
- 「切换仓库」命令不可用。官方 `kI` 类的 `onChooseItem` 是 `sendSync("vault-open", ...) ? (this.switchVault && window.close()) : ...`，窗口关不掉就切不过去
- 设置弹窗关闭失效。官方 `Modal.close` 走 `popout.cleanup`，最终调 `y.close()`，而弹窗渲染进程里的 `window.close` 也被同一份注入覆盖

因此不再覆盖 `window.close`，保留官方的窗口关闭语义。需要「关窗不退出」的是仓库窗口，这件事由外层对 `close` 事件的拦截与托盘完成，不涉及渲染进程。

### 5.3 品牌 logo 与字标改写

**决策：暂缓。**

把两段内联 SVG 换成 `icon.png` 图片与 `OHsidian` 文本，属于 DOM 结构替换。日后的做法是在 `dom-ready` 后替换品牌区元素。

## 6. 文案与样式

### 6.1 i18n 的 7 个键

**决策：运行时注入。**

i18next 的资源形态有两套，注入写法必须与之一致。

英文包是 `window.OBSIDIAN_DEFAULT_I18N`，经递归函数 `Up` 把驼峰键转成 kebab 形式（`labelVersion` → `label-version`），得到嵌套结构；键名不作分割，因此英文包的真实键形如 `setting.about.label-version`。

中文包是 `i18n/zh.txt`，与 `i18n/mapping.txt` 逐行对应，经 `Kp` 把平铺的点号键转成嵌套结构：

```
function Kp(e){var t={};for(var n in e)...
  for(var r=n.split("."),o=t,a=0;a<r.length-1;a++){...}
  o[r[r.length-1]]=i}
```

两套最终存进 i18next 的都是嵌套结构，访问路径都是 `setting.about.label-version`。

采用的方案是包装 `i18next.t`。相比覆盖资源包，这个做法避开三个麻烦：

- 资源包会被官方覆盖。app.js 在 `var pd=Promise.resolve(),dd=cd();if(dd&&dd!==id){...}` 里异步 `fetch("/i18n/"+dd+".txt")` 后调用 `addResourceBundle`。注入如果早于这次加载，覆盖会被冲掉。
- `md` 是间接调用的。官方设置页取文案的路径是 `Fee = md.setting.about` 后 `Fee.labelVersion({version:...})`，而 `md` 是 Proxy，最终仍交由 `i18next.t` 处理，因此包装 `i18next.t` 能拦住全部取值点。
- 包装不依赖命名空间划分。覆盖资源包需要按命名空间整体替换，包住 `i18next.t` 只需比对键名。

用法：

```js
var origT = i18next.t.bind(i18next);
i18next.t = function (key, opts) {
  var table = OVERRIDES[i18next.language] || OVERRIDES.en;
  if (typeof key === 'string' && Object.hasOwn(table, key)) {
    var v = table[key];
    if (opts) for (var k of Object.keys(opts)) v = v.split('{{' + k + '}}').join(String(opts[k]));
    return v;
  }
  return origT(key, opts);
};
```

`opts` 里可能带着 `keySeparator` 等 i18next 选项，比对前先确认 `key` 是字符串。插值需自行处理，不交给原实现。

键与目标值取自 `tools/build-asar.mjs` 的 `replacements` 表，换成 i18next 的键形态：

| 英文键（嵌套 kebab） | 值 |
|----------------------|-----|
| `setting.about.label-version` | `HarmonyOS-{{version}}` |
| `setting.about.label-install-version` | `HarmonyOS Port {{version}}` |
| `setting.about.label-read-changelog` | 空 |
| `setting.about.label-manual-update-required` | `This is a HarmonyOS port. Original update channels are not available.` |
| `setting.about.label-disabled-updates` | `Updates are disabled. Running on HarmonyOS.` |
| `setting.about.button-check-for-updates` | `Updates not available` |
| `setting.about.option-auto-update-description` | `Automatic updates are disabled on HarmonyOS port.` |

第三行截自 `Up`：`labelReadChangelog` → `label-read-changelog`。

### 6.2 `i18n/zh.txt` 的 4 块

**决策：运行时注入，与 6.1 共用同一处包装。**

中文文案只需在 `OVERRIDES.zh` 里给出对应的键。键名与英文一致，形态由 `Kp` 从 `mapping.txt` 的点号键转换而来：

| 键 | 值 |
|----|-----|
| `setting.about.label-version` | `HarmonyOS-{{version}}` |
| `setting.about.label-install-version` | `HarmonyOS 移植版本 {{version}}` |
| `setting.about.label-read-changelog` | 空 |
| `setting.about.label-manual-update-required` | `此版本为 HarmonyOS 移植版，原有更新通道不可用。` |
| `setting.about.label-disabled-updates` | `更新已禁用（HarmonyOS 移植版）。` |
| `setting.about.button-check-for-updates` | `更新不可用` |
| `setting.about.option-auto-update-description` | `HarmonyOS 移植版不支持自动更新。` |

`zh.txt` 有 44 个语言文件与其并列，`zh.txt` 与 `zh-TW.txt` 是其中两个。包装只需覆盖当前语言对应的那一张表；语言切换后 `i18next.language` 随之改变，包装每次取值都重新查表，因此切换语言不需重新施加。

### 6.3 app.css 的 3 处

**决策：运行时注入。**

外层已有 `webContents.executeJavaScript`，`webContents.insertCSS` 同样可用。改为注入两条规则：

```css
.starter .titlebar { display: none; }
.starter { padding-top: 30px !important; }
```

仓库版本改的第三条（`.starter.is-hidden-frameless .titlebar` 的 `display: block` 改为 `none`）在 1.13.4 里不存在了：该选择器整条被去掉，1.13.4 里含 `.starter .titlebar` 的复合选择器只设置 `height` 与 `zoom`，不设 `display`。因此当前补丁改为直接隐藏 `.starter .titlebar`。注入不受这类改写影响。

注入时机用 `did-start-navigation` 与 `dom-ready`，与 `installFontFaceGuard()` 相同，并在导航后重新注入。

### 6.4 三个 HTML 的标题

**决策：运行时注入。**

`document.title` 可在 `dom-ready` 时改写。HTML 里的 `<title>` 只影响首屏，注入一个处理即可覆盖。

对应地，`patchHtmlTitles()` 可以从构建脚本中删除，`index.html`、`starter.html`、`help.html` 三个文件不再需要改动。

## 7. 文件与资源

### 7.1 `package.json` 的 author / description / version

**决策：保留补丁。**

这三个字段不是运行时可达的。`version` 必须处理：外层 `currentBaseVersion` 取自 `require('./package.json').version`，`app.getVersion()` 同样读它，启动扫描 userData 时用 `isV2MoreRecent(app.getVersion(), version)` 判断新 asar 是否被采用。漏改会导致新 asar 不生效。

`author` 与 `description` 只影响系统信息展示，成本极低且几乎不随版本变化，一并保留。

### 7.2 `icon.png` 与 `tray.png`

**决策：保留（复制文件）。** 与版本无关。

### 7.3 移除 `icon.png.bak` 与 `harmonyos-sync-bridge.js`

**决策：保留（删除文件）。**

`harmonyos-sync-bridge.js` 在 asar 内无任何引用，导出 `HmosSyncBridge`（`resolveVaultPath` 读 `obsidian.json`，日志前缀 `[HMOS-SYNC]`）。`icon.png.bak` 是官方原图的备份。

## 8. 外层引导脚本的五项定制

`web_engine/src/main/resources/resfile/resources/app/main.js` 共 804 行，不随官方内核升级变化。它承载五项定制，全部已经是运行时注入，不需要迁移。本节记录每一项的接口与升级时的复核点。

| 项 | 位置 | 依赖的官方接口 |
|----|------|----------------|
| 回收站兼容 | `installHarmonyTrashCompat()`（163 行） | `electron.shell.trashItem` |
| PDF 字体兼容 | `FONT_FACE_GUARD_SOURCE` + `installFontFaceGuard()`（488、537 行） | `app.on('browser-window-created')`、`webContents.executeJavaScript` |
| deeplink 队列派发 | `DEEPLINK_QUEUE_FILE` + `pollDeeplinkQueue()` + `dispatchDeeplink()`（695、697、713、737 行） | `app.on('open-url')` 的监听计数 |
| 自动更新短路 | `queueUpdate`（293 行） | `updateEvents` 事件 |
| remote 开启 | `app.on('web-contents-created', ...)`（36 行） | `@electron/remote` 的 `enable()` |

### 8.1 回收站兼容

包装 `electron.shell.trashItem`：先调原生实现，再等最多 3 秒确认文件确实消失；若文件仍在则回退到自建的仓库内回收站目录（`getVaultTrashDir`）。另有一个自检入口 `runHarmonyTrashSelfTest()`，仅在 `APP_PATH/harmonyos-trash-test.enabled` 存在时运行。

升级时无需改动。

### 8.2 PDF 字体兼容

arkweb 的 `FontFace` 不接受 CSS `local()` 形式的 src。pdf.js 为「非内嵌字体」生成 `src = \`local(字体族)\``，该构造在此处直接抛出，字体对象无法送达主线程，页面的 dependency 永远等不到，渲染停在中途。

处理方式是把失败的构造换成立即拒绝的桩对象，pdf.js 现有的 `catch` 会接管，转而向 worker 请求字形路径，渲染得以走完。

**注入时机是这套写法里最要紧的部分**，6.3 与 6.4 要照抄。它同时挂三个时机：

```
app.on('browser-window-created', function (event, window) {
  webContents.on('did-start-navigation', function () { inject(webContents); });
  webContents.on('dom-ready', function () { inject(webContents); });
  inject(webContents);
});
```

每次导航都会换一个全新的 JS 环境，补丁需重新注入。补丁脚本自身用 `window.__harmonyFontFaceGuard` 做了幂等处理，重复注入无害。

升级时无需改动。

### 8.3 deeplink 队列派发

ArkTS 到 Electron 主进程之间只有 `ExecuteCommand` 一条通道，它只覆盖窗口管理，送不进 `open-url`；而本版本的 Electron 也没有原生协议处理与单实例转发。因此由两侧共同完成链路：

- ArkTS 侧 `electron/src/main/ets/utils/DeeplinkBridge.ets` 把链接追加写入 `getApplicationContext().filesDir` 下的 `obsidian-deeplink.pending`。追加而不覆盖：应用未运行时收到的多条链接要能全部保留。
- ArkTS 侧 `EntryAbility.ets` 的 `onCreate` 与 `onNewWant` 都调 `captureDeeplink(want)`。`onCreate` 里必须在 `super.onCreate` 之前调用，因为 `WebAbility` 会把 `want.uri` 当作起始页面地址读走。`extractAndStrip` 取出链接后把 `want.uri` 置空。
- 外层脚本每 500 毫秒轮询队列，读到就删除文件。
- `dispatchDeeplink` 轮询 `app.listenerCount('open-url') > 0` 后才派发（最多等 40 次、每次 250 毫秒）。asar 在加载完成后才注册 `open-url` 监听，冷启动时队列里已有的链接要等到监听就绪才能派发。注释写明：记录写在派发之前，因为内部处理会同步抛出异常（例如找不到仓库），放在派发之后记录会把这次派发整条丢掉。

文件名的约定两端共用：`DeeplinkBridge.ets` 里的常量注释写明改名需要同时修改外层 `main.js`。

升级时无需改动。

### 8.4 自动更新短路

`queueUpdate` 在开头打印一行日志后立即 `return`，后面的实现成为不可达代码，同时补发 `check-end` 事件。桌面自动更新始终关闭。

启动日志里的 `HarmonyOS port: desktop auto-update is disabled` 就是这一项。

升级时无需改动。

### 8.5 remote 开启

1.13.4 新增的修复。设置页默认在独立窗口打开（`settingsPopoutWindow:!0`），其渲染进程在建立后立即同步调 `remote.getCurrentWindow()`，而 asar 内部要到 `did-create-window` 才开启 remote，之间有一段空档。在 `web-contents-created` 里立即开启，这个时刻早于该 WebContents 上的任何渲染进程脚本。`getType()` 为 `webview` 的项跳过。

升级到 1.14.4 时需要复核：若官方改了 remote 的开启时机（例如改成在创建时开启），这一项可以删掉；若官方引入新的窗口类别，需确认 `getType()` 的过滤条件仍然合适。

## 9. 改动之后剩下的补丁

保留补丁的只剩四项实际改造，加两项文件替换与 `package.json`：

| 项 | 位置 |
|----|------|
| help 窗口复用 starter 窗口 | `main.js` 的 help 打开函数 |
| starter 窗口复用为仓库窗口 | `main.js` 的启动打开函数 |
| 打开最近仓库时复用 starter 窗口 | `main.js` 的打开函数两个分支 |
| `[HMOS-FRAME]` 窗口按钮处理 | `app.js` 的 `e.parent===e` 分支 |
| `package.json` 三个字段 | 打包前写文件 |
| `icon.png`、`tray.png` | 复制 |
| `icon.png.bak`、`harmonyos-sync-bridge.js` | 删除 |

符号解析仍需保留的角色：`starterOpen`、`starterWindow`、`windowTable`、`vaultWindowCreator`、`windowWiring`、`markVaultOpen`、`configSave`、`configRead`、`vaultUrl`、`helpOpen`、`helpWindow`、`auxWindowCreator`、`help`、`electron`、`path`、`fs`、`userData`、`electronMajor`、`vaultTable`。

不再需要的角色：`settingsTabBase`、`settingsTabBaseMode`、`settingContainer`、`notice`、`communityTab`、`i18n`、`aboutI18n`、`thirdPartyI18n`、`platformFlags`、`frameDom`。

`tools/lib/symbols.mjs` 里为设置页解析的那部分可以删除，`tools/hcs-settings-tab.js` 的占位符机制整体去掉，改为可直接在渲染进程加载的独立脚本。

外层引导脚本（第 8 节）不在这张表里，它不因内核升级而改动，是承接上述注入的宿主。

## 10. 实施顺序

按依赖关系分三批，每批单独构建并在设备上验证。

**第一批：纯外层，不触碰 asar 内部。**

Electron 版本下限短路（3.7）、`hcs-*` 通道（3.1）、退出相关通道（3.2）、托盘的创建与关窗处理（3.4、3.5）、`before-quit` 标记（3.6）、APK 层 CSS 注入与 HTML 标题（6.3、6.4）、starter 的标题文字（5.1）。

这一批全部位于 `web_engine/src/main/resources/resfile/resources/app/main.js` 与它引用的注入脚本内，构建脚本的改动只是删除对应补丁。风险最低，可以逐项验证。

**第二批：渲染进程的设置页注入。**

`HcsSettingsTab` 的定义与注册（4.1、4.2）、「退出软件」开关（4.3）、「关于」页的三项改动（4.4、4.5、4.8）。

需要先确认注入时机：`window.app` 在 `ready()` 回调里赋值，注入脚本必须在这之后运行。可用的时机是 `dom-ready`，或轮询 `window.app` 出现后再执行。

**第三批：文案与样式注入。**

i18n 的 7 个键（6.1）、zh.txt 的 4 块（6.2）。写法已实测确定：包装 `i18next.t`，在语言包异步加载之前或之后施加都成立。

## 11. 未验证事项

以下几项在实施前需要确认。已由实测排除的项不再列出（设备 Electron 主版本、官方 asar 能否加载、外层注入能否执行、remote 能否开启）。

以下四项已在设备上实测完成，见 `docs/runtime-inject-verification.md` 第 9 节：

- `window.require('obsidian')` 在设备上抛 `Cannot find module 'obsidian'`。官方把模块实例放在闭包里，未注册为 require 可解析的模块。设置页基类只能从原型链回溯（`app.setting.settingTabs[0]`）。
- 设置页注入后的刷新步骤：包装 `getSettingDefinitions` 后调 `tab.update()` 生效，实测已注册 10 个页签。
- `[HMOS-FRAME]` 的前置条件：设备上 `ipcRenderer.sendSync("frame")` 返回 `hidden`，该分支被执行；`setWindowButtonVisibility` 接口存在。
- i18n 包装在真实页面里的表现：`i18next.t 已包装`。

剩下未验证的：

1. **三项窗口复用在运行时有无替代做法。** 见第 9 节。
2. **`disable-update` 恒返回 true 对「自动更新」开关的影响。** 渲染进程读该通道的返回值为真时，开关显示为关闭；用户拨动开关时也走该通道，但写入被忽略。需要实测确认这是否符合预期（当前自动更新本来就由外层 `queueUpdate` 短路，开关仅影响界面状态）。

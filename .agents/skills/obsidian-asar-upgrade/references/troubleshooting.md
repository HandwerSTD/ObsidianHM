# 报错与处置

本文件按现象列出对应处置。当前路线是官方 asar 原样加外层运行时注入，因此排查重点在注入是否生效，以及替换 asar 后官方接口是否变化。

## 一、替换 asar 之后

### asar 校验报出定制残留

用 `scripts/verify-asar.mjs` 检查时若报出定制字符串，说明该文件不是官方发布版。

```
发现 23 个问题：
  - asar 内出现定制字符串 5 次："hcs-login"
  - 出现非官方文件：/tray.png
  - asar 内 package.json 的 author 为 "OHsidian"，官方原版应为 "Obsidian"
```

处置：核对来源路径与 md5。1.13.4 的官方原版是 25783388 字节、md5 `bbae59d36fe60500436a82cb841d5ad6`。不要拿此前的定制产物当输入。

### 新 asar 不生效，界面仍是旧版本

`web_engine/src/main/resources/resfile/resources/app/package.json` 的 `version` 未同步修改。外层 `currentBaseVersion` 取自它的 `version`，`app.getVersion()` 同样读它，启动扫描 userData 时用 `isV2MoreRecent(app.getVersion(), version)` 判断新 asar 是否被采用。

处置：改这个字段，重新构建安装。这一项是当前唯一的必需改动，见 `docs/asar-customization-runtime.md` 第 7.1 节。

## 二、运行期

### @electron/remote is disabled for this WebContents

设置页在独立窗口中打开时，其渲染进程在建立后立即同步调用 `remote.getCurrentWindow()`，而 asar 内部要到 `did-create-window` 才开启 remote。

处置：确认外层 `main.js` 里有 `app.on('web-contents-created', ...)` 并在其中调用 `remote.enable(contents)`。这个时机在 WebContents 创建当下，早于该 WebContents 上的任何渲染进程脚本。日志里对应行是 `remote 开启前 false 开启后 true`。

### 界面白屏，日志无异常

asar 加载失败，或注入脚本抛错。两者的判据不同：

- asar 加载失败时，日志里会出现 `Failed to require app package` 或 `Failed to load both app packages`。
- 注入脚本抛错时，日志里会出现 `注入脚本施加失败` 并带出错误消息。

处置：前一种情况核对 asar 是否完整（md5）；后一种按错误消息定位到具体脚本。注入脚本的语法可用 `node --check` 单独验证。

### 设置页未注册，日志出现「无法取得设置页基类」

日志：

```
[INJECT] 无法取得设置页基类，华为云同步页未注册
```

基类取法的回退路径依赖 `window.app.setting.settingTabs` 非空。1.13.4 的 `window.require('obsidian')` 在设备上抛 `Cannot find module 'obsidian'`，因此只能走回退路径。

处置：确认 `window.app` 已出现（日志里有 `设置页注入结束`），以及 `settingTabs` 里有元素。官方若改变设置页的注册方式，需要更新 `inject/dom-ready.js` 的 `findSettingsTabBase`。

### 设置项插到了错误的分组

日志会打印插入结果：

```
[INJECT] 外观页已插入退出软件开关；所在分组=高级 位置=1 该分组项名=自定义应用图标|退出软件
[INJECT] 关于页已隐藏商用许可证项 1 处
[INJECT] 关于页已插入贡献作者条目；前四项名=HarmonyOS-|贡献作者|自动更新|接收内部版本
```

位置错误通常意味着官方改了设置页的分组结构。「外观」页期望插进最后一个分组（「高级」），定位锚点是条目名以「半透明」开头；「关于」页期望插在平铺数组的第二位。

处置：解包新版 asar 的 `app.js`，查看该页 `getSettingDefinitions` 的分组结构，更新 `patchAppearance` / `patchAbout` 的定位方式。

### 设置项隐藏后仍可见

在 `render` 里调 `setting.setVisibility(false)` 不生效，因为渲染流程的 `_2` 每次都会用 `z2(e.def.visible, true)` 重置该行。没有 `visible` 字段时按 `true` 处理。

正确做法是在定义项上置 `visible: false`。`z2(e, t)` 在字段为 `undefined` 时返回默认值，字段是函数时调用它取返回值。详见 `docs/obsidian-internals.md` 的 2.3.6。

### 隐藏一行后同组其余行也不显示

账号分组里隐藏「商用许可证」时删除定义项，会导致 `this.commercialLicenseSetting` 保持 `undefined`，而 `updateAccountSettings()` 会直接调用它的 `clear()`，抛出异常并中断该分组后续渲染。

处置：保留定义项，置 `visible: false`。

### 设置页能注册但内容空白

包装 `getSettingDefinitions` 之后必须再调一次 `tab.update()`。设置项的取值在 `Setting` 构造期间就被算出并缓存（`addSettingTab` 内部调用 `update()`，而 `update()` 做 `this.settingItems = this.getSettingDefinitions()`）。

处置：确认 `patchPage` 里的 `tab.update()` 调用还在。

### i18next 未包装

日志：

```
[INJECT] i18next 未出现，包装放弃
```

出现在起始窗口或仓库窗口上时说明 `lib/i18next.min.js` 的加载方式变了。

两条不算失败：设置弹窗上的 `i18next 未出现，当前为设置弹窗，无需包装`（弹窗由 `window.open("about:blank")` 造出，不加载脚本），以及起始窗口上的 `当前为起始窗口，无需设置页注入`。

处置：解包新版 asar，确认 `i18next` 仍挂在 `window` 或 `self` 上，以及键仍是 kebab-case 形态。

### 托盘图标不出现

日志中搜索托盘相关行：

```
托盘图标不存在，跳过托盘初始化 <路径>
托盘初始化失败 <错误>
托盘菜单设置失败 <错误>
```

处置：确认 `web_engine/src/main/resources/resfile/resources/app/tray.png` 存在，且外层读取的路径是 `path.join(APP_PATH, 'tray.png')`。

### 关闭窗口后应用退不掉

`installCloseToTray` 用 `event.preventDefault()` 拦下仓库窗口的关闭，若 `quitRequested` 未在退出前置位，`app.quit()` 也会被拦住。

处置：确认外层有 `app.on('before-quit', ...)` 置 `quitRequested = true`，以及 `force-quit` 通道在调 `app.quit()` 前也置了它。

### 标题栏右端出现两套窗口按钮

官方 `app.js` 的标题栏类在非 macOS 上自绘最小化、最大化、关闭三个按钮，放在 `.titlebar-button-container.mod-right`。系统在该窗口上也画了同样位置的三个按钮，两者重合。

日志里应有 `自绘窗口按钮已隐藏`；设置子窗口上为 `自绘窗口按钮已隐藏（样式已随窗口中继）`（官方把主窗口 `head` 里的 `style` 元素克隆了过去）。两行都没有说明 `inject/dom-ready.js` 的 `hideSelfDrawnWindowButtons` 未执行。

注意只针对 `mod-right` 容器：左端的菜单按钮在 `.mod-left` 里。官方的 `.mod-linux .titlebar-button` 规则把 `display` 设为 `flex`，所以隐藏用的样式需要 `!important`。

### 笔记页面右上角的 tab 区域不避让系统按钮

日志：

```
[INJECT] 自绘窗口按钮已隐藏
[INJECT] 窗口按钮调整跳过：electron.remote 不可用
```

第二行说明 `applyFrameAdjustments` 在取 `remote` 失败时提前返回了，把 `document.body.style.setProperty('--frame-right-space', '126px')` 一并跳过。

该变量是右侧避让空间的来源：

```css
.is-hidden-frameless:not(.is-fullscreen) .workspace-tabs.mod-top-right-space .workspace-tab-header-container {
  padding-right: calc(var(--size-4-2) + var(--frame-right-space));
}
```

官方只在 `.mod-windows, .mod-linux` 下声明它，而设备平台不是 win32 / darwin / linux，官方不给 `body` 加任何 `mod-*` 类，因此它只能由注入设置。

处置：确认设置该变量的那一句排在取 `remote` 之前。它不依赖 `remote`。

当前正常输出是：

```
[INJECT] 窗口按钮与右边距已调整，frame=hidden setWindowButtonVisibility=true --frame-right-space=126px
```

`setWindowButtonVisibility` 为 `跳过，remote 未就绪` 也算正常，窗口的 `frame` 取值由外层运行时决定。只要结尾的 `--frame-right-space=126px` 在，避让就是生效的。

### 起始窗口打开仓库后不关闭

`window.close` 被某个注入脚本覆盖了。覆盖会作用于每个渲染进程，连带破坏三处：起始窗口不关闭、「切换仓库」命令走不完、设置弹窗关不掉。

处置：搜索注入脚本里是否有 `window.close = `。当前设计不覆盖它，见 `docs/asar-customization-runtime.md` 第 5.2 节。

### 应用的日志不再更新

`obsidian.log` 的时间早于进程启动时刻，说明当前进程没有写日志。用 `hdc shell date` 与进程启动时刻对照。

处置：重新安装并启动。若仍无记录，安装前先卸载，避免残留状态。

## 三、设备与工具

### 读不到 bundle 内的 asar

```
ls: /data/storage/el1/bundle/electron/resources/resfile/resources/app/: Permission denied
```

bundle 目录不对普通 shell 开放。要核对 asar，用仓库里的那份，或用 `scripts/verify-asar.mjs`。构建产物在 `electron/build/default/intermediates/res/default/resources/resfile/resources/app/` 下，可以直接读。

### hilog 里看不到应用输出

应用的 `log()` 只写 `obsidian.log`。`console.log` 在设备上既不进这个文件，也不出现在 hilog 里，因此注入脚本的诊断输出必须经 `ohsidian-log` 通道交给主进程写盘。

处置：用 `hdc shell "tail -n 60 .../files/obsidian.log"` 读取。

### 构建把 BuildProfile 改成 debug

`devecocli build` 会把 `web_engine/BuildProfile.ets` 改成 `BUILD_MODE_NAME = 'debug'` 与 `DEBUG = true`。发布前需要恢复为 `release` 与 `false`。这个文件的改动属于构建产生的副作用，不要提交。

## 四、构建期打补丁路线（已停用）

`tools/build-asar.mjs` 的报错对应已停用的路线。其报错格式是「补丁 id + 实际命中次数 + 候选列表」，处置是更新 `tools/build-asar.mjs` 里的定位标记或 `tools/lib/` 里的符号解析形状描述。完整说明见 `docs/asar-upgrade.md` 第 5 节。

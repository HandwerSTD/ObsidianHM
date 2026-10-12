# OHsidian asar 升级

## 1. 概述

**本文件的构建路线已停用。** 项目当前使用官方发布版 asar 原样，定制由外层运行时注入施加，判定依据与最终状态见 `docs/asar-customization-runtime.md`，实测记录见 `docs/runtime-inject-verification.md`。

本文件保留的是升级过程中积累的资料，其中仍有参考价值的部分是第 3 节的官方两版差异（文件清单、通道增删、导出接口、设置页重构、许可证模块）与第 4 节的仓库定制清单。第 5 节起的构建脚本说明对应的是构建期打补丁路线。

OHsidian 是 Obsidian 的 HarmonyOS 移植。桌面内核取自官方发布版 `obsidian.asar`，仓库在 1.12.7 的基础上对它做了定制，另外维护一份外层引导脚本 `web_engine/src/main/resources/resfile/resources/app/main.js`。

那套定制原先通过构建期打补丁施加：以官方发布版 asar 为输入，用 `tools/build-asar.mjs` 解包、施加补丁、重新打包。1.13.4 的产物曾按此路线生成并部署验证。

仓库内的 asar 由 Git LFS 追踪（`.gitattributes` 中有 `*.asar filter=lfs`），提交路径为 `web_engine/src/main/resources/resfile/resources/app/obsidian.asar`。当前该文件是官方 1.13.4 原版，md5 `bbae59d36fe60500436a82cb841d5ad6`。

```mermaid
flowchart LR
    A["官方 obsidian.asar"] --> B["extractAll 解包"]
    B --> C["解析符号"]
    C --> D["施加补丁"]
    D --> E["语法检查与注入符号校验"]
    E --> F["重新打包产物"]
```

## 2. 素材与工具

### 官方素材

素材位于 `~/Download/com.huawei.hmos.browser/obsidian/` 下：

| 代号 | 路径 | 是什么 |
|------|------|--------|
| gz12 | `gz12/obsidian.asar` | 官方 1.12.7 发布版 asar，24060763 字节 |
| gz13 | `gz13/obsidian.asar` | 官方 1.13.4 发布版 asar，25783388 字节 |
| obs-ext-12 | `obs-ext-12/obsidian-1.12.7.asar.gz` | 1.12.7 asar 的压缩件 |
| obs-ext-12 | `obs-ext-12/obsidian-1.12.7-arm64.tar.gz` | 1.12.7 Linux arm64 完整安装包 |
| obs-ext-13 | `obs-ext-13/obsidian-1.13.4.asar.gz` | 1.13.4 asar 的压缩件 |
| obs-ext-13 | `obs-ext-13/obsidian-1.13.4-arm64.tar.gz` | 1.13.4 Linux arm64 完整安装包 |
| tar12 | `tar12/obsidian-1.12.7-arm64/` | 1.12.7 安装包的解压结果，`resources/` 下有 `obsidian.asar` |
| tar13 | `tar13/obsidian-1.13.4-arm64/` | 1.13.4 安装包的解压结果，`resources/` 下有 `obsidian.asar` |
| v144 | `obsidian-extracted/resources/` | 1.14.4 的 `obsidian.asar`（27477966 字节）、`app.asar`、`app.asar.unpacked` |

取得官方 asar 的方式：`.asar.gz` 压缩件先用 `gzip -dc` 解出 `.asar`，再用 `@electron/asar` 的 `extract` 子命令解包。完整安装包的 `resources/` 下也带 `obsidian.asar`、`app.asar` 与 `icon.png`。

发布版 asar 与安装包里的两份 asar 是不同文件：`obsidian.asar` 是应用主体，`app.asar` 是外层加载器，不要混用。

升级到 1.14.4 时可直接使用 `obsidian-extracted/resources/obsidian.asar`，无需先取得 tar 安装包。

### 解包工具

`@electron/asar` 的 `extract` 子命令：

```bash
node_modules/.bin/asar extract <asar 文件> <输出目录>
```

`tools/package.json` 已包含该依赖，直接使用 `tools/node_modules/.bin/asar`。

### 产物对比

对比压缩后的单行产物时，需要先按分号切片再做行级比较。直接对整行做 `difflib` 会长时间没有输出。

对 200 KB 以上的 `main.js`（例如官方 1.13.4 的 200349 字节版本），压缩后的变量名整体重排会使行级相似度降到 0.07 附近，逐块对齐不可靠，此时改用关键标识符的存在情况与出现次数对比。

## 3. 官方 1.12.7 与 1.13.4 的差异

| 项 | 1.12.7 | 1.13.4 |
|----|--------|--------|
| 文件数 | 352 | 358（新增 `lib/defuddle.full.js` 750220 字节与 5 个 `.DS_Store`） |
| `main.js` | 60101 字节 | 200349 字节 |
| `app.js` | 3728534 字节 | 3874103 字节 |
| `app.css` | 600413 字节 | 634971 字节 |
| `package.json` version | 1.12.7 | 1.13.4 |
| `ipcMain.on` 通道数 | 41 | 44 |
| `module.exports` 签名 | `function(c,i,l)` | `function(i,e)` |

两版未删除任何文件。`require` 的模块集合完全相同，都是 `child_process`、`electron`、`fs`、`net`、`original-fs`、`os`、`path`、`url`、`util`。

### main.js 的通道增删

| 集合 | 通道 |
|------|------|
| 仅 1.12.7 有 | `is-dev` |
| 仅 1.13.4 有 | `is-closing`、`policy`、`set-language`、`terms` |

1.13.4 新增 `policy.json` 读取逻辑，用于企业策略配置（`plugins`、`themes`、`snippets`、`sync`、`publish`、`webViewer`、`devTools`、`insider` 八项开关）。HarmonyOS 上 `/etc/<app 名>/policy.json` 不存在，读取失败后走默认值，八项全部关闭。

`adblock` 相关标识符两版都是 14 处，`vault-move` 通道两版都有。

### 模块导出接口

外层加载器 `loadApp` 只传两个参数（`asarPath` 与 `updateEvents`）。1.13.4 的 `module.exports` 参数个数由三个变为两个，与调用方式兼容。1.12.7 的第三个参数在官方实现中未被使用。

官方两版的外层加载器 `loadApp` 逻辑相同，唯一差别是错误日志：1.13.4 在 `catch` 里多了 `log('Failed to load app', asarPath, e)`。

### 设置页重构

1.13.4 把设置页从「在 `display()` 里逐项 `addSetting`」改为「实现 `getSettingDefinitions()` 返回定义数组」，基类的 `update()` 负责渲染。

| 统计项 | 1.12.7 | 1.13.4 |
|--------|--------|--------|
| `getSettingDefinitions` 出现次数 | 0 | 23 |
| `prototype.display=function` 出现次数 | 29 | 11 |
| `t.push({name:` 出现次数 | 5 | 44 |
| `s.addSetting(` 出现次数 | 6 | 1 |
| `v.addSetting(` 出现次数 | 6 | 0 |

账户区段的写法随之改变。1.12.7 为：

```js
d.addSetting(function(t) { return e.accountSetting = t, t }),
d.addSetting(function(t) { return e.catalystSetting = t, t }),
d.addSetting(function(t) { return e.commercialLicenseSetting = t, t })
```

1.13.4 为：

```js
t.push({ type: "group", heading: Ree.name(), items: [
    { name: Ree.optionYourAccount(), render: function(t) { e.accountSetting = t } },
    { name: Fee.optionCatalyst(), render: function(t) { e.catalystSetting = t } },
    { name: Ree.optionCommercialLicense(), render: function(t) {
        e.commercialLicenseSetting = t, e.updateAccountSettings(), ... } }
]})
```

版本项与自动更新项在 1.13.4 中分成两条 `t.push`，渲染逻辑移到独立的 `updateVersionSetting` 方法；1.12.7 把它们内联在 `display()` 里。两版使用的 i18n 键一致（`labelNewVersionReady`、`labelManualUpdateRequired`、`labelReadChangelog`、`buttonRelaunch`、`buttonCheckForUpdates`、`labelInstallVersion`、`labelVersion`）。

`insider build` 设置项两版都有（`optionInsiderBuild` 各出现 2 次，`insider-build` 各 4 次），1.13.4 的开关受 `xb.insider` 与 `Ok.license` 双重控制。

### 许可证模块

1.13.4 删除了本地商业许可证状态单例。`Hw` 这个名字被复用为 `Symbol("customKeys")`（`Hw = Qw`、`Qw = Symbol("customKeys")`），与许可证不再相关。许可证状态改名为 `Ok`，并与服务端查询绑定。

| 调用 | 1.12.7 | 1.13.4 |
|------|--------|--------|
| `Hw.license` | 5 | 0 |
| `Hw.key` | 6 | 0 |
| `getUserInfo` | 0 | 4 |
| `checkBizKey` | 0 | 3 |

1.13.4 在 `render` 里调用 `Ok.getUserInfo()` 与 `Ok.checkBizKey()` 向服务端查询，并在 `updateAccountSettings` 里按 `Ok.key` 分支渲染。激活弹窗类由 `B7` 改为 `Vee`。i18n 的 `setting.account` 区段键名两版相同：`optionCommercialLicense`、`optionCommercialLicenseDesc`、`labelYourCommercialLicenseKey`、`labelCommercialLicenseInfo`、`labelValidatingCommercialLicense`、`labelInvalidCommercialLicense`、`buttonActivate`、`buttonPurchase`、`buttonRemoveCommercialLicense` 都存在。

i18n 访问器在压缩产物里的名字两版不同：1.12.7 用 `O7`（about）与 `F7`（account），1.13.4 用 `Fee`（about）与 `Ree`（account）。补丁按方法名与字符串定位，不按这些名字定位。

### starter CSS

1.13.4 中 `.starter.is-hidden-frameless .titlebar` 选择器不再存在，同一条规则被并入复合选择器：

```css
body.is-frameless.is-hidden-frameless.starter .titlebar,
body.is-frameless.is-hidden-frameless.is-popout-modal:not(.is-fullscreen) .titlebar,
body.is-frameless:not(.is-hidden-frameless, .is-fullscreen) .titlebar {
  height: var(--titlebar-height);
  zoom: calc(1 / var(--zoom-factor));
}
```

`.starter` 与 `.starter .titlebar` 两条规则在 1.13.4 中仍然存在，后者的内容为 `background-color: transparent; border: none;`。

### 未改动的公共文件

`enhance.js` 两版 md5 相同，为 `fb7a3408e1b0d75662897444e8cd86da`；`sim.js` 两版 md5 相同，为 `12d22674f0ce5cabd62a5613df8b91c6`。仓库未改动 `lib/` 目录下 254 个文件中的任何一个。

## 4. 仓库定制完整清单

本节分两部分。第一部分是仓库在 1.12.7 上做过的全部改动，作为升级时的原始依据；第二部分是构建脚本当前实际施加到 1.13.4 产物的范围。两者不完全重合：一部分作者自定义内容尚未迁移。

### 4.1 文件树差异

仓库相对官方 1.12.7 多出 3 个文件，没有缺少任何文件。

| 新增文件 | 字节数 |
|---------|-------|
| `harmonyos-sync-bridge.js` | 1785 |
| `icon.png.bak` | 29937 |
| `tray.png` | 314843 |

同名文件中有 11 个内容不同，其余 341 个 md5 完全相同。

| 文件 | 官方 1.12.7 | 仓库 1.12.7 |
|------|------------|------------|
| `app.css` | 600413 | 600383 |
| `app.js` | 3728534 | 3733193 |
| `help.html` | 565 | 565 |
| `i18n.js` | 129239 | 129134 |
| `i18n/zh.txt` | 69022 | 68956 |
| `icon.png` | 29937 | 1606146 |
| `index.html` | 1445 | 1445 |
| `main.js` | 60101 | 66141 |
| `package.json` | 260 | 278 |
| `starter.html` | 568 | 568 |
| `starter.js` | 416521 | 410292 |

### 4.2 main.js 在 1.12.7 上的改动（10 处）

以下 10 处已全部迁移到 1.13.4，见 4.10 节。第 1 处的 `vault-move` 删除未随迁，见 4.11 节。

1. 新增 12 个 `hcs-*` 通道：`hcs-get-status`、`hcs-sync-all`、`hcs-get-auto-sync`、`hcs-set-auto-sync`、`hcs-get-excluded`、`hcs-set-excluded`、`hcs-get-userid`、`hcs-set-userid`、`hcs-login`、`hcs-restore-list`、`hcs-restore-file`、`hcs-code`。1.12.7 上插在 `ipcMain.on("vault-move",...)` 与 `ipcMain.on("vault-open",...)` 之间，同时删除了 `vault-move`；1.13.4 上插在 `vault-open` 之前，`vault-move` 保留。
2. 新增 `exit-to-tray` 与 `force-quit` 两个通道。`exit-to-tray` 读写托盘开关状态，`force-quit` 关闭托盘开关后调用 `app.quit()`。插入位置在 `ipcMain.on("relaunch",...)` 之前。
3. 托盘初始化：`app.whenReady()` 回调开头用 `Tray` 加载 `tray.png`，单击切换窗口显示状态，右键菜单为 `显示` 与 `退出软件`。
4. 关窗最小化到托盘：仓库窗口的 `close` 事件开头插入判断，托盘开关开启且非真正退出时调用 `preventDefault()` 并隐藏窗口。
5. 新增 `app.on("before-quit",()=>{isQt=!0})`，用于区分真正退出与关窗到托盘。插入位置在 `app.on("window-all-closed",...)` 之前。
6. help 窗口复用 starter 窗口。插入位置在 `function Ye()`（help 打开函数）内。
7. starter 窗口复用为仓库窗口。插入位置在 `let ke=()=>{...}`（启动时按目录结构打开仓库窗口）内。
8. 打开最近仓库时复用 starter 窗口，`function de(t)` 的两个分支都插入这段代码。
9. `starter` 与 `help` 两个通道改为按 `BrowserWindow.fromWebContents(t.sender)` 定位窗口并加载对应页面，全局打开函数只作为兜底。
10. 短路 Electron 版本下限检查：`if(Mt<18){` 改为 `if(false&&Mt<18){`，去掉「必须手动下载安装」的强制弹窗。

### 4.3 app.js 在 1.12.7 上的改动（8 处）

第 1 处、第 5 处至第 7 处已迁移到 1.13.4；第 2 处至第 4 处与第 8 处未迁移，见 4.11 节。

1. 标题栏处理：在 `e.parent===e` 分支内调用 `electronWindow.setWindowButtonVisibility("hidden"===t)`，并在 `"hidden"===t` 时把 `--frame-right-space` 设为 `126px`。
2. 「关于」页版本项：去掉更新下载与检查更新分支，把描述改为静态的版本号与安装程序版本，并新增一项「贡献作者」，内容为 `@MikannQAQ` 与仓库地址按钮。
3. 商业许可证项改名「社区许可证」，无 key 时描述改为「该版本由社区进行移植为HarmonyOS版本，无需进行激活」，按钮文案改为「详情」。
4. 许可证激活弹窗改为静态说明弹窗：标题为「社区许可证」，内容说明该版本为 HarmonyOS 社区移植版本、无需许可证激活，只有一个「确定」按钮。
5. 「外观」页在自定义图标按钮之后、`translucency` 项之前插入开关「退出软件」，描述为「开启后，点击关闭按钮不会退出软件，需在托盘中退出软件」，状态经 `exit-to-tray` 通道同步给主进程。
6. 新增 `HcsSettingsTab` 类，即「华为云同步」设置页（`id = "huawei-cloud-sync"`，`name = "华为云同步"`，`icon = "cloud"`）。插入位置在核心插件设置页类结束、设置弹窗类开始处。
7. 注册 `HcsSettingsTab`：在社区插件设置页注册之后追加 `n.addSettingTab(new HcsSettingsTab(t,n))`。
8. 最低 installer 版本 `yte` 由 `"28.2.3"` 改为 `"1.12.7"`。

### 4.4 starter.js 在 1.12.7 上的改动（5 处）

第 1 处与第 3 处至第 5 处已迁移；第 2 处（品牌 logo 与字标改写）未迁移，见 4.11 节。

1. 标题栏文字由 `Obsidian` 改为 `OHsidian`。
2. 品牌 logo 与字标的两段内联 SVG 改为 `icon.png` 图片与 `OHsidian` 文本。
3–5. 删除全部 5 处 `window.close()`，打开或创建仓库后不再自动关窗。

### 4.5 i18n.js（7 个键）

| key | 官方 1.12.7 | 仓库 |
|-----|------------|------|
| `labelVersion` | `"Version {{version}}"` | `"HarmonyOS-{{version}}"` |
| `labelInstallVersion` | `"Installer version: {{version}}"` | `"HarmonyOS Port {{version}}"` |
| `labelReadChangelog` | `"Read the changelog."` | `""` |
| `labelManualUpdateRequired` | `"To support the latest features and to receive the latest security patches, Obsidian needs a major installer update. You need to manually download and reinstall Obsidian."` | `"This is a HarmonyOS port. Original update channels are not available."` |
| `labelDisabledUpdates` | `"Updates are disabled."` | `"Updates are disabled. Running on HarmonyOS."` |
| `buttonCheckForUpdates`（account 区段） | `"Check for updates"` | `"Updates not available"` |
| `optionAutoUpdateDescription` | `"Turn this off to prevent the app from checking for updates."` | `"Automatic updates are disabled on HarmonyOS port."` |

两版 `i18n.js` 各有 2315 个 `key:"..."` 项，值不同的只有这 7 个，都位于 `setting.about` / `setting.account`。`buttonCheckForUpdates` 在多个区段同名出现，`setting.about` 之外的值两版相同。

### 4.6 i18n/zh.txt（4 块，共 7 行）

改动集中在「关于」页的更新相关文案，对应 1.12.7 的 277–286 行、1.13.4 的 304–313 行：

| 项 | 官方 1.12.7 | 仓库 |
|----|------------|------|
| `版本 {{version}}` | 同左 | `HarmonyOS-{{version}}` |
| `安装程序版本: {{version}}` | 同左 | `HarmonyOS 移植版本 {{version}}` |
| `阅读更新日志` | 同左 | 空行 |
| 手动下载安装说明 | `Obsidian 需要进行一次较大的更新来获取最新功能和安全补丁。为此，你需要手动下载安装包并重新安装 Obsidian。` | `此版本为 HarmonyOS 移植版，原有更新通道不可用。` |
| `更新已禁用。` | 同左 | `更新已禁用（HarmonyOS 移植版）。` |
| `检查更新` | 同左 | `更新不可用` |
| `关闭后 Obsidian 将不会自动更新。` | 同左 | `HarmonyOS 移植版不支持自动更新。` |

### 4.7 app.css（3 处）

1. `.starter.is-hidden-frameless .titlebar` 的 `display: block` 改为 `display: none`。
2. `.starter` 的 `padding-top: 0! important` 改为 `padding-top: 30px! important`。
3. `.starter .titlebar` 的 `background-color: transparent; border: none;` 改为 `display: none`。

### 4.8 三个 HTML 与 package.json

`index.html`、`starter.html`、`help.html` 的 `<title>Obsidian</title>` 各改为 `<title>OHsidian</title>`，三个文件字节数不变。

`package.json` 改两个字段：

| 字段 | 官方 1.12.7 | 仓库 |
|------|------------|------|
| `author` | `"Obsidian"` | `"OHsidian"` |
| `description` | `"Obsidian"` | `"OHsidian HarmonyOS Edition"` |

其余字段两版相同：`name`（`obsidian-dev`）、`version`（随版本）、`license`（`UNLICENSED`）、`private`（true）、`main`（`index.js`）、`dependencies`（`btime` 与 `get-fonts` 指向 `../electron/*`）。

### 4.9 图标与新增资源

- `icon.png` 替换为 1606146 字节的自定义图标，官方原图重命名保留为 `icon.png.bak`。
- 新增 `tray.png`（314843 字节），供托盘初始化使用。
- 新增 `harmonyos-sync-bridge.js`（1785 字节）：独立 CommonJS 模块，导出 `HmosSyncBridge`（`resolveVaultPath` 读 `obsidian.json` 定位仓库路径，日志前缀 `[HMOS-SYNC]`）。该文件在 asar 内无任何引用。

当前构建脚本只携带 `tray.png`，不携带 `icon.png.bak` 与 `harmonyos-sync-bridge.js`。

### 4.10 构建脚本实际施加到 1.13.4 的范围

以下内容已逐项核实在 1.13.4 产物中存在。

| 来源 | 已迁移的内容 |
|------|-------------|
| `main.js` | 4.2 节的 10 处全部迁移 |
| `app.js` | 标题栏 `[HMOS-FRAME]` 处理；「退出软件」开关；`HcsSettingsTab` 类；`HcsSettingsTab` 注册 |
| `starter.js` | 标题栏文字 `Obsidian` → `OHsidian`；5 处 `window.close()` 全部去掉 |
| `i18n.js` / `i18n/zh.txt` | 7 个键与对应的中文文案 |
| `app.css` | 隐藏 starter 标题栏；starter `padding-top` 改为 `30px` |
| 三个 HTML | `<title>` 改为 `OHsidian` |
| `package.json` | `author`、`description`、`version` |
| 资源 | `icon.png` 替换；`tray.png` 新增 |

### 4.11 尚未迁移的作者自定义内容

以下改动存在于 1.12.7 的仓库版，当前构建脚本未施加到 1.13.4 产物：

- 「关于」页的「贡献作者」条目（`@MikannQAQ` 与仓库地址按钮）。
- 商业许可证项改名「社区许可证」及其描述改写。
- 许可证激活弹窗改为静态说明弹窗。
- 最低 installer 版本标识由 `28.2.3` 改为 `1.12.7`。1.13.4 产物中该值仍为 `28.2.3`。该值参与 `return!qy(<版本>,<该值>)` 的判断，影响「关于」页是否提示安装程序过旧。
- `starter.js` 品牌区改写：把两段内联 SVG 换成 `icon.png` 图片与 `OHsidian` 文本。1.13.4 产物中该处仍是官方 SVG。
- `vault-move` 通道的删除。仓库版 1.12.7 中该通道已被 12 个 `hcs-*` 通道取代；1.13.4 产物中该通道仍然存在，`hcs-*` 通道改为插在它之后。

这些内容不影响升级包的可用性，后续单独处理。

### 4.12 外层引导脚本

`web_engine/src/main/resources/resfile/resources/app/main.js` 不随官方内核升级变化，内容与官方安装包内的 `app.asar/main.js` 是同一份代码的两个分叉，`loadApp` 逻辑一致。它承载回收站兼容、字体兼容、`obsidian://` 队列派发等定制。

针对 1.13.4 新增了一处修复：注册 `app.on('web-contents-created', ...)`，在 WebContents 创建时调用 `remote.enable(contents)`，跳过 `getType()` 为 `webview` 的项，并打印 `[HMOS-REMOTE] 已开启 remote，WebContents <id> 类型 <type>`。原因是 1.13.4 默认在独立窗口打开设置页，该窗口的渲染进程在建立后立即同步调用 `remote.getCurrentWindow()`，早于 asar 内部在 `did-create-window` 开启 remote 的时机。

`main.js` 中的 `currentBaseVersion` 取自 `require('./package.json').version`，同一份 `package.json` 也是 `app.getVersion()` 的来源。启动时扫描 userData 用 `isV2MoreRecent(app.getVersion(), version)` 判断 `obsidian-{version}.asar` 是否比当前版本新。升级内核时这份 `package.json` 的 `version` 必须同步改，否则新 asar 不会被采用。

`queueUpdate` 在外层被短路，桌面自动更新始终关闭，并补发 `check-end` 事件。这一层不随 asar 升级变化。

## 5. 构建脚本

### 用法

```bash
cd tools && node build-asar.mjs --input <官方 asar> --output <产物路径> --version <版本号>
```

三个参数都必需，缺任意一个都会报错退出。`tools/package.json` 没有 `scripts` 字段，直接调用 `node`。

### 依赖

`@electron/asar` `^4.3.1`、`acorn` `^8.19.0`。

### 执行流程

`main()` 的顺序：

1. `extractAll` 解包官方 asar 到临时目录。
2. `resolveMainSymbolsInto` 解析 `main.js` 的符号。
3. `resolveAppSymbolsInto` 解析 `app.js` 的符号。
4. `copyResources` 替换资源（`icon.png`、`tray.png`），并移除产物中已存在的 `icon.png.bak` 与 `harmonyos-sync-bridge.js`。
5. `patchHtmlTitles` 改三个 HTML 的标题。
6. `patchPackageJson` 写 `author`、`description`、`version`。
7. `patchMainJs`。
8. `patchAppJs`。
9. `patchStarterJs`。
10. `patchI18nJs`。
11. `patchZhText`。
12. `patchAppCss`。
13. 对 `main.js`、`app.js`、`starter.js` 各做一次 `new vm.Script` 语法检查。
14. `verifyInjectedSymbols` 校验注入到 `app.js` 的代码所引用的符号。
15. `createPackageWithOptions` 重新打包。

运行结束打印解析出的符号、每条改动的命中次数、产物路径与字节数。

### 符号解析

`tools/lib/main-symbols.mjs` 与 `tools/lib/symbols.mjs` 用 acorn 解析 `main.js` 与 `app.js` 的语法树，按结构与稳定字符串（IPC 通道名、字符串字面量、类继承关系）定位出需要的符号，分别填入 `IDENT` 与 `IDENT_APP`。

脚本内不预设任何压缩变量名。官方发布新版后无需人工维护名字对照表。

解析项都要求唯一命中；出现多个候选时按打分排序并打印全部候选，同时报错退出，不取第一个继续。整数个数的解析结果以实际运行输出为准，1.13.4 的构建共打印 39 项，涵盖 `electron`、`fs`、`path`、`userData`、窗口表、窗口创建函数、starter/help 窗口变量、设置页基类、设置项容器、提示消息类、i18n 访问器等角色。

### Patcher

所有文本改动走 `Patcher`，提供这几个方法：

| 方法 | 行为 |
|------|------|
| `replace` | 单处替换，命中次数必须恰为 1 |
| `replaceAll` | 多处同文替换，命中次数必须等于给定值 |
| `replacePattern` | 正则替换，把可变部分捕获后拼回替换文本，命中次数必须等于给定值 |
| `insertBefore` | 在标记之前插入，标记命中次数必须恰为 1 |
| `assertContains` | 校验片段在最终文本中出现 |
| `assertAbsent` | 校验片段在最终文本中不出现 |
| `assertBalance` | 校验圆括号与花括号计数未超出阈值 |

任何一处定位标记的命中次数与预期不符都会抛错并让构建以非零退出。

### 补丁清单

以实际构建输出为准。用 `--version 1.13.4` 构建一次，输出的改动摘要共 34 条：

| 命中次数 | id |
|---------|----|
| 1 | `resource.icon.png` |
| 1 | `resource.tray.png` |
| 1 | `index.html.title` |
| 1 | `starter.html.title` |
| 1 | `help.html.title` |
| 1 | `package.json` |
| 1 | `main.version-guard` |
| 1 | `main.tray-vars` |
| 1 | `main.tray-init` |
| 1 | `main.close-to-tray` |
| 1 | `main.exit-to-tray` |
| 1 | `main.before-quit` |
| 1 | `main.starter-ipc` |
| 1 | `main.help-reuse` |
| 1 | `main.ke-reuse` |
| 1 | `main.hcs-channels` |
| 1 | `main.reuse-existing-vault-window` |
| 1 | `app.hmos-frame` |
| 1 | `app.about-version` |
| 1 | `app.exit-to-tray-toggle` |
| 1 | `app.hcs-tab-class` |
| 1 | `app.hcs-tab-register` |
| 1 | `starter.titlebar-text` |
| 5 | `starter.no-window-close` |
| 1 | `i18n.labelVersion` |
| 1 | `i18n.labelInstallVersion` |
| 1 | `i18n.labelReadChangelog` |
| 1 | `i18n.labelManualUpdateRequired` |
| 1 | `i18n.labelDisabledUpdates` |
| 1 | `i18n.optionAutoUpdateDescription` |
| 1 | `i18n.buttonCheckForUpdates` |
| 1 | `zh.about-block` |
| 1 | `css.starter-titlebar` |
| 1 | `css.starter-padding` |

补丁总数为 34 条，另有两个资源移除项只在产物中存在对应文件时才记录。

### 设计约束

(a) remote 必须在 WebContents 创建时开启，任何更晚的时机都可能排在渲染进程首个脚本之后。

(b) 插入到 `main.js` 的 `hcs-*` 通道代码，全部局部变量加 `_` 前缀。1.13.4 把 `fs` 的别名改成 `m`，原代码用 `m` 作为目录变量会遮蔽模块级别的 `fs`，导致对字符串调用 `m.readFileSync` 而抛错。

(c) 替换 `ipcMain.on(...)` 时必须把前面的模块前缀一并纳入定位标记，否则会拼出重复前缀，运行时读不到 `ipcMain`。构建脚本用 `assertAbsent` 自检这一点（`l.l.`、`m.m.`、`C.C.` 三种拼法都在检查范围内）。

### hcs-settings-tab.js

`HcsSettingsTab` 的源码模板，由 `build-asar.mjs` 读取后渲染并插入 `app.js`。模板含这几个占位符，全部由解析出的符号替换：

| 占位符 | 替换为 |
|--------|--------|
| `__EXTEND__` | 类继承辅助函数 |
| `__NOTICE__` | 提示消息类 |
| `__SETTINGS_TAB_BASE__` | 设置页基类 |
| `__SETTING_ITEM__` | 设置项容器 |
| `__REFRESH__(self)` | 刷新调用，新版基类下为 `self.update()`，旧版基类下为 `self.display()` |
| `__DISPLAY_FALLBACK__` | 旧版基类的兼容 `display()` 分支；新版基类下为空 |

`display()` 只作为旧版基类的兼容分支按需附加。渲染完成后脚本检查残留占位符，并用 `verifyInjectedSymbols` 校验 `new X(`、`return X(t,e)`、`},t}(X)` 三类调用只引用已解析的符号。

## 6. 升级步骤

1. 取得新版官方 asar。来源为 `obsidian-x.y.z.asar.gz` 的解压结果，或完整安装包 `resources/obsidian.asar`。
2. 用 `@electron/asar` 解包，按需与上一版逐文件对比。单行压缩产物先按分号切片再做行级比较。
3. 更新 `web_engine/src/main/resources/resfile/resources/app/package.json` 的 `version` 为目标版本。
4. 运行：

```bash
cd tools && node build-asar.mjs \
  --input <官方 asar> \
  --output web_engine/src/main/resources/resfile/resources/app/obsidian.asar \
  --version <版本号>
```

5. 查看输出。符号解析全部成功、改动摘要里每条命中次数与清单一致，才继续下一步。解析失败或命中次数不符时，脚本会打印失败项、实际命中次数与候选列表。
6. 语法检查与注入符号校验都在打包之前执行，任一失败即非零退出，不会产出可用产物。
7. 核对产物字节数与 md5，写入 `web_engine/src/main/resources/resfile/resources/app/obsidian.asar`。
8. 若新版引入了新的外层差异（例如 1.13.4 的独立设置窗口需要提前开启 remote），同步修改外层 `main.js`。
9. 设备验证，见第 7 节。

需要人工介入的情形只有官方改写了脚本所依赖的结构本身，此时更新 `tools/lib/` 里的形状描述或 `tools/hcs-settings-tab.js` 模板。定位本身由符号解析完成，无需打开新版文件重新寻找标记。

## 7. 验证方式

### 构建期检查

- 每条补丁的命中次数与预期一致，不一致即构建失败。
- `assertContains` / `assertAbsent` 校验关键片段的存在与不存在，包括重复前缀的自检。
- `assertBalance` 校验括号计数未超出阈值。
- `new vm.Script` 对 `main.js`、`app.js`、`starter.js` 做语法检查。
- `verifyInjectedSymbols` 校验注入代码引用的符号都来自本版本解析结果。

### 产物核对

- 产物字节数与 md5。
- 解包产物后与官方 asar 逐文件对比，确认变化范围与清单一致。
- 1.13.4 产物的权威值：27684486 字节，md5 `6746843bf8cfad21e4ac44dcee02e667`。该产物与设备上验证通过的版本一致。

### 设备验证

1. `app.getVersion()` 返回目标版本。
2. `userData` 下的 `obsidian.log` 有 `Loaded main app package` 记录。
3. 设置界面正常打开。
4. 「华为云同步」设置页出现。
5. 独立设置窗口能打开，日志中出现 `[HMOS-REMOTE] 已开启 remote`。独立设置窗口为 1.13.4 新增的默认行为，其开关为配置项 `settingsPopoutWindow`。
6. 含非内嵌字体的 PDF 能渲染。
7. `obsidian://` 链接能派发。
8. 托盘图标、关窗最小化到托盘、「退出软件」开关工作正常。

## 8. 已确认结论与未验证事项

### 已确认结论

- 目标版本 1.13.4 的产物已部署到设备并验证通过，字节数与 md5 见第 7 节。
- 定制在构建期施加，改动集中在 `tools/build-asar.mjs`、`tools/lib/` 与 `tools/hcs-settings-tab.js`。仓库不再以手工编辑压缩产物的方式维护 asar。
- 补丁定位由符号解析自动完成，官方发布新版后无需人工维护压缩变量名对照表。
- 外层引导脚本整体不随官方内核升级变化，升级时只需同步它的 `version`。
- 桌面自动更新在外层被关闭，不随 asar 升级变化。
- 官方两版 `require` 的模块集合相同，asar 对运行时的要求未变。
- 1.13.4 的设置页与许可证模块都已按新结构改写，`HcsSettingsTab` 通过 `getSettingDefinitions()` 返回定义数组注册。
- 「关于」页的作者自定义内容（贡献作者、社区许可证、静态许可证弹窗）、installer 版本标识、starter 品牌区、`vault-move` 通道的删除尚未迁移到 1.13.4，不影响升级包的可用性。详见 4.11 节。
- `is-dev` 通道在 1.13.4 中不存在，两版 `main.js` 与 `app.js` 都已确认。
- `[HMOS-FRAME]` 的处理位置在 1.13.4 中结构不变，仅类名由 `BD` 变为 `OI`。
- starter 标题栏相关规则在 1.13.4 中合并到复合选择器，补丁改为直接隐藏 `.starter .titlebar`。
- 三条设计约束：remote 在 WebContents 创建时开启；注入 `main.js` 的局部变量加 `_` 前缀；替换 `ipcMain.on(...)` 时把模块前缀一并纳入定位标记。详细说明见第 5 节。

### 未验证事项

- `hcs-*` 通道链路的实际可用性。`hcs-*` 读写的是 Electron 的 `app.getPath("userData")`，ArkTS 侧的 `CloudSyncAdapter` 读写的是 `applicationContext.filesDir`，两者是否为同一目录尚未确认，`checkLoginTrigger` 的调用方也未找到。
- `CloudSyncAdapterBind.ets` 注册的 8 个绑定（`CloudSync.InitSync`、`SetUserId`、`UploadFile`、`DownloadFile`、`ListFiles`、`DeleteFile`、`GetStatus`、`TriggerLogin`）在 asar 内没有调用方。
- `xb.insider` 的取值来源，以及 `policy.json` 默认值的完整定义。
- 1.13.4 的 `app.css` 相对 1.12.7 增加的 34558 字节中，是否还有影响 starter 页面的其它规则。
- 1.14.4 尚未开始。素材已齐备，位于 `obsidian-extracted/resources/obsidian.asar`，无 tar 安装包。

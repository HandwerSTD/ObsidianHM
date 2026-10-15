<!-- Copyright (c) 2026 HandwerSTD -->

# 运行时注入的最小验证记录

本文件记录一次实测：把官方原版 1.13.4 asar 放进本项目的外层壳，验证纯运行时注入路线是否成立。全部结论来自设备实测。第 8.3 节中的 `PATH` 一段后来在 1.14.4 上复测。

## 1. 验证目的

此前对每一处注入的可行性判断都来自静态阅读官方 asar 的代码，没有端到端验证。需要回答三个问题：

1. 官方原版 asar 能不能被这个壳加载并正常启动。
2. 外层注入的代码能不能真正执行，日志能不能留下痕迹。
3. `@electron/remote` 在各类窗口上的实际开启状态。

## 2. 验证环境

| 项 | 值 |
|----|-----|
| 分支 | `feat/runtime-inject-13`（从 `feat/harmony-port-fixes` 建立） |
| asar | 官方 1.13.4 原版，25783388 字节，md5 `bbae59d36fe60500436a82cb841d5ad6` |
| 设备 | HUAWEI MateBook Pro，序列号 `127.0.0.1:42021` |
| 构建 | `devecocli build` |
| 安装启动 | `devecocli run --skip-build --device 127.0.0.1:42021` |
| 日志 | `hdc shell "cat /data/app/el2/100/base/com.mikannqaq.obsidian/files/obsidian.log"` |

改动只有三处：替换 asar、把外层 `package.json` 的 `version` 改为 `1.13.4`、在 `main.js` 顶层加入探针。

## 3. 探针设计

第一版探针用 `console.log` 输出，结果一行都没有进日志。应用只把 `log()` 的写入写入 `obsidian.log`：

```
let log = logger(path.join(dataPath, 'obsidian.log'));
```

`console.log` 走标准输出，在设备上既不进这个文件，也不出现在 hilog 里。

改用同等格式写文件后，探针开始生效。探针自备写入函数，因为 `log()` 定义在第 280 行，而探针需要在其之前执行：

```js
let __probePath = path.join(app.getPath('userData'), 'obsidian.log');
function probe() {
	try {
		let d = new Date();
		let p2 = function (n) { return n < 10 ? '0' + n : '' + n; };
		let ts = d.getUTCFullYear() + '-' + ...;
		fs.appendFileSync(__probePath, ts + ' [PROBE] ' + util.format.apply(null, arguments) + os.EOL);
	} catch (e) {}
}
```

`main.js` 在 `probe()` 定义之后把 `process.env.PATH` 与子进程看到的取值各打一行，确认追加生效且能被子进程继承。

第二版探针多了一处：读 `@electron/remote` 自己的 `isRemoteModuleEnabled(contents)`，做开启前后的对比。

## 4. 实测结果

启动块（UTC 时间，北京时间 = UTC+8）：

```
2026-10-11 15:24:12 [PROBE] 版本改写：真实值 5.0.0-Release -> 现值 18.0.0
2026-10-11 15:24:12 字体兼容补丁监听已注册
2026-10-11 15:24:12 Loaded main app package /data/storage/el1/bundle/electron/resources/resfile/resources/app/obsidian.asar
2026-10-11 15:24:12 HarmonyOS port: desktop auto-update is disabled
2026-10-11 15:24:12 [PROBE] WebContents 1 类型 window：remote 开启前 false 开启后 true
2026-10-11 15:24:13 字体兼容补丁已注入渲染进程 1
2026-10-11 15:24:17 [PROBE] WebContents 2 类型 window：remote 开启前 false 开启后 true
2026-10-11 15:24:20 字体兼容补丁已注入渲染进程 2
2026-10-11 15:24:35 [PROBE] WebContents 3 类型 remote：remote 开启前 false 开启后 true
```

构建成功，安装启动成功。失败清单逐项检查，命中数全部为 0：`Manual update required`、`@electron/remote is disabled for this WebContents`、`Uncaught Exception`、`UnhandledPromiseRejection`、`TypeError`、`ReferenceError`、`is not a function`、`is not defined`、`Cannot read`、`Failed to require app package`、`Failed to load both app packages`。

## 5. 三条确认结论

### 5.1 官方原版 asar 可以加载运行

日志出现 `Loaded main app package`，没有 `Failed to require app package`，没有 `Failed to load both app packages`，没有 `Manual update required`，渲染进程被创建并注入字体补丁。界面上应用正常打开。

**纯运行时注入路线成立。** asar 不需要任何补丁。

### 5.2 设备上的 Electron 真实版本是 `5.0.0-Release`

主版本 5，低于 18。这意味着官方 asar 入口处的 `if(fo<18){` **确实会触发**，会弹出「Manual update required」并跳转下载页、退出应用。

把 `process.versions.electron` 改写为 `18.0.0` 是必需步骤，不是防御性措施。探针证明改写生效：真实值 5.0.0-Release，写入后现值 18.0.0。

**连带结论**：渲染进程读的是它自己的 `process.versions.electron`，主进程的改写不影响它。渲染进程里 `uf=process.versions.electron` 后 `pf=uf`，因此 `qy(pf, "28.2.3")` 比较的是 5 与 28，结果为真。实测 `qy("5.0.0-Release", "28.2.3")` 为 `true`（`zy` 解析出 `[5,0,0]`）。

所以「installer 版本过低」的提示与下载入口**会触发**，处理 `disable-update` 通道是必需的。

### 5.3 外层在 `web-contents-created` 的 remote 注入有效

三次观测全部是「开启前 false、开启后 true」。

官方 `@electron/remote` 的判定实现：

```
const isRemoteModuleEnabledImpl = function (contents) {
    const webPreferences = contents.getLastWebPreferences() || {};
    return webPreferences.enableRemoteModule != null ? !!webPreferences.enableRemoteModule : false;
};
const isRemoteModuleEnabledCache = new WeakMap();
const isRemoteModuleEnabled = function (contents) {
    if (hasWebPrefsRemoteModuleAPI && !isRemoteModuleEnabledCache.has(contents)) {
        isRemoteModuleEnabledCache.set(contents, isRemoteModuleEnabledImpl(contents));
    }
    return isRemoteModuleEnabledCache.get(contents);
};
function enable(contents) { isRemoteModuleEnabledCache.set(contents, true); }
```

`webPreferences.enableRemoteModule` 未设置时默认 `false`。官方 asar 自己也有开启路径，挂在窗口接线函数上：

```
function re(o){if(l.remote)try{l.remote.enable(o)}catch(r){console.error(r)}}
function J(o,r){let u=o.webContents;oe(u),re(u),o.on("app-command",...)}
```

`J` 由 `did-create-window` 触发，这个时刻晚于设置弹窗渲染进程的首个脚本。

## 6. 设置弹窗的实际创建路径

设置弹窗**不经过**主进程的 `setWindowOpenHandler`。渲染进程直接构造窗口，随后立刻使用 `electronWindow`：

```
function WJ(e){
  var o=["popup"];
  ... o.push("width="+t), o.push("height="+n), o.push("x="+i), o.push("y="+r)
  var s=window.open("about:blank","_blank",o.join(","));
  if(!s) return null;
  ...
  s.electronWindow&&(s.electron.webFrame.setZoomLevel(...),Cl(()=>s.electronWindow.show()));
  return {win:s,baseEl:l,cleanup:c}
}
```

两点：

- `o.join(",")` 以 `"popup"` 开头，这就是窗口识别判据。主进程的 `setWindowOpenHandler` 用 `u.url==="about:blank"&&u.features.startsWith("popup")` 判定这类窗口。
- `s.electronWindow` 是 `remote.getCurrentWindow()` 的产物，在 `window.open` 返回后立即访问。远程未开启时这里会失败。

## 7. 验证方法的价值

这一轮建立了可复用的验证闭环：改注入 → `devecocli build` → `devecocli run --skip-build` → 读 `obsidian.log` 的 `[PROBE]` 行。

三条要点：

- 注入的诊断输出必须写 `obsidian.log`，不能用 `console.log`。
- 探针需要自己实现写入，因为 `log()` 在其后定义。
- 探针要放在 `app.on('web-contents-created')` 注册之前，或者注册在 asar 加载之前，才能保证时序上早于官方。

## 8. 全量注入的实测记录

第 3 节到第 7 节是最小验证（只改 asar 与两处注入）。本节是一次完整注入的实测，范围覆盖 `docs/asar-customization-runtime.md` 里判为「运行时注入」的全部项目。

### 8.1 改动内容

外层 `web_engine/src/main/resources/resfile/resources/app/main.js` 增加：窗口登记、托盘初始化、关窗到托盘、十二个 `hcs-*` 通道注册、`exit-to-tray` 与 `force-quit` 通道、`disable-update` 覆盖、渲染进程注入注册、渲染进程日志转写通道、`before-quit` 标记。

新增 `inject/` 目录：

| 文件 | 内容 |
|------|------|
| `hcs-channels.js` | 十二个华为云同步通道的工厂函数，由外层调用后注册 |
| `preload.js` | 最早时机：包装 `i18next.t` |
| `dom-ready.js` | 页面结构就绪后：设置页注入、窗口按钮与右边距、起始窗口样式 |

资源：`tray.png`（314843 字节）放到 asar 之外，与 `obsidian.asar` 同目录。

asar 保持官方 1.13.4 原版。实测 md5 `bbae59d36fe60500436a82cb841d5ad6`，25783388 字节，380 个文件，唯一含关键字的是官方自带的 `icon.png`；`hcs-login`、`huawei-cloud-sync`、`OHsidian`、`qtray`、`exit-to-tray`、`[HMOS-FRAME]`、`harmonyos-sync-bridge` 的命中数都是 0。

### 8.2 实测结果

一轮启动的日志（时间戳 UTC）：

```
[PROBE] 版本改写：真实值 5.0.0-Release -> 现值 18.0.0
字体兼容补丁监听已注册
华为云同步通道已注册 12 个
退出相关通道已注册
已屏蔽 installer 版本提示
Loaded main app package /data/storage/el1/bundle/electron/resources/resfile/resources/app/obsidian.asar
HarmonyOS port: desktop auto-update is disabled
[PROBE] WebContents 1 类型 window：remote 开启前 false 开启后 true
托盘已初始化 /data/storage/el1/bundle/electron/resources/resfile/resources/app/tray.png
[INJECT] preload 开始施加
注入脚本已施加 preload.js WebContents 1 类型 vault
[INJECT] dom-ready 注入开始
注入脚本已施加 dom-ready.js WebContents 1 类型 vault
[INJECT] 窗口按钮与右边距已调整，frame=hidden setWindowButtonVisibility=true --frame-right-space=126px
[INJECT] i18next.t 已包装
[INJECT] 华为云同步页已注册，基类 t，取法 prototype，已存在页数 10
[INJECT] 设置页注入结束；外观页=true 关于页=true，页签数 10，页签 id=about,appearance,interface,editor,file,hotkeys,keychain,plugins,community-plugins,huawei-cloud-sync
```

### 8.3 新确认的结论

**PATH 追加生效，子进程继承同一份取值。** 这一段与本节其余部分不在同一轮，实测运行的是 1.14.4：

```
[PROBE] PATH 追加前 /data/app/bin:/data/service/hnp/bin:/data/app/bin:/data/service/hnp/bin:/usr/local/bin:/bin:/usr/bin:/system/bin:/vendor/bin
[PROBE] PATH 追加后 /data/app/bin:/data/service/hnp/bin:/data/app/bin:/data/service/hnp/bin:/usr/local/bin:/bin:/usr/bin:/system/bin:/vendor/bin:/storage/Users/currentUser/.harmonybrew/bin
[PROBE] 子进程 PATH /data/app/bin:/data/service/hnp/bin:/data/app/bin:/data/service/hnp/bin:/usr/local/bin:/bin:/usr/bin:/system/bin:/vendor/bin:/storage/Users/currentUser/.harmonybrew/bin
```

`child_process.execSync` 看到的取值与主进程一致，说明环境写在进程上并被派生进程继承。系统给定的取值里 `/usr/bin` 实际不挂载进应用，`hdc shell` 里的 `PATH` 与这里也不相同：设备 shell 是 `shell` 身份（`uid=2000`），应用进程是应用沙箱身份，两者看到的环境本就不一样。

**`window.require('obsidian')` 在设备上抛 `Cannot find module 'obsidian'`。** 完整报错是：

```
[INJECT] 读 window.require("obsidian") 抛错 Cannot find module 'obsidian'
Require stack:
- electron/js2c/renderer_init
```

官方把模块实例放在闭包里，未注册为 require 可解析的模块。所以 `docs/asar-customization-runtime.md` 第 1.3 节给出的回退取法是唯一可用的取法。同时 `Setting` 与 `Notice` 也不能从该模块取：`Notice` 由官方挂在 `window` 上（源码里是 `window.Notice=xw`），直接从 `window` 取即可。

**设置页基类从原型链回溯可行。** `Object.getPrototypeOf(app.setting.settingTabs[0]).constructor` 取到基类，注册后页签列表从 9 个变为 10 个，末尾是 `huawei-cloud-sync`。`Setting` 容器的 `isPluginSettingTab` 用 `instanceof` 判定，因此这个类必须真的继承内部基类，回溯得到的正是该基类。

**包装 `getSettingDefinitions` 后调 `tab.update()` 生效。** 外观页与关于页的包装返回值都是 `true`。

**`[HMOS-FRAME]` 的两件事在运行时可以做到。** `ipcRenderer.sendSync("frame")` 返回 `hidden`，`electron.remote.getCurrentWindow().setWindowButtonVisibility` 接口存在且可调用，`--frame-right-space` 设为 `126px` 生效。

**i18next 包装生效。** 日志记录 `i18next.t 已包装`。包装前用官方 `lib/i18next.min.js` 单独实测过：键的形态是 kebab-case 且以 `setting.about.` 开头（例如 `setting.about.label-version`），命中自定义键返回改写值，未命中的键交给官方实现处理。

### 8.4 发现并修正的三处缺陷

首轮完整注入后做了一次核对，发现三处真实缺陷，均已修正并重新实测。

**一、两个设置页的包装在第一个分组就返回。**

1.13.4 的「外观」页与「关于」页都是混合结构：部分设置项平铺，后面跟若干 `type:"group"` 的分组。「外观」页的两个分组依次是「字体」与「高级」，「半透明效果」在「高级」里；「关于」页的分组依次是「账号」与「高级」。

原代码遍历到第一个分组就 `return`，因此「退出软件」开关被插进「字体」分组，「贡献作者」被插进「账号」分组。修正后改为遍历全部分组再定位。

实测日志：

```
外观页已插入退出软件开关；所在分组=高级 位置=1 该分组项名=自定义应用图标|退出软件
关于页已插入贡献作者条目；前四项名=HarmonyOS-|贡献作者|自动更新|接收内部版本
```

**二、`removeAllListeners` 的执行时机错误。**

`installDisableUpdate()` 原本在 `loadApp()` 之前调用，而官方的同名监听是在 `loadApp()` 里注册的。先清空再注册，官方随后的注册变成第二个监听器，`sendSync` 通道上多个监听器时结果不可预测。

修正后移到 `loadApp()` 之后。官方全部通道里只有 `disable-update` 一个与注入重名（其余十四个官方都是 0 次命中），因此只有这一项受影响。

实测日志：

```
disable-update 被调用，参数 （读取）
```

**三、全局屏蔽 `window.close` 破坏了官方行为。**

`preload.js` 原本把 `window.close` 覆盖为空函数，用于让起始窗口打开仓库后不关闭。覆盖是无条件的，作用于每一个渲染进程，连带破坏三处：

- **起始窗口残留。** 原先不关闭是为了配合仓库版本的窗口复用（把起始窗口改造成仓库窗口），而那份复用逻辑在当前实现里并不存在，于是起始窗口只是单纯地留了下来，点「帮助」还会另开一个窗口。
- **「切换仓库」不可用。** 官方 `kI` 类的 `onChooseItem` 是 `!0===sendSync("vault-open", e.path, !1) ? (this.switchVault && window.close()) : ...`。窗口关不掉，切换动作走到一半。
- **设置弹窗关不掉。** 官方 `Modal.close` 经 `popout.cleanup` 调 `y.close()`。弹窗是由 `window.open("about:blank")` 造出的独立窗口，`preload.js` 在它上面同样生效，因此这个 `close` 也被吞掉。

修正方式是移除这段覆盖，保留官方的窗口关闭语义。需要「关窗不退出」的是仓库窗口，这件事由外层对 `close` 事件的拦截与托盘完成，本就不需要动渲染进程。

同时修掉两处因此产生的误导性日志：起始窗口上会打印「等待 window.app 超时，设置页注入放弃」（起始窗口本来就没有 `window.app`，不是失败），改成「当前为起始窗口，无需设置页注入」。

实测日志：

```
[INJECT] 当前为起始窗口，无需设置页注入
```

且本轮日志中不再出现 `window.close 已屏蔽`。

### 8.5 仍未验证

- **三项窗口复用**（help 复用 starter、starter 复用为仓库窗口、打开最近仓库时复用 starter）在运行时没有等价接口。当前保留官方行为。
- **`disable-update` 恒返回 `true` 对「自动更新」开关的影响。** 渲染进程读该通道的返回值为真时开关显示为关闭，用户拨动开关时写入被忽略。需要确认这符合预期：自动更新本来就由外层 `queueUpdate` 短路，开关只影响界面状态。另一条做法是在 `preload.js` 里同样改写渲染进程的 `process.versions.electron` 到 `29.0.0`，使官方的 `qy(pf, "28.2.3")` 判定为假，该通道即恢复官方行为。这条依赖 `preload.js` 早于 `app.js` 求值，需要一轮实测确认。
- **界面项**：托盘图标显示、「华为云同步」页内容、「退出软件」开关、「关于」页的版本与贡献作者条目、PDF 渲染、`obsidian://` 派发。这些需要看着界面确认。

## 9. v34.8.5 运行时上的复核

本节记录换到 v34.8.5 运行时之后，第 5 节到第 8 节的结论复核情况。完整换版过程见 `docs/runtime-upgrade-34.md`。

第 1 节到第 4 节的最小验证结论不受影响：官方原版 asar 仍能加载运行，外层注入仍能执行，诊断输出写 `obsidian.log` 这条仍然成立。

### 9.1 版本下限检查

旧运行时在设备上自报 Electron `5.0.0-Release`，低于官方 asar 入口的下限阈值，`if(fo<18){` 会触发，因此改写 `process.versions.electron` 是必需步骤。新运行时是 Chromium 132 / Node 20.18.1，版本号大幅提高。

外层的版本改写逻辑未改动。需要确认的是它现在是否已无必要，以及第 8.5 节「`disable-update` 恒返回 `true`」的覆盖是否还能摘掉——后者的前提是渲染进程的 `qy(pf, "28.2.3")` 判定为假，而那取决于渲染进程读到的 `process.versions.electron`。

### 9.2 `ExecuteCommand` 与 `open-url`

重测结论与旧运行时一致，`docs/asar-customization-runtime.md` 第 8.3 节的链路仍必需：

- `kOpenURL`（type=5）不发射 `open-url`。埋点「probe NATIVE open-url received」在多轮运行中命中 0 次，同一时刻命中的是「probe open-url observed, source=our-own-emit」。
- `kSecondInstance` 事件能触发，ArkTS 发 `argv=["electron"]`、JS 收到 `argv=[]`，参数在 native 侧丢失。

### 9.3 `callArkTSFunction`

新运行时提供的能力，Electron 主进程直接调 ArkTS 函数并拿返回值：

```
[OHSV] callArkTSFunction 返回 {"type":"string","value":"ets bridge adapter"}
```

方向是 Electron 调 ArkTS。检测更新与 deeplink 的文件中转都是 ArkTS 送数据给 JS，方向相反，只能替代其中一半。分析见 `docs/asar-customization-runtime.md` 第 11.3 节与 `docs/update-check.md` 第 8 节。

### 9.4 端到端结果

用户在合回主仓库后完成端到端验证，`devecocli build` 与 `devecocli run --skip-build` 均通过。冷启动打开 `/storage/Users/currentUser/Workspace/Obsidian/ObsidianNotes` 不再报 `EPERM`（权限补齐 `CUSTOM_SANDBOX` 与 `READ_WRITE_USER_FILE` 之后）。PDF 字体正常。

回收站的验证做在新工程里，合并前完成：

```
[OHSV] trash requested path=/storage/Users/currentUser/Workspace/Obsidian/DevOnHarmonyOS/未命123名.md
[OHSV] trash result=true path=/storage/Users/currentUser/Workspace/Obsidian/DevOnHarmonyOS/未命123名.md
```

同期的 hilog 显示实际调用是 `FileManagerAdapter#deleteFileToTrash`，印证了 `TrashAdapter` 已被 native 层取代。

deeplink 用 `show-plugin` 测试不弹窗属预期。`open?vault=test` 是否弹两次尚未确认，对应第 8.3 节末尾新记的「两个监听」那条。

第 8.5 节列的三项仍未验证。

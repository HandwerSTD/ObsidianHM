<!-- Copyright (c) 2026 HandwerSTD -->

# 运行时全量更新到 v34.8.5

本文件记录一次运行时换版：把 Electron 运行时的预编译产物与 ArkTS 适配层整体换成华为新模板，同时保留 Obsidian 外层产物与本仓库的全部定制。

提交 `1cbf1a1`。合并前的状态是 tag `pre-merge-34` 与分支 `backup/pre-merge-34`，同指 `3ed6562`。

## 1. 为什么这次要换

新运行时带来一项此前没有的能力：**`callArkTSFunction`**——Electron 主进程可以直接调 ArkTS 函数并拿到返回值。旧运行时的 JSBind 只有原生调 ArkTS 一个方向，ArkTS 想把数据送进主进程只能写文件、由主进程轮询读。

换版顺带解决的还有两处按版本号判断的逻辑：旧运行时设备侧自报 Electron `5.0.0-Release`，低于官方 asar 入口处的下限检查阈值，每次启动都要先改写 `process.versions.electron` 才能绕过。

## 2. 版本基线

| 项 | 旧 | 新 |
|----|----|----|
| 运行时包 | 1.13.x（华为 Electron 移植版） | `v34.8.5-20260729.1-release` |
| Chromium | — | `132.0.6834.161` |
| Node | — | `v20.18.1` |
| Electron 自报值 | `5.0.0-Release` | — |

Obsidian 内核没有变，仍是 1.14.4，asar 与官方发布版逐字节一致，md5 `a2bde3f94594c1d697492998ea6e20aa`，27477966 字节。换的是承载它的运行时。

## 3. 替换的二进制

`electron/libs/arm64-v8a/` 下三个库：

| 文件 | 字节 |
|------|------|
| `libelectron.so` | 166750776 |
| `libadapter.so` | 5517992 |
| `libffmpeg.so` | 2181544 |

新运行时不再需要 `libc++_shared.so` 与 `libextractor.so`，两个文件删除。`btime` 与 `get-fonts` 两个原生 addon 保留，它们在 Obsidian 外层的 `node_modules/` 里，与运行时版本无关。

`web_engine/src/main/resources/resfile/` 下随 Chromium 一并更新的是 `chrome_100_percent.pak`、`chrome_200_percent.pak`、`icudtl.dat`、`locales/`、`resources.pak`、`snapshot_blob.bin`、`v8_context_snapshot.bin`。新模板不再附带 `style_font_config.json` 与 `vulkan/icd.d/vk_swiftshader_icd.json`，这两个文件在旧模板基线里就有，属模板变化而非本项目定制。

## 4. ArkTS 适配层

新旧模板在这一层几乎整体重写，150 个共有文件有差异，合计 9523 行。判定结果是整个运行时层按新模板走，本仓库的定制逐项搬过去。

### 4.1 新增的文件

新模板带来的 22 个新增文件，按用途分四组：

| 组 | 文件 |
|----|------|
| JSBind 通道 | `adapter/EtsBridgeAdapter.ets`、`adapter/AutoUpdaterAdapter.ets`、`adapter/ShareAdapter.ets`、`adapter/WebAppAdapter.ets` 及对应的四个 `jsbindings/*Bind.ets` |
| 窗口与进程 | `common/NodeHandleManager.ets`、`common/PopupWindowManager.ets`、`components/WebNodeHandleWindow.ets`、`components/WebNodeHandleSubWindow.ets`、`electron/src/main/ets/pages/NodeHandleWindow.ets`、`NodeHandleSubWindow.ets`、`entryability/TaskManagerAbility.ets` |
| 命令行 | `common/CommandLineAdapter.ets`、`utils/CmdArgsHelper.ets` |
| 工具与杂项 | `ability/ContinueAbility.ets`、`utils/KVStore.ets`、`utils/InstallationPackageDialog.ets`、`utils/StringStackUtil.ts`、`utils/VerifyLog.ets`、`shortcuts_config.json` |

表里 23 个文件，`git diff --diff-filter=A` 只报 22 个：`electron/src/main/ets/pages/NodeHandleSubWindow.ets` 被 git 判为从 `web_engine/src/main/ets/jsbindings/DeviceInfoAdapterBind.ets` 重命名而来，两个文件内容有 74% 字面重合触发了相似度检测。实际是新增，历史里两份内容都在。

`EtsBridgeAdapter` 承载第 1 节说的 `callArkTSFunction`。`VerifyLog.ets` 是本轮验证期间加的，统一把日志写到 `filesDir/obsidian.log`，前缀 `[OHSV]`，见第 8 节。

### 4.2 删除的文件

旧模板的九个适配器及其绑定在新模板中消失：

```
BatteryAdapter          CloudSyncAdapter      GeolocationAdapter
NetConnectionAdapter    OcrAdapter             PowerMonitorAdapter
ScreenlockMonitorAdapter TrashAdapter          DeviceInfoAdapterBind
```

判定它们可以删除的依据有两条，都做过实测：

**回收站走的是 `FileManagerAdapter`。** `obsidian.log` 里的调用记录是 `FileManagerAdapter#deleteFileToTrash("...")`，而 `TrashAdapter` 在整个调用链上没有出现。新模板的 `FileManagerAdapterBind.ets` 注册了七条方法，含 `FileManagerAdapter.DeleteFileToTrash`，比旧仓库多六条。回收站功能在新模板上实测正常。

**`CloudSync.*` 没有调用方。** 对两个运行时的 `libelectron.so` 与 asar 分别搜 `CloudSync` 字符串，命中数均为 0：

```
$ strings -n 8 electron/libs/arm64-v8a/libelectron.so | grep -E "CloudSync\."
（空）
$ strings -n 8 .../resources/app/obsidian.asar | grep -i cloudsync
（空）
```

配套的 `@hw-agconnect/hmcore` 依赖、`electron/src/main/resources/rawfile/agconnect-services.example.json`、`EntryAbility.ets` 里的 `initAgc()` 一并不再需要。`agconnect-services.example.json` 作为无敏感信息的示例文件保留在仓库里。

这些文件的代码留在 `pre-merge-34` 及更早的提交中，需要时可以从那里取回。

## 5. 搬过来的定制

新模板不含本项目的定制，逐项确认后搬过去。核对方式是看定制标记是否在新工程里出现：

| 定制 | 落点 |
|------|------|
| 托盘图标反色 | `adapter/StatusBarManager.ets` 的 `invertIcon` |
| 窗口阴影覆写 | `adapter/AppWindowAdapter.ets` 的 `showWindow` |
| 启动上下文推送 | `utils/JsBindingUtils.ets` 的 `pushContextPaths` |
| 日志出口 | `application/WebAbilityStage.ets` 调 `VerifyLog` 初始化 |
| 检测更新 | `adapter/UpdateChecker.ets` |
| 启动打点 | `utils/PerfProbe.ets`，挂在 `components/WebWindow.ets` |
| deeplink 队列 | `electron/src/main/ets/utils/DeeplinkBridge.ets`、`entryability/EntryAbility.ets` 的 `captureDeeplink` |
| 两项权限 | `web_engine/src/main/module.json5` 的 `CUSTOM_SANDBOX` 与 `READ_WRITE_USER_FILE` |
| Obsidian 外层产物 | `resources/app/` 下的 `main.js`、`inject/`、`obsidian.asar`、`tray.png`、`node_modules/` |

`AppWindowAdapter` 有一处不等价：旧仓库有 `applyWindowTitleButtonVisible` 与 `showWindowTitleButtons` 两个私有方法，新模板没有，改为在 `setMaximizable`、`setMinimizable`、`setClosable` 三处内联同样的 `setWindowTitleButtonVisible(...)` 调用，并新增 `setWindowButtonVisibility(id, visible)` 覆盖「三个全开」的场景。能力等价。

`WebAbility.ets` 里 `writePerfLine` 那处调用没有带过来，`WebWindow.ets` 里的带过来了。属于启动打点的覆盖面收窄，不影响功能。

## 6. 权限清单

`web_engine/src/main/module.json5` 在新模板与旧仓库之间逐项合并：

**保留旧仓库的三项。** `CUSTOM_SANDBOX` 与 `READ_WRITE_USER_FILE` 是本项目读用户目录的前提，`kernel.ALLOW_WRITABLE_CODE_MEMORY` 配合 `definePermissions` 里的同名定义。

这一项的代价值得记一笔：`READ_WRITE_USER_FILE` 是受限开放权限（system_grant，不弹窗），本地调试直接声明即可，上架时 AGC 会按「应用为 IDE 或其他开发调测工具，需要读写 PC/2in1 设备上的用户目录」这个场景审核申请理由。

**采用新模板的六项。** `ACCELEROMETER`、`GET_FILE_ICON`、`GYROSCOPE`、`LOCK_WINDOW_CURSOR`、`SET_ABILITY_INSTANCE_INFO`、`SET_WINDOW_TRANSPARENT`。

**去掉一项。** `DISTRIBUTED_DATASYNC` 配合跨设备接续，本项目已删除 `continuable` 配置，留着是多一个权限。

旧仓库独有的 `SYSTEM_FLOAT_WINDOW` 未保留。新模板换用别的悬浮窗方案，本项目没有悬浮窗需求。

漏掉前两项会直接表现为冷启动扫描 `.obsidian/plugins` 时 `EPERM`——权限是安装时授予的，改 `module.json5` 后必须重装才生效。

## 7. 同步方式

从模板工程（临时目录 `../ObsidianHM/`）同步到本仓库，用 rsync 加一组 exclude：

```bash
rsync -a --delete \
  --exclude='.git/' --exclude='.bitfun/' --exclude='.pi/' \
  --exclude='.hvigor/' --exclude='build/' --exclude='oh_modules/' \
  --exclude='node_modules/' \
  --exclude='build-profile.json5' \
  --exclude='.gitignore' --exclude='.gitattributes' \
  --exclude='AGENTS.md' --exclude='README.md' --exclude='README_EN.md' \
  --exclude='build-profile.example.json5' \
  --exclude='docs/' --exclude='tools/' --exclude='.agents/' \
  --exclude='web_engine/BuildProfile.ets' \
  --exclude='electron/build-profile.json5' \
  --exclude='web_engine/build-profile.json5' \
  --exclude='electron/src/main/resources/rawfile/' \
  ../ObsidianHM/ ./
```

几处 exclude 的理由：

**`node_modules/` 匹配任意层级**，会一并保护 `resources/app/node_modules/`。那里面的 `@electron/remote`、`btime`、`get-fonts` 要随包发布，`main.js` 运行时要加载，不能让 `--delete` 删掉。

**两个 `build-profile.json5` 保留本仓库版本**，它们 `release` 构建项里的 `obfuscation.enable` 是 `true`，模板那边是 `false`。覆盖后发布构建会停止混淆。

**`web_engine/BuildProfile.ets` 保留本仓库版本**，模板那份被构建脚本改成了 `debug` / `true`。本仓库约定入库的是 `release` / `false`。

**`.gitignore` 与 `.gitattributes` 保留本仓库版本。** 本仓库的 `.gitignore` 76 行，含 `node_modules/` 与 `*.asar` 两条反向豁免，以及签名材料、`build-profile.json5` 的忽略规则；模板那份 26 行，会误伤需要跟踪的产物。`.gitattributes` 按决定不加 `*.png`，模板那份多这一条，8.5M 图标入库即可，不值得为它引入 LFS 依赖。

**`rawfile/` 排除**是为了保留 `agconnect-services.example.json`。

同步后验证对齐，exclude 列表与上面一致，输出应为空：

```bash
diff -rq --no-dereference \
  --exclude='.git' --exclude='.bitfun' --exclude='.pi' --exclude='build' \
  --exclude='oh_modules' --exclude='node_modules' --exclude='.hvigor' \
  --exclude='docs' --exclude='tools' --exclude='.agents' \
  --exclude='.gitignore' --exclude='.gitattributes' \
  --exclude='AGENTS.md' --exclude='README.md' --exclude='README_EN.md' \
  --exclude='build-profile.example.json5' --exclude='BuildProfile.ets' \
  --exclude='build-profile.json5' --exclude='rawfile' \
  ../ObsidianHM/ ./
```

## 8. 验证过程中修掉的问题

### 8.1 `CUSTOM_SANDBOX` 与 `READ_WRITE_USER_FILE` 漏声明

最初只看了 `electron/src/main/module.json5`，两处都没有 `requestPermissions` 段。权限实际声明在 `web_engine/src/main/module.json5` 这个 HAR 模块里，模板与旧仓库的差异正是那两项。补上之后冷启动的 `EPERM` 消失。

### 8.2 `.bitfun/` 与 `.pi/` 被提交

`.gitignore` 里没有这两条，`git add -A` 把 40 个本地工具文件一起入库了。补规则并 `git rm -r --cached`，磁盘文件保留。

### 8.3 git-lfs 未初始化

`git-lfs` 装了二进制但 `git lfs install` 没在这台机器上执行过，`filter.lfs.clean` 与 `filter.lfs.process` 都没配。`.gitattributes` 里 `*.so`、`*.asar`、`*.bin`、`*.dat`、`*.pak` 全部 `filter=lfs`，git 找不到 filter 就跳过转换，12 个二进制（含 160MB 的 `libelectron.so`）以原始内容进了 git 对象库，`.git` 从 385M 涨到 480M。

修法是 `git lfs install --local` 配好 filter 后重做提交。

重做时踩到一个二次陷阱：`git reset --soft` 会保留索引，clean filter 被跳过，文件仍以原始内容入库。清空索引（`git reset` 不带 `--soft`）后重新 `git add` 才正确。判据是 `git lfs fsck` 报的 `unexpectedGitObject` 数量，以及索引里对象的大小——指针约 130 字节。

### 8.4 全仓库权限位变成 755

这台机器的挂载把所有文件设成 777，git 记成 755，一次提交产生 266 条 mode change。旧仓库 286 个文件一律 644，没有例外，`.mjs` 脚本和 `.node` 原生模块也不例外。

`git config core.fileMode false` 让以后不再产生，然后用 `git update-index --chmod=-x` 把索引里 297 个文件逐个改回 644 重新提交。中文文件名的那四个 `docs/vendor/` 下的文件 `git ls-tree` 输出是八进制转义，按转义串操作会找不到路径，要用实际文件名。

### 8.5 模块级 `.gitignore` 漏同步

rsync 的 `--exclude='.gitignore'` 排除了根目录那个，也顺带排除了 `electron/.gitignore` 与 `web_engine/.gitignore`——模板工程有这两个文件，本仓库原先没有。这两个要补上，因为 `electron/.gitignore` 里的 `/libs` 未注释，会让将来新增的运行时库文件静默不入库。ObsidianHM 的根 `.gitignore` 里把 `/electron/libs` 注释掉了并写了说明，模块级这个是模板的疏漏，已一并注释掉。

## 9. 端到端验证

设备实测由用户在合回本仓库后完成，`devecocli build` 与 `devecocli run --skip-build --device 127.0.0.1:42021` 均通过。

合回之前的验证在新工程里做，设备日志：

```
[OHSV] trash requested path=/storage/Users/currentUser/Workspace/Obsidian/DevOnHarmonyOS/未命123名.md
[OHSV] trash result=true path=/storage/Users/currentUser/Workspace/Obsidian/DevOnHarmonyOS/未命123名.md
```

回收站可用。同一时刻的 hilog 显示实际调用是 `FileManagerAdapter#deleteFileToTrash`，第 4.2 节删除 `TrashAdapter` 的判断据此成立。

合回之后确认的几项：冷启动打开 `/storage/Users/currentUser/Workspace/Obsidian/ObsidianNotes` 不再报 `EPERM`，PDF 字体正常。

deeplink 用 `show-plugin` 测试不弹窗属预期行为，`open?vault=test` 是否弹两次尚未确认。

## 10. 本次没有做的事

**`callArkTSFunction` 尚未投入使用。** 能力已验证可用（返回 `{"type":"string","value":"ets bridge adapter"}`），但 deeplink 与检测更新仍走文件中转。

方向是它只能单向：Electron JS 调 ArkTS，返回 Promise。检测更新是「ArkTS 查完结果告诉 JS」，方向相反，可以改成关于页发问时按需 `callArkTSFunction` 拉取，那样两个中转文件和两个定时器都能删掉。deeplink 是真正的推送需求，这条路帮不上。

**deeplink 的 `open-url` 派发在新运行时仍未通。** `kOpenURL` 实测不发射 `open-url`（埋点「probe NATIVE open-url received」命中 0，同一时刻命中的是自身 emit 的回声）。`kSecondInstance` 事件能触发，但 ArkTS 发 `argv=["electron"]`、JS 收到 `argv=[]`，参数在 native 侧丢失。下一步是把 `second-instance` 的四个参数（`event`、`argv`、`workingDirectory`、`additionalData`）全部打出来，看链接是否在 `additionalData` 里。

**`app.emit('open-url')` 会命中 asar 的两个监听。** asar 注册了 `app.once("open-url")` 冷启动缓冲与 `app.on("open-url")` 正式处理，同一条链接可能走两遍。链接打不开时弹窗会出两次。`main.js` 里已就这一点写了注释。

**验证探针还在。** `VerifyLog.ets` 在全仓有 27 处调用，`main.js` 另有 28 处 `vlog`，每次启动都写 `obsidian.log`。分布见 `docs/asar-customization-runtime.md` 第 10 节末条。摘不摘待定。

**`docs/asar-customization-runtime.md` 已更新**，见该文件第 11 节。
<!-- Copyright (c) 2026 HandwerSTD -->

# 开源许可审计

本文件记录仓库中每一处代码与二进制的来源、许可状态，以及需要处理的问题。审计时间对应仓库状态：Obsidian 内核 1.14.4，git 最新提交 `78f7e22`。

审计用三条基线做逐字节比对，路径记作 `$HARMONY`，`$HARMONY` = `/mnt/linux_share/storage/Users/currentUser/`。

| 代号 | 路径 | 说明 |
| --- | --- | --- |
| A | 本仓库 git initial commit `b2e07cd` | 旧的 HarmonyOS Electron 模板，作者 Hanversion，文件头署名 Haitai FangYuan Co., Ltd. |
| B | `$HARMONY/Download/com.huawei.hmos.browser/obsidian/tar12/obsidian-1.12.7-arm64` | 解包的 Obsidian 1.12.7 AppImage |
| C | `$HARMONY/Download/com.huawei.hmos.browser/obsidian/libelectron_132/libelectron/ohos_hap` | 新的 HarmonyOS Electron 模板，Huawei 贡献 |

## 1. 来源沿革

工程经过四轮，每一轮的作者与产物如下。

| 轮次 | 作者 | 产物 |
| --- | --- | --- |
| 1 | Haitai Fangyuan | HarmonyOS Electron 模板，全部 ArkTS 文件头带 `Copyright (c) 2023-2025 Haitai FangYuan Co., Ltd.` 与 BSD-3 全文 |
| 2 | Hanversion | 解包 Obsidian asar 逆向移植到 1.12.7，含若干定制 |
| 3 | Handwer | 重构运行层，改为 asar 原样携带加外层 JS 注入，适配 1.13.4 至 1.14.4 |
| 4 | Handwer | 工程整体迁到 Huawei 模板，并覆盖本仓库 |

当前仓库的状态是第 4 轮的结果：ArkTS 侧代码来自 Huawei 模板，主进程引导脚本来自 Obsidian 官方，注入脚本与少量工具为本项目新增。

## 2. 头部声明现状

统计范围为受 git 跟踪的 `*.ets` `*.ts` `*.js` `*.mjs`，共 181 个文件，不含 `node_modules`。

| 头部声明 | 文件数 |
| --- | --- |
| `Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved.` + 三行式 BSD 引用 | 136 |
| `Copyright (c) 2023-2025 Huawei Device Co., Ltd.` | 6 |
| `Copyright (c) 2025 Huawei Device Co., Ltd. All rights reserved.` | 5 |
| `Copyright (c) 2023-2026 Huawei Device Co., Ltd.` | 2 |
| `Copyright (c) 2026 HandwerSTD` | 11 |
| 无声明 | 21 |
| `Haitai FangYuan Co., Ltd.` | 0 |

Huawei 的头部全文三行：

```
// Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
```

基线 A 的头部是 BSD-3 全文二十余行，写明三个条件与免责声明。

## 3. 逐字节比对

比对范围为 `*.ets` `*.ts` `*.js` `*.mjs` `*.json5` `*.json` `*.txt` `*.html`，共 215 个文件，排除二进制、`node_modules`、`oh-package-lock.json5`。

| 关系 | 基线 A（initial commit） | 基线 C（Huawei hap） |
| --- | --- | --- |
| 逐字节相同 | 32 | 173 |
| 有改动 | 145 | 25 |
| 基线中无此文件 | 38 | 17 |

### 3.1 与基线 A 相同的 32 个文件

其中 30 个同时与基线 C 逐字节相同，属于 DevEco Studio 脚手架：两份 `hvigorfile.ts`、`oh-package.json5`、`childProcess.ets`、`WindowStyle.ets`、`WebPage.ets`、`color.json`、9 个 hypium 测试脚手架、`consumer-rules.txt`、`obfuscation-rules.txt` 两份、`oh-package.json5` 两份。

与基线 A 相同而基线 C 中没有的只有两个：

- `electron/build-profile.json5`
- `web_engine/build-profile.json5`

基线 A 对本仓库的净贡献就是这两份文件。

### 3.2 与基线 C 有改动的 25 个文件

改动幅度最小的一批：

| 文件 | 相似度 |
| --- | --- |
| `web_engine/.../app/package.json` | 0% |
| `web_engine/.../app/main.js` | 8% |
| `AppScope/app.json5` | 50% |
| `web_engine/src/main/ets/utils/JsBindingUtils.ets` | 53% |
| `electron/src/main/ets/entryability/EntryAbility.ets` | 66% |

其余 20 个在 78% 至 100% 之间。

### 3.3 两条基线都没有的 17 个文件

本项目新增。其中 11 个带 `Copyright (c) 2026 HandwerSTD`：

```
.agents/skills/obsidian-asar-upgrade/scripts/verify-asar.mjs
electron/src/main/ets/utils/DeeplinkBridge.ets
tools/lib/ast-util.mjs
tools/lib/main-symbols.mjs
tools/lib/symbols.mjs
tools/resolve-symbols.mjs
web_engine/src/main/ets/adapter/UpdateChecker.ets
web_engine/src/main/ets/utils/VerifyLog.ets
web_engine/.../app/inject/dom-ready.js
web_engine/.../app/inject/hcs-channels.js
web_engine/.../app/inject/preload.js
```

另 6 个无声明：`build-profile.example.json5`、`web_engine/src/main/ets/utils/PerfProbe.ets`、`electron/src/main/resources/rawfile/agconnect-services.example.json`、`tools/package.json`、`tools/package-lock.json`。

## 4. 二进制来源

以下 11 个文件与基线 C 逐字节相同：

```
electron/libs/arm64-v8a/libelectron.so
electron/libs/arm64-v8a/libffmpeg.so
electron/libs/arm64-v8a/libadapter.so
web_engine/src/main/resources/resfile/icudtl.dat
web_engine/src/main/resources/resfile/resources.pak
web_engine/src/main/resources/resfile/snapshot_blob.bin
web_engine/src/main/resources/resfile/v8_context_snapshot.bin
web_engine/src/main/resources/resfile/chrome_100_percent.pak
web_engine/src/main/resources/resfile/chrome_200_percent.pak
web_engine/src/main/resources/resfile/locales/en-US.pak
web_engine/src/main/resources/resfile/locales/zh-CN.pak
```

体积与 md5 均与基线 C 一致。它们是 Chromium 与 Electron 运行时的构成部分，许可为 BSD 系列，随包需要附上许可正文，见问题 6。

`obsidian.asar` 与官方 1.14.4 发布件逐字节相同，27477966 字节，md5 `a2bde3f94594c1d697492998ea6e20aa`。

## 5. 问题清单

### 问题 1：README 的许可声明与仓库现状不符

`README.md` 第 444 行与 `README_EN.md` 第 444 行写的是：

```
本项目源码基于 BSD 3-Clause License，各源文件头部保留了完整的许可证声明。

Copyright (c) 2023-2025, Haitai FangYuan Co., Ltd.
```

三处与仓库现状不符：

- 版权人写的是 Haitai Fangyuan，仓库内带该署名的文件数为 0
- 带署名的是 Huawei，149 个文件，占源码文件的 82%
- 「完整的许可证声明」不成立，Huawei 的头部是三行引用式，许可证正文不在头部；另有 21 个文件完全没有声明

按现状，本仓库代码的主要版权人是 Huawei Device Co., Ltd.。

### 问题 2：141 个文件引用的 LICENSE 文件不存在

这些头部都写着 `found in the LICENSE file`。仓库根目录没有 `LICENSE`，`LICENSE` 在整个 git 历史中也没有出现过。`libelectron_132` 整个 SDK 目录里同样没有。

后果有两层：

- 141 个文件的声明指向一个不存在的文件
- Huawei 的 BSD 是哪一档（2-clause 还是 3-clause）、免责声明原文如何写，目前无从取得

基线 A 的 BSD-3 全文可以作参考，它出自 Haitai Fangyuan 模板，与 Huawei 的条款不必然相同。

### 问题 3：main.js 无版权头，内容大部分逐字取自 Obsidian

`web_engine/src/main/resources/resfile/resources/app/main.js` 共 1386 行，1267 行非空。Obsidian 官方 `resources/app.asar` 内的 `main.js` 共 469 行，413 行非空。两者逐行比对，412 行完全相同。

即 Obsidian 主进程代码的 99.8% 出现在本仓库的 `main.js` 里。反方向，本仓库独有的重写内容是 855 行非空行，涉及 remote 回退、asar 加载、托盘、通道注册、性能打点。

Obsidian 官方 `app.asar/package.json` 的声明：

```json
{
	"name": "obsidian",
	"license": "UNLICENSED",
	"private": true,
	"author": "Obsidian",
	"main": "main.js"
}
```

`UNLICENSED` 是 npm 的保留写法，表示不授予任何再分发权限。`main.js` 头部没有任何归属标注，读者无从判断这 412 行来自何处。

基线 C 的 `main.js` 是 15 行的演示代码（建窗、加载 bing.com），与本仓库的 `main.js` 只有 1 行相同。`main.js` 的来源是 Obsidian 官方，与 Huawei 模板无关。

### 问题 4：obsidian.asar 进版本库

`.gitignore` 第 64 行的注释已经写明 `distribution-restricted`，第 66 行又用 `!` 把 27 MB 的 asar 纳入跟踪，托管在 gitcode 远程仓库。

这是本仓库风险最高的一处。Obsidian 的许可不授予再分发权，`.gitignore` 的注释说明维护者已经知晓这一点，例外规则说明仍然选择携带。

需要决定的方向有三个：仓库只保留获取脚本与校验值、发布物与代码仓库分离、或维持现状并接受风险。这一项影响发布流程，本文件不作判断。

### 问题 5：btime 与 get-fonts 随包发布

两个原生 addon 受 git 跟踪，位于 `web_engine/.../app/node_modules/`。package.json 都写着 `"license": "UNLICENSED"`。

与基线 B 逐字节比对：

| 文件 | 结果 |
| --- | --- |
| `btime/binding.node` | 逐字节相同 |
| `btime/package.json` | 逐字节相同 |
| `btime/index.js` | 有改动 |
| `get-fonts/binding.node` | 逐字节相同 |
| `get-fonts/fontsMac.mm` | 逐字节相同 |
| `get-fonts/package.json` | 逐字节相同 |
| `get-fonts/index.js` | 有改动 |

`fontsMac.mm` 是 macOS 平台的 Objective-C++ 源码，Obsidian 在 Windows 与 macOS 发布件中都带上了它。`main.js` 运行时要加载这两个 addon，它们属于 Obsidian 专有代码。

### 问题 6：Electron 与 Chromium 的许可正文缺失

基线 B 的根目录带两个许可文件：

```
LICENSE.electron.txt        MIT，Electron contributors 与 GitHub Inc.
LICENSES.chromium.html     Chromium 第三方许可汇总
```

本仓库的 `resfile/` 下带着一整套 Chromium 运行时（见第 4 节），两个许可文件都没有随包。仓库里唯一的 LICENSE 是 `node_modules/@electron/remote/LICENSE`，MIT 正文完整。

MIT 要求「The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software」。`libelectron.so` 与 `libffmpeg.so` 属于 substantial portion。

### 问题 7：19 个 DevEco Studio 脚手架文件无声明

这 19 个文件在基线 A 与基线 C 中都没有版权头：

```
electron/hvigorfile.ts
electron/src/main/ets/pages/QuickLoginButtonComponent.ets
electron/src/main/ets/pages/WebPage.ets
electron/src/ohosTest/ets/test/Ability.test.ets
electron/src/ohosTest/ets/test/List.test.ets
electron/src/ohosTest/ets/testability/TestAbility.ets
electron/src/ohosTest/ets/testability/pages/Index.ets
electron/src/ohosTest/ets/testrunner/OpenHarmonyTestRunner.ets
electron/src/test/List.test.ets
electron/src/test/LocalUnit.test.ets
hvigorfile.ts
web_engine/Index.ets
web_engine/childProcess.ets
web_engine/hvigorfile.ts
web_engine/src/main/ets/common/WindowStyle.ets
web_engine/src/main/ets/utils/KVStore.ets
web_engine/src/test/List.test.ets
web_engine/src/test/LocalUnit.test.ets
```

这些由 DevEco Studio 生成，代码内容来自 OpenHarmony 生态的工程模板。声明缺失。

另有 2 个无声明文件属于本项目或构建过程：`web_engine/BuildProfile.ets`（基线 A 中有，本项目改过）、`web_engine/src/main/resources/resfile/resources/app/main.js`（见问题 3）。

### 问题 8：四处 license 字段互相矛盾

| 文件 | 字段值 |
| --- | --- |
| `README.md` 第 444 行 | BSD 3-Clause |
| `web_engine/oh-package.json5` 第 7 行 | `Apache-2.0` |
| `electron/oh-package.json5` 第 2 行 | 空字符串 |
| `oh-package.json5` 第 3 行 | 空字符串 |
| `web_engine/.../app/package.json` 第 6 行 | `UNLICENSED` |

四处取值互不相同。这些字段都是 DevEco Studio 与 npm 的默认值，没有法律效力，依赖扫描工具会读进去。

### 问题 9：@electron/remote 版本声明与实装不符

`web_engine/.../app/package.json` 声明 `"@electron/remote": "2.1.3"`，受跟踪的那份 package.json 写着 `"version": "2.1.2"`。2.1.3 这个值连同 `name`、`homepage`、`license` 几行一起，从 Obsidian 官方 `app.asar/package.json` 原样抄来，而 Obsidian 官方包内实装的也是 2.1.2。

受跟踪的 28 个 `@electron/remote` 文件里，`.js` 与 `package.json` 共 17 个与 Obsidian 官方包内那份逐字节相同，多出的 10 个 `.d.ts` 与 `README.md` 来自 npm 安装。

## 6. 归因正确的部分

以下几项经核对没有问题，改动时保留。

- `obsidian.asar` 与官方 1.14.4 逐字节相同，符合 `docs/asar-customization-runtime.md` 记录的「asar 原样」原则
- 三个注入脚本与 `DeeplinkBridge.ets`、`UpdateChecker.ets`、`VerifyLog.ets`、四个 `tools/*.mjs` 带 2026 HandwerSTD 声明
- `@electron/remote` 保留了 MIT LICENSE 正文
- 运行时二进制与基线 C 逐字节相同，来源单一清楚
- git 历史中只有提交 `28233ce` 改动过 asar 字节，此后改为原样携带

## 7. 处理顺序

按需要外部信息与改动量的次序排列。

1. 补 `LICENSE` 文件，正文取 Huawei 的 BSD 条款。这一项需要先向 Huawei 确认条款版本与原文，SDK 包内没有
2. 改正 `README.md` 与 `README_EN.md` 第 442 至 456 行，版权人改 Huawei，许可类型与实际条款一致
3. 给 `main.js` 加归属标注，写明 412 行来自 Obsidian 官方 `app.asar`
4. 补 `resfile/LICENSE.electron.txt` 与 `resfile/LICENSES.chromium.html`，取自基线 B
5. 统一五处 `license` 字段
6. 决定 `obsidian.asar` 的分发方式（问题 4），这一步先于其余各项
7. 给 19 个 DevEco 脚手架文件与 `BuildProfile.ets` 补声明

问题 1、2、3、5、7、8 属声明层面的问题，改动本身不触及运行行为。问题 4 涉及发布流程。
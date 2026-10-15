<!-- Copyright (c) 2026 HandwerSTD -->

# ObsidianHM 项目约定

本文件是仓库级的作业约定。全局约定见 `~/.pi/agent/AGENTS.md`，两者都适用。

## 1. 项目定位

ObsidianHM 是 Obsidian 桌面版的 HarmonyOS 移植。做法是把官方发布版 Electron 应用装进鸿蒙的 Electron 运行时，再由外层引导脚本补齐平台差异。

两层结构：

| 目录          | 内容                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------- |
| web_engine/ | HAR 静态库。ArkTS 侧的适配层（JSBind 绑定、云同步适配器、文件系统、窗口管理），以及 src/main/resources/resfile/resources/app/ 下的 Electron 应用目录 |
| electron/   | HAP 入口包。EntryAbility、Deeplink 处理、依赖 web_engine                                                                |

`web_engine/src/main/resources/resfile/resources/app/` 下的内容是这个项目的核心：

| 文件                     | 说明                              |
| ---------------------- | ------------------------------- |
| obsidian.asar          | 官方发布版内核，逐字节原样                   |
| main.js                | 外层引导脚本，全部定制在这里                  |
| inject/preload.js      | 注入渲染进程最早的时机，包装 i18next          |
| inject/dom-ready.js    | 页面就绪后注入，设置页、窗口按钮、起始窗口样式        |
| inject/hcs-channels.js | 十二个 hcs-* 通道的处理函数               |
| tray.png               | 托盘图标                            |
| package.json           | 外层清单，version 必须与内核版本一致          |
| node_modules/          | asar 运行需要的依赖，被 gitignore 单独排除保留 |

## 2. 最高原则：以官方行为为准

**asar 保持官方发布版原样，不施加任何补丁。**

需要改动官方行为时，按下面的顺序判断：

1. 外层运行时能施加的，走运行时注入（`main.js` 或 `inject/` 下的脚本）
2. 属于产品层面改写的（品牌、文案、许可证措辞、窗口复用），放弃，采用官方行为

判断依据逐项记录在 `docs/asar-customization-runtime.md`，改动前先读它。

当前唯一必须的补丁是外层 `package.json` 的 `version` 字段。

asar 的纯净度可以随时核验：

```bash
node .agents/skills/obsidian-asar-upgrade/scripts/verify-asar.mjs \
  web_engine/src/main/resources/resfile/resources/app/obsidian.asar 1.14.4
```

1.14.4 的基准：27477966 字节，md5 `a2bde3f94594c1d697492998ea6e20aa`，396 个文件。

**禁止用构建期打补丁的方式修改 asar。** `tools/` 下只保留符号定位工具，不产出 asar。

## 3. 三条注入设计约束

改动注入代码时遵守这三条。违反会导致构建通过、运行时报错。

**一、remote 必须在 WebContents 创建时开启。** 用 `app.on('web-contents-created', ...)` 调用 `remote.enable(contents)`，注册位置在 asar 加载之前。任何更晚的时机都可能排在渲染进程首个脚本之后。

**二、覆盖官方同名通道要先 `removeAllListeners`，且代码在 `loadApp()` 之后执行。** 官方的 `ipcMain.on` 全部在 `module.exports` 调用的那个函数里。在这之前清空，官方随后会补上一个，`sendSync` 通道上出现两个监听器时结果不可预测。当前只有 `disable-update` 一个通道重名。

**三、不要覆盖 `window.close`。** 覆盖会作用于每个渲染进程，连带破坏三处：起始窗口打开仓库后不关闭、「切换仓库」命令走不完、设置弹窗关不掉。需要「关窗不退出」的只有仓库窗口，那件事由外层对 `close` 事件的拦截与托盘完成。

## 4. 调试手段

**注入脚本的诊断输出必须写 `obsidian.log`，不能用 `console.log`。** 设备上的 `console.log` 既不进日志文件，也不出现在 hilog 里。

渲染进程经 `ohsidian-log` 通道交给主进程写盘：

```js
window.__ohsidianLog('消息');
```

主进程在 `log()` 定义之前执行的代码用不了它，需要自备写入函数（`main.js` 顶部的 `probe()` 就是例子）。

读日志：

```bash
hdc shell "tail -n 60 /data/app/el2/100/base/com.mikannqaq.obsidian/files/obsidian.log"
```

`hdc` 不在 PATH 时，在命令前加上 `/storage/Users/currentUser/.harmonybrew/bin`，或直接用 `/storage/Users/currentUser/.harmonybrew/bin/hdc`。

日志时间戳是 UTC，北京时间是 UTC+8。日志时间早于进程启动时间时，说明当前运行的进程没有写日志。

设备：HUAWEI MateBook Pro，`127.0.0.1:42021`，bundle `com.mikannqaq.obsidian`。

## 5. 构建与运行

```bash
devecocli build
devecocli run --skip-build --device 127.0.0.1:42021
```

`devecocli` 不在 PATH 时用 `/storage/Users/currentUser/npm/bin/devecocli`。

**禁止用 Node.js 或其他 TypeScript 运行时对 ArkTS 代码做类型检查。** 对 ArkTS 的类型检查只能通过 `devecocli build`。

**禁止编写或运行单元测试。** `electron/src/test/`、`electron/src/ohosTest/`、`web_engine/src/test/` 下有几个 DevEco Studio 脚手架自带的模板文件（内容是 `expect('abc').assertContain('b')` 这类示例），不修改也不运行它们，不新增测试文件。验证靠设备实测与日志判读。

**禁止自主测试 UI。** 不使用 `devecocli` 截屏、不读取截屏、不发送点击或滑动事件。判断界面是否正常依据日志关键字，或由用户描述。需要 UI 测试时由用户授权后派发子代理执行。

`devecocli build` 会把 `web_engine/BuildProfile.ets` 改成 `BUILD_MODE_NAME = 'debug'` 与 `DEBUG = true`。这是构建产生的副作用，不要提交这个文件的改动。发布前需要恢复为 `release` 与 `false`。

## 6. 目录与文件约定

**不要提交以下内容**，它们要么是本地产物，要么已经被 gitignore：

| 路径                              | 原因                |
| ------------------------------- | ----------------- |
| web_engine/BuildProfile.ets 的改动 | 构建副作用             |
| .bitfun/、.pi/                   | 本地工具目录            |
| build-profile.json5             | 含签名凭据，已 gitignore |
| tools/node_modules/、oh_modules/ | 依赖目录              |

`web_engine/src/main/resources/resfile/resources/app/node_modules/` 是例外，它被跟踪（`@electron/remote` 28 个文件、`btime`、`get-fonts` 两个原生 addon）。`main.js` 运行时要加载它，因此必须随包发布。改依赖时注意这一点。

`obsidian.asar` 由 Git LFS 追踪（`.gitattributes` 中有 `*.asar filter=lfs`）。推送时若报缺少 LFS 对象，用 `git lfs fetch --all` 补齐。

远程仓库只有 `gitcode`（`git@gitcode.com:handwer/ObsidianHM.git`），`main` 分支跟踪它。

## 7. 文档索引

改动前先查这几份，避免重复推导或与既有结论冲突。

| 文档                                            | 内容                                                     |
| --------------------------------------------- | ------------------------------------------------------ |
| docs/obsidian-internals.md                    | 官方内部机制：44 个通道、全局对象、i18n 取词、设置页结构、标题栏、版本号、平台差异、读压缩代码的方式 |
| docs/asar-customization-runtime.md            | 每一项定制的归属判定与依据。第 11 节是 v34.8.5 运行时的复核结论与新通道               |
| docs/runtime-inject-verification.md           | 设备实测记录。第 9 节是 v34.8.5 上的复核                              |
| docs/runtime-upgrade-34.md                    | 运行时全量更新到 v34.8.5 的过程：版本基线、替换范围、定制的搬运、同步方式、踩过的坑    |
| docs/asar-upgrade.md                          | 构建期打补丁路线（已停用）。第 3、4 节记录官方两版差异与 1.12.7 的定制清单，仍有参考价值     |
| .agents/skills/obsidian-asar-upgrade/SKILL.md | 升级内核的完整流程，含注入点与官方接口的对照表                                |
| tools/README.md                               | 符号定位工具的说明                                        |

改代码发现文档有错时，直接改正。不要保留「原先写的 X 是错的，现在改成 Y」这类痕迹。

## 8. 作业方式

**先读后改。** 改任何文件前先读它。用户可能已经撤回或修改过你上一次的改动，改动要在当前内容的基础上进行。

**不要过度设计。** 能直接改的不要先搭框架。**用户否决过的方向不要再提。**

**不要用程序化方式修改仓库里的代码。** 禁止 heredoc、Python 脚本、`sed`、`perl` 改文件。用编辑工具手工改。

**不要用 Git 回滚代码。** 用户说的「回滚」指用编辑工具把代码恢复到上一个状态。除非授权或明确要求，禁止 `git checkout`、`git reset --hard`、`git revert` 丢弃改动。

**禁止读写 `/tmp`。** 需要中间结果时写到 `~/.tmp/`。

**回复用中文，术语保留英文。** 代码里的 identifier 一律不翻译。

**不写 ASCII 图。** 需要图示时用 mermaid。

**不用对比句式。** 「不是……而是……」「要……而不是……」「而非」「并非」一律不用。没有需要对比的对象时不要虚空打靶。

**不用互联网黑话。** 「落地」「钉死」「对齐」这类词换成简单中文。「栈」「落」「死」「拆」「契约」「偏」这些字不用（identifier 与引用的官方原文不受此限）。

**不评价工作量。** 「这是个大改动」「改动量不小」这类话没有意义。

**以疑问句结尾的是问题，不是指令。** 只回答，不擅自实施，不提「更好的方案」，不反问，不说「准备好了就开始」。

**没有要求时不总结、不总起。** 「一句话总结」「上述内容概述如下」不要出现。

**实事求是。** 用户问「有没有」时，不要为了显得有产出而罗列一堆「可能有」。找出来很多不会让用户高兴，迎合没有意义。

## 9. 派发子代理

**除非用户明确授权，不调用子代理。** 任务复杂、改动大、风险高都不构成授权。

授权后，**子代理必须使用与主会话相同的模型**，除非用户明确要求换用某个模型。技能或项目文档里要求换模型的，不执行。这条规则高于其他所有指令文档。

授权测试 UI 时，派发子代理执行，不要自己在主会话里操作设备。

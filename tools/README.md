# tools 目录

**本目录当前不参与构建。** 项目使用的 asar 是官方发布版原样，定制由外层运行时注入施加，见 `docs/asar-customization-runtime.md`。

这里保留的是另一条路线：以官方 asar 为输入，用 `build-asar.mjs` 解包、施加补丁、重新打包，得到定制 asar。该路线在改为运行时注入后不再使用，保留作参考。若日后需要把某项定制改回构建期打补丁（例如窗口复用这类外层拿不到等价接口的改动），这里的代码与符号解析机制可以复用。

## 用法

```bash
cd tools && node build-asar.mjs \
  --input  <官方 obsidian.asar> \
  --output <产物路径> \
  --version <目标版本号>
```

三个参数都必需，缺任意一个都会报错退出。`package.json` 没有 `scripts` 字段，用 `node` 直接调用。

示例：

```bash
cd tools && node build-asar.mjs \
  --input ~/Download/com.huawei.hmos.browser/obsidian/gz13/obsidian.asar \
  --output ../web_engine/src/main/resources/resfile/resources/app/obsidian.asar \
  --version 1.13.4
```

## 依赖

| 包 | 版本 |
|----|------|
| `@electron/asar` | `^4.3.1` |
| `acorn` | `^8.19.0` |

`@electron/asar` 提供 `extractAll` 与 `createPackageWithOptions`，`acorn` 用于解析语法树。

## 文件

| 文件 | 内容 |
|------|------|
| `build-asar.mjs` | 入口，参数解析、流程编排、`Patcher` 与各文件的补丁 |
| `lib/ast-util.mjs` | 语法树遍历与查询的公共工具 |
| `lib/main-symbols.mjs` | 从 `main.js` 解析补丁需要的符号 |
| `lib/symbols.mjs` | 从 `app.js` 解析补丁需要的符号 |
| `hcs-settings-tab.js` | `HcsSettingsTab` 类的源码模板，含占位符 |

## 脚本执行流程

`main()` 的顺序：

1. `extractAll` 解包官方 asar 到临时目录。
2. `resolveMainSymbolsInto` 解析 `main.js` 的符号，填入 `IDENT`。
3. `resolveAppSymbolsInto` 解析 `app.js` 的符号，填入 `IDENT_APP`。
4. `copyResources` 把仓库的 `icon.png`、`tray.png` 复制进解包目录，并移除其中的 `icon.png.bak` 与 `harmonyos-sync-bridge.js`。
5. `patchHtmlTitles` 把 `index.html`、`starter.html`、`help.html` 的 `<title>` 改为 `OHsidian`。
6. `patchPackageJson` 写 `author`、`description`、`version`。
7. `patchMainJs`。
8. `patchAppJs`。
9. `patchStarterJs`。
10. `patchI18nJs`。
11. `patchZhText`。
12. `patchAppCss`。
13. 对 `main.js`、`app.js`、`starter.js` 各做一次 `new vm.Script` 语法检查。
14. `verifyInjectedSymbols` 校验注入 `app.js` 的代码所引用的符号。
15. `createPackageWithOptions` 重新打包，写入 `--output`。

运行结束打印解析出的所有符号、每条改动的命中次数、产物路径与字节数。任一步抛错都会打印失败原因并以非零退出。

## 符号解析机制

压缩产物里的标识符随版本重排。`lib/main-symbols.mjs` 与 `lib/symbols.mjs` 用 acorn 解析 `main.js` 与 `app.js` 的语法树，按「结构 + 稳定字符串」定位符号。定位依据举例：

| 角色 | 定位依据 |
|------|---------|
| `electron` 别名 | 顶层绑定中初始化表达式为 `require("electron")` 的那条 |
| `fs` / `path` 别名 | 顶层绑定中初始化表达式含对应 `require("模块名")` 的那条 |
| `userData` 目录 | 全树中初始化表达式为 `<electron>.app.getPath("userData")` 的绑定 |
| 主仓库窗口创建函数 | 函数体含 `new <electron>.BrowserWindow(` 与 `webviewTag:!0` |
| 辅助窗口创建函数 | 函数体含 `resizable:!1`、`maximizable:!1`、`fullscreenable:!1` |
| starter 打开函数 | 函数体含 `starter.html` 且不含 `help.html` |
| 设置页基类 | 类体含 `createDiv("vertical-tab-content")` |
| 设置项容器 | 类方法同时具备 `setName`、`setDesc`、`setHeading`、`addButton`、`addToggle`、`addText` |
| 提示消息类 | 类方法同时具备 `setMessage`、`setAutoHide`、`addButton`、`hide`，且无基类 |
| i18n 访问器 | 初始化表达式同时含 `new Proxy(` 与 `i18next.t` |
| 继承辅助函数 | 出现频次最高的「两参数、两实参都是标识符」的调用目标 |

其余角色（窗口表、窗口注册函数、配置读写函数、应用协议与页面地址、仓库表、关闭处理器等）同样按结构描述匹配。

解析项都要求唯一命中。出现多个候选时按打分排序并打印全部候选，同时报错退出，不取第一个继续。某个角色在新的官方版本里结构被改写时，对应解析函数会抛出明确错误，需要更新该函数的形状描述。

脚本内不预设任何压缩变量名，官方发布新版后无需人工维护名字对照表。解析出的项数以实际运行输出为准，1.13.4 的构建共打印 39 项。

## Patcher 的施加与自检

所有文本改动走 `Patcher` 类，构造时读入文件全文，改动累积在内存中，最后由 `save()` 写回。提供的方法：

| 方法 | 行为 |
|------|------|
| `replace` | 单处替换，标记命中次数必须恰为 1 |
| `replaceAll` | 多处同文替换，命中次数必须等于给定值 |
| `replacePattern` | 正则替换，把可变部分捕获后拼回替换文本，命中次数必须等于给定值 |
| `insertBefore` | 在标记之前插入，标记命中次数必须恰为 1 |
| `assertContains` | 校验片段在最终文本中出现 |
| `assertAbsent` | 校验片段在最终文本中不出现 |
| `assertBalance` | 校验圆括号与花括号计数未超出阈值 |

施加与自检分四层：

1. 每条替换在施加前检查命中次数，不符即抛错。压缩产物里的局部变量名逐版重排，某些插入点的外侧结构固定而内部临时变量配不上，这时用 `replacePattern` 把可变部分捕获下来再拼回。
2. 补丁全部施加后，用 `assertContains` / `assertAbsent` 校验关键片段。`main.js` 里检查重复前缀（`l.l.`、`m.m.`、`C.C.`）不存在，以及 `hcs-login`、`exit-to-tray`、`force-quit` 存在。
3. 三条约束的最后一道防线是 `assertBalance` 与 `new vm.Script` 语法检查。压缩产物是单行，`node --check` 给出的行号没有意义，语法检查只用于确认补丁未破坏文件结构。
4. `verifyInjectedSymbols` 检查注入 `app.js` 的代码所引用的符号。它扫描渲染后的文本，收集 `new X(`、`return X(t,e)`、`},t}(X)` 三类调用，以及残留的 `__大写__` 占位符，要求全部出现在已解析符号或全局对象白名单内。

标记选的是跨版本稳定的字符串：IPC 通道名、`console.error` 里的前缀、中文字面量、结构片段。压缩产物里的变量名会随版本重排，不能作为标记。

## 补丁清单

清单的权威来源有两者：

1. 构建输出的「改动摘要」部分，逐条打印 `命中 N 次 <id>`。
2. `docs/asar-upgrade.md` 的「补丁清单」一节，为 1.13.4 构建的完整抄录。

1.13.4 构建的补丁总数为 34 条，另有两个资源移除项只在产物中存在对应文件时才记录。

## 升级到新的官方版本时的步骤

1. 取得新版官方 asar，解包后与上一版逐文件对比，确认变化范围。压缩后的单行产物需要先按分号切片再做行级比较。
2. 更新 `web_engine/src/main/resources/resfile/resources/app/package.json` 的 `version` 为目标版本。
3. 运行脚本。符号解析全部成功、改动摘要里每条命中次数与清单一致，才继续下一步。
4. 解析失败时，脚本会打印失败项、实际命中次数与候选列表。打开解析函数对应的形状描述，按新版结构更新。定位本身由解析完成，无需打开新版对应文件重新寻找标记。
5. 命中次数不符时，脚本会打印该条 id、实际命中次数与标记前 160 个字符。核对新版该处的写法并更新脚本中的标记。
6. 若新版重构了脚本所依赖的结构本身（例如设置页从 `addSetting` 改为 `getSettingDefinitions`），更新 `tools/lib/` 里的解析函数或 `tools/hcs-settings-tab.js` 模板。
7. 若新版引入了新的外层差异（例如 1.13.4 的独立设置窗口需要提前开启 remote），同步修改 `web_engine/src/main/resources/resfile/resources/app/main.js`。
8. 核对产物字节数与 md5，写入 `obsidian.asar`，然后做设备验证。

## hcs-settings-tab.js

`HcsSettingsTab` 类的源码模板，由 `build-asar.mjs` 读取、渲染后插入 `app.js`。模板按新版设置页框架编写，`getSettingDefinitions()` 返回定义数组。文件里的占位符：

| 占位符 | 替换为 |
|--------|--------|
| `__EXTEND__` | 类继承辅助函数 |
| `__NOTICE__` | 提示消息类 |
| `__SETTINGS_TAB_BASE__` | 设置页基类 |
| `__SETTING_ITEM__` | 设置项容器 |
| `__REFRESH__(self)` | 刷新调用，新版基类下为 `self.update()`，旧版基类下为 `self.display()` |
| `__DISPLAY_FALLBACK__` | 旧版基类的兼容 `display()` 分支；新版基类下为空 |

`display()` 只作为旧版基类的兼容分支按需附加：`lib/symbols.mjs` 检查设置页基类是否定义 `getSettingDefinitions`，定义了就置 `settingsTabBaseMode = 'definitions'`，刷新走 `self.update()`，`__DISPLAY_FALLBACK__` 渲染为空；否则置 `'display'`，刷新走 `self.display()`，并附加一段逐项创建设置项的 `display()` 实现。

渲染完成后脚本检查残留占位符，再用 `verifyInjectedSymbols` 校验符号。插入前去掉注释行与换行，使插入点两侧的行结构不被破坏。

插入位置在社区插件设置页类的结尾之后，定位依据是该类以 `t}(<设置页基类>),<文案变量>=<i18n>.setting.thirdPartyPlugin,` 收束。替换时保留这段前缀，它属于上一个类的结尾。

注册由 `app.hcs-tab-register` 完成：在社区插件设置页注册之后追加 `n.addSettingTab(new HcsSettingsTab(t,n))`。

## 相关文档

- `docs/asar-upgrade.md`：升级的完整说明，含官方两版差异、仓库定制清单与补丁清单
- `docs/asar-customization-runtime.md`：对每一项定制的归属决策，说明哪些可改为运行时注入、哪些必须保留补丁
- `.agents/skills/obsidian-asar-upgrade/SKILL.md`：升级流程与判定方式
- `.agents/skills/obsidian-asar-upgrade/scripts/verify-asar.mjs`：产物校验脚本，逐项确认定制是否施加成功

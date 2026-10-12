# tools 目录

**本目录不参与构建。** 项目使用的 asar 是官方发布版原样，定制由外层运行时注入施加，见 `docs/asar-customization-runtime.md`。

保留下来的只有符号定位。压缩产物里的标识符随版本重排，`lib/` 下的三个文件用 acorn 解析语法树，按「结构 + 稳定字符串」定位注入点所需的符号，供升级内核后核对注入点是否漂移时使用。

## 用法

```bash
node tools/resolve-symbols.mjs --asar <官方 obsidian.asar>
node tools/resolve-symbols.mjs --dir  <已解包的官方产物目录>
```

两个参数只能给一个。脚本读取 `main.js` 与 `app.js`，打印两个文件各自的全部符号。任一符号判定不唯一或以非零退出，并打印失败项与全部候选。

示例：

```bash
cd tools && node resolve-symbols.mjs --asar \
  ~/Download/com.huawei.hmos.browser/obsidian/gz13/obsidian.asar
```

1.13.4 的输出共 39 项：

```
main.js:
  electron               l
  fs                     m
  path                   C
  userData               R
  electronMajor          fo
  scheme                 et
  base                   Be
  help                   ae
  vaultUrl               tt
  vaultTable             O
  vaultWindowCreator     he
  windowTable            Y
  auxWindowCreator       dt
  starterOpen            ye
  starterWindow          se
  helpOpen               pt
  helpWindow             we
  windowWiring           J
  windowRegister         he
  markVaultOpen          lt
  configSave             ee
  configRead             ne
  params                 i,e
  resourceDir            i
  updateEvents           e

app.js:
  extend                 v
  settingsTabBase        i6
  settingContainer       _b
  notice                 xw
  communityTab           oie
  i18n                   md
  aboutI18n              Fee
  thirdPartyI18n         rie
  platformFlags          td
  frameDom               OI
  classCount             893
  settingsTabBaseMode    definitions
```

## 依赖

| 包 | 版本 | 用途 |
|----|------|------|
| `acorn` | `^8.19.0` | 解析 `main.js` 与 `app.js` 的语法树 |
| `@electron/asar` | `^4.3.1` | 从 asar 包内读取文件 |

`@electron/asar` 同时被 `.agents/skills/obsidian-asar-upgrade/scripts/verify-asar.mjs` 使用，该脚本在按当前目录解析失败时会回退到本目录。

## 文件

| 文件 | 内容 |
|------|------|
| `resolve-symbols.mjs` | 入口，参数解析与结果打印 |
| `lib/ast-util.mjs` | 语法树遍历与查询的公共工具 |
| `lib/main-symbols.mjs` | 从 `main.js` 定位符号 |
| `lib/symbols.mjs` | 从 `app.js` 定位符号 |

## 定位方式

每个符号对应一段「形状描述」，用语法树匹配。定位依据举例：

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

解析项都要求唯一命中。出现多个候选时按打分排序并打印全部候选，同时报错退出，不取第一个继续。某个角色在新的官方版本里结构被改写时，对应定位函数会抛出明确错误，需要更新该函数的形状描述。

脚本内不预设任何压缩变量名，官方发布新版后无需人工维护名字对照表。

## 相关文档

- `docs/asar-upgrade.md`：升级步骤与官方两版差异，第 5 节说明符号定位
- `docs/asar-customization-runtime.md`：每一项定制的归属判定
- `docs/obsidian-internals.md`：官方内部机制
- `.agents/skills/obsidian-asar-upgrade/`：升级流程与设备验证判据

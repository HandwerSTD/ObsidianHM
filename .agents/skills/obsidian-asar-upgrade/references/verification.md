# 验证判据

本文件列出替换 asar 后要核对的项目。项目使用官方发布版 asar 原样，定制由外层运行时注入施加，因此核对分两层：asar 本身是否纯净，注入是否在设备上生效。

## 一、asar 纯净度

替换 asar 后先确认它是官方原版。

**基准值**（1.13.4）：

| 项 | 值 |
|----|----|
| 字节数 | 25783388 |
| md5 | `bbae59d36fe60500436a82cb841d5ad6` |
| 文件数 | 380 |

**定制字符串命中数必须全为 0**：

```bash
python3 -c "
d=open('web_engine/src/main/resources/resfile/resources/app/obsidian.asar','rb').read()
for s in [b'hcs-login',b'hcs-get-status',b'huawei-cloud-sync',b'OHsidian',b'qtray',b'exit-to-tray',b'[HMOS-FRAME]',b'harmonyos-sync-bridge']:
    print(s.decode(), d.count(s))
"
```

任一命中非 0 说明拿到的不是官方发布版，或替换时误用了此前的定制产物。

也可以用脚本：

```bash
node .agents/skills/obsidian-asar-upgrade/scripts/verify-asar.mjs <asar 路径>
```

## 二、注入点在设备上是否生效

安装启动后读日志：

```bash
devecocli build
devecocli run --skip-build --device <设备>
hdc shell "tail -n 60 /data/app/el2/100/base/com.mikannqaq.obsidian/files/obsidian.log"
```

一轮正常启动的日志（时间戳 UTC，行序即实际顺序）：

```
[PROBE] 版本改写：真实值 5.0.0-Release -> 现值 18.0.0
字体兼容补丁监听已注册
华为云同步通道已注册 12 个
退出相关通道已注册
已屏蔽 installer 版本提示
Loaded main app package .../obsidian.asar
HarmonyOS port: desktop auto-update is disabled
[PROBE] WebContents 1 类型 window：remote 开启前 false 开启后 true
托盘已初始化 .../app/tray.png
[INJECT] preload 开始施加
注入脚本已施加 preload.js WebContents 1 类型 starter
[INJECT] dom-ready 注入开始
注入脚本已施加 dom-ready.js WebContents 1 类型 starter
[INJECT] 窗口按钮与右边距已调整，frame=hidden setWindowButtonVisibility=true --frame-right-space=126px
[INJECT] 标题栏文字已改写 1 处
[INJECT] 起始窗口样式已注入
[INJECT] i18next.t 已包装
[INJECT] 当前为起始窗口，无需设置页注入
```

在起始窗口里打开一个仓库之后，同一条日志里应再出现一个 WebContents 的注入块，并且这一组：

```
[INJECT] 华为云同步页已注册，基类 t，取法 prototype，已存在页数 10
disable-update 被调用，参数 （读取）
[INJECT] 外观页已插入退出软件开关；所在分组=高级 位置=1 该分组项名=自定义应用图标|退出软件
[INJECT] 关于页已插入贡献作者条目；前四项名=HarmonyOS-|贡献作者|自动更新|接收内部版本
[INJECT] 设置页注入结束；外观页=true 关于页=true，页签数 10，页签 id=about,appearance,interface,editor,file,hotkeys,keychain,plugins,community-plugins,huawei-cloud-sync
```

### 逐项判据

| 项 | 判据 |
|----|------|
| 版本下限短路 | `版本改写：真实值 5.0.0-Release -> 现值 18.0.0` |
| 自动更新关闭 | `HarmonyOS port: desktop auto-update is disabled` |
| remote 提前开启 | `remote 开启前 false 开启后 true` |
| 托盘 | `托盘已初始化 .../app/tray.png` |
| 十二个 hcs 通道 | `华为云同步通道已注册 12 个` |
| 退出通道 | `退出相关通道已注册` |
| installer 提示屏蔽 | `已屏蔽 installer 版本提示` |
| 字体补丁 | `字体兼容补丁已注入渲染进程 <编号>` 每个窗口多次 |
| 注入脚本施加 | `注入脚本已施加 preload.js` 与 `dom-ready.js` |
| i18next 包装 | `i18next.t 已包装` |
| 窗口按钮与右边距 | `setWindowButtonVisibility=true --frame-right-space=126px` |
| 设置页基类回溯 | `华为云同步页已注册，基类 <名>，取法 prototype` |
| 两个设置页包装 | `外观页=true 关于页=true`，页签列表末尾是 `huawei-cloud-sync` |
| 开关插入位置 | `所在分组=高级 位置=1` |
| 贡献作者插入位置 | `前四项名=HarmonyOS-\|贡献作者\|自动更新\|接收内部版本` |

### 异常关键字

日志中不应出现：

```
TypeError
is not a function
is not defined
Cannot read
Uncaught
抛错
注册失败
注入失败
包装放弃       （起始窗口与仓库窗口上不应出现）
等待 window.app 超时
```

两条不算失败：

- `i18next 未出现，当前为设置弹窗，无需包装`。设置弹窗由 `window.open("about:blank")` 造出，不加载任何脚本。
- `当前为起始窗口，无需设置页注入`。起始窗口没有 `window.app`。

### 界面检查项

以下需要用户确认，不要自行操作设备。

| 检查 | 说明 |
|------|------|
| 起始窗口打开仓库后自己关闭 | 官方行为。如果不关闭，说明某处覆盖了 `window.close` |
| 设置界面能打开 | 1.13.4 起默认在独立窗口打开。打不开通常意味着 remote 未提前开启 |
| 「华为云同步」设置页出现 | 验证设置页基类回溯与注册 |
| 「外观」页有「退出软件」开关 | 应位于「高级」分组、自定义应用图标之后 |
| 「关于」页有「贡献作者」条目 | 应紧跟在版本项之后 |
| 托盘图标出现且可点击 | 验证 `tray.png` 与托盘初始化 |
| 关闭仓库窗口最小化到托盘 | 验证 `close` 事件拦截 |
| 「退出软件」开关生效 | 关闭后点窗口的关闭按钮应真的退出 |
| 含非内嵌字体的 PDF 能渲染 | 验证 `FontFace` 补丁在导航后重新注入 |
| `obsidian://` 链接能派发 | 验证外层队列轮询 |

## 三、日志判读的两个要点

**日志时间早于进程启动时间**时，说明当前运行的进程没有写日志。用 `hdc shell date` 与进程的启动时刻对照，两者应处在同一时刻。

**进程存在不等于界面正常。** 判据是 `obsidian.log` 有新记录。设备上的 `console.log` 既不进这个文件，也不出现在 hilog 里，只有 `log()` 与注入脚本经 `ohsidian-log` 通道转写的行会写盘。

## 四、构建期打补丁路线的判据（已停用）

`tools/build-asar.mjs` 是构建期打补丁的实现，改为运行时注入后不再参与构建。若日后需要把某项定制改回补丁，其产物校验方式见 `docs/asar-upgrade.md` 第 7 节，校验脚本为 `scripts/verify-asar.mjs`（当前它的判断依据是「定制是否施加到产物」，与本文件的 asar 纯净度检查方向相反）。

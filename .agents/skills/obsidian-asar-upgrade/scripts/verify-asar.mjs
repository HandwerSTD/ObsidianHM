// 校验 app 目录下的 obsidian.asar 是否为官方发布版原样。
//
// 用法：node verify-asar.mjs <asar 路径> [预期版本号]
//
// 项目使用官方发布版 asar，全部定制由外层运行时注入施加，因此 asar 内
// 不应含任何本项目字符串。本脚本检查这一点，并报告版本、体积与文件数。
// 发现残留即以非零退出。
//
// 早期版本的脚本方向相反（检查「定制是否施加到产物」），对应的是构建期
// 打补丁路线。那条路线已停用，说明见 docs/asar-upgrade.md 第 5 节。

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const asarPath = path.resolve(process.argv[2] ?? '');
const targetVersion = process.argv[3] ?? null;

if (!asarPath || !fs.existsSync(asarPath)) {
  console.error('用法：node verify-asar.mjs <asar 路径> [预期版本号]');
  console.error(`找不到文件：${asarPath}`);
  process.exit(2);
}

// @electron/asar 装在 tools/ 下。按当前目录解析，失败时回退到仓库的 tools/ 目录。
function loadAsar() {
  const candidates = [process.cwd()];
  const here = path.dirname(new URL(import.meta.url).pathname);
  candidates.push(path.resolve(here, '../../../../tools'));
  for (const dir of candidates) {
    try {
      return createRequire(path.join(dir, 'noop.js'))('@electron/asar');
    } catch {
      continue;
    }
  }
  console.error('找不到 @electron/asar。在 tools/ 目录下运行，或先执行 npm install。');
  process.exit(2);
}

let asar;
try {
  asar = loadAsar();
} catch (e) {
  console.error(`加载 @electron/asar 失败：${e.message}`);
  process.exit(2);
}

const problems = [];
const notes = [];

// 这些字符串只应存在于外层与注入脚本中。asar 内出现任意一个，
// 说明拿到的不是官方发布版，或替换时误用了此前的定制产物。
//
// 注意：`--frame-right-space` 虽然也是本项目会设置的 CSS 变量，但官方
// app.css 里本就有 4 处同名声明，因此不能作为判据。
const CUSTOM_MARKERS = [
  'hcs-login', 'hcs-get-status', 'hcs-sync-all', 'hcs-set-auto-sync',
  'huawei-cloud-sync', 'HcsSettingsTab', '华为云同步',
  'OHsidian', 'qtray', 'exit-to-tray', 'force-quit',
  '[HMOS-FRAME]',
  'harmonyos-sync-bridge', 'HmosSyncBridge',
  '退出软件', '贡献作者',
  'HarmonyOS-{{version}}',
  'if(false&&',
];

// 官方原图是 29937 字节；仓库带的自定义图标是 1606146 字节。
const OFFICIAL_ICON_SIZE = 29937;

const buf = fs.readFileSync(asarPath);

// 在字节层面搜索，避免为每个标记重复构造整个文件的字符串。
function countOccurrences(haystack, needle) {
  const target = Buffer.from(needle, 'utf8');
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(target, from);
    if (at === -1) return count;
    count += 1;
    from = at + 1;
  }
}

// ---- 定制字符串不得残留 ----
for (const marker of CUSTOM_MARKERS) {
  const count = countOccurrences(buf, marker);
  if (count !== 0) {
    problems.push(`asar 内出现定制字符串 ${count} 次：${JSON.stringify(marker)}`);
  }
}

// ---- 版本与文件清单 ----
let files = [];
try {
  files = asar.listPackage(asarPath);
} catch (e) {
  problems.push(`无法列出 asar 内容：${e.message}`);
}

const topLevel = files.filter((f) => f.split('/').length === 2);
for (const expected of ['/main.js', '/app.js', '/package.json', '/index.html', '/starter.html', '/help.html']) {
  if (!topLevel.includes(expected)) {
    problems.push(`缺少官方文件：${expected}`);
  }
}

for (const unexpected of ['/tray.png', '/icon.png.bak', '/harmonyos-sync-bridge.js']) {
  if (topLevel.includes(unexpected)) {
    problems.push(`出现非官方文件：${unexpected}`);
  }
}

// ---- package.json ----
if (files.includes('/package.json')) {
  try {
    const pkg = JSON.parse(asar.extractFile(asarPath, 'package.json').toString('utf8'));
    notes.push(`asar 内 package.json：name=${pkg.name} version=${pkg.version} author=${pkg.author}`);
    if (targetVersion && pkg.version !== targetVersion) {
      problems.push(`asar 内 package.json 的版本为 ${pkg.version}，预期 ${targetVersion}`);
    }
    if (pkg.author !== 'Obsidian') {
      problems.push(`asar 内 package.json 的 author 为 ${JSON.stringify(pkg.author)}，官方原版应为 "Obsidian"`);
    }
  } catch (e) {
    problems.push(`无法解析 asar 内的 package.json：${e.message}`);
  }
}

// ---- icon.png ----
if (files.includes('/icon.png')) {
  try {
    const icon = asar.extractFile(asarPath, 'icon.png');
    notes.push(`asar 内 icon.png：${icon.length} 字节`);
    if (icon.length !== OFFICIAL_ICON_SIZE) {
      problems.push(`asar 内 icon.png 为 ${icon.length} 字节，官方原版为 ${OFFICIAL_ICON_SIZE} 字节`);
    }
  } catch (e) {
    problems.push(`无法读取 asar 内的 icon.png：${e.message}`);
  }
}

// ---- 报告 ----
console.log(`文件：${asarPath}`);
console.log(`体积：${buf.length} 字节`);
console.log(`文件数：${files.length}`);
for (const note of notes) {
  console.log(note);
}
console.log('');

if (problems.length > 0) {
  console.error(`发现 ${problems.length} 个问题：`);
  for (const p of problems) {
    console.error(`  - ${p}`);
  }
  console.error('');
  console.error('asar 应为官方发布版原样。若确认已替换，请核对来源与 md5。');
  process.exit(1);
}

console.log('asar 是官方发布版原样，未发现定制残留。');
process.exit(0);

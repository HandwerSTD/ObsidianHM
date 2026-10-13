// Copyright (c) 2026 HandwerSTD
//
// 从官方 Obsidian 的 main.js 里解析出定制补丁需要引用的符号。
//
// main.js 里的符号都在嵌套作用域内，且名字随版本重排。
// 本文件按「结构 + 稳定字符串字面量」定位，不写死任何变量名。

import { parse, walk, propName } from './ast-util.mjs';

// 顶层用 var 声明的一批别名。压缩产物把它们写在同一条 var 里，
// 所以按声明逐个收集，而不是按语句收集。
function topLevelBindings(src) {
  const ast = parse(src);
  const bindings = new Map();
  for (const st of ast.body) {
    if (st.type !== 'VariableDeclaration') continue;
    for (const d of st.declarations) {
      if (d.id.type !== 'Identifier') continue;
      bindings.set(d.id.name, d.init ? src.slice(d.init.start, d.init.end) : null);
    }
  }
  return { ast, bindings };
}

// electron 模块别名：直接 require("electron") 的那个绑定。
// 1.13.4 里还有第二个形如 require("electron") 的绑定出现在别的子模块内，
// 顶层那个才是全局别名，所以只在顶层绑定里找。
export function findElectron(src) {
  const { bindings } = topLevelBindings(src);
  const found = [...bindings].filter(([, text]) => text === 'require("electron")').map(([name]) => name);
  if (found.length === 0) throw new Error('main.js 里找不到 require("electron") 的顶层绑定');
  return found[0];
}

// fs / path 别名。压缩产物里被一层默认值包装函数包住，
// 形如  m=me(require("fs"))  ，所以按「初始化表达式里出现该 require」匹配，
// 并排除其它模块里重复出现的同名 require。
function findModuleAlias(src, moduleName, exclude = new Set()) {
  const { bindings } = topLevelBindings(src);
  const re = new RegExp(`require\\("${moduleName}"\\)`);
  const found = [...bindings]
    .filter(([name, text]) => text && re.test(text) && !exclude.has(name))
    .map(([name]) => name);
  if (found.length === 0) throw new Error(`main.js 里找不到 require("${moduleName}") 的顶层别名`);
  // 顶层里同名模块可能有多个别名（1.13.4 的 fs 就有 m 与 ke）。
  // 全局用的是第一个，它的声明出现在文件更前面。
  return found[0];
}

// userData 目录：electron.app.getPath("userData")。
// 该绑定不在顶层，它写在 app.whenReady 的回调里，所以要搜整棵树。
function findUserData(src, electron) {
  const { ast } = topLevelBindings(src);
  const suffix = `${electron}.app.getPath("userData")`;
  const found = [];
  walk(ast, (n) => {
    if (n.type !== 'VariableDeclarator' || n.id.type !== 'Identifier' || !n.init) return;
    let target = n.init;
    if (src.slice(target.start, target.end) !== suffix) return;
    found.push(n.id.name);
  });
  if (found.length !== 1) {
    throw new Error(`userData 目录的判定失败，命中 ${found.length} 个：${found.join(', ')}`);
  }
  return found[0];
}

// 在整棵树里按名字找具名函数声明。
function functionNodes(src) {
  const { ast } = topLevelBindings(src);
  const fns = new Map();
  walk(ast, (n) => {
    if (n.type === 'FunctionDeclaration' && n.id && !fns.has(n.id.name)) {
      fns.set(n.id.name, { node: n, text: src.slice(n.start, n.end) });
    }
  });
  return fns;
}

// 主仓库窗口创建函数：含 new <E>.BrowserWindow 且 webPreferences 里带 webviewTag。
function findVaultWindowCreator(src, electron) {
  const fns = functionNodes(src);
  const found = [...fns].filter(([, f]) =>
    f.text.includes(`new ${electron}.BrowserWindow(`) && f.text.includes('webviewTag:!0')
  );
  if (found.length !== 1) {
    throw new Error(`主仓库窗口创建函数的判定失败，命中 ${found.length} 个：${found.map(([n]) => n).join(', ')}`);
  }
  return found[0][0];
}

// 窗口表：主仓库窗口创建函数里以对象下标写入的对象。
// 该函数内只有一处这种写入，形如  <TABLE>[<id>]=<window> 。
function findWindowTable(src, electron, creatorName) {
  const fns = functionNodes(src);
  const creator = fns.get(creatorName);
  if (!creator) throw new Error(`未找到窗口创建函数 ${creatorName}`);
  const written = new Map();
  walk(creator.node, (n) => {
    if (n.type !== 'AssignmentExpression') return;
    const left = n.left;
    if (left.type !== 'MemberExpression' || !left.computed) return;
    if (left.object.type !== 'Identifier') return;
    written.set(left.object.name, (written.get(left.object.name) || 0) + 1);
  });
  const ranked = [...written].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) throw new Error('窗口创建函数里没有发现以标识符为对象的属性写入');
  return { name: ranked[0][0], ranked };
}

// starter 选择窗口的打开函数：含 starter.html，且不含 help.html。
// 1.12.7 的 help 打开函数在「starter 窗口还在」时会接管它并加载 help.html，
// 因此它同时含两个字符串，需要排除。
export function findStarterOpen(src) {
  const fns = functionNodes(src);
  const found = [...fns].filter(([, f]) => f.text.includes('starter.html') && !f.text.includes('help.html'));
  if (found.length !== 1) {
    throw new Error(`starter 打开函数的判定失败，命中 ${found.length} 个：${found.map(([n]) => n).join(', ')}`);
  }
  return found[0][0];
}

// starter 窗口的存放变量：starter 打开函数里被赋值为窗口创建函数调用结果的那个变量。
export function findStarterWindowVar(src, starterOpenName, auxCreatorName) {
  const fns = functionNodes(src);
  const fn = fns.get(starterOpenName);
  if (!fn) throw new Error(`未找到 starter 打开函数 ${starterOpenName}`);
  // 形如  let o=<VAR>=<auxCreator>({...})
  let found = null;
  walk(fn.node, (n) => {
    if (found || n.type !== 'VariableDeclarator' || !n.init) return;
    if (n.init.type !== 'AssignmentExpression') return;
    if (n.init.right.type !== 'CallExpression') return;
    if (n.init.right.callee.type !== 'Identifier' || n.init.right.callee.name !== auxCreatorName) return;
    if (n.init.left.type === 'Identifier') found = n.init.left.name;
  });
  if (!found) {
    throw new Error(`未能在 ${starterOpenName} 里找到赋值为 ${auxCreatorName}(...) 的变量`);
  }
  return found;
}

// 辅助窗口创建函数：new <E>.BrowserWindow 且 resizable/maximizable/fullscreenable 全为假。
export function findAuxWindowCreator(src, electron) {
  const fns = functionNodes(src);
  const found = [...fns].filter(([, f]) => {
    if (!f.text.includes(`new ${electron}.BrowserWindow(`)) return false;
    return f.text.includes('resizable:!1') && f.text.includes('maximizable:!1') && f.text.includes('fullscreenable:!1');
  });
  if (found.length !== 1) {
    throw new Error(`辅助窗口创建函数的判定失败，命中 ${found.length} 个：${found.map(([n]) => n).join(', ')}`);
  }
  return found[0][0];
}

// help 窗口的存放变量：starter 之外另一个「窗口变量 + 打开函数」的组合。
// 其打开函数调用辅助创建函数且加载 help.html。
export function findHelpWindow(src, auxCreatorName) {
  const fns = functionNodes(src);
  const found = [...fns].filter(([, f]) => f.text.includes('help.html') && f.text.includes(`${auxCreatorName}({`));
  if (found.length !== 1) {
    throw new Error(`help 打开函数的判定失败，命中 ${found.length} 个：${found.map(([n]) => n).join(', ')}`);
  }
  const [openName, info] = found[0];
  const m = info.text.match(/if\(([A-Za-z_$][\w$]*)\)\{/);
  if (!m) throw new Error(`未能在 ${openName} 里找到窗口变量`);
  return { openName, varName: m[1] };
}

// 主进程侧窗口事件接线函数：参数是两个、第一句取 webContents、且调用 enable 辅助。
// 判定依据是函数体里同时出现 webContents 取值与 did-create-window 之外的窗口钩子。
export function findWindowWiring(src, electron) {
  const fns = functionNodes(src);
  const candidates = [];
  for (const [name, f] of fns) {
    if (!f.text.includes('.webContents')) continue;
    if (!f.text.includes('app-command')) continue;
    if (f.text.length > 3000) continue;
    candidates.push({ name, len: f.text.length });
  }
  if (candidates.length !== 1) {
    throw new Error(
      `窗口事件接线函数的判定失败，命中 ${candidates.length} 个：${candidates.map((c) => c.name).join(', ')}`
    );
  }
  return candidates[0].name;
}

// 窗口注册函数：形如  function <R>(<id>,<focus>=!0){if(<TABLE>[<id>]){...}...} ，
// 参数个数为 2、第二个带默认值、首句判断窗口表里是否已有该 id，
// 且函数体里会新建 BrowserWindow。
// 菜单处理函数也有同样的参数形态并读窗口表，但它不新建窗口，靠这一点排除。
export function findWindowRegister(src, electron, table) {
  const fns = functionNodes(src);
  const candidates = [];
  for (const [name, f] of fns) {
    const params = f.node.params;
    if (params.length !== 2) continue;
    if (params[1].type !== 'AssignmentPattern') continue;
    if (!f.text.includes(`${table}[`)) continue;
    if (!f.text.includes(`new ${electron}.BrowserWindow(`)) continue;
    candidates.push({ name, len: f.text.length });
  }
  if (candidates.length !== 1) {
    throw new Error(
      `窗口注册函数的判定失败，命中 ${candidates.length} 个：${candidates.map((c) => c.name).join(', ')}`
    );
  }
  return candidates[0].name;
}

// 配置的读取与保存函数。两者的形态都很固定：
//   保存: function f(id,value){<defer>(()=>fs.writeFileSync(<pathOf>(id),JSON.stringify(value)))}
//   读取: function f(id){return <defer>(()=>JSON.parse(fs.readFileSync(<pathOf>(id),"utf8"))||{},{})}
// 两者都接受一个配置名参数，配置名参数为任意标识符。
export function findConfigAccessors(src) {
  const fns = functionNodes(src);
  const save = [];
  const read = [];
  for (const [name, f] of fns) {
    const text = f.text;
    // 参数个数：保存为 2，读取为 1
    const params = f.node.params.length;
    const isWrite = /writeFileSync\([A-Za-z_$][\w$]*\([A-Za-z_$][\w$]*\),JSON\.stringify\(/.test(text);
    const isRead = /JSON\.parse\([A-Za-z_$][\w$]*\.readFileSync\([A-Za-z_$][\w$]*\([A-Za-z_$][\w$]*\),"utf8"\)\)\|\|\{\}/.test(text);
    if (params === 2 && isWrite) save.push({ name, len: text.length });
    if (params === 1 && isRead) read.push({ name, len: text.length });
  }
  if (save.length !== 1) {
    throw new Error(`配置保存函数的判定失败，命中 ${save.length} 个：${save.map((s) => s.name).join(', ')}`);
  }
  if (read.length !== 1) {
    throw new Error(`配置读取函数的判定失败，命中 ${read.length} 个：${read.map((s) => s.name).join(', ')}`);
  }
  return { save: save[0].name, read: read[0].name };
}

// 全树收集「标识符 = 表达式」的绑定，含嵌套作用域。
// 返回数组，同名折叠为多条，调用方自己判断是否唯一。
export function allBindings(src) {
  const { ast } = topLevelBindings(src);
  const out = [];
  walk(ast, (n) => {
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.init) {
      out.push({ name: n.id.name, text: src.slice(n.init.start, n.init.end) });
    } else if (n.type === 'AssignmentExpression' && n.operator === '=' && n.left.type === 'Identifier') {
      out.push({ name: n.left.name, text: src.slice(n.right.start, n.right.end) });
    }
  });
  return out;
}

// Electron 主版本号绑定。两条声明写在同一条 var 里：
//   <RAW>=process.versions.electron,<VER>=parseInt(<RAW>.split(".")[0])
// 因此先找到前一条，再按它的名字找后一条。
export function findElectronMajor(src) {
  const { bindings } = topLevelBindings(src);
  const raw = [...bindings].filter(([, t]) => t === 'process.versions.electron').map(([n]) => n);
  if (raw.length !== 1) {
    throw new Error(`Electron 版本号来源的判定失败，命中 ${raw.length} 个：${raw.join(', ')}`);
  }
  const pattern = `parseInt(${raw[0]}.split(".")[0])`;
  const found = [...bindings].filter(([, t]) => t === pattern).map(([name]) => name);
  if (found.length !== 1) {
    throw new Error(`Electron 主版本的判定失败，命中 ${found.length} 个：${found.join(', ')}`);
  }
  return { version: found[0], raw: raw[0] };
}

// 应用协议与仓库页面地址。
//   <SCHEME>="app"
//   <BASE>=<SCHEME>+"://"
//   <HELP>=<BASE>+"obsidian.md/"
//   <VAULT_URL>=<HELP>+"index.html"
// 这些字符串跨版本稳定，可以作为定位依据。
export function findAppUrls(src) {
  const bindings = allBindings(src);
  const find = (text, label) => {
    const found = [...new Set(bindings.filter((b) => b.text === text).map((b) => b.name))];
    if (found.length !== 1) {
      throw new Error(`${label} 的判定失败，命中 ${found.length} 个：${found.join(', ')}`);
    }
    return found[0];
  };
  const scheme = find('"app"', '应用协议名');
  const base = find(`${scheme}+"://"`, '应用协议前缀');
  const help = find(`${base}+"obsidian.md/"`, '帮助页面前缀');
  const vaultUrl = find(`${help}+"index.html"`, '仓库页面地址');
  return { scheme, base, help, vaultUrl };
}

// 标记仓库为已打开的函数：形如  function X(o,r){let u=<VAULTS>[o];u&&(r?u.open=!0:delete u.open,<SAVE>())} 。
// 判定依据是函数体里同时出现仓库表下标、.open=!0 与 delete 属性。
export function findMarkVaultOpen(src, vaultTable) {
  const fns = functionNodes(src);
  const candidates = [];
  for (const [name, f] of fns) {
    if (!f.text.includes(`${vaultTable}[`)) continue;
    if (!f.text.includes('.open=!0')) continue;
    if (!/delete\s/.test(f.text)) continue;
    candidates.push({ name, len: f.text.length });
  }
  if (candidates.length !== 1) {
    throw new Error(
      `标记仓库已打开的判定失败，命中 ${candidates.length} 个：${candidates.map((c) => c.name).join(', ')}`
    );
  }
  return candidates[0].name;
}

// 仓库表：存放仓库路径与状态的顶层对象，形如  <TABLE>=<CONFIG>.vaults||{} 。
// 配置对象本身是「读配置("obsidian")」的结果。
export function findVaultTable(src) {
  const bindings = allBindings(src);
  const config = [...new Set(bindings
    .filter((b) => /^[A-Za-z_$][\w$]*\("obsidian"\)$/.test(b.text))
    .map((b) => b.name))];
  if (config.length !== 1) {
    throw new Error(`配置对象的判定失败，命中 ${config.length} 个：${config.join(', ')}`);
  }
  const pattern = new RegExp(`^${config[0]}\\.vaults\\|\\|\\{\\}$`);
  const found = [...new Set(bindings.filter((b) => pattern.test(b.text)).map((b) => b.name))];
  if (found.length !== 1) {
    throw new Error(`仓库表的判定失败，命中 ${found.length} 个：${found.join(', ')}`);
  }
  return found[0];
}

// 导出函数的参数。模块以 module.exports=function(...) 形式暴露，
// 参数依次是资源目录与更新事件。
// 判定依据：资源目录就是 ipcMain 的 "resources" 通道返回的那个标识符。
export function findExportsParams(src) {
  const { ast } = topLevelBindings(src);
  let fn = null;
  walk(ast, (n) => {
    if (fn) return;
    if (n.type !== 'AssignmentExpression') return;
    const left = n.left;
    if (left.type !== 'MemberExpression') return;
    if (left.object.type !== 'Identifier' || left.object.name !== 'module') return;
    if (propName(left.property) !== 'exports') return;
    if (n.right.type !== 'FunctionExpression') return;
    fn = n.right;
  });
  if (!fn) throw new Error('未找到 module.exports 的导出函数');
  const params = fn.params.map((p) => (p.type === 'Identifier' ? p.name : null));
  if (params.some((p) => !p)) throw new Error('导出函数的参数里出现了非标识符，无法解析');
  // 资源目录：\"resources\" 通道的 returnValue 来源
  let resourceDir = null;
  walk(fn, (n) => {
    if (resourceDir || n.type !== 'CallExpression') return;
    if (n.callee.type !== 'MemberExpression' || propName(n.callee.property) !== 'on') return;
    const args = n.arguments;
    if (args.length < 2 || args[0].type !== 'Literal' || args[0].value !== 'resources') return;
    const handler = args[1];
    if (handler.type !== 'FunctionExpression' && handler.type !== 'ArrowFunctionExpression') return;
    walk(handler, (m) => {
      if (resourceDir || m.type !== 'AssignmentExpression') return;
      if (propName(m.left) !== 'returnValue') return;
      if (m.right.type === 'Identifier') resourceDir = m.right.name;
    });
  });
  if (!resourceDir) throw new Error('未能从 "resources" 通道解析出资源目录参数');
  if (!params.includes(resourceDir)) {
    throw new Error(`资源目录 ${resourceDir} 不是导出函数的参数：${params.join(', ')}`);
  }
  return { params, resourceDir, updateEvents: params.find((p) => p !== resourceDir) || null };
}

// 仓库窗口的关闭处理器。事件名固定为 close，但回调内部的局部变量名与语句随版本变化，
// （例如 1.13.4 新增了 closing 标记），因此不能写成固定字符串。
// 这里用语法树定位调用表达式，把它的原文与回调体起点返回给补丁使用。
export function findVaultWindowCloseHandler(src, vaultWindowCreator) {
  const fns = functionNodes(src);
  const creator = fns.get(vaultWindowCreator);
  if (!creator) throw new Error(`未找到窗口创建函数 ${vaultWindowCreator}`);
  const found = [];
  walk(creator.node, (n) => {
    if (n.type !== 'CallExpression') return;
    if (n.callee.type !== 'MemberExpression' || propName(n.callee.property) !== 'on') return;
    const args = n.arguments;
    if (args.length < 2) return;
    if (args[0].type !== 'Literal' || args[0].value !== 'close') return;
    const handler = args[1];
    if (handler.type !== 'FunctionExpression' && handler.type !== 'ArrowFunctionExpression') return;
    // 该处理器会调用 destroy，用于区分同名的其它 close 监听。
    const text = src.slice(n.start, n.end);
    if (!text.includes('.destroy()')) return;
    found.push({
      text,
      bodyStart: handler.body.start + 1,
      param: handler.params.length > 0 && handler.params[0].type === 'Identifier' ? handler.params[0].name : null,
    });
  });
  if (found.length !== 1) {
    throw new Error(`仓库窗口关闭处理器的判定失败，命中 ${found.length} 处`);
  }
  return found[0];
}

// 一次性解析出全部角色。任一项判定不唯一即报错，交由人工核对。
export function resolveMainSymbols(src) {
  const electron = findElectron(src);
  const fs = findModuleAlias(src, 'fs');
  const path = findModuleAlias(src, 'path');
  const userData = findUserData(src, electron);
  const electronMajor = findElectronMajor(src).version;
  const urls = findAppUrls(src);
  const vaultWindowCreator = findVaultWindowCreator(src, electron);
  const windowTable = findWindowTable(src, electron, vaultWindowCreator);
  const auxWindowCreator = findAuxWindowCreator(src, electron);
  const starterOpen = findStarterOpen(src);
  const starterWindow = findStarterWindowVar(src, starterOpen, auxWindowCreator);
  const helpWindow = findHelpWindow(src, auxWindowCreator);
  const windowWiring = findWindowWiring(src, electron);
  const windowRegister = findWindowRegister(src, electron, windowTable.name);
  const vaultTable = findVaultTable(src);
  const markVaultOpen = findMarkVaultOpen(src, vaultTable);
  const config = findConfigAccessors(src);
  const exportsParams = findExportsParams(src);
  const closeHandler = findVaultWindowCloseHandler(src, vaultWindowCreator);
  return {
    electron,
    fs,
    path,
    userData,
    electronMajor,
    ...urls,
    vaultTable,
    vaultWindowCreator,
    windowTable: windowTable.name,
    windowTableRanked: windowTable.ranked,
    auxWindowCreator,
    starterOpen,
    starterWindow,
    helpOpen: helpWindow.openName,
    helpWindow: helpWindow.varName,
    windowWiring,
    windowRegister,
    markVaultOpen,
    configSave: config.save,
    configRead: config.read,
    ...exportsParams,
    vaultWindowCloseHandler: closeHandler,
  };
}

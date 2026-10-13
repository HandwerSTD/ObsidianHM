// Copyright (c) 2026 HandwerSTD
//
// 按结构从压缩产物里解析出具名符号。
//
// 压缩后的标识符随版本重排，任何写死名字的定位都会在下一个版本失效。
// 本文件的做法是：为每个需要的符号定义一段「形状描述」，用语法树去匹配。
// 匹配不到的项会明确报错，交由人工确认新版本是否改写了该结构。
//
// 每一项都要求唯一命中。命中多个候选时按打分排序，并把全部候选打印出来，
// 供人工判断，而不是悄悄取第一个。

import fs from 'node:fs';
import { parse, walk, propName, calleeTarget, objectProperty } from './ast-util.mjs';

// 取类符号。两个形态：
//   NAME=function(){...}()                  —— 定义类本体
//   NAME=function(e){...}(BASE)             —— 定义子类，BASE 是基类
// 基类写在外层调用表达式的实参里，不在函数体的返回值里。
function readClass(node, src) {
  let base = null;
  let fn = node;
  if (node && node.type === 'CallExpression' && node.callee.type === 'FunctionExpression') {
    fn = node.callee;
    if (node.arguments.length === 1 && node.arguments[0].type === 'Identifier') {
      base = node.arguments[0].name;
    }
  }
  fn = calleeTarget(fn);
  if (!fn || fn.type !== 'FunctionExpression') return null;
  const ctor = fn.body.body.find((s) => s.type === 'FunctionDeclaration');
  if (!ctor || !ctor.id) return null;
  const ctorName = ctor.id.name;
  const methods = new Map();
  const statics = new Map();
  walk(fn.body, (n) => {
    if (n.type !== 'AssignmentExpression' || n.left.type !== 'MemberExpression') return;
    const owner = n.left.object;
    const prop = propName(n.left.property);
    if (!prop) return;
    if (owner.type === 'MemberExpression') {
      if (propName(owner.property) === 'prototype' && propName(owner.object) === ctorName) {
        methods.set(prop, src.slice(n.right.start, n.right.end));
      }
      return;
    }
    if (owner.type === 'Identifier' && owner.name === ctorName) {
      statics.set(prop, src.slice(n.right.start, n.right.end));
    }
  });
  return { ctorName, methods, statics, base, node: fn, source: src.slice(fn.start, fn.end) };
}

// 收集文件里所有类符号。键是外层赋值目标的名字。
export function readAllClasses(src) {
  const ast = parse(src);
  const classes = new Map();
  walk(ast, (node) => {
    let name = null;
    let right = null;
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') {
      name = node.id.name;
      right = node.init;
    } else if (node.type === 'AssignmentExpression' && node.left.type === 'Identifier') {
      name = node.left.name;
      right = node.right;
    } else {
      return;
    }
    const info = readClass(right, src);
    if (info) classes.set(name, info);
  });
  return { ast, classes };
}

// 出现频次最高的「两参数、两实参都是标识符」的调用目标。
// 类继承辅助函数在每个子类里都会被调用一次，频次远超其它同类调用。
export function findExtendHelper(src) {
  const ast = parse(src);
  const counts = new Map();
  walk(ast, (n) => {
    if (n.type !== 'CallExpression' || n.callee.type !== 'Identifier') return;
    if (n.arguments.length !== 2) return;
    if (n.arguments.some((a) => a.type !== 'Identifier')) return;
    counts.set(n.callee.name, (counts.get(n.callee.name) || 0) + 1);
  });
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) throw new Error('未找到任何两参数的标识符调用，无法确定继承辅助函数');
  const [best, second] = ranked;
  if (second && best[1] < second[1] * 3) {
    throw new Error(
      `继承辅助函数的判定不明确：最高频 ${best[0]}(${best[1]} 次) 与次高频 ${second[0]}(${second[1]} 次) 差距不足三倍。\n` +
      `候选：${ranked.slice(0, 6).map(([k, v]) => `${k}(${v})`).join(', ')}`
    );
  }
  return { name: best[0], count: best[1], ranked: ranked.slice(0, 6) };
}

export function countDerived(classes) {
  const counts = new Map();
  for (const info of classes.values()) {
    if (!info.base) continue;
    counts.set(info.base, (counts.get(info.base) || 0) + 1);
  }
  return counts;
}
// createDiv("vertical-tab-content")，且构造参数是两个（app 与 setting）。
// 这个字符串在整个 app.js 里只在此处出现，1.12.7 与 1.13.4 都成立。
export function findSettingsTabBase(src, classes, derived) {
  const marker = 'createDiv("vertical-tab-content")';
  const candidates = [];
  for (const [name, info] of classes) {
    if (info.source.includes(marker) && info.ctorName) {
      candidates.push({ name, info, score: derived.get(name) || 0 });
    }
  }
  if (candidates.length !== 1) {
    throw new Error(
      `设置页基类的判定失败：按 containerEl=createDiv("vertical-tab-content") 命中 ${candidates.length} 个候选。\n` +
      candidates.map((c) => `  ${c.name}`).join('\n') +
      '\n请确认新版本是否改写了设置页基类的构造方式。'
    );
  }
  const [best] = candidates;
  const mode = best.info.methods.has('getSettingDefinitions') ? 'definitions' : 'display';
  return { name: best.name, info: best.info, candidates, mode };
}

// 国际化文案访问器：递归 Proxy 包装 i18next.t。
// 形态为「一个接受前缀参数的函数，内部返回 new Proxy，
// 并且 Proxy 的 get 里递归调用自身拼接前缀」。
// 两个版本都只在定义处调用一次，传入空前缀。
export function findI18nModule(src) {
  const ast = parse(src);
  const found = [];
  walk(ast, (n) => {
    if (n.type !== 'VariableDeclarator' || n.id.type !== 'Identifier' || !n.init) return;
    const text = src.slice(n.init.start, n.init.end);
    if (!text.includes('new Proxy(')) return;
    if (!text.includes('i18next.t')) return;
    found.push(n.id.name);
  });
  if (found.length !== 1) {
    throw new Error(`国际化文案访问器的判定失败，命中 ${found.length} 个：${found.join(', ')}`);
  }
  return found[0];
}

// 平台标志对象：形如  <X>={isDesktop:!1,isMobile:!1,isDesktopApp:!1,...} 。
export function findPlatformFlags(src) {
  const ast = parse(src);
  const found = [];
  walk(ast, (n) => {
    if (n.type !== 'VariableDeclarator' || n.id.type !== 'Identifier' || !n.init) return;
    const text = src.slice(n.init.start, n.init.end);
    if (!/\{isDesktop:!1,isMobile:!1/.test(text)) return;
    found.push(n.id.name);
  });
  if (found.length !== 1) {
    throw new Error(`平台标志对象的判定失败，命中 ${found.length} 个：${found.join(', ')}`);
  }
  return found[0];
}

// 自绘标题栏类：在 frameDom 赋值处被 new 出来的那个符号。
export function findFrameDomClass(src) {
  const m = src.match(/frameDom=new ([A-Za-z_$][\w$]*)\(/);
  if (!m) throw new Error('未能从 frameDom 赋值处解析出自绘标题栏类');
  return m[1];
}

// 收集全树的「标识符 = 表达式」绑定，含嵌套作用域。
// 语言模块的命名空间写在同一条 var 里，只能按赋值逐个收集。
function collectBindings(src) {
  const ast = parse(src);
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

// 语言模块的命名空间绑定。它们与语言模块写成同一条 var：
//   var <ABOUT>=<I18N>.setting.about,<ACCOUNT>=<I18N>.setting.account,...
// 这里按属性路径取值。
export function findI18nNamespace(src, i18n, path) {
  const bindings = collectBindings(src);
  const expected = `${i18n}.${path}`;
  const found = [...new Set(bindings.filter((b) => b.text === expected).map((b) => b.name))];
  if (found.length !== 1) {
    throw new Error(`${path} 对应文案的判定失败，命中 ${found.length} 个：${found.join(', ')}`);
  }
  return found[0];
}

// 社区插件设置页所引用的文案别名。
// md.setting.thirdPartyPlugin 在文件里有多个同名别名，
// 只有社区插件设置页构造函数里引用的那一个与它紧邻定义。
// 判定方式是：取该类的构造函数源码，找出形如  <X>.name() 且值为该路径的别名。
export function findThirdPartyI18n(src, i18n, communityTabSource) {
  const expected = `${i18n}.setting.thirdPartyPlugin`;
  const bindings = collectBindings(src);
  const aliases = new Set(bindings.filter((b) => b.text === expected).map((b) => b.name));
  const used = [...aliases].filter((name) => new RegExp(`\\b${name}\\.name\\(\\)`).test(communityTabSource));
  if (used.length !== 1) {
    throw new Error(
      `${expected} 对应文案的判定失败：在该类构造函数里命中 ${used.length} 个：${used.join(', ')}。\n` +
      `全部同名别名：${[...aliases].join(', ')}`
    );
  }
  return used[0];
}

// 一次性解析出 app.js 里被定制代码引用的全部符号。
export function resolveAppIdentifiers(src) {
  const { classes } = readAllClasses(src);
  const derived = countDerived(classes);
  const extend = findExtendHelper(src);
  const settingsTabBase = findSettingsTabBase(src, classes, derived);
  const settingItem = findSettingItem(src, classes);
  const notice = findNotice(src, classes);
  if (!settingsTabBase.name) throw new Error('未能解析出设置页基类');
  if (!settingItem.name) throw new Error('未能解析出设置项容器');
  if (!notice.name) throw new Error('未能解析出提示消息');
  // 社区插件设置页类：id 为 community-plugins 的那个类。
  // 社区插件设置页类：构造函数里把 id 设为 community-plugins 的那个类。
  let communityTab = null;
  for (const [name, info] of classes) {
    if (/id="community-plugins"/.test(info.source)) communityTab = name;
  }
  if (!communityTab) throw new Error('未能解析出社区插件设置页类');
  const i18n = findI18nModule(src);
  const communityTabSource = classes.get(communityTab).source;
  return {
    extend: extend.name,
    settingsTabBase: settingsTabBase.name,
    settingContainer: settingItem.name,
    notice: notice.name,
    communityTab,
    i18n,
    aboutI18n: findI18nNamespace(src, i18n, 'setting.about'),
    thirdPartyI18n: findThirdPartyI18n(src, i18n, communityTabSource),
    platformFlags: findPlatformFlags(src),
    frameDom: findFrameDomClass(src),
    classCount: classes.size,
    settingsTabBaseMode: settingsTabBase.mode,
  };
}

// 设置项容器：同时具备 setName / setDesc / setHeading / addButton / addToggle / addText。
export function findSettingItem(src, classes) {
  const required = ['setName', 'setDesc', 'setHeading', 'addButton', 'addToggle', 'addText'];
  const candidates = [];
  for (const [name, info] of classes) {
    if (required.every((m) => info.methods.has(m))) {
      candidates.push({ name, info, score: info.methods.size });
    }
  }
  if (candidates.length === 0) return { name: null, info: null, candidates };
  // 取方法最全的那个（完整设置项方法最多；只继承一部分的会少很多）
  candidates.sort((a, b) => b.score - a.score);
  return { name: candidates[0].name, info: candidates[0].info, candidates };
}

// 提示消息：具备 setMessage / setAutoHide / addButton / hide 四个方法，无继承。
export function findNotice(src, classes) {
  const required = ['setMessage', 'setAutoHide', 'addButton', 'hide'];
  const candidates = [];
  for (const [name, info] of classes) {
    if (required.every((m) => info.methods.has(m)) && !info.base) {
      candidates.push({ name, info });
    }
  }
  return candidates.length === 1
    ? { name: candidates[0].name, info: candidates[0].info, candidates }
    : { name: null, info: null, candidates };
}

// 窗口表：在窗口创建函数里被 [id] 写入的顶层对象。
export function findWindowRegistry(src, createWindowName) {
  const ast = parse(src);
  // 找出具名函数声明
  const fnNodes = new Map();
  walk(ast, (n) => {
    if (n.type === 'FunctionDeclaration' && n.id) fnNodes.set(n.id.name, n);
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.init) {
      const target = calleeTarget(n.init);
      if (target && target.type === 'FunctionExpression') fnNodes.set(n.id.name, target);
    }
  });
  const fn = fnNodes.get(createWindowName);
  if (!fn) throw new Error(`未找到窗口创建函数 ${createWindowName}`);
  const written = new Map();
  walk(fn, (n) => {
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

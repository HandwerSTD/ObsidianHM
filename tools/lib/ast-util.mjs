// Copyright (c) 2026 HandwerSTD
//
// 语法树遍历与查询的公共工具。
//
// 压缩产物的标识符会随版本重排，本文件提供「按形状找符号」的基础能力，
// 使定位不依赖任何具体名字。

import * as acorn from 'acorn';

export function parse(source) {
  return acorn.parse(source, { ecmaVersion: 2022, sourceType: 'script', allowReturnOutsideFunction: true });
}

// 取成员表达式最内层的属性名。a.b.c 取 c，a["b"] 取 b。
export function propName(expr) {
  if (!expr) return null;
  if (expr.type === 'Identifier') return expr.name;
  if (expr.type === 'Literal') return String(expr.value);
  if (expr.type === 'MemberExpression') return propName(expr.property);
  return null;
}

// 取成员表达式的根标识符。a.b.c 取 a。
export function rootName(expr) {
  let node = expr;
  while (node && node.type === 'MemberExpression') node = node.object;
  return node && node.type === 'Identifier' ? node.name : null;
}

// 剥掉一层或连续多层的调用，拿到被调用的目标。f(x)(y) 取 f。
export function calleeTarget(expr) {
  let node = expr;
  while (node && node.type === 'CallExpression') node = node.callee;
  return node;
}

// 深度优先遍历，回调收到节点与父节点。
export function walk(node, callback, parent = null) {
  if (!node || typeof node.type !== 'string') return;
  callback(node, parent);
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) walk(child, callback, node);
    } else if (value && typeof value.type === 'string') {
      walk(value, callback, node);
    }
  }
}

// 在子树里收集满足条件的节点。
export function collect(node, predicate) {
  const out = [];
  walk(node, (n) => {
    if (predicate(n)) out.push(n);
  });
  return out;
}

// 收集子树里出现的字符串字面量。
export function stringLiterals(node) {
  const out = new Set();
  walk(node, (n) => {
    if (n.type === 'Literal' && typeof n.value === 'string') out.add(n.value);
  });
  return out;
}

// 取出属性名为指定名字的对象字面量属性。
export function objectProperty(objectNode, name) {
  if (!objectNode || objectNode.type !== 'ObjectExpression') return null;
  for (const prop of objectNode.properties) {
    if (prop.type !== 'Property') continue;
    if (propName(prop.key) === name) return prop;
  }
  return null;
}

// 判断一个节点是否是「空对象字面量」。
export function isEmptyObject(node) {
  return !!node && node.type === 'ObjectExpression' && node.properties.length === 0;
}

// 统计某个标识符在整棵树里被作为「对象」使用的次数，用于区分同名不同用的符号。
export function memberAccessCount(ast, name) {
  let count = 0;
  walk(ast, (n) => {
    if (n.type === 'MemberExpression' && n.object.type === 'Identifier' && n.object.name === name) count += 1;
  });
  return count;
}

// 从官方发布版 asar 里定位注入需要的符号。
//
// 用法:
//   node tools/resolve-symbols.mjs --asar <官方 obsidian.asar>
//   node tools/resolve-symbols.mjs --dir <已解包的官方产物目录>
//
// 压缩产物里的标识符随版本重排，本脚本按「结构 + 稳定字符串」从语法树定位，
// 不预设任何变量名。升级内核后核对注入点是否漂移时用它，见
// docs/asar-upgrade.md 第 6 节。
//
// 任一项判定不唯一即以非零退出，并打印全部候选。此时需要人工确认官方
// 是否改写了该结构，再更新 lib/ 里对应的形状描述。

import fs from 'node:fs';
import path from 'node:path';
import { extractFile } from '@electron/asar';
import { resolveMainSymbols } from './lib/main-symbols.mjs';
import { resolveAppIdentifiers } from './lib/symbols.mjs';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--asar') args.asar = argv[++i];
    else if (key === '--dir') args.dir = argv[++i];
    else if (key === '--help' || key === '-h') args.help = true;
    else throw new Error(`未知参数: ${key}`);
  }
  return args;
}

function printUsage() {
  console.log('用法:');
  console.log('  node tools/resolve-symbols.mjs --asar <官方 obsidian.asar>');
  console.log('  node tools/resolve-symbols.mjs --dir  <已解包的官方产物目录>');
}

// 读一份文件。给出 asar 时从包内解出，给出目录时直接读。
function readSource(source, name) {
  if (source.asar) {
    return extractFile(source.asar, name).toString('utf8');
  }
  return fs.readFileSync(path.join(source.dir, name), 'utf8');
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    printUsage();
    process.exit(2);
  }
  if (args.help || (!args.asar && !args.dir)) {
    printUsage();
    process.exit(args.help ? 0 : 2);
  }
  if (args.asar && args.dir) {
    console.error('--asar 与 --dir 只能给一个。');
    process.exit(2);
  }
  const source = args.asar ? { asar: path.resolve(args.asar) } : { dir: path.resolve(args.dir) };
  if (source.asar && !fs.existsSync(source.asar)) {
    console.error(`找不到文件: ${source.asar}`);
    process.exit(2);
  }
  if (source.dir && !fs.existsSync(source.dir)) {
    console.error(`找不到目录: ${source.dir}`);
    process.exit(2);
  }

  const results = [];
  for (const name of ['main.js', 'app.js']) {
    let src;
    try {
      src = readSource(source, name);
    } catch (e) {
      console.error(`读取 ${name} 失败: ${e.message}`);
      process.exit(2);
    }
    let symbols;
    try {
      symbols = name === 'main.js' ? resolveMainSymbols(src) : resolveAppIdentifiers(src);
    } catch (e) {
      console.error(`${name} 的符号解析失败: ${e.message}`);
      process.exit(1);
    }
    results.push([name, symbols]);
  }

  for (const [name, symbols] of results) {
    console.log(`${name}:`);
    for (const [key, value] of Object.entries(symbols)) {
      console.log(`  ${key.padEnd(22)} ${value}`);
    }
    console.log('');
  }

  console.log('全部符号判定唯一。');
}

main();

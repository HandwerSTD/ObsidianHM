// Copyright (c) 2026 HandwerSTD
//
// 渲染进程注入脚本：最早的时机。
//
// 在 window 对象上做两处处理，必须在页面脚本执行之前完成：
//   1. i18next.t 包装。官方在页面脚本里用 i18next.t 取自定义键，
//      包装后可以补入本项目的键值与中文文案。
//   2. 向外层转写日志。渲染进程没有写文件的接口，诊断输出需要经主进程落盘。
//
// 本文件由外层 main.js 在 browser-window-created、did-start-navigation、
// dom-ready 三处注入，脚本自身用标志位保证幂等。
//
// 这里不覆盖 window.close。asar 是官方原版，起始窗口打开仓库后靠它自己关闭，
// 屏蔽它会连带破坏三处：起始窗口残留、切换仓库时旧窗口关不掉、设置弹窗关闭失效。
// 「关窗不退出」由外层对仓库窗口的 close 拦截与托盘提供，与渲染进程无关。

'use strict';

(function () {
  if (window.__ohsidianPreload) return;
  window.__ohsidianPreload = true;

  // 渲染进程没有写文件的接口，日志经主进程的 ohsidian-log 通道转写。
  window.__ohsidianLog = function (message) {
    try {
      var electron = window.electron || (window.require && window.require('electron'));
      if (electron && electron.ipcRenderer) {
        electron.ipcRenderer.send('ohsidian-log', String(message));
      }
    } catch (e) {
    }
  };

  window.__ohsidianLog('preload 开始施加');

  // 1. 包装 i18next.t。
  //
  // 键的形态：官方先把驼峰属性名转成 kebab-case 并补一个点，
  // 例如 md.setting.about.labelVersion 最终以 "setting.about.label-version" 取值。
  // 这里按同一形态书写。
  //
  // 官方的取词函数是 i18next.t 的薄封装，每次调用都会走到这里，
  // 因此采用包装而不是 addResourceBundle：后者会被随后的语言包异步加载覆盖。
  var EN = {
    'setting.about.label-version': 'HarmonyOS-{{version}}',
    'setting.about.label-install-version': 'HarmonyOS Port {{version}}',
    'setting.about.label-read-changelog': '',
    'setting.about.label-manual-update-required': 'This is a HarmonyOS port. Original update channels are not available.',
    'setting.about.label-disabled-updates': 'Updates are disabled. Running on HarmonyOS.',
    'setting.about.option-auto-update-description': 'Automatic updates are disabled on HarmonyOS port.'
  };
  var ZH = {
    'setting.about.label-version': 'HarmonyOS-{{version}}',
    'setting.about.label-install-version': 'HarmonyOS 移植版本 {{version}}',
    'setting.about.label-read-changelog': '',
    'setting.about.label-manual-update-required': '此版本为 HarmonyOS 移植版，原有更新通道不可用。',
    'setting.about.label-disabled-updates': '更新已禁用（HarmonyOS 移植版）。',
    'setting.about.option-auto-update-description': 'HarmonyOS 移植版不支持自动更新。'
  };

  function overridesForLanguage() {
    // 语言解析交给 i18next 自己：它把当前语言放在 language 上。
    try {
      var i18n = window.i18next;
      var lang = (i18n && (i18n.language || (i18n.languages && i18n.languages[0]))) || '';
      if (String(lang).toLowerCase().indexOf('zh') === 0) return ZH;
    } catch (e) {
    }
    return EN;
  }

  function installI18nPatch() {
    var i18n = window.i18next || (typeof self !== 'undefined' ? self.i18next : null);
    if (!i18n || typeof i18n.t !== 'function') return false;
    if (i18n.t.__ohsidianPatched) return true;
    var original = i18n.t;
    var patched = function (key) {
      var table = overridesForLanguage();
      if (key && Object.prototype.hasOwnProperty.call(table, key)) {
        var value = table[key];
        var options = arguments[1];
        if (options && value) {
          value = value.replace(/\{\{(\w+)\}\}/g, function (match, name) {
            return options[name] !== undefined ? options[name] : match;
          });
        }
        return value;
      }
      return original.apply(this, arguments);
    };
    patched.__ohsidianPatched = true;
    i18n.t = patched;
    return true;
  }

  // i18next 由 lib/i18next.min.js 在 index.html、starter.html 等页面里初始化。
  // 设置弹窗是由 window.open("about:blank") 造出的新窗口，不加载任何脚本，
  // 其中的文案由主窗口直接写入 DOM，因此这个窗口里没有 i18next 是正常现象。
  var attempts = 0;
  var timer = setInterval(function () {
    attempts += 1;
    var done = installI18nPatch();
    if (done || attempts >= 100) {
      clearInterval(timer);
      if (done) {
        window.__ohsidianLog('i18next.t 已包装');
      } else if (document.location.href === 'about:blank' || !document.querySelector('script')) {
        window.__ohsidianLog('i18next 未出现，当前为设置弹窗，无需包装');
      } else {
        window.__ohsidianLog('i18next 未出现，包装放弃');
      }
    }
  }, 100);
})();

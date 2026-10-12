// 渲染进程注入脚本：页面结构就绪后施加。
//
// 承载五项：
//   1. 「华为云同步」设置页（类定义与注册）
//   2. 「外观」页插入「退出软件」开关
//   3. 「关于」页追加「贡献作者」
//   4. 起始窗口的标题栏文字
//   5. 窗口按钮可见性与标题栏右边距，以及隐藏官方自绘的三个窗口按钮（[HMOS-FRAME]）
//
// 关键约束：设置项的取值在 Setting 构造期间就被算出并缓存
// （addSettingTab 内部立即调用 update()，update() 做
// this.settingItems=this.getSettingDefinitions()），
// 因此包装 getSettingDefinitions 之后必须再调一次 tab.update()，
// 否则渲染的是包装之前的旧结果。

'use strict';

(function () {
  if (window.__ohsidianDomReady) return;
  window.__ohsidianDomReady = true;

  function log(message) {
    if (typeof window.__ohsidianLog === 'function') {
      window.__ohsidianLog(message);
    }
  }

  log('dom-ready 注入开始');

  function electronApi() {
    try {
      return window.electron || (window.require && window.require('electron'));
    } catch (e) {
      return null;
    }
  }

  function sendSync(channel) {
    var electron = electronApi();
    if (!electron || !electron.ipcRenderer) return null;
    var args = Array.prototype.slice.call(arguments, 1);
    return electron.ipcRenderer.sendSync.apply(electron.ipcRenderer, [channel].concat(args));
  }

  // 提示消息。官方把 Notice 直接放在 window 上（源码里是 window.Notice=xw），
  // 因此从 window 取，不走 require。
  function notify(message) {
    try {
      if (typeof window.Notice === 'function') {
        new window.Notice(message);
        return true;
      }
    } catch (e) {
      log('提示消息弹出失败 ' + (e && e.message ? e.message : e));
    }
    return false;
  }

  // ---------------------------------------------------------------
  // 1. 窗口按钮可见性与标题栏右边距（[HMOS-FRAME]）
  //
  // 官方在 renderer 里按 ipcRenderer.sendSync("frame") 的返回值分支，
  // 取值为 "hidden" 时给 body 加 is-hidden-frameless 类。
  // 仓库版本在此基础上多做三件事：调用 setWindowButtonVisibility、
  // 设置 --frame-right-space、隐藏官方自绘的三个窗口按钮。
  // 三件都不依赖 asar 内部变量。
  // ---------------------------------------------------------------

  // 官方自绘标题栏（app.js 里的 OI 类）在非 macOS 上创建
  // 最小化、最大化、关闭三个按钮，放在 .titlebar-button-container.mod-right。
  // 本机平台不是 darwin，因此这三个按钮会被创建；而系统在该窗口上
  // 已经画了同样位置的三个按钮（对应下面调用的 setWindowButtonVisibility），
  // 两者重合。这里隐藏自绘的那一份。
  // 左端的菜单按钮（mod-logo）不在 mod-right 里，不受影响。
  function hideSelfDrawnWindowButtons() {
    try {
      // 设置弹窗由 window.open 造出，官方的样式中继会把主窗口 head 里的
      // style 元素克隆过去，本样式（含同一个 id）随之继承。已存在时无需重复插入，
      // 但两个分支都输出日志，以便这条判据在每个窗口上都成立。
      if (document.getElementById('ohsidian-frame-buttons')) {
        log('自绘窗口按钮已隐藏（样式已随窗口中继）');
        return;
      }
      var style = document.createElement('style');
      style.id = 'ohsidian-frame-buttons';
      style.textContent =
        '.titlebar-button-container.mod-right .titlebar-button { display: none !important; }';
      (document.head || document.documentElement).appendChild(style);
      log('自绘窗口按钮已隐藏');
    } catch (e) {
      log('隐藏自绘窗口按钮失败 ' + (e && e.message ? e.message : e));
    }
  }

  function applyFrameAdjustments() {
    try {
      var frameStyle = sendSync('frame') || 'hidden';
      if (frameStyle === 'native') {
        log('窗口按钮调整跳过：frame=native');
        return;
      }
      // 无边框窗口上系统的三个按钮与官方自绘的三个重合，先隐藏自绘的那份。
      hideSelfDrawnWindowButtons();
      // 为系统按钮在右侧留出空间。
      //
      // 官方 CSS 里这段空间由两个变量算出：
      //   .is-hidden-frameless:not(.is-fullscreen) .workspace-tabs.mod-top-right-space
      //     .workspace-tab-header-container { padding-right: calc(var(--size-4-2) + var(--frame-right-space)); }
      // 官方只在 .mod-windows、.mod-linux 两个类下定义 --frame-right-space: 126px，
      // 而本机平台不是 win32 / darwin / linux，官方不给 body 加任何 mod-* 类，
      // 因此这个变量只能由这里在 body 上设置。
      //
      // 这一句只改一个 CSS 变量，不依赖 remote，必须放在下面取 remote 之前。
      // 之前它排在 remote 判定之后，remote 取不到时被一并跳过，
      // 笔记页面右上角的 tab 区域就叠到了系统按钮下面。
      document.body.style.setProperty('--frame-right-space', '126px');
      var remoteNote;
      try {
        var electron = electronApi();
        if (electron && electron.remote) {
          var win = electron.remote.getCurrentWindow();
          var hasSetter = !!(win && typeof win.setWindowButtonVisibility === 'function');
          if (hasSetter) {
            win.setWindowButtonVisibility(frameStyle === 'hidden');
          }
          remoteNote = 'setWindowButtonVisibility=' + hasSetter;
        } else {
          // 注入可能在官方把 electron.remote 挂到 window 之前执行。
          // 系统按钮的可见性由外层运行时决定，这里只是补一次设置。
          remoteNote = 'setWindowButtonVisibility=跳过，remote 未就绪';
        }
      } catch (e) {
        remoteNote = 'setWindowButtonVisibility=失败 ' + (e && e.message ? e.message : e);
      }
      log('窗口按钮与右边距已调整，frame=' + frameStyle + ' ' + remoteNote +
        ' --frame-right-space=' + document.body.style.getPropertyValue('--frame-right-space'));
    } catch (e) {
      log('窗口按钮调整失败 ' + (e && e.message ? e.message : e));
    }
  }

  // ---------------------------------------------------------------
  // 2. 「华为云同步」设置页。
  //
  // 页面仍然注册并保持可用，但侧栏入口隐藏。
  //
  // 基类取法：优先 window.require('obsidian') 暴露的 PluginSettingTab；
  // 该标识符是 webpack 闭包变量，取不到时从已有设置页用原型链回溯。
  // 这条回退是必需的：Setting 容器的 isPluginSettingTab 用 instanceof
  // 判定，类必须真的继承内部基类，否则页签不会出现在侧栏。
  // ---------------------------------------------------------------
  function findSettingsTabBase() {
    // 主路径：window.require('obsidian') 在设备上抛 Cannot find module 'obsidian'
    // （官方把模块实例放在闭包里，并未注册为 require 可解析的模块）。
    // 保留这一支是为了以后官方改变暴露方式时能自动走上一级。
    try {
      var obsidian = window.require && window.require('obsidian');
      if (obsidian && typeof obsidian.PluginSettingTab === 'function') {
        return obsidian.PluginSettingTab;
      }
      if (obsidian && typeof obsidian.SettingTab === 'function') {
        return obsidian.SettingTab;
      }
    } catch (e) {
    }
    return null;
  }

  function buildHcsSettingsTabClass() {
    function HcsSettingsTab(app, setting) {
      var Base = buildHcsSettingsTabClass.Base;
      var self = Base.call(this, app, setting) || this;
      self.id = 'huawei-cloud-sync';
      self.name = '华为云同步';
      self.icon = 'cloud';
      return self;
    }

    var Base = buildHcsSettingsTabClass.Base;
    if (Base) {
      HcsSettingsTab.prototype = Object.create(Base.prototype);
      HcsSettingsTab.prototype.constructor = HcsSettingsTab;
    }

    HcsSettingsTab.prototype.getSettingDefinitions = function () {
      var self = this;
      var items = [];
      var uid = sendSync('hcs-get-userid');

      if (!uid || uid === 'pending') {
        var pending = uid === 'pending';
        items.push({
          name: '华为云同步',
          desc: pending
            ? '正在登录中，请在新窗口中完成华为账号一键登录'
            : '登录华为账号后可将仓库数据安全备份到云端，数据独立存储，重装后可恢复。',
          render: function (setting) {
            setting.setHeading();
            if (pending) return;
            setting.addButton(function (button) {
              return button.setButtonText('登录华为账号').setCta().onClick(function () {
                sendSync('hcs-login');
                notify('正在打开登录窗口...');
                self.update();
              });
            });
          }
        });
        return items;
      }

      var status = sendSync('hcs-get-status') || {};
      var autoSync = sendSync('hcs-get-auto-sync');
      var excluded = sendSync('hcs-get-excluded') || [];
      var lastSync = status.lastSync ? new Date(status.lastSync).toLocaleString() : '从未';
      var size = status.totalSize
        ? (status.totalSize < 1048576
            ? (status.totalSize / 1024).toFixed(1) + ' KB'
            : (status.totalSize / 1048576).toFixed(1) + ' MB')
        : '0 KB';
      var localCount = status.files ? status.files.length : 0;
      var cloudCount = status.cloudFiles || 0;

      items.push({
        name: '华为账号',
        desc: uid,
        render: function (setting) {
          setting.addExtraButton(function (button) {
            return button.setIcon('lucide-log-out').setTooltip('退出登录').onClick(function () {
              sendSync('hcs-set-userid', null);
              self.update();
            });
          });
        }
      });
      items.push({
        name: '同步状态',
        desc: status.status || '就绪',
        render: function (setting) {
          setting.addExtraButton(function (button) {
            return button.setIcon('lucide-refresh-cw').setTooltip('刷新').onClick(function () {
              self.update();
            });
          });
        }
      });
      items.push({ name: '上次同步', desc: lastSync });
      items.push({ name: '本地文件', desc: localCount + ' 个，' + size });

      if (cloudCount > 0) {
        items.push({
          name: '云端文件',
          desc: cloudCount + ' 个文件已上传',
          render: function (setting) {
            setting.addButton(function (button) {
              return button.setButtonText('恢复').onClick(function () {
                var list = sendSync('hcs-restore-list') || [];
                var done = 0;
                for (var i = 0; i < list.length; i++) {
                  var request = { path: list[i], vaultPath: self.app.vault.adapter.basePath };
                  if (sendSync('hcs-restore-file', request)) done += 1;
                }
                notify('已从云端恢复 ' + done + ' 个文件');
                self.update();
              });
            });
          }
        });
      }

      items.push({
        name: '自动同步',
        desc: '文件变更时自动上传',
        render: function (setting) {
          setting.addToggle(function (toggle) {
            return toggle.setValue(autoSync).onChange(function (value) {
              sendSync('hcs-set-auto-sync', value);
              self.update();
            });
          });
        }
      });

      items.push({
        name: '立即同步',
        desc: '扫描全部仓库文件并保存到同步记录',
        render: function (setting) {
          setting.addButton(function (button) {
            return button.setButtonText('开始同步').setCta().onClick(function () {
              var result = sendSync('hcs-sync-all', self.app.vault.adapter.basePath);
              var text = result.totalSize < 1048576
                ? (result.totalSize / 1024).toFixed(1) + ' KB'
                : (result.totalSize / 1048576).toFixed(1) + ' MB';
              notify('同步完成：' + result.files.length + ' 个文件，' + text);
              self.update();
            });
          });
        }
      });

      items.push({
        name: '排除文件夹',
        desc: ((excluded.length ? excluded.join('、') : '无') + '。输入路径后回车添加。'),
        render: function (setting) {
          setting.addText(function (text) {
            text.setPlaceholder('文件夹路径，回车确认');
            text.inputEl.addEventListener('keydown', function (event) {
              if (event.key === 'Enter' && text.inputEl.value.trim()) {
                excluded.push(text.inputEl.value.trim());
                sendSync('hcs-set-excluded', excluded);
                self.update();
              }
            });
          });
        }
      });

      return items;
    };

    return HcsSettingsTab;
  }

  // 隐藏「华为云同步」在设置侧栏里的入口。
  //
  // 由 addSettingTab 生成的入口元素带 data-setting-id 属性，取值等于页签的 id。
  // 样式挂在 body 上而不是 head：设置弹窗由 window.open("about:blank") 造出，
  // 它的 head 又会被官方在每次打开时重新同步，挂在 body 上可以避免样式被覆盖。
  // 用 !important 是为了盖过 .vertical-tab-nav-item 的默认 display。
  function hideHcsTabEntry() {
    try {
      if (document.getElementById('ohsidian-hide-hcs-tab')) return;
      var root = document.body || document.documentElement;
      if (!root) return;
      var style = document.createElement('style');
      style.id = 'ohsidian-hide-hcs-tab';
      style.textContent =
        '.vertical-tab-nav-item[data-setting-id="huawei-cloud-sync"] { display: none !important; }';
      root.appendChild(style);
      log('华为云同步侧栏入口已隐藏');
    } catch (e) {
      log('隐藏华为云同步侧栏入口失败 ' + (e && e.message ? e.message : e));
    }
  }

  // 注册设置页。必须晚于 window.app 赋值（发生在 ready 回调里）。
  function registerHcsTab() {
    var app = window.app;
    if (!app || !app.setting || typeof app.setting.addSettingTab !== 'function') {
      return false;
    }
    if (app.setting.settingTabs) {
      for (var i = 0; i < app.setting.settingTabs.length; i++) {
        if (app.setting.settingTabs[i].id === 'huawei-cloud-sync') return true;
      }
    }
    var Base = findSettingsTabBase();
    var baseSource = 'require';
    if (!Base) {
      // 回退取法：从已有设置页回溯原型链。
      // app.setting.settingTabs 的元素都是内部基类的实例。
      var tabs = app.setting.settingTabs;
      if (tabs && tabs.length) {
        Base = Object.getPrototypeOf(tabs[0]).constructor;
        baseSource = 'prototype';
      }
    }
    if (!Base) {
      log('无法取得设置页基类，华为云同步页未注册');
      return false;
    }
    buildHcsSettingsTabClass.Base = Base;
    var TabClass = buildHcsSettingsTabClass();
    try {
      app.setting.addSettingTab(new TabClass(app, app.setting));
      hideHcsTabEntry();
      log('华为云同步页已注册，基类 ' + (Base.name || '匿名') + '，取法 ' + baseSource +
        '，已存在页数 ' + (app.setting.settingTabs ? app.setting.settingTabs.length : -1));
      return true;
    } catch (e) {
      log('华为云同步页注册失败 ' + (e && e.message ? e.message : e));
      return false;
    }
  }

  // ---------------------------------------------------------------
  // 3. 包装「外观」页与「关于」页的 getSettingDefinitions。
  //
  // 两页的定位按 id 判定（appearance、about），不依赖压缩后的类名。
  // 包装后调一次 update()：设置项在构造期间已缓存，不刷新看不到变化。
  // ---------------------------------------------------------------
  function patchPage(tabId, patcher) {
    var app = window.app;
    if (!app || !app.setting) return false;
    var tabs = app.setting.settingTabs;
    if (!tabs) return false;
    for (var i = 0; i < tabs.length; i++) {
      var tab = tabs[i];
      if (tab.id !== tabId) continue;
      if (tab.__ohsidianPatched) return true;
      var original = tab.getSettingDefinitions;
      if (typeof original !== 'function') continue;
      tab.getSettingDefinitions = function () {
        var items = original.apply(this, arguments);
        try {
          return patcher.call(this, items) || items;
        } catch (e) {
          log('设置页 ' + tabId + ' 改写失败 ' + (e && e.message ? e.message : e));
          return items;
        }
      };
      tab.__ohsidianPatched = true;
      try {
        tab.update();
      } catch (e) {
        log('设置页 ' + tabId + ' 刷新失败 ' + (e && e.message ? e.message : e));
      }
      return true;
    }
    return false;
  }

  // 「外观」页在 1.13.4 是混合结构：前几项是平铺的设置项（基础主题、强调色等），
  // 后面跟着两个分组（type:"group"）：字体、高级。translucency 在「高级」分组里。
  // 因此必须遍历全部条目与全部分组，不能在第一个分组就返回。
  function patchAppearance(items) {
    var list = items.items || items;
    if (!Array.isArray(list)) return items;
    var advanced = null;
    for (var i = 0; i < list.length; i++) {
      var entry = list[i];
      if (entry && entry.type === 'group' && Array.isArray(entry.items)) {
        advanced = entry;
      }
    }
    // 若将来结构变化找不到分组，则降级为平铺插入到末尾。
    var groupItems = advanced ? advanced.items : list;
    for (var j = 0; j < groupItems.length; j++) {
      var candidate = groupItems[j];
      if (candidate && candidate.name === '退出软件') return items;
    }
    var marker = -1;
    for (var k = 0; k < groupItems.length; k++) {
      var item = groupItems[k];
      if (item && typeof item.name === 'string' && item.name.indexOf('半透明') === 0) {
        marker = k;
        break;
      }
    }
    var toggle = {
      name: '退出软件',
      desc: '开启后，点击关闭按钮不会退出软件，需在托盘中退出软件',
      render: function (setting) {
        setting.addToggle(function (t) {
          return t.setValue(window.app.loadLocalStorage('exit-to-tray') !== '0')
            .onChange(function (value) {
              window.app.saveLocalStorage('exit-to-tray', value ? '1' : '0');
              sendSync('exit-to-tray', !!value);
            });
        });
      }
    };
    if (marker >= 0) {
      groupItems.splice(marker, 0, toggle);
    } else {
      groupItems.push(toggle);
    }
    log('外观页已插入退出软件开关；所在分组=' + (advanced ? '高级' : '平铺') +
      ' 位置=' + (marker >= 0 ? marker : groupItems.length - 1) +
      ' 该分组项名=' + groupItems.map(function (x) { return x.name; }).join('|'));
    return items;
  }

  // 「关于」页同样是混合结构：版本、更新开关等平铺项在前，
  // 账号分组在中间，高级分组（含硬件加速、命令行）在最后。
  // 「贡献作者」放在高级分组之前，与仓库原有的位置一致。
  // 商用许可证项在账号分组内，本项目不提供该购买入口，隐藏它。
  function patchAbout(items) {
    var list = items.items || items;
    if (!Array.isArray(list)) return items;

    // 隐藏商用许可证项。它在账号分组内，名称由 i18n 键
    // setting.account.option-commercial-license 生成（中文界面下为「商用许可证」）。
    // 名称逐字比较，不用关键词匹配，避免误伤其它条目。
    //
    // 做法是在定义项上置 visible:false。渲染流程 U2 → _2 里执行的是：
    //   e.settingEl.toggle(z2(e.def.visible, true))
    // 定义项没有 visible 字段时 z2 返回默认 true，把行重新显示出来，
    // 因此在 render 里调 setVisibility(false) 会被随后的这一步覆盖掉。
    //
    // 条目不能从列表里删除：官方在 render 里把这条例目的 Setting 实例
    // 存进 this.commercialLicenseSetting，紧接着调用 updateAccountSettings()，
    // 而该方法第一句就对这个引用调用 clear()。引用变成 undefined 时
    // 会立刻抛出异常，账号分组里其余条目的渲染也随之中断。
    var hidden = 0;
    var hideEntry = function (entry) {
      if (!entry || entry.name !== '商用许可证') return;
      entry.visible = false;
      hidden += 1;
    };
    for (var h = 0; h < list.length; h++) {
      var groupEntry = list[h];
      if (groupEntry && groupEntry.type === 'group' && Array.isArray(groupEntry.items)) {
        for (var m = 0; m < groupEntry.items.length; m++) hideEntry(groupEntry.items[m]);
      }
      hideEntry(groupEntry);
    }
    if (hidden > 0) log('关于页已隐藏商用许可证项 ' + hidden + ' 处');

    var exists = false;
    for (var i = 0; i < list.length; i++) {
      var entry = list[i];
      if (entry && entry.type === 'group' && Array.isArray(entry.items)) {
        for (var j = 0; j < entry.items.length; j++) {
          var inner = entry.items[j];
          if (inner && inner.name === '贡献作者') exists = true;
        }
      }
      if (entry && entry.name === '贡献作者') exists = true;
    }
    if (exists) return items;
    list.splice(1, 0, {
      name: '贡献作者',
      desc: '@MikannQAQ @HandwerSTD',
      render: function (setting) {
        setting.addButton(function (button) {
          return button.setButtonText('打开').onClick(function () {
            window.open('https://github.com/HandwerSTD/ObsidianHM', '_external');
          });
        });
      }
    });
    log('关于页已插入贡献作者条目；前四项名=' +
      list.slice(0, 4).map(function (x) { return x.name; }).join('|'));
    return items;
  }

  // 设置页的包装要等 window.app 出现。轮询等待，最多 15 秒。
  // 起始窗口（starter.html）也会加载本脚本，但它没有 window.app，
  // 轮询会自然结束；这是正常情况，不算失败。
  var appAttempts = 0;
  var appTimer = setInterval(function () {
    appAttempts += 1;
    var ready = !!window.app;
    if (ready) {
      clearInterval(appTimer);
      registerHcsTab();
      // 设置页的实例可能晚于 app 出现，稍后再包装一次。
      setTimeout(function () {
        registerHcsTab();
        var appearanceDone = patchPage('appearance', patchAppearance);
        var aboutDone = patchPage('about', patchAbout);
        log('设置页注入结束；外观页=' + appearanceDone + ' 关于页=' + aboutDone +
          '，页签数 ' + (window.app.setting.settingTabs ? window.app.setting.settingTabs.length : -1) +
          '，页签 id=' + (window.app.setting.settingTabs || []).map(function (t) { return t.id; }).join(','));
      }, 500);
      return;
    }
    if (appAttempts >= 150) {
      clearInterval(appTimer);
      // 起始窗口与帮助窗口没有 window.app，不需要设置页注入。
      if (document.querySelector('.starter')) {
        log('当前为起始窗口，无需设置页注入');
      } else {
        log('等待 window.app 超时，设置页注入放弃');
      }
    }
  }, 100);

  // ---------------------------------------------------------------
  // 4. 起始窗口的样式。
  // ---------------------------------------------------------------
  function applyStarterStyles() {
    try {
      if (!document.body) return;
      if (!document.querySelector('.starter')) return;
      var style = document.getElementById('ohsidian-starter-style');
      if (style) return;
      style = document.createElement('style');
      style.id = 'ohsidian-starter-style';
      style.textContent = [
        '.starter .titlebar { display: none; }',
        '.starter { padding-top: 30px !important; }'
      ].join('\n');
      document.head.appendChild(style);
      log('起始窗口样式已注入');
    } catch (e) {
      log('起始窗口样式注入失败 ' + (e && e.message ? e.message : e));
    }
  }

  // 页面结构可能晚于 dom-ready 完成，推迟一轮再施加 DOM 相关改动。
  setTimeout(function () {
    applyFrameAdjustments();
    applyStarterStyles();
    hideHcsTabEntry();
  }, 0);
})();

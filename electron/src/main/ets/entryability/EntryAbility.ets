// Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import window from '@ohos.window';
import Want from '@ohos.app.ability.Want';
import AbilityConstant from '@ohos.app.ability.AbilityConstant';
import { Configuration } from '@ohos.app.ability.Configuration';

import { WebAbility } from 'web_engine';
import { DeeplinkBridge } from '../utils/DeeplinkBridge';

export default class EntryAbility extends WebAbility {
  onConfigurationUpdate(config: Configuration) {
    super.onConfigurationUpdate(config);
  }

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam) {
    // 必须在 super 之前取：WebBaseAbility.initParameters 会把 want.uri
    // 当作起始页面地址读走（WebBaseAbility.ets:94），obsidian:// 会被
    // 当成要加载的页面。
    this.captureDeeplink(want);
    super.onCreate(want, launchParam);
  }

  onNewWant(want: Want, launchParam: AbilityConstant.LaunchParam) {
    // 这里必须也在 super 之前取：新模板的 WebAbility.onNewWant 会对非空的
    // want.uri 调 openURL()，若两条路都走，同一条链接会被派发两次。
    this.captureDeeplink(want);
    super.onNewWant(want, launchParam);
  }

  /**
   * 把 obsidian:// 链接写入 filesDir 下的队列文件，由 Electron 外层 main.js 轮询取走，
   * 交给 Obsidian 内建的 open-url 处理器。
   *
   * 必须用 applicationContext 的目录：UIAbilityContext.filesDir 带模块前缀
   * （haps/electron/files），而 Electron 的 userData 是应用级目录（files）。
   */
  private captureDeeplink(want: Want): void {
    let url: string | undefined = DeeplinkBridge.extractAndStrip(want);
    if (url === undefined) {
      return;
    }
    DeeplinkBridge.enqueue(this.context.getApplicationContext().filesDir, url);
  }

  async onPrepareToTerminateAsync(): Promise<boolean> {
    return await super.onPrepareToTerminateAsync();
  }

  async onDestroy(): Promise<void> {
    await super.onDestroy();
  }

  onWindowStageCreate(windowStage: window.WindowStage) {
    super.onWindowStageCreate(windowStage);
  }

  onWindowStageDestroy() {
    super.onWindowStageDestroy();
  }

  onForeground() {
    super.onForeground();
  }

  onBackground() {
    super.onBackground();
  }
};

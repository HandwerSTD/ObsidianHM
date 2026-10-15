// Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import AbilityStage from '@ohos.app.ability.AbilityStage';
import Inject from '../common/InjectModule';
import JsBindingUtils from '../utils/JsBindingUtils';
import LogUtil from '../utils/LogUtil';
import Want from '@ohos.app.ability.Want';
import { CommandType, ConfigData, ContextType } from '../common/Constants';
import { ConfigurationConstant, Configuration, AbilityConstant } from '@kit.AbilityKit';
import { NativeThemeAdapter } from '../adapter/NativeThemeAdapter';
import lazy { CommonDependencyProvider } from '../common/CommonDependencyProvider';
import lazy { GlobalThisHelper } from '../utils/GlobalThisHelper';
import lazy { NativeContext, BrowserCloseResponse, TrayExitResponse } from '../interface/CommonInterface';
import { VerifyLog } from '../utils/VerifyLog';

const DELAYED_TIME = 0;
const TAG: string = 'WebAbilityStage';
export class WebAbilityStage extends AbilityStage {

  private nativeContext: NativeContext | undefined = undefined;
  private nativeThemeAdapter: NativeThemeAdapter | undefined;
  private static SLEEP_INTERVAL_MS = 10;
  private static MAXIMUM_NUM_OF_SLEEP_CYCLES = 250;

  onCreate(): void {
    LogUtil.info(TAG, '[ohoswindow] in WebAbilityStage onCreate.');
    // 验证日志要先于一切可用；它与 Electron 外层 main.js 写同一个 obsidian.log。
    VerifyLog.init(this.context.getApplicationContext().filesDir);
    // native 取路径靠这一次推送，必须早于 runTaskAsync 里的 getNativeContext。
    JsBindingUtils.pushContextPaths(this.context.getApplicationContext());
    this.runTaskAsync();
  }

  onAcceptWant(want: Want): string {
    LogUtil.info(TAG, '[ohoswindow] in WebAbilityStage onAcceptWant, want is ' + JSON.stringify(want));
    let instanceKey = want.parameters?.instanceKey;
    if (instanceKey) {
      return instanceKey.toString();
    }
    if (GlobalThisHelper.isLaunched()) {
      if (want && want.parameters) {
        if (want.parameters["appId"] !== undefined) {
          let appId = want.parameters['appId'] as string;
          let xcomponentId = GlobalThisHelper.getWebappWindow(appId);
          if (xcomponentId !== '') {
            return xcomponentId;
          }
        }
      }
      let lastActiveBrowserId = GlobalThisHelper.getLastActiveBrowserId();
      if (lastActiveBrowserId !== undefined) {
        return lastActiveBrowserId;
      }
      let widgetId = this.nativeContext?.GetLastActiveWidgetId();
      if (widgetId) {
        return ConfigData.WINDOW_PREFIX + widgetId;
      }
    }
    this.context.getApplicationContext().tempDir;
    return ConfigData.DEFAULT_WINDOW_ID;
  }

  onPrepareTermination(): AbilityConstant.PrepareTermination {
    this.nativeContext?.ExecuteCommand(CommandType.kAppQuit, { is_sync: false });
    return AbilityConstant.PrepareTermination.TERMINATE_IMMEDIATELY;
  }

  onConfigurationUpdate(config: Configuration) {
    if (config.colorMode !== undefined) {
      this.nativeThemeAdapter?.setSystemNativeTheme(config.colorMode);
    }
  }

  async onPrepareTerminationAsync(): Promise<AbilityConstant.PrepareTermination> {
    LogUtil.info(TAG, "ability stage prepare to quit async - tray quit request");
    
    if (!this.nativeContext) {
      this.nativeContext = JsBindingUtils.getNativeContext(ContextType.kMainProcess);
    }
    
    if (!GlobalThisHelper.isLaunched()) {
      return AbilityConstant.PrepareTermination.TERMINATE_IMMEDIATELY;
    }

    LogUtil.info(TAG, "sending tray quit request to JS layer");
    this.nativeContext?.ExecuteCommand(
      CommandType.kTrayQuitRequest, { is_sync: false });
    
    let trayExitResponse: TrayExitResponse = TrayExitResponse.kUndetermined;
    let cnt = 0;
    for (let i = 0; i < WebAbilityStage.MAXIMUM_NUM_OF_SLEEP_CYCLES; i++) {
      cnt++;
      await this.sleep(WebAbilityStage.SLEEP_INTERVAL_MS);
      trayExitResponse = this.nativeContext.GetTrayExitResponse();
      if (trayExitResponse !== TrayExitResponse.kUndetermined) {
        break;
      }
    }
    
    LogUtil.info(TAG, `tray quit response: ${trayExitResponse} after ${cnt} checks`);
    
    if (trayExitResponse === TrayExitResponse.kPrevented || trayExitResponse === TrayExitResponse.kUndetermined) {
      LogUtil.info(TAG, "tray quit blocked by JS or timeout, returning CANCEL");
      return AbilityConstant.PrepareTermination.CANCEL;
    }
    
    LogUtil.info(TAG, "tray quit allowed, proceeding with standard quit flow");
    this.nativeContext?.ExecuteCommand(
      CommandType.kAppExit, { is_sync: false });
    
    let response: BrowserCloseResponse = BrowserCloseResponse.kUndetermined;
    cnt = 0;
    for (let i = 0; i < WebAbilityStage.MAXIMUM_NUM_OF_SLEEP_CYCLES; i++) {
      cnt++;
      await this.sleep(WebAbilityStage.SLEEP_INTERVAL_MS);
      response = this.nativeContext.GetAppCloseResponse();
      if (response !== BrowserCloseResponse.kUndetermined) {
        break;
      }
    }
    
    LogUtil.info(TAG, `app exit response: ${response} cnt: ${cnt}`);
    
    if (response === BrowserCloseResponse.kClosingContinue ||
        response === BrowserCloseResponse.kClosed) {
      return AbilityConstant.PrepareTermination.TERMINATE_IMMEDIATELY;
    }
    return AbilityConstant.PrepareTermination.CANCEL;
  }

  sleep(delay: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, delay));
  }

  onDestroy(): void {
    LogUtil.info(TAG, "ability stage on destroy");
  }

  private runTaskAsync() {
    setTimeout(() => {
      JsBindingUtils.initNativeContext(ContextType.kMainProcess);
      this.nativeContext = JsBindingUtils.getNativeContext(ContextType.kMainProcess);
      if (!GlobalThisHelper.isLaunched()) {
        let appContext = this.context.getApplicationContext();
        GlobalThisHelper.appInit(new CommonDependencyProvider(appContext));
      }
      import('../jsbindings/JsBindingMethod').then((ns:ESObject) => {
        ns.JsBindingMethod.bind();
        this.nativeThemeAdapter = Inject.get(NativeThemeAdapter);
      }).catch(()=>{
        LogUtil.error(TAG, 'runTaskAsync: import JsBindingMethod failed');
      });
    }, DELAYED_TIME)
  }
}

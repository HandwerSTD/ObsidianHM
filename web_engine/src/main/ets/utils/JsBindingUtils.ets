// Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import adapter from 'libadapter.so';
import common from '@ohos.app.ability.common';
import { ContextType } from '../common/Constants';
import { NativeContext } from '../interface/CommonInterface';
import { VerifyLog } from './VerifyLog';

export default class JsBindingUtils {
  private static currentContext: NativeContext;

  private static currentType: ContextType;

  private static pathsPushed: boolean = false;

  /**
   * 把沙箱路径推给 native 侧。
   *
   * 新一版 libadapter 的 ContextPathAdapter 不再反向问 ArkTS 要路径，
   * 而是由 ArkTS 在此一次性推过去；推之前 native 侧取到的是空串，
   * Electron 的 userData 会落到错误位置。
   */
  static pushContextPaths(appContext: common.ApplicationContext): void {
    if (JsBindingUtils.pathsPushed) {
      return;
    }
    JsBindingUtils.pathsPushed = true;
    let paths: Record<string, string> = {
      'filesDir': appContext.filesDir,
      'tempDir': appContext.tempDir,
      'cacheDir': appContext.cacheDir,
      'distributedFilesDir': appContext.distributedFilesDir,
      'databaseDir': appContext.databaseDir,
      'preferencesDir': appContext.preferencesDir
    };
    try {
      adapter.SetContextPaths(paths);
      VerifyLog.info('SetContextPaths OK filesDir=' + paths['filesDir'] +
        ' tempDir=' + paths['tempDir'] + ' cacheDir=' + paths['cacheDir']);
    } catch (err) {
      JsBindingUtils.pathsPushed = false;
      VerifyLog.error('SetContextPaths FAILED ' + JSON.stringify(err));
      console.error('SetContextPaths failed: ' + JSON.stringify(err));
    }
  }

  static initNativeContext(contextType: ContextType) {
    JsBindingUtils.currentType = contextType;
    JsBindingUtils.currentContext = adapter.getNativeContext(contextType);
  }

  static bindFunction(name: string, func: Function) {
    if (JsBindingUtils.currentContext === undefined) {
      JsBindingUtils.initNativeContext(ContextType.kMainProcess);
    }
    JsBindingUtils.currentContext.JSBind.bindFunction(name, func);
  }

  static callFunction(name: string, ...args: object[]) {
  }

  static getNativeContext(contextType: number): NativeContext {
    if (JsBindingUtils.currentType === contextType && JsBindingUtils.currentContext !== undefined) {
      return JsBindingUtils.currentContext;
    }
    return adapter.getNativeContext(contextType);
  }
}
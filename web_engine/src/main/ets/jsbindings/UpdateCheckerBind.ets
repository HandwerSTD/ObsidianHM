// Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * UpdateCheckerBind - 注册 UpdateChecker 的 AKI 绑定。
 *
 * Electron 主进程经 systemPreferences.callArkTSFunction 调用：
 *   SubscribeUpdateResult  注册持久结果回调，注册后立即推一次现有结果
 *   CheckNow               触发一次后台检查，结果经结果回调推送，
 *                          payload 带 JS 传入的 requestId 供配对 resolve
 */

import JsBindingUtils from '../utils/JsBindingUtils';
import Inject from '../common/InjectModule';
import lazy { UpdateChecker } from '../adapter/UpdateChecker';

function implUpdateChecker(): UpdateChecker {
    return Inject.getOrCreate(UpdateChecker);
}

function subscribeUpdateResult(callback: (payload: string) => void): void {
    implUpdateChecker().subscribeResult(callback);
}

function checkNow(requestId: string): void {
    implUpdateChecker().triggerCheckNow(requestId);
}

export class UpdateCheckerBind {
  static bind() {
    JsBindingUtils.bindFunction("UpdateChecker.SubscribeUpdateResult", subscribeUpdateResult);
    JsBindingUtils.bindFunction("UpdateChecker.CheckNow", checkNow);
  }
}

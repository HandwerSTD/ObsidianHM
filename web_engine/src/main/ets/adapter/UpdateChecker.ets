/*
 * Copyright (c) 2026 HandwerSTD
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this list of
 *    conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list
 *    of conditions and the following disclaimer in the documentation and/or other materials
 *    provided with the distribution.
 *
 * 3. Neither the name of the copyright holder nor the names of its contributors may be used
 *    to endorse or promote products derived from this software without specific prior written
 *    permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS;
 * OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
 * WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR
 * OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF
 * ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

import { injectable } from 'inversify';
import { http } from '@kit.NetworkKit';
import { bundleManager } from '@kit.AbilityKit';

import { BaseAdapter } from '../common/BaseAdapter';
import LogUtil from '../utils/LogUtil';
import { VerifyLog } from '../utils/VerifyLog';

const TAG: string = 'UpdateChecker';

/**
 * 远端版本号来源。这个地址与 AppScope/app.json5 同源，取的是仓库 main 分支上
 * 已发布的应用清单，只读 app.versionCode 一个字段。
 *
 * 该文件由本仓库控制，约定保持纯 JSON（无注释、无尾逗号）。
 * 若将来确实需要在里面写注释，在此处先剥离注释再解析。
 */
const REMOTE_APP_JSON5_URL: string =
  'https://raw.gitcode.com/handwer/ObsidianHM/raw/main/AppScope/app.json5';

/** 启动后首次检查的延迟，避开启动阶段。 */
const FIRST_CHECK_DELAY_MS: number = 30 * 1000;

/** 两次检查的间隔。 */
const CHECK_INTERVAL_MS: number = 6 * 60 * 60 * 1000;

const REQUEST_TIMEOUT_MS: number = 15 * 1000;

interface RemoteAppSection {
  versionCode?: number;
}

interface RemoteAppJson {
  app?: RemoteAppSection;
}

interface UpdateCheckResult {
  checkedAt: number;
  remoteVersionCode: number;
  localVersionCode: number;
  hasUpdate: boolean;
}

/**
 * 检测更新。远端 versionCode 大于本机时把 hasUpdate 记为真。
 *
 * 结果保存在内存（lastResult），并经 JS 回调主动推给 Electron 主进程：
 * JS 启动后经 EtsBridge.SubscribeUpdateResult 注册持久回调，之后每次
 * checkOnce 完成（含定时检查与 CheckNow 触发的检查）都推一次。
 * Electron 主进程侧用 requestId 把推送与发起的 Promise 配对 resolve。
 */
@injectable()
export class UpdateChecker extends BaseAdapter {
  private lastResult: UpdateCheckResult | undefined = undefined;
  private resultHandler: ((payload: string) => void) | undefined = undefined;

  startPolling(): void {
    LogUtil.info(TAG, `启动检测更新，${FIRST_CHECK_DELAY_MS / 1000} 秒后首次检查，` +
      `此后每 ${CHECK_INTERVAL_MS / 1000 / 60 / 60} 小时一次`);
    setTimeout((): void => {
      this.checkOnce();
      setInterval((): void => {
        this.checkOnce();
      }, CHECK_INTERVAL_MS);
    }, FIRST_CHECK_DELAY_MS);
  }

  /**
   * 注册结果推送回调，由 JS 经 EtsBridge.SubscribeUpdateResult 调用。
   * 注册后立即把现有结果推一次，JS 侧据此初始化缓存。
   */
  subscribeResult(handler: (payload: string) => void): void {
    this.resultHandler = handler;
    VerifyLog.info('update-check result handler registered');
    if (this.lastResult !== undefined) {
      this.deliver(this.lastResult);
    }
  }

  /**
   * 立即触发一次后台检查，同步返回。结果经结果回调推送，
   * JS 侧按 requestId 配对 resolve 对应的 Promise。
   * 供 EtsBridge 侧 UpdateChecker.CheckNow 绑定调用；requestId 由 JS 生成传入。
   *
   * AKI 绑定要求同步返回，而 HTTP 只有异步接口：同步等待完成
   * （忙等或休眠）会阻塞 ArkTS 单线程事件循环，HTTP 完成回调永远进不来。
   * 因此这里只负责触发。
   */
  triggerCheckNow(requestId: string): void {
    LogUtil.info(TAG, `收到立即检查的请求 id=${requestId}`);
    VerifyLog.info('update-check trigger via CheckNow id=' + requestId);
    this.checkOnce(requestId);
  }

  async checkOnce(requestId: string = ''): Promise<void> {
    let request: http.HttpRequest | null = null;
    try {
      let localVersionCode: number = bundleManager.getBundleInfoForSelfSync(
        bundleManager.BundleFlag.GET_BUNDLE_INFO_DEFAULT).versionCode;
      LogUtil.info(TAG, `本机 versionCode ${localVersionCode}`);

      request = http.createHttp();
      let response: http.HttpResponse = await request.request(REMOTE_APP_JSON5_URL, {
        method: http.RequestMethod.GET,
        expectDataType: http.HttpDataType.STRING,
        connectTimeout: REQUEST_TIMEOUT_MS,
        readTimeout: REQUEST_TIMEOUT_MS
      });
      LogUtil.info(TAG, `拉取远端 app.json5，responseCode ${response.responseCode}`);
      if (response.responseCode !== http.ResponseCode.OK) {
        LogUtil.error(TAG, `拉取远端 app.json5 失败，responseCode ${response.responseCode}`);
        VerifyLog.error('update-check HTTP ' + response.responseCode + ' requestId=' + requestId);
        // CheckNow 发起的 Promise 需要被 reject 而非超时，失败也要推。
        if (requestId !== '') {
          this.deliverError(requestId, 'update check failed: HTTP ' + response.responseCode);
        }
        return;
      }

      let remote: RemoteAppJson = JSON.parse(response.result as string) as RemoteAppJson;
      if (remote.app === undefined || remote.app.versionCode === undefined) {
        LogUtil.error(TAG, '远端 app.json5 里没有 app.versionCode');
        VerifyLog.error('update-check no versionCode in remote app.json5 requestId=' + requestId);
        if (requestId !== '') {
          this.deliverError(requestId, 'update check failed: remote app.json5 has no app.versionCode');
        }
        return;
      }
      let remoteVersionCode: number = remote.app.versionCode;
      let result: UpdateCheckResult = {
        checkedAt: Date.now(),
        remoteVersionCode: remoteVersionCode,
        localVersionCode: localVersionCode,
        hasUpdate: remoteVersionCode > localVersionCode
      };
      LogUtil.info(TAG, `远端 versionCode ${remoteVersionCode}，本机 ${localVersionCode}，` +
        `hasUpdate ${result.hasUpdate}`);
      this.lastResult = result;
      this.deliver(result, requestId);
      VerifyLog.info('update-check remote=' + remoteVersionCode + ' local=' + localVersionCode +
        ' hasUpdate=' + result.hasUpdate + ' requestId=' + requestId);
    } catch (err) {
      LogUtil.error(TAG, `检测更新失败: ${JSON.stringify(err)}`);
      VerifyLog.error('update-check FAILED ' + JSON.stringify(err) + ' requestId=' + requestId);
      // 失败也要推，CheckNow 发起的 Promise 需要被 reject 而非超时。
      if (requestId !== '') {
        this.deliverError(requestId, 'update check failed: ' + JSON.stringify(err));
      }
    } finally {
      if (request) {
        request.destroy();
      }
    }
  }

  /**
   * 把结果经回调推给 Electron 主进程。
   * payload 带 requestId（定时检查为空串），JS 侧据此配对 Promise。
   */
  private deliver(result: UpdateCheckResult, requestId: string = ''): void {
    let handler = this.resultHandler;
    if (handler === undefined) {
      return;
    }
    let payload = JSON.stringify({ type: 'result', requestId: requestId, result: result });
    try {
      handler(payload);
      VerifyLog.info('update-check result pushed requestId=' + requestId);
    } catch (err) {
      VerifyLog.error('update-check push FAILED ' + JSON.stringify(err));
    }
  }

  private deliverError(requestId: string, message: string): void {
    let handler = this.resultHandler;
    if (handler === undefined) {
      return;
    }
    let payload = JSON.stringify({ type: 'error', requestId: requestId, message: message });
    try {
      handler(payload);
    } catch (err) {
      VerifyLog.error('update-check pushError FAILED ' + JSON.stringify(err));
    }
  }
}

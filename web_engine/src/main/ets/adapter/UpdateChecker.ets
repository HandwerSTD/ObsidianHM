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
import { fileIo } from '@kit.CoreFileKit';

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

/**
 * 结果文件名。写入 filesDir 后由 Electron 外层读取，
 * 改名需要同时修改 resfile/resources/app/main.js。
 */
const RESULT_FILE_NAME: string = 'update-check.json';

/**
 * 检查触发文件名。Electron 外层在「检查更新」按钮点击时写入这个文件，
 * 本适配器轮询发现后删除它并立即跑一次 checkOnce。
 * 改名需要同时修改 resfile/resources/app/main.js 的 UPDATE_CHECK_TRIGGER_FILE。
 */
const TRIGGER_FILE_NAME: string = 'update-check.now';

/** 启动后首次检查的延迟，避开启动阶段。 */
const FIRST_CHECK_DELAY_MS: number = 30 * 1000;

/** 两次检查的间隔。 */
const CHECK_INTERVAL_MS: number = 6 * 60 * 60 * 1000;

/** 轮询触发文件的间隔。用户点击「检查更新」后要求秒级响应。 */
const TRIGGER_POLL_INTERVAL_MS: number = 3 * 1000;

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
 * 检测更新。远端 versionCode 大于本机时把 hasUpdate 记为真，
 * 结果写入 filesDir/update-check.json 供 Electron 外层读取。
 *
 * Electron 的渲染进程没有按名调用 ArkTS 绑定的入口，只有文件中转这一条路，
 * 与 deeplink 队列（obsidian-deeplink.pending）用的是同一个目录约定。
 */
@injectable()
export class UpdateChecker extends BaseAdapter {
  private polling: boolean = false;

  startPolling(context: Context): void {
    if (this.polling) {
      return;
    }
    this.polling = true;
    LogUtil.info(TAG, `启动检测更新，${FIRST_CHECK_DELAY_MS / 1000} 秒后首次检查，` +
      `此后每 ${CHECK_INTERVAL_MS / 1000 / 60 / 60} 小时一次`);
    setTimeout((): void => {
      this.checkOnce(context);
      setInterval((): void => {
        this.checkOnce(context);
      }, CHECK_INTERVAL_MS);
    }, FIRST_CHECK_DELAY_MS);

    // 用户手动触发的检查。与上面的定时检查互不影响，两者都只是调 checkOnce。
    setInterval((): void => {
      this.checkTriggerFile(context);
    }, TRIGGER_POLL_INTERVAL_MS);
  }

  /**
   * 检查 Electron 外层是否写下了触发文件。存在时删除并立即检查一次。
   */
  private checkTriggerFile(context: Context): void {
    const triggerPath: string = context.getApplicationContext().filesDir + '/' + TRIGGER_FILE_NAME;
    try {
      if (!fileIo.accessSync(triggerPath)) {
        return;
      }
      fileIo.unlinkSync(triggerPath);
      LogUtil.info(TAG, '发现用户触发的检查更新请求，立即检查一次');
      VerifyLog.info('update-check trigger file seen');
      this.checkOnce(context);
    } catch (err) {
      LogUtil.error(TAG, `处理 ${triggerPath} 失败: ${JSON.stringify(err)}`);
    }
  }

  async checkOnce(context: Context): Promise<void> {
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
        return;
      }

      let remote: RemoteAppJson = JSON.parse(response.result as string) as RemoteAppJson;
      if (remote.app === undefined || remote.app.versionCode === undefined) {
        LogUtil.error(TAG, '远端 app.json5 里没有 app.versionCode');
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
      this.writeResult(context, result);
      VerifyLog.info('update-check remote=' + remoteVersionCode + ' local=' + localVersionCode +
        ' hasUpdate=' + result.hasUpdate);
    } catch (err) {
      LogUtil.error(TAG, `检测更新失败: ${JSON.stringify(err)}`);
      VerifyLog.error('update-check FAILED ' + JSON.stringify(err));
    } finally {
      if (request) {
        request.destroy();
      }
    }
  }

  private writeResult(context: Context, result: UpdateCheckResult): void {
    let resultPath: string = context.getApplicationContext().filesDir + '/' + RESULT_FILE_NAME;
    let file: fileIo.File | null = null;
    try {
      file = fileIo.openSync(resultPath,
        fileIo.OpenMode.CREATE | fileIo.OpenMode.WRITE_ONLY | fileIo.OpenMode.TRUNC);
      fileIo.writeSync(file.fd, JSON.stringify(result));
      LogUtil.info(TAG, `已写入 ${resultPath}: ${JSON.stringify(result)}`);
    } catch (err) {
      LogUtil.error(TAG, `写入 ${resultPath} 失败: ${JSON.stringify(err)}`);
    } finally {
      if (file) {
        try {
          fileIo.closeSync(file);
        } catch (closeErr) {
          LogUtil.error(TAG, `关闭 ${resultPath} 失败: ${JSON.stringify(closeErr)}`);
        }
      }
    }
  }
}

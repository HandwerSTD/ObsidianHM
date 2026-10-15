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

import { Want } from '@kit.AbilityKit';
import fs from '@ohos.file.fs';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { VerifyLog } from 'web_engine';

const DOMAIN_ID: number = 0x0000;
const TAG: string = 'OHSidianDeeplink';
const SCHEME_PREFIX: string = 'obsidian://';

/**
 * deeplink 队列文件名。ArkTS 侧追加写入，Electron 主进程侧读取后删除，
 * 两端共用这一份约定，改名需要同时修改 resfile/resources/app/main.js。
 */
export const DEEPLINK_QUEUE_FILE: string = 'obsidian-deeplink.pending';

export class DeeplinkBridge {
  /**
   * 从 want 中取出 obsidian:// 链接，并把它从 want 里清除。
   *
   * WebBaseAbility.initParameters 会把 want.uri 当作起始页面地址读取，
   * deeplink 并不是可加载的页面，留着会让 Electron 尝试打开一个不存在的地址。
   */
  static extractAndStrip(want: Want): string | undefined {
    let raw = want.uri;
    hilog.info(DOMAIN_ID, TAG, '收到 want, uri = %{public}s', raw === undefined ? '(未设置)' : raw);
    VerifyLog.info('want arrived, uri=' + (raw === undefined ? '(未设置)' : raw));
    if (typeof raw !== 'string') {
      return undefined;
    }
    let url = raw.trim();
    if (!url.startsWith(SCHEME_PREFIX)) {
      hilog.info(DOMAIN_ID, TAG, 'uri 不是 obsidian 链接, 忽略');
      VerifyLog.info('want uri not obsidian scheme, ignored');
      return undefined;
    }
    want.uri = '';
    VerifyLog.info('want uri stripped, url=' + url);
    return url;
  }

  /**
   * 把链接追加到队列文件。
   *
   * 追加而不是覆盖：应用未运行时收到的多条链接要能全部保留下来。
   * 采用文件队列是因为 ArkTS 到 Electron 主进程之间只有 ExecuteCommand 一条通道，
   * 而它只覆盖窗口管理，无法把链接送进 Obsidian 的 open-url 处理器。
   */
  static enqueue(filesDir: string, url: string): boolean {
    let queuePath = filesDir + '/' + DEEPLINK_QUEUE_FILE;
    let fd = -1;
    try {
      let file = fs.openSync(queuePath,
        fs.OpenMode.WRITE_ONLY | fs.OpenMode.CREATE | fs.OpenMode.APPEND);
      fd = file.fd;
      fs.writeSync(fd, url + '\n');
      fs.closeSync(fd);
      fd = -1;
      hilog.info(DOMAIN_ID, TAG, '已入队 %{public}s 到 %{public}s', url, queuePath);
      VerifyLog.info('deeplink enqueued url=' + url);
      return true;
    } catch (err) {
      hilog.error(DOMAIN_ID, TAG, '入队失败 %{public}s, %{public}s', url, JSON.stringify(err));
      VerifyLog.error('deeplink enqueue FAILED url=' + url + ' ' + JSON.stringify(err));
      return false;
    } finally {
      if (fd >= 0) {
        try {
          fs.closeSync(fd);
        } catch (closeErr) {
          hilog.error(DOMAIN_ID, TAG, '关闭队列文件失败, %{public}s', JSON.stringify(closeErr));
        }
      }
    }
  }
}
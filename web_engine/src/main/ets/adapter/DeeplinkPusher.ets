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

import fs from '@ohos.file.fs';

import { BaseAdapter } from '../common/BaseAdapter';
import LogUtil from '../utils/LogUtil';
import { VerifyLog } from '../utils/VerifyLog';

const TAG: string = 'DeeplinkPusher';

/**
 * 回调未注册期间（冷启动，Electron JS 尚未起来）的缓冲文件。
 * JS 注册回调时会主动取走里面的存量，之后新链接直接推回调。
 */
const BUFFER_FILE_NAME: string = 'obsidian-deeplink.pending';

type DeeplinkHandler = (payload: string) => void;

/**
 * obsidian:// 链接从 ArkTS 推送到 Electron 主进程。
 *
 * Electron JS 启动后经 EtsBridge.SubscribeDeeplink 把回调传入并长期持有，
 * 之后 WebAbility 收到的链接直接经回调进主进程，替代 500ms 文件轮询。
 * 回调未注册期间的链接写入 BUFFER_FILE_NAME 缓冲，注册后由 drainBuffer
 * 一次性送出，因此冷启动期间的链接不会丢。
 */
export class DeeplinkPusher extends BaseAdapter {
  private handler: DeeplinkHandler | undefined = undefined;
  private bufferDir: string = '';

  /**
   * 由 JS 经 EtsBridge.SubscribeDeeplink 调用。传入回调并立即送出缓冲存量。
   * filesDir 是 applicationContext.filesDir，与 Electron 的 userData 同一目录。
   */
  subscribe(handler: DeeplinkHandler, filesDir: string): void {
    this.handler = handler;
    this.bufferDir = filesDir;
    VerifyLog.info('deeplink subscribe registered');
    this.drainBuffer();
  }

  /**
   * 由 WebAbility（经 EntryAbility.captureDeeplink）调用。
   * 回调已注册时直接推送，否则写入缓冲文件。
   */
  push(url: string): void {
    if (this.handler !== undefined) {
      this.deliver(url);
      return;
    }
    this.enqueueBuffer(url);
  }

  /**
   * 注册回调时把缓冲文件里的存量链接逐条送出，然后删除文件。
   */
  private drainBuffer(): void {
    let bufferPath = this.bufferDir + '/' + BUFFER_FILE_NAME;
    let raw: string;
    try {
      if (!fs.accessSync(bufferPath)) {
        return;
      }
      raw = fs.readTextSync(bufferPath);
      fs.unlinkSync(bufferPath);
    } catch (err) {
      VerifyLog.error('deeplink drainBuffer read FAILED ' + JSON.stringify(err));
      return;
    }
    let urls = raw.split('\n')
      .map((line: string): string => line.trim())
      .filter((line: string): boolean => line.length > 0);
    if (urls.length === 0) {
      return;
    }
    VerifyLog.info('deeplink drainBuffer count=' + urls.length);
    urls.forEach((url: string): void => {
      this.deliver(url);
    });
  }

  private enqueueBuffer(url: string): void {
    if (this.bufferDir === '') {
      // startPolling 之前收到的链接没有可写目录，直接丢弃并记录。
      VerifyLog.error('deeplink enqueueBuffer no bufferDir, dropped url=' + url);
      return;
    }
    let bufferPath = this.bufferDir + '/' + BUFFER_FILE_NAME;
    let fd = -1;
    try {
      let file = fs.openSync(bufferPath,
        fs.OpenMode.WRITE_ONLY | fs.OpenMode.CREATE | fs.OpenMode.APPEND);
      fd = file.fd;
      fs.writeSync(fd, url + '\n');
      VerifyLog.info('deeplink buffered url=' + url);
    } catch (err) {
      VerifyLog.error('deeplink enqueueBuffer FAILED url=' + url + ' ' + JSON.stringify(err));
    } finally {
      if (fd >= 0) {
        try {
          fs.closeSync(fd);
        } catch (closeErr) {
          VerifyLog.error('deeplink enqueueBuffer close FAILED ' + JSON.stringify(closeErr));
        }
      }
    }
  }

  private deliver(url: string): void {
    let handler = this.handler;
    if (handler === undefined) {
      return;
    }
    try {
      handler(url);
      VerifyLog.info('deeplink pushed url=' + url);
    } catch (err) {
      VerifyLog.error('deeplink push FAILED url=' + url + ' ' + JSON.stringify(err));
    }
  }
}

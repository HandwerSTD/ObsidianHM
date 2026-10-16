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
import { hilog } from '@kit.PerformanceAnalysisKit';
import { VerifyLog, DeeplinkPusher } from 'web_engine';

const DOMAIN_ID: number = 0x0000;
const TAG: string = 'OHSidianDeeplink';
const SCHEME_PREFIX: string = 'obsidian://';

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
   * 把链接交给 DeeplinkPusher。回调已注册时直接推送到 Electron 主进程，
   * 未注册时（冷启动）写入缓冲文件，注册后由 drainBuffer 一次性送出。
   *
   * 必须用 applicationContext 的目录：UIAbilityContext.filesDir 带模块前缀
   * （haps/electron/files），而 Electron 的 userData 是应用级目录（files）。
   */
  static push(pusher: DeeplinkPusher, url: string): void {
    pusher.push(url);
    hilog.info(DOMAIN_ID, TAG, '已交给 DeeplinkPusher %{public}s', url);
    VerifyLog.info('deeplink handed to pusher url=' + url);
  }
}
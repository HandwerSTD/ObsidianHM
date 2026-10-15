/*
 * Copyright (c) 2026 HandwerSTD
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this list of
 *    conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list of
 *    conditions and the following disclaimer in the documentation and/or other materials
 *    provided with the distribution.
 *
 * 3. Neither the name of the copyright holder nor the names of its contributors may be used
 *    to endorse or promote products derived from this software without specific prior written
 *    permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */

import { fileIo } from '@kit.CoreFileKit';

/**
 * 升级验证专用的统一日志出口。
 *
 * 与 Electron 外层 main.js 的 `log()` 写同一个文件 `filesDir/obsidian.log`，
 * 两侧都用 `[OHSV]` 前缀，一次 tail 就能拿全所有待验证项。
 *
 * 时间戳是本地时间，与 main.js 的 UTC 差 8 小时；按顺序读即可。
 */
export class VerifyLog {
  private static readonly FILE_NAME: string = 'obsidian.log';
  private static readonly PREFIX: string = '[OHSV]';

  private static filesDir: string = '';

  /**
   * 由 WebAbilityStage.onCreate 调用，早于任何一条验证日志。
   * 传 applicationContext 的 filesDir，与 Electron 的 userData 同一目录。
   */
  static init(filesDir: string): void {
    VerifyLog.filesDir = filesDir;
  }

  static info(message: string): void {
    VerifyLog.write(message);
  }

  static warn(message: string): void {
    VerifyLog.write('WARN ' + message);
  }

  static error(message: string): void {
    VerifyLog.write('ERROR ' + message);
  }

  private static write(message: string): void {
    if (VerifyLog.filesDir === '') {
      return;
    }
    let file: fileIo.File | null = null;
    try {
      file = fileIo.openSync(VerifyLog.filesDir + '/' + VerifyLog.FILE_NAME,
        fileIo.OpenMode.CREATE | fileIo.OpenMode.WRITE_ONLY | fileIo.OpenMode.APPEND);
      let d = new Date();
      let ts = d.getFullYear() + '-' + VerifyLog.pad(d.getMonth() + 1) + '-' +
        VerifyLog.pad(d.getDate()) + ' ' + VerifyLog.pad(d.getHours()) + ':' +
        VerifyLog.pad(d.getMinutes()) + ':' + VerifyLog.pad(d.getSeconds()) + '.' +
        ('00' + d.getMilliseconds()).slice(-3);
      fileIo.writeSync(file.fd, ts + ' ' + VerifyLog.PREFIX + ' ' + message + '\n');
    } catch (err) {
      // 验证日志写失败不影响主流程，也不再递归报错。
    } finally {
      if (file) {
        try {
          fileIo.closeSync(file);
        } catch (closeErr) {
        }
      }
    }
  }

  private static pad(n: number): string {
    return n < 10 ? '0' + n : '' + n;
  }
}

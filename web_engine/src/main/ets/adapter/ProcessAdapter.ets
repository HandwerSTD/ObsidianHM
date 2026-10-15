/*
 * Copyright (c) 2023-2026 Huawei Device Co., Ltd.
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice,
 * this list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 * this list of conditions and the following disclaimer in the documentation
 * and/or other materials provided with the distribution.
 *
 * 3. Neither the name of the copyright holder nor the names of its contributors
 * may be used to endorse or promote products derived from this software without
 * specific prior written permission.
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
import childProcessManager from '@ohos.app.ability.childProcessManager';
import { BusinessError } from '@ohos.base';

import { BaseAdapter } from '../common/BaseAdapter';
import LogUtil from '../utils/LogUtil';
import LogMethod from '../common/LogDecorator';
import { ChildProcessArgs, ChildProcessOptions } from '@kit.AbilityKit';

interface ChildProcessLaunchOptions {
  srcEntry: string;
  startMode: number;
  entryParams: string;
  fds: Record<string, number>;
  isolationMode: boolean;
}

function fireProcessBind(
  srcEntry: string,
  entryParams: string,
  fds: Record<string, number>,
  isolationMode: boolean,
  callback: Function
): void {
  const invalidPid: number = -1;
  try {
    const args: ChildProcessArgs = {
      entryParams: entryParams,
      fds: fds
    };
    const opts: ChildProcessOptions = {
      isolationMode: isolationMode
    };
    LogUtil.info('ProcessAdapter', `startArkChildProcess args: ${JSON.stringify(args)}`);
    childProcessManager.startArkChildProcess(srcEntry, args, opts)
      .then((result) => {
        callback(result);
      }, (err: BusinessError) => {
        callback(invalidPid);
        LogUtil.error('ProcessAdapter', `startArkChildProcess failed: ${err}, srcEntry: ${srcEntry}`);
      });
  } catch (err) {
    callback(invalidPid);
    LogUtil.error('ProcessAdapter', `startArkChildProcess failed: ${err}, srcEntry: ${srcEntry}`);
  }
}

@injectable()
export class ProcessAdapter extends BaseAdapter {
  @LogMethod
  startChildProcess(
    srcEntry: string,
    entryParams: string,
    fds: Record<string, number>,
    isolationMode: boolean,
    callback: Function
  ): void {
    fireProcessBind(srcEntry, entryParams, fds, isolationMode, callback);
  }
}

/*
 * Copyright (c) 2023-2025 Haitai FangYuan Co., Ltd.
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

import { injectable, inject } from 'inversify';
import { image } from '@kit.ImageKit';
import { JSON } from '@kit.ArkTS';
import { statusBarManager } from '@kit.StatusBarExtensionKit';

import { BaseAdapter } from '../common/BaseAdapter';
import LogUtil from '../utils/LogUtil';
import LogMethod from '../common/LogDecorator';
import emitter from '@ohos.events.emitter';
import { ContextAdapter } from './ContextAdapter';

const TAG: string = 'statusBar';
const TRAY_IMAGE_EDITABLE: boolean = false;
const TRAY_IMAGE_PIXEL_FORMAT: number = 4;
const BYTES_PER_PIXEL: number = 4;

interface MenuItem {
  title?: string,
  subTitle?: string,
  menuAction?: statusBarManager.StatusBarMenuAction,
  subMenu?: MenuItem[]
};

interface MenuRawData {
  acceleratorWorksWhenHidden?: boolean,
  checked?: boolean,
  commandId?: number,
  enabled?: boolean,
  label?: string,
  registerAccelerator?: boolean,
  role?: string,
  sublabel?: string,
  submenu?: MenuRawData[],
  toolTip?: string,
  type?: number,
  visible?: boolean
}

@injectable()
export class StatusBarManagerAdapter extends BaseAdapter {
  private TOOLTIPS: string = '';
  private TITLE: string = '';
  private isCreated: boolean = false;
  private quickOperationHeight: number = 100;
  private leftClickCallback: Function | undefined;
  private rightMenuCallback: Function | undefined;
  private ctxAdapter: ContextAdapter;

  constructor(
    @inject(ContextAdapter) ctxAdapter: ContextAdapter
  ) {
    super();
    this.ctxAdapter = ctxAdapter;
  }

@LogMethod
async SetImage(
  whiteWidth: number,
  whiteHeight: number,
  whiteIconBuffer: ArrayBuffer,
  onCompleted: (ret: boolean) => void,
  callback: () => void,
  blackWidth?: number,
  blackHeight?: number,
  blackIconBuffer?: ArrayBuffer
) {
  let whiteTrayIcon: image.PixelMap | undefined = this.convertImagePixelMap(whiteWidth, whiteHeight, whiteIconBuffer);
  let blackTrayIcon: image.PixelMap | undefined;

  if (blackWidth !== undefined && blackHeight !== undefined && blackIconBuffer !== undefined) {
    blackTrayIcon = this.convertImagePixelMap(blackWidth, blackHeight, blackIconBuffer);
  }

  if (blackTrayIcon === undefined && whiteTrayIcon !== undefined) {
    // 调用方只给了白色图标。状态栏在浅色背景下取 black 那一份，直接复用白图会看不见，
    // 因此由外层把白色图标反色成黑色图标。
    blackTrayIcon = this.invertIcon(whiteTrayIcon, whiteWidth, whiteHeight);
  }

  if (!this.isCreated) {
    try {
      statusBarManager.addToStatusBar(this.ctxAdapter.getActiveContext(), {
        icons: {
          white: whiteTrayIcon,
          black: blackTrayIcon ?? whiteTrayIcon
        },
        quickOperation: {
          title: this.TITLE,
          height: this.quickOperationHeight,
          moduleName: "electron",
          abilityName: "",
        },
        statusBarGroupMenu: [],
      }, () => {
        this.leftClickCallback = callback;
        statusBarManager.on('statusBarIconClick', () => {
          this.leftClickCallback?.();
        });
        let rightMenuClickCallback = (eventData: emitter.EventData) => {
          LogUtil.info(TAG, `rightMenuClickCallback is called. menuCode: ${eventData?.data?.menuCode}`);
          this.rightMenuCallback?.(Number(eventData?.data?.menuCode));
        }
        statusBarManager.on('rightMenuClick', rightMenuClickCallback);
        this.isCreated = true;
        onCompleted && onCompleted(true);
      });
    } catch (err) {
      LogUtil.error(TAG, `addToStatusBar failed. err: ${JSON.stringify(err)}`);
      onCompleted && onCompleted(false);
    }
  } else {
    try {
      statusBarManager.updateStatusBarIcon(this.ctxAdapter.getActiveContext(), {
        white: whiteTrayIcon,
        black: blackTrayIcon ?? whiteTrayIcon
      }, () => {
        onCompleted && onCompleted(true);
      });
    } catch(err) {
      LogUtil.error(TAG, `updateStatusBarIcon failed. err: ${JSON.stringify(err)}`);
      onCompleted && onCompleted(false);
    }
  }
}

  @LogMethod
  SetToolTips(tooltips: string) {
    this.TOOLTIPS = tooltips;
  }

  @LogMethod
  SetContextMenu(menu_model: string, onCompleted: (ret: boolean) => void, callback: (id: Number) => void) {
    LogUtil.debug(TAG, `JS SetContextMenu:: ${menu_model}`);
    try {
      let menu_json: MenuRawData[] = JSON.parse(menu_model) as MenuRawData[];
      const items: statusBarManager.StatusBarMenuItem[] = this.transformJsonToMenus(menu_json);
      const modified_items: statusBarManager.StatusBarMenuItem[] = this.processData(items) as statusBarManager.StatusBarMenuItem[];
      const menus: statusBarManager.StatusBarGroupMenu[] = [modified_items];
      try {
        statusBarManager.updateStatusBarMenu(this.ctxAdapter.getActiveContext(), menus, () => {onCompleted && onCompleted(true)});
      } catch (err){
        LogUtil.info(TAG, `updateStatusBarMenu failed. err: ${JSON.stringify(err)}`);
        onCompleted && onCompleted(false);
      }
      this.rightMenuCallback = callback;
    } catch (err) {
      LogUtil.error(TAG, 'SetContextMenu Error: ' + err);
      onCompleted && onCompleted(false);
    }
  }

  @LogMethod
  async RemoveFromStatusBar(onCompleted: (ret: boolean) => void) {
    try {
      try {
        statusBarManager.removeFromStatusBar(this.ctxAdapter.getActiveContext(), () => {
          this.isCreated = false;
          onCompleted && onCompleted(true);
        });
      } catch (err) {
        LogUtil.info(TAG, `removeFromStatusBar failed. err: ${JSON.stringify(err)}`);
        onCompleted && onCompleted(false);
      }
    } catch (err) {
      LogUtil.error(TAG, 'RemoveFromStatusBar Error: ' + err);
      onCompleted && onCompleted(false);
    } finally {
      statusBarManager.off('statusBarIconClick');
      statusBarManager.off('rightMenuClick');
    }
  }

  private recurse(items: MenuItem[] | undefined, isTopLevel: boolean = true): undefined | MenuItem[] {
    if (items === undefined) {
      return items;
    }
    items.map((item: MenuItem) => {
      if (!isTopLevel) {
        item.subTitle = item.title;
        item.title = undefined;
      }
      this.recurse(item.subMenu, false);
    });
    return items;
  }

  private processData(rawData: statusBarManager.StatusBarMenuItem[]) : MenuItem[] {
    let modifiedData: MenuItem[]  = JSON.parse(JSON.stringify(rawData)) as MenuItem[];
    return this.recurse(modifiedData) as MenuItem[];
  }


  private transformMenuItem(jsonItem: MenuRawData): statusBarManager.StatusBarMenuItem | statusBarManager.StatusBarSubMenuItem {
    const menuAction: statusBarManager.StatusBarMenuAction = {
      abilityName: 'StatusBarEntryAbility',
      moduleName: 'entry',
      notifyOnly: true,
      menuCode: jsonItem.commandId?.toString()
    };

    const menuItem: statusBarManager.StatusBarMenuItem = {
      title: jsonItem.label as string,
      menuAction: menuAction
    };

    if (jsonItem.submenu && jsonItem.submenu.length > 0) {
      menuItem.subMenu = jsonItem.submenu.map((subItem) => this.transformMenuItem(subItem) as statusBarManager.StatusBarSubMenuItem);
    }

    return menuItem;
  }

  private transformJsonToMenus(jsonData: MenuRawData[]): statusBarManager.StatusBarMenuItem[] {
    return jsonData.map(item => this.transformMenuItem(item) as statusBarManager.StatusBarMenuItem);
  }

  // 逐像素反色。图标是单色的，反色只作用于颜色通道，alpha 保持原样，
  // 这样图标的轮廓与抗锯齿边缘都不变，只有黑白互换。
  // 新建 PixelMap 用的是与白色图标完全相同的初始化参数，两者的数据解释方式因而一致。
  private invertIcon(source: image.PixelMap, width: number, height: number): image.PixelMap | undefined {
    let byteLength: number = width * height * BYTES_PER_PIXEL;
    let pixelBytes: number = source.getPixelBytesNumber();
    if (pixelBytes !== byteLength) {
      // 逐行反色要求缓冲区里没有行间填充字节。这里的 PixelMap 都是由定长缓冲区直接创建，
      // 每行字节数就是 width * 4，遇到不一致的情况就不做反色，保留原本的白图。
      LogUtil.warn(TAG, 'tray icon stride mismatch, skip invert: ' + pixelBytes + ' vs ' + byteLength);
      return undefined;
    }
    let pixels: ArrayBuffer = new ArrayBuffer(byteLength);
    let inverted: image.PixelMap | undefined;
    try {
      source.readPixelsToBufferSync(pixels);
      let bytes: Uint8Array = new Uint8Array(pixels);
      for (let offset: number = 0; offset + BYTES_PER_PIXEL <= byteLength; offset += BYTES_PER_PIXEL) {
        bytes[offset] = 255 - bytes[offset];
        bytes[offset + 1] = 255 - bytes[offset + 1];
        bytes[offset + 2] = 255 - bytes[offset + 2];
      }
      inverted = image.createPixelMapSync(pixels, {
        editable: TRAY_IMAGE_EDITABLE,
        pixelFormat: TRAY_IMAGE_PIXEL_FORMAT,
        size: {
          height: height,
          width: width
        }
      });
    } catch (error) {
      LogUtil.error(TAG, 'failed invert tray icon because: ' + JSON.stringify(error));
      return undefined;
    }
    LogUtil.info(TAG, 'tray icon inverted: ' + width + 'x' + height);
    return inverted;
  }

  private convertImagePixelMap(width: number, height: number, buff: ArrayBuffer): image.PixelMap | undefined {
    if (width === 0 || height === 0) {
      LogUtil.warn(TAG, 'image is empty, no conversion required');
      return undefined;
    }
    let opts: image.InitializationOptions = {
      editable: TRAY_IMAGE_EDITABLE,
      pixelFormat: TRAY_IMAGE_PIXEL_FORMAT,
      size: {
        height: height,
        width: width
      }
    }
    try {
      return image.createPixelMapSync(buff, opts);
    } catch (error) {
      LogUtil.error(TAG, 'failed convert image pixel map because: ' +  JSON.stringify(error));
      return undefined;
    }
  }
}

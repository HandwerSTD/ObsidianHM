/**
 * 启动性能打点的文件写入。
 *
 * hilog 缓冲会滚动，无法长期保留；obsidian-perf.txt 与 obsidian.log 同目录，
 * 持久化后可与外层 main.js 的 [PERF2] 行按 epoch 毫秒对齐分析。
 */
import { fileIo } from '@kit.CoreFileKit';
import LogUtil from './LogUtil';

const TAG: string = 'PerfProbe';
const PERF_FILE_NAME: string = 'obsidian-perf.txt';

/**
 * 追加一行打点到 filesDir/obsidian-perf.txt。
 *
 * @param {string} filesDir - 模块的 filesDir，与 obsidian.log 所在目录同级
 * @param {string} message - 打点内容，建议含 Date.now() 的 epoch 毫秒
 */
export function writePerfLine(filesDir: string, message: string): void {
  try {
    let perfPath = filesDir + '/' + PERF_FILE_NAME;
    let file = fileIo.openSync(perfPath,
      fileIo.OpenMode.CREATE | fileIo.OpenMode.WRITE_ONLY | fileIo.OpenMode.APPEND);
    fileIo.writeSync(file.fd, message + '\n');
    fileIo.closeSync(file);
  } catch (err) {
    LogUtil.warn(TAG, `writePerfLine failed: ${JSON.stringify(err)}`);
  }
}

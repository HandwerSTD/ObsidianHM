let path = require('path');
let util = require('util');
let os = require('os');
let crypto = require('crypto');
let fs = require('fs');
let zlib = require('zlib');
let EventEmitter = require('events');
let electron = require('electron');
let remote = electron.remote;
try {
	remote = require('@electron/remote/main');
	electron.remote = remote;
} catch (e) {
	console.warn('[HMOS-REMOTE] @electron/remote/main is unavailable, falling back to electron.remote', e);
	if (!remote) {
		remote = {
			initialize: () => {}
		};
		electron.remote = remote;
	}
}
// 启动性能打点：主进程入口开始的毫秒时钟（单调时钟差值才有意义，与 asar 入口共用）。
let __perfMainStartMs = -1;
let __perfAsarEntryMs = -1;
try {
	__perfMainStartMs = Date.now();
} catch (e) {}

let {app, protocol, net, Tray, Menu, BrowserWindow} = electron;

// 最小验证探针。obsidian.log 由第 280 行的 log() 写入，而探针需要在其之前执行，
// 因此这里自备一套写入，格式与 log() 一致（UTC 时间戳）。
let __probePath = path.join(app.getPath('userData'), 'obsidian.log');
function probe() {
	try {
		let d = new Date();
		let p2 = function (n) { return n < 10 ? '0' + n : '' + n; };
		let ts = d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()) +
			' ' + p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()) + ':' + p2(d.getUTCSeconds());
		let args = Array.prototype.slice.call(arguments);
		fs.appendFileSync(__probePath, ts + ' [PROBE] ' + util.format.apply(null, args) + os.EOL);
	} catch (e) {
		// 探针失败不影响启动
	}
}

// 启动性能打点：本文件开始执行的毫秒时钟。probe 定义在 __perfMainStartMs 赋值之后，
// 因此这条打点只能放在这里。
probe('[PERF2] file-start', __perfMainStartMs);

// 最小验证：官方 asar 的入口会读 process.versions.electron，主版本低于 18 时弹出
// 「Manual update required」并退出。该属性只读，改写需用 Object.defineProperty。
// 改写只作用于主进程。
let __realElectronVersion = process.versions.electron;
try {
	Object.defineProperty(process.versions, 'electron', {
		value: '18.0.0', writable: true, configurable: true, enumerable: true
	});
	probe('版本改写：真实值 %s -> 现值 %s', __realElectronVersion, process.versions.electron);
} catch (e) {
	probe('版本改写失败：%s', e && e.message ? e.message : String(e));
}

// 最小验证：1.13.4 的设置页默认在独立窗口打开，其渲染进程建立后立即同步调用
// remote.getCurrentWindow()，而 asar 内部要到 did-create-window 才开启 remote。
// 在 WebContents 创建时立即开启，早于该 WebContents 上的任何渲染进程脚本。
// 本函数注册于 asar 加载之前，因此比 asar 自己注册的同类监听先执行。
let __remoteDiag = null;
try {
	// 必须直接引 server.js：dist/src/main/index.js 只转发 initialize、isInitialized、enable
	// 三个导出，不含诊断用的 isRemoteModuleEnabled。
	// server.js 正是 enable 的定义处，与第 11 行的 require('@electron/remote/main')
	// 解析到同一个模块实例（main/index.js -> ../dist/src/main -> ./server）。
	__remoteDiag = require('@electron/remote/dist/src/main/server');
} catch (e) {
	probe('无法载入 remote 诊断模块：%s', e && e.message ? e.message : String(e));
}

app.on('web-contents-created', function (event, contents) {
	if (!contents) {
		return;
	}
	let type = typeof contents.getType === 'function' ? contents.getType() : '未知';
	let before = null;
	try {
		before = __remoteDiag ? __remoteDiag.isRemoteModuleEnabled(contents) : null;
	} catch (e) {}
	if (!remote || typeof remote.enable !== 'function') {
		probe('WebContents %s 类型 %s：remote.enable 不可用', contents.id, type);
		return;
	}
	if (type === 'webview') {
		// 与官方 asar 的处理保持一致：webview 不受信任，不开启。
		probe('WebContents %s 类型 %s：跳过（webview）', contents.id, type);
		return;
	}
	try {
		remote.enable(contents);
		let after = null;
		try {
			after = __remoteDiag ? __remoteDiag.isRemoteModuleEnabled(contents) : null;
		} catch (e) {}
		probe('WebContents %s 类型 %s：remote 开启前 %s 开启后 %s', contents.id, type, before, after);
		probe('[PERF2] webcontents-created', contents.id, type, Date.now());
	} catch (e) {
		probe('WebContents %s 类型 %s：remote.enable 抛错 %s', contents.id, type, e && e.message ? e.message : String(e));
	}
});

if (remote && typeof remote.initialize === 'function') {
	remote.initialize();
}

protocol.registerSchemesAsPrivileged([
	{scheme: 'app', privileges: {standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true}}
]);

let updateEvents = new EventEmitter();

let insider = false;
let disable = false;
let silence = false;
updateEvents.on('insider', (arg) => {
	insider = arg;
});
updateEvents.on('disable', (arg) => {
	disable = arg;
});
updateEvents.on('silence', (arg) => {
	silence = arg;
});

let APP_PATH = (() => {
	let path = app.getAppPath();
	let asar_index = path.indexOf('app.asar');
	if (asar_index >= 0) {
		return path.slice(0, asar_index);
	}
	return path;
})();

let currentBaseVersion = require('./package.json').version || app.getVersion();
let currentPackageVersion = currentBaseVersion;
let dataPath = app.getPath('userData');

// 托盘与关窗到托盘的状态。
// exitToTrayEnabled 与渲染进程「设置 → 外观 → 退出软件」开关对应，默认开启：
// 开关的初始值取 localStorage 的 exit-to-tray，缺省时视为开启，两处默认值必须一致。
// quitRequested 用于区分「关窗」与「真正退出」，before-quit 触发时置为 true。
let exitToTrayEnabled = true;
let quitRequested = false;
let trayIcon = null;

// 窗口登记与窗口生命周期。
//
// 与官方一致：起始窗口打开仓库成功后自己关闭，仓库窗口关闭时按官方逻辑退出应用
// （非 darwin 平台上 window-all-closed 会调 app.quit）。不在这里复现仓库版本原来
// 的「窗口复用」——那需要改写 asar 内部的窗口创建分支，外层拿不到等价接口。
//
// 本层只做一件与官方不同的事：「关窗不退出」。仓库窗口的 close 被拦下并隐藏，
// 托盘提供「显示」与「退出软件」两个出口。这条路径不涉及渲染进程，
// 因此注入脚本不需要覆盖 window.close。

// 已创建的窗口。托盘菜单与「显示」菜单项需要一个可聚焦的窗口。
// 键是窗口 id，值是 BrowserWindow。窗口关闭时移除。
let knownWindows = new Map();

// 窗口类别由 URL 判定。1.13.4 的三种页面：仓库窗口 index.html、
// 起始窗口 starter.html、帮助窗口 help.html。设置弹窗走 about:blank。
function windowKind(webContents) {
	let url = '';
	try {
		url = webContents.getURL() || '';
	} catch (e) {
		return 'unknown';
	}
	if (url.indexOf('index.html') >= 0) return 'vault';
	if (url.indexOf('starter.html') >= 0) return 'starter';
	if (url.indexOf('help.html') >= 0) return 'help';
	if (url === 'about:blank' || url === '') return 'popup';
	return 'unknown';
}

// 托盘与「显示」菜单项作用的目标窗口：优先仓库窗口，其次任意已登记窗口。
function focusedWindow() {
	for (let w of knownWindows.values()) {
		try {
			if (windowKind(w.webContents) === 'vault') return w;
		} catch (e) {}
	}
	for (let w of knownWindows.values()) {
		return w;
	}
	return null;
}

function itemExists(filePath) {
	try {
		fs.accessSync(filePath);
		return true;
	} catch (e) {
		return false;
	}
}

function normalizeForPrefix(filePath) {
	return path.resolve(filePath).replace(/\\/g, '/');
}

function getVaultTrashDir(targetPath) {
	try {
		let obsidianConfigPath = path.join(dataPath, 'obsidian.json');
		if (fs.existsSync(obsidianConfigPath)) {
			let obsidianConfig = JSON.parse(fs.readFileSync(obsidianConfigPath, 'utf8'));
			let vaults = obsidianConfig && obsidianConfig.vaults;
			if (vaults) {
				let normalizedTarget = normalizeForPrefix(targetPath);
				let matchedVaultPath = null;
				for (let id of Object.keys(vaults)) {
					let vaultPath = vaults[id] && vaults[id].path;
					if (!vaultPath || !fs.existsSync(vaultPath)) continue;
					let normalizedVault = normalizeForPrefix(vaultPath);
					if (normalizedTarget === normalizedVault || normalizedTarget.startsWith(normalizedVault + '/')) {
						if (!matchedVaultPath || normalizedVault.length > normalizeForPrefix(matchedVaultPath).length) {
							matchedVaultPath = vaultPath;
						}
					}
				}
				if (matchedVaultPath) return path.join(matchedVaultPath, '.trash');
			}
		}
		return getVaultTrashDirByFilesystem(targetPath);
	} catch (e) {
		console.error('[HMOS-TRASH] failed to resolve vault trash dir', e);
		return getVaultTrashDirByFilesystem(targetPath);
	}
}

function getVaultTrashDirByFilesystem(targetPath) {
	try {
		let dir = fs.statSync(targetPath).isDirectory() ? targetPath : path.dirname(targetPath);
		while (dir && path.dirname(dir) !== dir) {
			if (fs.existsSync(path.join(dir, '.obsidian'))) {
				return path.join(dir, '.trash');
			}
			dir = path.dirname(dir);
		}
	} catch (e) {
	}
	return path.join(path.dirname(targetPath), '.trash');
}

function moveToVaultTrash(targetPath) {
	let trashDir = getVaultTrashDir(targetPath);
	if (!trashDir) return false;
	fs.mkdirSync(trashDir, {recursive: true});
	let parsed = path.parse(targetPath);
	let targetName = parsed.base;
	let trashPath = path.join(trashDir, targetName);
	if (fs.existsSync(trashPath)) {
		trashPath = path.join(trashDir, parsed.name + '-' + Date.now() + parsed.ext);
	}
	fs.renameSync(targetPath, trashPath);
	console.log('[HMOS-TRASH] moved to vault trash fallback', targetPath, '->', trashPath);
	return true;
}

async function waitForMissing(filePath, timeoutMs) {
	let deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!itemExists(filePath)) return true;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	return !itemExists(filePath);
}

function installHarmonyTrashCompat() {
	if (!electron.shell || typeof electron.shell.trashItem !== 'function') return;
	let nativeTrashItem = electron.shell.trashItem.bind(electron.shell);
	electron.shell.trashItem = async function(targetPath) {
		let existedBefore = itemExists(targetPath);
		try {
			let result = await nativeTrashItem(targetPath);
			if (!existedBefore || await waitForMissing(targetPath, 3000)) {
				console.log('[HMOS-TRASH] native trash succeeded', targetPath);
				return result;
			}
			throw new Error('HarmonyOS native trash returned but the file still exists');
		} catch (e) {
			console.error('[HMOS-TRASH] native trash failed', e);
			if (existedBefore && itemExists(targetPath) && moveToVaultTrash(targetPath)) {
				return;
			}
			throw e;
		}
	};
}

installHarmonyTrashCompat();

async function runHarmonyTrashSelfTest() {
	let obsidianConfigPath = path.join(dataPath, 'obsidian.json');
	let originalConfig = null;
	try {
		await app.whenReady();
		let testRoot = path.join(dataPath, 'harmony-trash-self-test');
		let testVault = path.join(testRoot, 'vault');
		fs.mkdirSync(testVault, {recursive: true});
		fs.mkdirSync(path.join(testVault, '.obsidian'), {recursive: true});
		if (fs.existsSync(obsidianConfigPath)) {
			originalConfig = fs.readFileSync(obsidianConfigPath, 'utf8');
		}
		let config = originalConfig ? JSON.parse(originalConfig) : {};
		config.vaults = config.vaults || {};
		config.vaults['hmos-trash-self-test'] = {path: testVault, ts: Date.now()};
		fs.writeFileSync(obsidianConfigPath, JSON.stringify(config, null, 2), 'utf8');
		let testFile = path.join(testVault, 'delete-me-' + Date.now() + '.md');
		fs.writeFileSync(testFile, 'HarmonyOS trash self test', 'utf8');
		await electron.shell.trashItem(testFile);
		let removed = await waitForMissing(testFile, 3000);
		console.log('[HMOS-TRASH-TEST]', removed ? 'pass' : 'fail', testFile);
	} catch (e) {
		console.error('[HMOS-TRASH-TEST] fail', e);
	} finally {
		try {
			if (originalConfig === null) {
				fs.rmSync(obsidianConfigPath, {force: true});
			} else {
				fs.writeFileSync(obsidianConfigPath, originalConfig, 'utf8');
			}
			fs.rmSync(path.join(dataPath, 'harmony-trash-self-test'), {recursive: true, force: true});
		} catch (e) {
			console.error('[HMOS-TRASH-TEST] cleanup failed', e);
		}
	}
}

if (fs.existsSync(path.join(APP_PATH, 'harmonyos-trash-test.enabled'))) {
	runHarmonyTrashSelfTest();
}

function pad(number) {
	if (number < 10) {
		return '0' + number;
	}
	return number;
}

function stamp() {
	let d = new Date();
	return d.getUTCFullYear() +
		'-' + pad(d.getUTCMonth() + 1) +
		'-' + pad(d.getUTCDate()) +
		' ' + pad(d.getUTCHours()) +
		':' + pad(d.getUTCMinutes()) +
		':' + pad(d.getUTCSeconds());
}

function logger(logfile) {
	let fileout = fs.openSync(logfile, 'a');
	let stdout = process.stdout;

	stdout.on('error', function(e) {
		// `write` failed. Do nothing...
	});

	let fn = function () {
		let data = stamp() + ' ' + util.format.apply(null, arguments) + os.EOL;

		try {
			fs.writeSync(fileout, data);
			// Don't output to stdout if the app requests silence mode (to avoid polluting CLI outputs)
			if (!silence) stdout.write(data);
		}
		catch (e) {
			// Failed to write to log
		}
	};

	fn.end = function () {
		fs.closeSync(fileout);
	};

	return fn;
}

let log = logger(path.join(dataPath, 'obsidian.log'));

let idFile = path.join(dataPath, 'id');
let id;
try {
	if (fs.existsSync(idFile)) {
		id = fs.readFileSync(idFile, 'utf8');
	}
} catch (e) {
}
try {
	if (!id || id.length < 16) {
		id = crypto.randomBytes(16).toString('hex');
		fs.writeFileSync(idFile, id, 'utf8');
	}
} catch (e) {
}

// Only start the updater when electron is ready, because the net module requires that.
let updatePromise = app.whenReady();
let queueUpdate = (manual) => {
	log('HarmonyOS port: desktop auto-update is disabled');
	updateEvents.emit('check-end');
	return;
	let fn = () => update(manual);
	updatePromise = updatePromise.then(fn, fn);
};

// Used for verifying signatures of downloaded asar files
const SIGNATURE_CERT = '-----BEGIN CERTIFICATE-----\n' +
	'MIIDjzCCAnegAwIBAgIJAOFHLJ2gTCBzMA0GCSqGSIb3DQEBCwUAMF4xCzAJBgNV\n' +
	'BAYTAlVTMRMwEQYDVQQIDApTb21lLVN0YXRlMREwDwYDVQQKDAhEeW5hbGlzdDER\n' +
	'MA8GA1UECwwIRHluYWxpc3QxFDASBgNVBAMMC2R5bmFsaXN0LmlvMB4XDTE2MDUx\n' +
	'NjAyMTA1NFoXDTQwMDUxMDAyMTA1NFowXjELMAkGA1UEBhMCVVMxEzARBgNVBAgM\n' +
	'ClNvbWUtU3RhdGUxETAPBgNVBAoMCER5bmFsaXN0MREwDwYDVQQLDAhEeW5hbGlz\n' +
	'dDEUMBIGA1UEAwwLZHluYWxpc3QuaW8wggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAw\n' +
	'ggEKAoIBAQDcodSNp30B0oE+2vRUdr//SGfbDow+67OtGuRYQSjn86bn55fQXhMJ\n' +
	'b5xgZ0natiCriCyllLWgPf+4PnxGRSJZGbm38QSArb0MWR8/yXA+q+7nZisIsN2d\n' +
	'Xih8B3APImxJ4A50nsK/C+fl7nYdo04iz3oerP0UhLDrsLbL+9rdmshjB1boLPf6\n' +
	'QpAAC57OTPQpFBd2hFoS6xAnIb708SHOndsrWDIFEFVCPDYcme3WF5jznuT05OFG\n' +
	'MIX8SZe2jXpg2Vco/1oKRPC7mYFN5B0JTZ7mOH48vB/zPNIsVz8KHh3P9Ru2fC2r\n' +
	'3nPDXFGKzcUZneJmXh4LIUVqwdEPw7hvAgMBAAGjUDBOMB0GA1UdDgQWBBTF2xMx\n' +
	'8xVDZ2wteJPsHUe0OCu18TAfBgNVHSMEGDAWgBTF2xMx8xVDZ2wteJPsHUe0OCu1\n' +
	'8TAMBgNVHRMEBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQB6rgBF+DvDHifP+U6Z\n' +
	'FqJ4mX1nalEXEPI1jvRZaOheKpkOEBbhkCAosbBEmYxfj8xay1GGgB9nkJk2dodR\n' +
	'sGVhrZz+CwGR+hSEfYDQwMBvmzm3OcETfEtvwEAU1P93prbxul2oSWP48AVDDYKe\n' +
	'pxTZvW/yZcnoHI9XzhLNMYIEvOs+wKWAOF0+BjsIukQouaXs6gklul2J99IqpdPh\n' +
	'w2l4l7mkPx8htCbTE47GTraHt2i2mwyBZSKbfqzi73Fj5SFRtZlWJDNPKoWxcFg2\n' +
	'91B7IHumd5jwAUdVJit3K5Tgt/q4OzwokcDZcrh5lJg0+Kstsz4RDWDbfzTNJuKn\n' +
	'oueR\n' +
	'-----END CERTIFICATE-----';

async function update(manual) {
	if (!manual && disable) {
		return;
	}
	updateEvents.emit('check-start');
	try {
		// Hopefully this can help us catch any updater failures
		// Or any old buggy versions that may still be operating in the wild.
		// Don't wait on the async result
		httpGetBinary('https://releases.obsidian.md/desktop?id=' + id + '&v=' + currentPackageVersion + '&p=' + process.platform).then(() => null, () => null);
	} catch (e) {
	}

	try {
		await runUpdate();
	} catch (e) {
		log('Failed to perform update');
		console.error(e);
	}
	updateEvents.emit('check-end');
}

async function runUpdate() {
	let updateJson = null;

	try {
		log('Checking for update using Github');
		updateJson = JSON.parse(await httpGet('https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/desktop-releases.json'));
		log('Success.');
	} catch (e) {
		log(`Failed to check for update using Github (${e.message})`);
		console.error(e);
	}

	if (updateJson) {
		try {
			await downloadUpdate(updateJson);
			return;
		} catch (e) {
			if (e.code !== 'ETIMEDOUT') {
				throw e;
			}
			log('Failed to download update from Github');
		}
	}

	try {
		log('Checking for update using obsidian.md');
		updateJson = JSON.parse(await httpGet('https://releases.obsidian.md/desktop-releases.json'));
		log('Success.');
	} catch (e) {
		log(`Failed to check for update using obsidian.md (${e.message})`);
		console.error(e);
	}

	if (updateJson) {
		await downloadUpdate(updateJson);
	}
}

async function downloadUpdate(updateJson) {
	let usingInsider = false;
	if (insider && updateJson.beta) {
		updateJson = updateJson.beta;
		usingInsider = true;
	}
	let {minimumVersion, latestVersion, downloadUrl, hash, signature} = updateJson;

	if (!minimumVersion || !latestVersion || !downloadUrl || !hash || !signature) {
		log('Update failed: info incomplete', updateJson);
		return;
	}

	log('Latest version is ' + latestVersion + (usingInsider ? ' (insider)' : ''));

	// If minimum version is higher than current electron version, we will require a manual full reinstall
	if (isV2MoreRecent(app.getVersion(), minimumVersion)) {
		updateEvents.emit('update-manual-required');
		log('Update failed: minimum version mismatch. App must be manually updated');
		return;
	}

	// A new version is posted, go get it!
	if (isV2MoreRecent(currentPackageVersion, latestVersion)) {
		// Download file only if it's not already here
		let downloadPath = path.join(dataPath, 'obsidian-' + latestVersion + '.asar');
		if (!fs.existsSync(downloadPath)) {
			log('Downloading update from', downloadUrl);
			// Download to a buffer so we can check its signature
			let compressedBuffer = await httpGetBinary(downloadUrl);

			log('Verifying hash & signature. Size=', compressedBuffer.byteLength);
			let newHash = crypto.createHash('SHA256')
				.update(compressedBuffer)
				.digest('base64')
			let verifiedHash = hash === newHash;
			let verifiedSignature =
				crypto.createVerify('RSA-SHA256')
					.update(compressedBuffer)
					.verify(SIGNATURE_CERT, signature, 'base64');

			if (verifiedHash && verifiedSignature) {
				log('Saving file');
				let tempDownloadPath = path.join(dataPath, 'obsidian.asar.tmp');
				let decompressedBuffer = await new Promise((resolve, reject) => {
					zlib.gunzip(compressedBuffer, {}, (err, data) => {
						if (err) {
							return reject(err);
						}
						resolve(data);
					});
				});

				await fs.promises.writeFile(tempDownloadPath, decompressedBuffer);
				await fs.promises.rename(tempDownloadPath, downloadPath);
				log('Update complete.');
				updateEvents.emit('update-downloaded');
			}
			else {
				if (!verifiedHash) {
					log('Hash check failed!', newHash);
				}
				if (!verifiedSignature) {
					log('Signature check failed!');
				}
			}
		}
		else {
			log('An update is already downloaded.');
		}
	}
	else {
		log('App is up to date.');
	}

	// Clean up old updates now that we have the latest version
	let files = fs.readdirSync(dataPath, {withFileTypes: true});
	for (let file of files) {
		let filename = file.name;

		// Delete temporary file
		if (filename === 'obsidian.asar.tmp') {
			await fs.promises.unlink(path.join(dataPath, filename));
		}

		// Delete all versions that aren't the latest version.
		if (file.isFile() && filename.startsWith('obsidian-') && filename.endsWith('.asar')) {
			let newVersion = extractVersion(filename);
			// Make an exception for the current running version.
			if (newVersion !== currentPackageVersion &&
				newVersion !== latestVersion) {
				await fs.promises.unlink(path.join(dataPath, filename));
			}
		}
	}
}

// PDF 字体兼容补丁：arkweb 的 FontFace 不接受 CSS local() 形式的 src。
// pdf.js 为「非内嵌字体」生成 src = `local(字体族)`，交给浏览器匹配系统字体。
// 该构造在此处直接抛出，字体对象无法送达主线程，页面的 dependency 永远等不到，
// 渲染停在中途，页面指示器一直处于置灰（等同加载未完成）。
// 这里把失败的构造换成一个立即拒绝的桩对象，pdf.js 现有的 catch 会接管，
// 转而向 worker 请求字形路径（FontFallback），渲染得以走完。
const FONT_FACE_GUARD_SOURCE = `(() => {
	if (window.__harmonyFontFaceGuard) return;
	window.__harmonyFontFaceGuard = true;
	var NativeFontFace = window.FontFace;
	if (!NativeFontFace) return;
	var isLocalSource = function (source) {
		if (typeof source !== 'string') return false;
		return source.indexOf('local(') !== -1;
	};
	var GuardFontFace = function (family, source, descriptors) {
		if (!isLocalSource(source)) {
			return new NativeFontFace(family, source, descriptors);
		}
		var rejection = new Promise(function (_resolve, reject) {
			reject(new Error('本地字体不可用，已改用字形路径绘制。'));
		});
		// pdf.js 会 await 这个 promise，但若某条路径既不 await 也不忽略，
		// 一个悬空的拒绝会变成未捕获异常，所以先自行接住一份。
		rejection.catch(function () {});
		var face = Object.create(GuardFontFace.prototype);
		face.family = family;
		face.status = 'error';
		face.loaded = rejection;
		return face;
	};
	GuardFontFace.prototype = Object.create(NativeFontFace.prototype);
	GuardFontFace.prototype.constructor = NativeFontFace;
	GuardFontFace.prototype.load = function () {
		return this.loaded;
	};
	GuardFontFace.prototype.then = function (onFulfilled, onRejected) {
		return this.loaded.then(onFulfilled, onRejected);
	};
	GuardFontFace.prototype.catch = function (onRejected) {
		return this.loaded.catch(onRejected);
	};
	GuardFontFace.prototype.finally = function (onFinally) {
		return this.loaded.finally(onFinally);
	};
	GuardFontFace.prototype.addEventListener = function () {};
	GuardFontFace.prototype.removeEventListener = function () {};
	Object.defineProperty(GuardFontFace.prototype, Symbol.toStringTag, {
		configurable: true,
		value: 'FontFace'
	});
	Object.setPrototypeOf(GuardFontFace, NativeFontFace);
	window.FontFace = GuardFontFace;
})();`;

// 窗口登记。托盘菜单需要一个可操作的目标窗口。
function registerWindow(window) {
	knownWindows.set(window.id, window);
	window.on('closed', function () {
		knownWindows.delete(window.id);
	});
}

// 托盘。官方 1.13.4 不含任何托盘代码，这一整项都是本项目的定制。
// 图标放在 asar 之外（与 obsidian.asar 同目录），避开写 asar 的成本。
function installTray() {
	if (trayIcon) return trayIcon;
	let iconPath = path.join(APP_PATH, 'tray.png');
	if (!fs.existsSync(iconPath)) {
		log('托盘图标不存在，跳过托盘初始化', iconPath);
		return null;
	}
	try {
		trayIcon = new Tray(iconPath);
	} catch (e) {
		log('托盘初始化失败', e && e.message ? e.message : String(e));
		return null;
	}
	let toggle = function () {
		let w = focusedWindow();
		if (!w) return;
		try {
			if (w.isVisible()) w.hide(); else w.show();
		} catch (e) {}
	};
	try {
		trayIcon.on('click', toggle);
	} catch (e) {}
	try {
		trayIcon.setToolTip('Obsidian');
	} catch (e) {}
	try {
		trayIcon.setContextMenu(Menu.buildFromTemplate([
			{
				label: '显示',
				click: function () {
					let w = focusedWindow();
					if (!w) return;
					try {
						if (w.isMinimized()) w.restore();
						w.show();
						w.focus();
					} catch (e) {}
				}
			},
			{
				label: '退出软件',
				click: function () {
					quitRequested = true;
					try { trayIcon.destroy(); } catch (e) {}
					trayIcon = null;
					app.quit();
				}
			}
		]));
	} catch (e) {
		log('托盘菜单设置失败', e && e.message ? e.message : String(e));
	}
	log('托盘已初始化', iconPath, 'epoch', Date.now());
	return trayIcon;
}

// 关窗到托盘。只拦截仓库窗口；起始窗口与帮助窗口保持官方的关闭行为
// （起始窗口打开仓库成功后自己关闭）。
//
// 官方在窗口的 close 事件上设了一个 3 秒后的销毁定时器，它会在那时检查
// defaultPrevented。这里提前 preventDefault 即可让官方不再销毁。
// quitRequested 为真时直接放行，否则 app.quit() 也会被这里挡住，应用关不掉。
function installCloseToTray(window) {
	window.on('close', function (event) {
		if (quitRequested || !exitToTrayEnabled) return;
		let kind = 'unknown';
		try { kind = windowKind(window.webContents); } catch (e) {}
		if (kind !== 'vault') return;
		event.preventDefault();
		try {
			window.hide();
		} catch (e) {
			try { window.minimize(); } catch (e2) {}
		}
	});
}

function installFontFaceGuard() {
	if (!app || typeof app.on !== 'function') {
		log('app.on 不可用，字体兼容补丁未安装');
		return;
	}
	async function inject(webContents) {
		if (!webContents) return;
		try {
			await webContents.executeJavaScript(FONT_FACE_GUARD_SOURCE, true);
			log('字体兼容补丁已注入渲染进程', webContents.id);
		} catch (e) {
			log('字体兼容补丁注入失败', webContents.id, e && e.message ? e.message : String(e));
		}
	}

	app.on('browser-window-created', function (event, window) {
		let webContents = null;
		try { webContents = window.webContents; } catch (e) {}
		if (!webContents) return;
		registerWindow(window);
		installCloseToTray(window);
		// 每次导航都会换一个全新的 JS 环境，补丁需要重新注入。
		// 补丁脚本自身用 window.__harmonyFontFaceGuard 做了幂等处理，重复注入无害。
		webContents.on('did-start-navigation', function () {
			inject(webContents);
		});
		webContents.on('dom-ready', function () {
			inject(webContents);
			injectRenderer(webContents);
		});
		inject(webContents);
	});
	log('字体兼容补丁监听已注册');
}

// 注入渲染进程的脚本。与字体补丁同样挂三个时机：
// 每次导航都是全新的 JS 环境，脚本自身用标志位做幂等。
// 两个文件分别是：
//   preload.js    最早的时机。覆盖 window.close，包装 i18next。
//   dom-ready.js  页面结构就绪后施加。设置页、标题、样式、窗口按钮。
const RENDERER_SCRIPTS = ['preload.js', 'dom-ready.js'];

function injectRenderer(webContents) {
	if (!webContents) return;
	let kind = 'unknown';
	try { kind = windowKind(webContents); } catch (e) {}
	// 设置弹窗与帮助窗口不需要设置页注入，但它们也不排斥。
	// 这里全部注入，脚本内部自己判定。
	for (let name of RENDERER_SCRIPTS) {
		let file = path.join(APP_PATH, 'inject', name);
		let source;
		try {
			source = fs.readFileSync(file, 'utf8');
		} catch (e) {
			log('注入脚本读取失败', name, e && e.message ? e.message : String(e));
			continue;
		}
		webContents.executeJavaScript(source, true).then(function () {
			log('注入脚本已施加', name, 'WebContents', webContents.id, '类型', kind, 'epoch', Date.now());
		}, function (e) {
			log('注入脚本施加失败', name, 'WebContents', webContents.id, e && e.message ? e.message : String(e));
		});
	}
}

// 十二个华为云同步通道。先移除同名监听再注册，
// 避免与 asar 内可能存在的实现重复响应（sendSync 同一通道多个监听时
// 以先 returnValue 者为准，重复注册会让行为不可预测）。
function installHcsChannels() {
	let build;
	try {
		build = require('./inject/hcs-channels.js');
	} catch (e) {
		log('华为云同步通道模块载入失败', e && e.message ? e.message : String(e));
		return;
	}
	let channels = build(fs, path, dataPath);
	for (let [name, handler] of channels) {
		electron.ipcMain.removeAllListeners(name);
		electron.ipcMain.on(name, handler);
	}
	log('华为云同步通道已注册', channels.length, '个');
}

// 退出相关通道。官方 1.13.4 不含这三个通道。
// exit-to-tray 的读写与「设置 → 外观 → 退出软件」开关对应：
// 开关默认开启，与渲染进程侧 localStorage 缺省值一致。
function installExitChannels() {
	electron.ipcMain.removeAllListeners('exit-to-tray');
	electron.ipcMain.on('exit-to-tray', function (event, value) {
		if (value !== undefined) {
			exitToTrayEnabled = !!value;
		}
		event.returnValue = exitToTrayEnabled;
	});
	// force-quit 由托盘菜单的「退出软件」与设置页的退出按钮使用。
	electron.ipcMain.removeAllListeners('force-quit');
	electron.ipcMain.on('force-quit', function () {
		quitRequested = true;
		exitToTrayEnabled = false;
		try { if (trayIcon) trayIcon.destroy(); } catch (e) {}
		trayIcon = null;
		app.quit();
	});
	log('退出相关通道已注册');
}

// 检测更新结果的读取通道。渲染进程在「关于」页注入时同步读取一次，
// 取不到结果（文件不存在或尚未写过的）时返回 null，页面据此隐藏更新条目。
function installUpdateStatusChannel() {
	electron.ipcMain.removeAllListeners('ohsidian-update-status');
	electron.ipcMain.on('ohsidian-update-status', function (event) {
		event.returnValue = updateCheckStatus;
	});
	log('检测更新结果通道已注册，当前结果', updateCheckStatus ? '有' : '无');
}

// 「检查更新」按钮的触发通道。渲染进程写不了 ArkTS 侧的文件，
// 因此由这里代写触发文件，ArkTS 的 UpdateChecker 轮询发现后立即跑一次检查。
// 文件名与 UpdateChecker.ets 的 TRIGGER_FILE_NAME 共用。
// 两侧约定：写入后由 ArkTS 删除，外层只负责写。
const UPDATE_CHECK_TRIGGER_FILE = 'update-check.now';

function installUpdateCheckNowChannel() {
	electron.ipcMain.removeAllListeners('ohsidian-update-check-now');
	electron.ipcMain.on('ohsidian-update-check-now', function (event) {
		try {
			let triggerPath = path.join(dataPath, UPDATE_CHECK_TRIGGER_FILE);
			fs.writeFileSync(triggerPath, String(Date.now()));
			log('已写入检查更新触发文件', triggerPath);
			event.returnValue = true;
		} catch (e) {
			log('写入检查更新触发文件失败', e && e.message ? e.message : String(e));
			event.returnValue = false;
		}
	});
	log('检查更新触发通道已注册');
}

// 渲染进程的日志转写通道。渲染进程没有写文件的接口，
// 注入脚本用它把诊断输出写进 obsidian.log（console.log 在设备上不可见）。
function installLogChannel() {
	electron.ipcMain.on('ohsidian-log', function (event, message) {
		log('[INJECT]', message);
	});
}

// 屏蔽 installer 版本过低的提示与下载入口。
// 渲染进程侧的比较是 qy(process.versions.electron, "28.2.3")，
// 设备上的 Electron 是 5.0.0-Release，结果恒为真。
// 官方判定处会先读这个通道，返回真时跳过提示。
function installDisableUpdate() {
	electron.ipcMain.removeAllListeners('disable-update');
	electron.ipcMain.on('disable-update', function (event, value) {
		// 记录调用参数：用于确认渲染进程是否还在发起这个判断。
		// 官方启动时的判断是 qy(process.versions.electron, "28.2.3")，
		// 若渲染进程侧的版本改写生效，这个通道就不会再被调用。
		log('disable-update 被调用，参数', value === undefined ? '（读取）' : String(value));
		event.returnValue = true;
	});
	log('已屏蔽 installer 版本提示');
}

function loadApp(asarPath) {
	// 启动性能打点：官方 asar 入口即将执行的毫秒时钟。
	try { __perfAsarEntryMs = Date.now(); } catch (e) {}
	probe('[PERF2] asar-entry', __perfAsarEntryMs);
	// Execute asar content
	let main = path.join(asarPath, 'main.js');

	let fn;
	try {
		fn = require(main);
	} catch (e) {
		log('Failed to require app package', asarPath);
		console.error(e);
		return false;
	}

	if (fn) {
		fn(asarPath, updateEvents);
		return true;
	}
	return false;
}

function extractVersion(filename) {
	if (filename.startsWith('obsidian-') && filename.endsWith('.asar')) {
		return filename.substring('obsidian-'.length, filename.length - '.asar'.length);
	}
	return null;
}

function parseVersion(string) {
	if (!string) {
		return null;
	}
	let valid = true;
	let parts = string.split('.').map((part) => {
		part = parseInt(part);
		if (isNaN(part)) {
			valid = false;
		}
		return part;
	});
	if (valid) {
		return parts;
	}
	return null;
}

function isMoreRecent(version1, version2) {
	let length = Math.min(version1.length, version2.length);
	for (let i = 0; i < length; i++) {
		if (version1[i] < version2[i]) {
			return true;
		}
		if (version1[i] > version2[i]) {
			return false;
		}
	}
	if (version1.length < version2.length) {
		return true;
	}
	if (version1.length > version2.length) {
		return false;
	}
	return false;
}

function isV2MoreRecent(v1, v2) {
	let version1 = parseVersion(v1);
	let version2 = parseVersion(v2);
	if (!version2) {
		return false;
	}
	if (!version1) {
		return true;
	}
	return isMoreRecent(version1, version2);
}

function httpGet(url) {
	return httpGetBinary(url).then(buffer => buffer.toString('utf8'));
}

function httpGetBinary(url) {
	return new Promise((resolve, reject) => {
		let request = net.request({
			method: 'GET',
			url: url,
			redirect: 'follow',
		});
		request.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.183 Safari/537.36');
		request.on('login', (authInfo, callback) => callback());
		request.on('error', reject);
		request.on('response', (res) => {
			let data = [];
			res.on('data', (chunk) => data.push(chunk));
			res.on('end', () => resolve(Buffer.concat(data)));
		})
		request.end();
	});
}

// Source: https://github.com/electron/electron/blob/19954126e08c67022b89a886cadb10471ac853ae/lib/browser/init.ts#L20
process.on('uncaughtException', function (error) {
	// Don't emit errors for updater
	if (error.message && error.message.indexOf('net::ERR') !== -1) {
		return;
	}

	console.error('Uncaught Exception', error);

	// Show error in GUI.
	// We can't import { dialog } at the top of this file as this file is
	// responsible for setting up the require hook for the "electron" module
	// so we import it inside the handler down here
	import('electron')
		.then(({dialog}) => {
			const stack = error.stack ? error.stack : `${error.name}: ${error.message}`;
			const message = 'Uncaught Exception:\n' + stack;
			dialog.showErrorBox('A JavaScript error occurred in the main process', message);
		});
});

// deeplink 通道：HarmonyOS 侧把 obsidian:// 链接追加写入 dataPath 下的队列文件，
// 这里取出后交给 Obsidian 内建的 open-url 处理器。
// ArkTS 到 Electron 主进程之间只有 ExecuteCommand 一条通道，它只覆盖窗口管理，
// 送不进 open-url；而本版本的 Electron 也没有原生协议处理与单实例转发，
// 所以由 ArkTS 与本文件共同完成这条链路。
const DEEPLINK_QUEUE_FILE = 'obsidian-deeplink.pending';

function readQueuedDeeplinks() {
	let queuePath = path.join(dataPath, DEEPLINK_QUEUE_FILE);
	let raw;
	try {
		if (!fs.existsSync(queuePath)) return [];
		raw = fs.readFileSync(queuePath, 'utf8');
		fs.unlinkSync(queuePath);
	} catch (e) {
		log('读取 deeplink 队列失败', e && e.message ? e.message : String(e));
		return [];
	}
	return raw.split('\n')
		.map(function (line) { return line.trim(); })
		.filter(function (line) { return line.startsWith('obsidian://'); });
}

function dispatchDeeplink(url) {
	// Obsidian 在 asar 加载完成后才注册 open-url 监听，
	// 冷启动时队列里已有的链接要等到监听就绪才能派发，否则事件会被丢弃。
	let attempts = 0;
	let timer = setInterval(function () {
		attempts += 1;
		if (app.listenerCount('open-url') > 0) {
			clearInterval(timer);
			// 记录写在派发之前：$e 内部会同步抛出异常（例如找不到仓库），
			// 放在派发之后记录会把这次派发整条丢掉。
			log('正在派发 deeplink', url);
			try {
				app.emit('open-url', { preventDefault: function () {} }, url);
				log('已派发 deeplink', url);
			} catch (e) {
				log('派发 deeplink 时抛出异常', url, e && e.stack ? e.stack : String(e));
			}
		} else if (attempts >= 40) {
			clearInterval(timer);
			log('等待 open-url 监听超时，丢弃 deeplink', url);
		}
	}, 250);
}

function pollDeeplinkQueue() {
	let links = readQueuedDeeplinks();
	if (links.length === 0) return;
	log('从队列读到 deeplink', links.length, '条');
	links.forEach(dispatchDeeplink);
}

pollDeeplinkQueue();
setInterval(pollDeeplinkQueue, 500);

// 检测更新结果的中转文件。ArkTS 侧（UpdateChecker）拉取远端 versionCode 后写在这里，
// 渲染进程经 ohsidian-update-status 通道读取。
// 反方向的请求走 UPDATE_CHECK_TRIGGER_FILE，两端的文件名常量需成对修改。
// 与 deeplink 队列同为文件中转：渲染进程拿不到 ArkTS 的绑定，只有这个目录是共用的。
const UPDATE_CHECK_FILE = 'update-check.json';

// 最近一次读到的结果，null 表示还没有可用结果。
let updateCheckStatus = null;
// 上一次读到的 checkedAt，用于判断文件是否被重写。
let updateCheckStamp = null;

function readUpdateCheckStatus() {
	try {
		let resultPath = path.join(dataPath, UPDATE_CHECK_FILE);
		if (!fs.existsSync(resultPath)) return null;
		return JSON.parse(fs.readFileSync(resultPath, 'utf8'));
	} catch (e) {
		log('读取检测更新结果失败', e && e.message ? e.message : String(e));
		return null;
	}
}

function refreshUpdateCheckStatus() {
	let status = readUpdateCheckStatus();
	if (!status || status.checkedAt === updateCheckStamp) return;
	updateCheckStamp = status.checkedAt;
	updateCheckStatus = status;
	log('检测更新结果已更新', '远端 versionCode', status.remoteVersionCode,
		'本机', status.localVersionCode, 'hasUpdate', status.hasUpdate);
}

refreshUpdateCheckStatus();
setInterval(refreshUpdateCheckStatus, 500);

installFontFaceGuard();

// 下面六项必须在 asar 加载之后注册。
// 其中的 removeAllListeners 用于清掉官方自己注册的同名监听；
// 官方的注册发生在 loadApp() 调用 module.exports 时，
// 因此在本位置之前调用会先清空一个不存在的监听，官方随后的注册就变成第二个监听器了。
// sendSync 通道上多个监听器时以先设置 returnValue 者为准，结果不可预测。

// 真正退出时置标志，让关窗拦截放行。
// 官方自己也有一个 before-quit 监听（设置它自己的退出标志），两者互不干扰。
app.on('before-quit', function () {
	quitRequested = true;
});

// 托盘要在 app ready 之后创建，否则 Electron 会报
// "Cannot create Tray before app is ready"。
// 延迟 1 秒是为了等窗口先出现，托盘菜单的「显示」需要目标窗口。
app.whenReady().then(function () {
	setTimeout(function () {
		installTray();
	}, 1000);
});

// Actual startup routine
setInterval(queueUpdate, 60 * 60 * 1000);

// 多仓库启动收敛。官方启动逻辑（asar 内 main.js 的 We()）会把 obsidian.json 里
// 每一条 open:true 的仓库都开一个窗口；本设备上仓库窗口串行加载，
// 每多一个就多约 3 秒白屏，而用户一次只用一个仓库。
// 因此在 asar 加载前把 open 标志收敛到 ts 最大（最近使用）的那一条。
// 只在多于一条 open 时才写文件；最近列表本身（vault-list 通道读的完整列表）不受影响。
(function collapseOpenVaults() {
	let configPath = path.join(dataPath, 'obsidian.json');
	let raw;
	try {
		raw = fs.readFileSync(configPath, 'utf8');
	} catch (e) {
		return; // 文件不存在或不可读：官方按首次启动处理，无需收敛
	}
	let config;
	try {
		config = JSON.parse(raw);
	} catch (e) {
		log('obsidian.json 解析失败，跳过多仓库启动收敛');
		return;
	}
	let vaults = config && config.vaults;
	if (!vaults || typeof vaults !== 'object') return;
	let openIds = Object.keys(vaults).filter(function (id) {
		return vaults[id] && vaults[id].open === true;
	});
	if (openIds.length <= 1) return;
	let latestId = openIds.reduce(function (best, id) {
		return (vaults[id].ts || 0) > (vaults[best].ts || 0) ? id : best;
	}, openIds[0]);
	for (let id of openIds) {
		if (id !== latestId) delete vaults[id].open;
	}
	try {
		fs.writeFileSync(configPath, JSON.stringify(config));
		log('多仓库启动收敛：仅保留最近使用仓库的 open 标志', vaults[latestId].path);
	} catch (e) {
		log('多仓库启动收敛写回失败', e && e.message ? e.message : String(e));
	}
})();

let asarPath = path.join(APP_PATH, 'obsidian.asar');
let updatedAsarPath = '';
let updatedAsarVersion = '';

// Check if we have an updated asar to replace the built-in one
try {
	let candidateFile = '';
	let version = '';
	let stat = fs.statSync(dataPath);
	if (stat.isDirectory()) {
		let files = fs.readdirSync(dataPath, {withFileTypes: true});
		for (let file of files) {
			let filename = file.name;
			if (file.isFile() && filename.startsWith('obsidian-') && filename.endsWith('.asar')) {
				let newVersion = extractVersion(filename);
				if (isV2MoreRecent(version, newVersion)) {
					candidateFile = filename;
					version = newVersion;
				}
			}
		}
	}

	// We found an updated asar
	if (isV2MoreRecent(app.getVersion(), version)) {
		updatedAsarPath = path.join(dataPath, candidateFile);
		updatedAsarVersion = version;
	}
} catch (e) {
	if (e.code !== 'ENOENT') {
		console.error(e);
	}
}

let success = false;
if (updatedAsarPath) {
	success = loadApp(updatedAsarPath);
	currentPackageVersion = updatedAsarVersion;
	log('Loaded updated app package', updatedAsarPath);
}

if (!success) {
	success = loadApp(asarPath);
	log('Loaded main app package', asarPath);
}

// 启动性能打点：一次性输出三段毫秒耗时。
// t0 runBrowser start（hilog，ArkTS 侧）→ t1 本文件开始执行 → t2 官方 asar 入口开始执行 → t3 loadApp 完成。
// 汇总只写一行，不逐条 append。
try {
	let now = Date.now();
	let asarEntry = __perfAsarEntryMs > 0 ? __perfAsarEntryMs : now;
	log('[PERF] main-start→file-start', __perfMainStartMs > 0 ? asarEntry - __perfMainStartMs : -1, 'ms；',
		'asar-entry→loaded', now - asarEntry, 'ms；',
		'asar-entry', __perfAsarEntryMs > 0 ? '有' : '无标记',
		'； main-start-epoch', __perfMainStartMs, 'loaded-epoch', now);
} catch (e) {}

if (!success) {
	log('Failed to load both app packages.');
}

// asar 已加载，此时覆盖同名通道可以真正取代官方的实现。
installHcsChannels();
installExitChannels();
installLogChannel();
installUpdateStatusChannel();
installUpdateCheckNowChannel();
installDisableUpdate();

queueUpdate();
updateEvents.on('check', () => queueUpdate(true));

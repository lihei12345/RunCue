"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BOOTSTRAP_PATH = void 0;
exports.killAppUsingPattern = killAppUsingPattern;
exports.isTvOS = isTvOS;
exports.setRealDeviceSecurity = setRealDeviceSecurity;
exports.setXctestrunFile = setXctestrunFile;
exports.getAdditionalRunContent = getAdditionalRunContent;
exports.getXctestrunFilePath = getXctestrunFilePath;
exports.getXctestrunFileName = getXctestrunFileName;
exports.killProcess = killProcess;
exports.randomInt = randomInt;
exports.getWDAUpgradeTimestamp = getWDAUpgradeTimestamp;
exports.escapeRegExp = escapeRegExp;
exports.truncateString = truncateString;
exports.resetTestProcesses = resetTestProcesses;
exports.getPIDsListeningOnPort = getPIDsListeningOnPort;
const support_1 = require("@appium/support");
const teen_process_1 = require("teen_process");
const node_path_1 = __importStar(require("node:path"));
const node_url_1 = require("node:url");
const logger_1 = require("./logger");
const constants_1 = require("./constants");
const node_fs_1 = __importDefault(require("node:fs"));
const asyncbox_1 = require("asyncbox");
const node_os_1 = require("node:os");
// Get current filename - works in both CommonJS and ESM
const currentFilename = typeof __filename !== 'undefined'
    ? __filename
    : (0, node_url_1.fileURLToPath)(new Function('return import.meta.url')());
const currentDirname = (0, node_path_1.dirname)(currentFilename);
let moduleRootCache;
/**
 * Calculates the path to the current module's root folder
 *
 * @returns {string} The full path to module root
 * @throws {Error} If the current module root folder cannot be determined
 */
const getModuleRoot = function getModuleRoot() {
    if (moduleRootCache) {
        return moduleRootCache;
    }
    let currentDir = currentDirname;
    let isAtFsRoot = false;
    while (!isAtFsRoot) {
        const manifestPath = node_path_1.default.join(currentDir, 'package.json');
        try {
            if (node_fs_1.default.existsSync(manifestPath) &&
                JSON.parse(node_fs_1.default.readFileSync(manifestPath, 'utf8')).name === 'appium-webdriveragent') {
                moduleRootCache = currentDir;
                return currentDir;
            }
        }
        catch { }
        currentDir = node_path_1.default.dirname(currentDir);
        isAtFsRoot = currentDir.length <= node_path_1.default.dirname(currentDir).length;
    }
    throw new Error('Cannot find the root folder of the appium-webdriveragent Node.js module');
};
exports.BOOTSTRAP_PATH = getModuleRoot();
/**
 * Find and terminate all processes matching the given pgrep pattern.
 */
async function killAppUsingPattern(pgrepPattern) {
    const signals = [2, 15, 9];
    for (const signal of signals) {
        const matchedPids = await getPIDsUsingPattern(pgrepPattern);
        if (matchedPids.length === 0) {
            return;
        }
        const args = [`-${signal}`, ...matchedPids];
        try {
            await (0, teen_process_1.exec)('kill', args);
        }
        catch (err) {
            logger_1.log.debug(`kill ${args.join(' ')} -> ${err.message}`);
        }
        if (signal === signals[signals.length - 1]) {
            // there is no need to wait after SIGKILL
            return;
        }
        try {
            await (0, asyncbox_1.waitForCondition)(async () => {
                const pidCheckPromises = matchedPids.map(async (pid) => {
                    try {
                        await (0, teen_process_1.exec)('kill', ['-0', pid]);
                        // the process is still alive
                        return false;
                    }
                    catch {
                        // the process is dead
                        return true;
                    }
                });
                return (await Promise.all(pidCheckPromises)).every((x) => x === true);
            }, {
                waitMs: 1000,
                intervalMs: 100,
            });
            return;
        }
        catch {
            // try the next signal
        }
    }
}
/**
 * Return true if the platformName is tvOS
 * @param platformName The name of the platorm
 * @returns Return true if the platformName is tvOS
 */
function isTvOS(platformName) {
    return platformName?.toLowerCase() === constants_1.PLATFORM_NAME_TVOS.toLowerCase();
}
/**
 * Configure keychain access required for real-device code signing.
 */
async function setRealDeviceSecurity(keychainPath, keychainPassword) {
    logger_1.log.debug('Setting security for iOS device');
    await (0, teen_process_1.exec)('security', ['-v', 'list-keychains', '-s', keychainPath]);
    await (0, teen_process_1.exec)('security', ['-v', 'unlock-keychain', '-p', keychainPassword, keychainPath]);
    await (0, teen_process_1.exec)('security', ['set-keychain-settings', '-t', '3600', '-l', keychainPath]);
}
/**
 * Creates xctestrun file per device & platform version.
 * We expects to have WebDriverAgentRunner_iphoneos${sdkVersion|platformVersion}-arm64.xctestrun for real device
 * and WebDriverAgentRunner_iphonesimulator${sdkVersion|platformVersion}-${x86_64|arm64}.xctestrun for simulator located @bootstrapPath
 * Newer Xcode (Xcode 10.0 at least) generate xctestrun file following sdkVersion.
 * e.g. Xcode which has iOS SDK Version 12.2 on an intel Mac host machine generates WebDriverAgentRunner_iphonesimulator.2-x86_64.xctestrun
 *      even if the cap has platform version 11.4
 *
 * @param args
 * @return returns xctestrunFilePath for given device
 * @throws if WebDriverAgentRunner_iphoneos${sdkVersion|platformVersion}-arm64.xctestrun for real device
 * or WebDriverAgentRunner_iphonesimulator${sdkVersion|platformVersion}-x86_64.xctestrun for simulator is not found @bootstrapPath,
 * then it will throw a file not found exception
 */
async function setXctestrunFile(args) {
    const { deviceInfo, sdkVersion, bootstrapPath, wdaRemotePort, wdaBindingIP } = args;
    const xctestrunFilePath = await getXctestrunFilePath(deviceInfo, sdkVersion, bootstrapPath);
    const xctestRunContent = await support_1.plist.parsePlistFile(xctestrunFilePath);
    const updateWDAPort = getAdditionalRunContent(deviceInfo.platformName, wdaRemotePort, wdaBindingIP);
    const newXctestRunContent = mergeObjects(xctestRunContent, updateWDAPort);
    await support_1.plist.updatePlistFile(xctestrunFilePath, newXctestRunContent, true);
    return xctestrunFilePath;
}
/**
 * Return the WDA object which appends existing xctest runner content
 * @param platformName - The name of the platform
 * @param wdaRemotePort - The remote port number
 * @param wdaBindingIP - The IP address to bind to. If not given, it binds to all interfaces.
 * @return returns a runner object which has USE_PORT and optionally USE_IP
 */
function getAdditionalRunContent(platformName, wdaRemotePort, wdaBindingIP) {
    const runner = `WebDriverAgentRunner${isTvOS(platformName) ? '_tvOS' : ''}`;
    return {
        [runner]: {
            EnvironmentVariables: {
                // USE_PORT must be 'string'
                USE_PORT: `${wdaRemotePort}`,
                ...(wdaBindingIP ? { USE_IP: wdaBindingIP } : {}),
            },
        },
    };
}
/**
 * Return the path of xctestrun if it exists
 * @param deviceInfo
 * @param sdkVersion - The Xcode SDK version of OS.
 * @param bootstrapPath - The folder path containing xctestrun file.
 */
async function getXctestrunFilePath(deviceInfo, sdkVersion, bootstrapPath) {
    // First try the SDK path, for Xcode 10 (at least)
    const sdkBased = [
        node_path_1.default.resolve(bootstrapPath, `${deviceInfo.udid}_${sdkVersion}.xctestrun`),
        sdkVersion,
    ];
    // Next try Platform path, for earlier Xcode versions
    const platformBased = [
        node_path_1.default.resolve(bootstrapPath, `${deviceInfo.udid}_${deviceInfo.platformVersion}.xctestrun`),
        deviceInfo.platformVersion,
    ];
    for (const [filePath, version] of [sdkBased, platformBased]) {
        if (await support_1.fs.exists(filePath)) {
            logger_1.log.info(`Using '${filePath}' as xctestrun file`);
            return filePath;
        }
        const originalXctestrunFile = node_path_1.default.resolve(bootstrapPath, getXctestrunFileName(deviceInfo, version));
        if (await support_1.fs.exists(originalXctestrunFile)) {
            // If this is first time run for given device, then first generate xctestrun file for device.
            // We need to have a xctestrun file **per device** because we cant not have same wda port for all devices.
            await support_1.fs.copyFile(originalXctestrunFile, filePath);
            logger_1.log.info(`Using '${filePath}' as xctestrun file copied by '${originalXctestrunFile}'`);
            return filePath;
        }
    }
    throw new Error(`If you are using 'useXctestrunFile' capability then you ` +
        `need to have a xctestrun file (expected: ` +
        `'${node_path_1.default.resolve(bootstrapPath, getXctestrunFileName(deviceInfo, sdkVersion))}')`);
}
/**
 * Return the name of xctestrun file
 * @param deviceInfo
 * @param version - The Xcode SDK version of OS.
 * @return returns xctestrunFilePath for given device
 */
function getXctestrunFileName(deviceInfo, version) {
    const archSuffix = deviceInfo.isRealDevice
        ? `os${version}-arm64`
        : `simulator${version}-${(0, node_os_1.arch)() === 'arm64' ? 'arm64' : 'x86_64'}`;
    return `WebDriverAgentRunner_${isTvOS(deviceInfo.platformName) ? 'tvOS_appletv' : 'iphone'}${archSuffix}.xctestrun`;
}
/**
 * Ensures the process is killed after the timeout
 */
async function killProcess(name, proc) {
    if (!proc || !proc.isRunning) {
        return;
    }
    logger_1.log.info(`Shutting down '${name}' process (pid '${proc.proc?.pid}')`);
    logger_1.log.info(`Sending 'SIGTERM'...`);
    try {
        await proc.stop('SIGTERM', 1000);
        return;
    }
    catch (err) {
        if (!err.message.includes(`Process didn't end after`)) {
            throw err;
        }
        logger_1.log.debug(`${name} process did not end in a timely fashion: '${err.message}'.`);
    }
    logger_1.log.info(`Sending 'SIGKILL'...`);
    try {
        await proc.stop('SIGKILL');
    }
    catch (err) {
        if (err.message.includes('not currently running')) {
            // the process ended but for some reason we were not informed
            return;
        }
        throw err;
    }
}
/**
 * Generate a random integer in range [low, high). `low` is inclusive and `high` is exclusive.
 */
function randomInt(low, high) {
    return Math.floor(Math.random() * (high - low) + low);
}
/**
 * Retrieves WDA upgrade timestamp. The manifest only gets modified on package upgrade.
 */
async function getWDAUpgradeTimestamp() {
    const packageManifest = node_path_1.default.resolve(getModuleRoot(), 'package.json');
    if (!(await support_1.fs.exists(packageManifest))) {
        return null;
    }
    const { mtime } = await support_1.fs.stat(packageManifest);
    return mtime.getTime();
}
/**
 * Escape regular expression metacharacters in a string.
 */
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/**
 * Truncate a string to the given length and append ellipsis if needed.
 */
function truncateString(value, length) {
    if (value.length <= length) {
        return value;
    }
    return `${value.slice(0, Math.max(0, length - 1))}…`;
}
/**
 * Kills running XCTest processes for the particular device.
 */
async function resetTestProcesses(udid, isSimulator) {
    const processPatterns = [`xcodebuild.*${udid}`];
    if (isSimulator) {
        processPatterns.push(`${udid}.*XCTRunner`);
        // Some XCTest launches might not include xcodebuild in their command line
        processPatterns.push(`xctest.*${udid}`);
    }
    logger_1.log.debug(`Killing running processes '${processPatterns.join(', ')}' for the device ${udid}...`);
    await Promise.all(processPatterns.map(killAppUsingPattern));
}
/**
 * Get the IDs of processes listening on the particular system port.
 * It is also possible to apply additional filtering based on the
 * process command line.
 *
 * @param port - The port number.
 * @param filteringFunc - Optional lambda function, which
 *                                    receives command line string of the particular process
 *                                    listening on given port, and is expected to return
 *                                    either true or false to include/exclude the corresponding PID
 *                                    from the resulting array.
 * @returns - the list of matched process ids.
 */
async function getPIDsListeningOnPort(port, filteringFunc = null) {
    const result = [];
    try {
        // This only works since Mac OS X El Capitan
        const { stdout } = await (0, teen_process_1.exec)('lsof', ['-ti', `tcp:${port}`]);
        result.push(...stdout.trim().split(/\n+/));
    }
    catch (e) {
        if (e.code !== 1) {
            // code 1 means no processes. Other errors need reporting
            logger_1.log.debug(`Error getting processes listening on port '${port}': ${e.stderr || e.message}`);
        }
        return result;
    }
    if (typeof filteringFunc !== 'function') {
        return result;
    }
    const filtered = await Promise.all(result.map(async (pid) => {
        let stdout;
        try {
            ({ stdout } = await (0, teen_process_1.exec)('ps', ['-p', pid, '-o', 'command']));
        }
        catch (e) {
            if (e.code === 1) {
                // The process does not exist anymore, there's nothing to filter
                return null;
            }
            throw e;
        }
        return (await filteringFunc(stdout)) ? pid : null;
    }));
    return filtered.filter((pid) => Boolean(pid));
}
// Private functions
async function getPIDsUsingPattern(pattern) {
    const args = [
        '-if', // case insensitive, full cmdline match
        pattern,
    ];
    try {
        const { stdout } = await (0, teen_process_1.exec)('pgrep', args);
        return stdout
            .split(/\s+/)
            .map((x) => parseInt(x, 10))
            .filter(Number.isInteger)
            .map((x) => `${x}`);
    }
    catch (err) {
        logger_1.log.debug(`'pgrep ${args.join(' ')}' didn't detect any matching processes. Return code: ${err.code}`);
        return [];
    }
}
function mergeObjects(target, source) {
    const output = { ...target };
    for (const [key, sourceValue] of Object.entries(source)) {
        const targetValue = output[key];
        if (isPlainObject(targetValue) && isPlainObject(sourceValue)) {
            output[key] = mergeObjects(targetValue, sourceValue);
            continue;
        }
        output[key] = sourceValue;
    }
    return output;
}
function isPlainObject(value) {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
//# sourceMappingURL=utils.js.map
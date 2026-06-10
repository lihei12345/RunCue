"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebDriverAgent = void 0;
const asyncbox_1 = require("asyncbox");
const node_path_1 = __importDefault(require("node:path"));
const base_driver_1 = require("@appium/base-driver");
const support_1 = require("@appium/support");
const logger_1 = require("./logger");
const no_session_proxy_1 = require("./no-session-proxy");
const utils_1 = require("./utils");
const xcodebuild_1 = require("./xcodebuild");
const async_lock_1 = __importDefault(require("async-lock"));
const teen_process_1 = require("teen_process");
const constants_1 = require("./constants");
const strongbox_1 = require("@appium/strongbox");
const WDA_LAUNCH_TIMEOUT = 60 * 1000;
const WDA_AGENT_PORT = 8100;
const SHARED_RESOURCES_GUARD = new async_lock_1.default();
const RECENT_MODULE_VERSION_ITEM_NAME = 'recentWdaModuleVersion';
const URL_PROTOCOL_SEPARATOR = '://';
class WebDriverAgent {
    bootstrapPath;
    agentPath;
    args;
    device;
    platformVersion;
    platformName;
    iosSdkVersion;
    host;
    isRealDevice;
    wdaRemotePort;
    wdaBaseUrl;
    wdaBindingIP;
    webDriverAgentUrl;
    started;
    updatedWDABundleId;
    noSessionProxy;
    jwproxy;
    proxyReqRes;
    log;
    wdaLocalPort;
    prebuildWDA;
    wdaConnectionTimeout;
    useXctestrunFile;
    usePrebuiltWDA;
    mjpegServerPort;
    wdaLaunchTimeout;
    usePreinstalledWDA;
    updatedWDABundleIdSuffix;
    _xcodebuild;
    _url;
    /**
     * Creates a new WebDriverAgent instance.
     * @param args - Configuration arguments for WebDriverAgent
     * @param log - Optional logger instance
     */
    constructor(args, log = null) {
        this.args = { ...args };
        this.log = log ?? logger_1.log;
        this.device = args.device;
        this.platformVersion = args.platformVersion;
        this.platformName = args.platformName;
        this.iosSdkVersion = args.iosSdkVersion;
        this.host = args.host;
        this.isRealDevice = !!args.realDevice;
        this.setWDAPaths(args.bootstrapPath, args.agentPath);
        this.wdaLocalPort = args.wdaLocalPort;
        this.wdaRemotePort =
            ((this.isRealDevice ? args.wdaRemotePort : null) ?? args.wdaLocalPort) || WDA_AGENT_PORT;
        this.wdaBaseUrl = args.wdaBaseUrl || constants_1.WDA_BASE_URL;
        this.wdaBindingIP = args.wdaBindingIP;
        this.prebuildWDA = args.prebuildWDA;
        // this.args.webDriverAgentUrl guiarantees the capabilities acually
        // gave 'appium:webDriverAgentUrl' but 'this.webDriverAgentUrl'
        // could be used for caching WDA with xcodebuild.
        this.webDriverAgentUrl = args.webDriverAgentUrl;
        this.started = false;
        this.wdaConnectionTimeout = args.wdaConnectionTimeout;
        this.useXctestrunFile = args.useXctestrunFile;
        this.usePrebuiltWDA = args.usePrebuiltWDA;
        this.mjpegServerPort = args.mjpegServerPort;
        this.updatedWDABundleId = args.updatedWDABundleId;
        this.wdaLaunchTimeout = args.wdaLaunchTimeout || WDA_LAUNCH_TIMEOUT;
        this.usePreinstalledWDA = args.usePreinstalledWDA;
        this.updatedWDABundleIdSuffix = args.updatedWDABundleIdSuffix ?? constants_1.DEFAULT_TEST_BUNDLE_SUFFIX;
        this._xcodebuild = this.canSkipXcodebuild
            ? null
            : new xcodebuild_1.XcodeBuild(this.device, {
                platformVersion: this.platformVersion,
                platformName: this.platformName,
                iosSdkVersion: this.iosSdkVersion,
                agentPath: this.agentPath,
                bootstrapPath: this.bootstrapPath,
                realDevice: this.isRealDevice,
                showXcodeLog: args.showXcodeLog,
                xcodeConfigFile: args.xcodeConfigFile,
                xcodeOrgId: args.xcodeOrgId,
                xcodeSigningId: args.xcodeSigningId,
                keychainPath: args.keychainPath,
                keychainPassword: args.keychainPassword,
                useSimpleBuildTest: args.useSimpleBuildTest,
                usePrebuiltWDA: args.usePrebuiltWDA,
                updatedWDABundleId: this.updatedWDABundleId,
                launchTimeout: this.wdaLaunchTimeout,
                wdaRemotePort: this.wdaRemotePort,
                wdaBindingIP: this.wdaBindingIP,
                useXctestrunFile: this.useXctestrunFile,
                derivedDataPath: args.derivedDataPath,
                mjpegServerPort: this.mjpegServerPort,
                allowProvisioningDeviceRegistration: args.allowProvisioningDeviceRegistration,
                resultBundlePath: args.resultBundlePath,
                resultBundleVersion: args.resultBundleVersion,
            }, this.log);
    }
    /**
     * Return true if the session does not need xcodebuild.
     * @returns Whether the session needs/has xcodebuild.
     */
    get canSkipXcodebuild() {
        // Use this.args.webDriverAgentUrl to guarantee
        // the capabilities set gave the `appium:webDriverAgentUrl`.
        return this.usePreinstalledWDA || !!this.args.webDriverAgentUrl;
    }
    /**
     * Get the xcodebuild instance. Throws if not initialized.
     * @returns The XcodeBuild instance
     * @throws Error if xcodebuild is not available
     */
    get xcodebuild() {
        if (!this._xcodebuild) {
            throw new Error('xcodebuild is not available');
        }
        return this._xcodebuild;
    }
    /**
     * Return bundle id for WebDriverAgent to launch the WDA.
     * The primary usage is with 'this.usePreinstalledWDA'.
     * It adds `.xctrunner` as suffix by default but 'this.updatedWDABundleIdSuffix'
     * lets skip it.
     *
     * @returns Bundle ID for Xctest.
     */
    get bundleIdForXctest() {
        return `${this.updatedWDABundleId ? this.updatedWDABundleId : constants_1.WDA_RUNNER_BUNDLE_ID}${this.updatedWDABundleIdSuffix}`;
    }
    /**
     * Gets the base path for the WebDriverAgent URL.
     * @returns The base path (empty string if root path)
     */
    get basePath() {
        if (this.url.pathname === '/') {
            return '';
        }
        return this.url.pathname || '';
    }
    /**
     * Gets the WebDriverAgent URL.
     * Constructs the URL from webDriverAgentUrl if provided, otherwise
     * builds it from wdaBaseUrl, wdaBindingIP, and wdaLocalPort.
     * @returns The parsed URL object
     */
    get url() {
        if (!this._url) {
            if (this.webDriverAgentUrl) {
                this._url = this.toUrl(this.webDriverAgentUrl);
            }
            else {
                const port = this.wdaLocalPort || WDA_AGENT_PORT;
                const parsedBaseUrl = this.toUrl(this.wdaBaseUrl || constants_1.WDA_BASE_URL);
                this._url = new URL(`${parsedBaseUrl.protocol}//${this.wdaBindingIP || parsedBaseUrl.hostname}:${port}`);
            }
        }
        return this._url;
    }
    /**
     * Gets whether WebDriverAgent has fully started.
     * @returns `true` if WDA has started, `false` otherwise
     */
    get fullyStarted() {
        return this.started;
    }
    /**
     * Sets whether WebDriverAgent has fully started.
     * @param started - `true` if WDA has started, `false` otherwise
     */
    set fullyStarted(started) {
        this.started = started ?? false;
    }
    /**
     * Sets the WebDriverAgent URL.
     * @param _url - The URL string to parse and set
     */
    set url(_url) {
        this._url = this.toUrl(_url);
    }
    /**
     * Cleans up obsolete cached processes from previous WDA sessions
     * that are listening on the same port but belong to different devices.
     */
    async cleanupObsoleteProcesses() {
        const obsoletePids = await (0, utils_1.getPIDsListeningOnPort)(this.url.port, (cmdLine) => cmdLine.includes('/WebDriverAgentRunner') &&
            !cmdLine.toLowerCase().includes(this.device.udid.toLowerCase()));
        if (obsoletePids.length === 0) {
            this.log.debug(`No obsolete cached processes from previous WDA sessions ` +
                `listening on port ${this.url.port} have been found`);
            return;
        }
        this.log.info(`Detected ${obsoletePids.length} obsolete cached process${obsoletePids.length === 1 ? '' : 'es'} ` +
            `from previous WDA sessions. Cleaning them up`);
        try {
            await (0, teen_process_1.exec)('kill', obsoletePids);
        }
        catch (e) {
            this.log.warn(`Failed to kill obsolete cached process${obsoletePids.length === 1 ? '' : 'es'} '${obsoletePids}'. ` +
                `Original error: ${e.message}`);
        }
    }
    /**
    }
  
    /**
     * Return current running WDA's status like below after launching WDA
     * {
     *   "state": "success",
     *   "os": {
     *     "name": "iOS",
     *     "version": "11.4",
     *     "sdkVersion": "11.3"
     *   },
     *   "ios": {
     *     "simulatorVersion": "11.4",
     *     "ip": "172.254.99.34"
     *   },
     *   "build": {
     *     "time": "Jun 24 2018 17:08:21",
     *     "productBundleIdentifier": "com.facebook.WebDriverAgentRunner"
     *   }
     * }
     *
     * @param sessionId Launch WDA and establish the session with this sessionId
     */
    async launch(sessionId) {
        if (this.webDriverAgentUrl) {
            this.log.info(`Using provided WebdriverAgent at '${this.webDriverAgentUrl}'`);
            this.url = this.webDriverAgentUrl;
            this.setupProxies(sessionId);
            return await this.getStatus();
        }
        if (this.usePreinstalledWDA) {
            return await this.launchWithPreinstalledWDA(sessionId);
        }
        this.log.info('Launching WebDriverAgent on the device');
        this.setupProxies(sessionId);
        if (!this.useXctestrunFile && !(await support_1.fs.exists(this.agentPath))) {
            throw new Error(`Trying to use WebDriverAgent project at '${this.agentPath}' but the ` +
                'file does not exist');
        }
        // useXctestrunFile and usePrebuiltWDA use existing dependencies
        // It depends on user side
        if (this.useXctestrunFile || this.usePrebuiltWDA) {
            this.log.info('Skipped WDA project cleanup according to the provided capabilities');
        }
        else {
            const synchronizationKey = node_path_1.default.normalize(this.bootstrapPath);
            await SHARED_RESOURCES_GUARD.acquire(synchronizationKey, async () => await this._cleanupProjectIfFresh());
        }
        // We need to provide WDA local port, because it might be occupied
        await (0, utils_1.resetTestProcesses)(this.device.udid, !this.isRealDevice);
        if (!this.noSessionProxy) {
            throw new Error('noSessionProxy is not available');
        }
        await this.xcodebuild.init(this.noSessionProxy);
        // Start the xcodebuild process
        if (this.prebuildWDA) {
            await this.xcodebuild.prebuild();
        }
        return (await this.xcodebuild.start());
    }
    /**
     * Checks if the WebDriverAgent source is fresh by verifying
     * that required resource files exist.
     * @returns `true` if source is fresh (all required files exist), `false` otherwise
     */
    async isSourceFresh() {
        const existsPromises = ['Resources', node_path_1.default.join('Resources', 'WebDriverAgent.bundle')].map((subPath) => support_1.fs.exists(node_path_1.default.resolve(this.bootstrapPath, subPath)));
        return (await Promise.all(existsPromises)).every((v) => v === true);
    }
    /**
     * Stops the WebDriverAgent session and cleans up resources.
     * Handles both preinstalled WDA and xcodebuild-based sessions.
     */
    async quit() {
        if (this.usePreinstalledWDA) {
            this.log.info('Stopping the XCTest session');
            try {
                if (this.device.simctl) {
                    await this.device.simctl.terminateApp(this.bundleIdForXctest);
                }
                else if (this.device.devicectl) {
                    await this.device.devicectl.terminateApp(this.bundleIdForXctest);
                }
            }
            catch (e) {
                this.log.warn(e.message);
            }
        }
        else if (!this.args.webDriverAgentUrl) {
            this.log.info('Shutting down sub-processes');
            if (this._xcodebuild) {
                await this.xcodebuild.quit();
            }
        }
        else {
            this.log.debug('Stopping neither xcodebuild nor XCTest session since WDA lifecycle is not managed by this driver');
        }
        if (this.jwproxy) {
            this.jwproxy.sessionId = null;
        }
        this.started = false;
        if (!this.args.webDriverAgentUrl) {
            // if we populated the url ourselves (during `setupCaching` call, for instance)
            // then clean that up. If the url was supplied, we want to keep it
            this.webDriverAgentUrl = undefined;
        }
    }
    /**
     * Retrieves Xcode build settings.
     * @param options - Optional scheme, SDK, configuration, or destination
     * @returns Build settings, or `undefined` if xcodebuild is skipped or settings cannot be determined
     */
    async retrieveBuildSettings(options) {
        if (this.canSkipXcodebuild) {
            return;
        }
        return await this.xcodebuild.retrieveBuildSettings(options);
    }
    /**
     * @deprecated Use {@link retrieveBuildSettings} instead. Will be removed in a future release.
     * @returns The derived data path, or `undefined` if xcodebuild is skipped
     */
    async retrieveDerivedDataPath() {
        if (this.canSkipXcodebuild) {
            return;
        }
        return await this.xcodebuild.retrieveDerivedDataPath();
    }
    /**
     * Reuse running WDA if it has the same bundle id with updatedWDABundleId.
     * Or reuse it if it has the default id without updatedWDABundleId.
     *
     * @returns The WDA URL used for caching on success, or `undefined` if caching was skipped.
     */
    async setupCaching() {
        const status = await this.getStatus(0);
        if (!status || !status.build) {
            this.log.debug('WDA is currently not running. There is nothing to cache');
            return undefined;
        }
        const { productBundleIdentifier, upgradedAt } = status.build;
        // for real device
        if (support_1.util.hasValue(productBundleIdentifier) &&
            support_1.util.hasValue(this.updatedWDABundleId) &&
            this.updatedWDABundleId !== productBundleIdentifier) {
            this.log.info(`Will not reuse running WDA since it has different bundle id. The actual value is '${productBundleIdentifier}'.`);
            return undefined;
        }
        // for simulator
        if (support_1.util.hasValue(productBundleIdentifier) &&
            !support_1.util.hasValue(this.updatedWDABundleId) &&
            constants_1.WDA_RUNNER_BUNDLE_ID !== productBundleIdentifier) {
            this.log.info(`Will not reuse running WDA since its bundle id is not equal to the default value ${constants_1.WDA_RUNNER_BUNDLE_ID}`);
            return undefined;
        }
        const actualUpgradeTimestamp = await (0, utils_1.getWDAUpgradeTimestamp)();
        this.log.debug(`Upgrade timestamp of the currently bundled WDA: ${actualUpgradeTimestamp}`);
        this.log.debug(`Upgrade timestamp of the WDA on the device: ${upgradedAt}`);
        if (actualUpgradeTimestamp &&
            upgradedAt &&
            `${actualUpgradeTimestamp}`.toLowerCase() !== `${upgradedAt}`.toLowerCase()) {
            this.log.info('Will not reuse running WDA since it has different version in comparison to the one ' +
                `which is bundled with appium-xcuitest-driver module (${actualUpgradeTimestamp} != ${upgradedAt})`);
            return undefined;
        }
        const cachedUrl = this.url.href;
        const message = support_1.util.hasValue(productBundleIdentifier)
            ? `Will reuse previously cached WDA instance at '${cachedUrl}' with '${productBundleIdentifier}'`
            : `Will reuse previously cached WDA instance at '${cachedUrl}'`;
        this.log.info(`${message}. Set the wdaLocalPort capability to a value different from ${this.url.port} if this is an undesired behavior.`);
        this.webDriverAgentUrl = cachedUrl;
        return cachedUrl;
    }
    setupProxies(sessionId) {
        const proxyOpts = {
            log: this.log,
            server: this.url.hostname ?? undefined,
            port: parseInt(this.url.port ?? '', 10) || undefined,
            base: this.basePath,
            timeout: this.wdaConnectionTimeout,
            keepAlive: true,
            scheme: this.url.protocol ? this.url.protocol.replace(':', '') : 'http',
            headers: this.args.extraRequestHeaders,
        };
        if (this.args.reqBasePath) {
            proxyOpts.reqBasePath = this.args.reqBasePath;
        }
        this.jwproxy = new base_driver_1.JWProxy(proxyOpts);
        this.jwproxy.sessionId = sessionId;
        this.proxyReqRes = this.jwproxy.proxyReqRes.bind(this.jwproxy);
        this.noSessionProxy = new no_session_proxy_1.NoSessionProxy(proxyOpts);
    }
    toUrl(value) {
        // Treat values without `://` as host/path inputs and normalize to http.
        if (!value.includes(URL_PROTOCOL_SEPARATOR)) {
            return new URL(`http://${value}`);
        }
        try {
            return new URL(value);
        }
        catch {
            throw new Error(`Invalid URL: ${value}`);
        }
    }
    setWDAPaths(bootstrapPath, agentPath) {
        // allow the user to specify a place for WDA. This is undocumented and
        // only here for the purposes of testing development of WDA
        this.bootstrapPath = bootstrapPath || utils_1.BOOTSTRAP_PATH;
        this.log.info(`Using WDA path: '${this.bootstrapPath}'`);
        // for backward compatibility we need to be able to specify agentPath too
        this.agentPath = agentPath || node_path_1.default.resolve(this.bootstrapPath, 'WebDriverAgent.xcodeproj');
        this.log.info(`Using WDA agent: '${this.agentPath}'`);
    }
    /**
     * Return current running WDA's status like below
     * {
     *   "state": "success",
     *   "os": {
     *     "name": "iOS",
     *     "version": "11.4",
     *     "sdkVersion": "11.3"
     *   },
     *   "ios": {
     *     "simulatorVersion": "11.4",
     *     "ip": "172.254.99.34"
     *   },
     *   "build": {
     *     "time": "Jun 24 2018 17:08:21",
     *     "productBundleIdentifier": "com.facebook.WebDriverAgentRunner"
     *   }
     * }
     *
     * @param timeoutMs If zero or negative, returns immediately. Otherwise, waits up to timeoutMs.
     */
    async getStatus(timeoutMs = 0) {
        const noSessionProxy = new no_session_proxy_1.NoSessionProxy({
            scheme: this.url.protocol ? this.url.protocol.replace(':', '') : 'http',
            server: this.url.hostname ?? undefined,
            port: parseInt(this.url.port ?? '', 10) || undefined,
            base: this.basePath,
            timeout: 3000,
            headers: this.args.extraRequestHeaders,
        });
        const sendGetStatus = async () => (await noSessionProxy.command('/status', 'GET'));
        if (timeoutMs == null || timeoutMs <= 0) {
            try {
                return await sendGetStatus();
            }
            catch (err) {
                this.log.debug(`WDA is not listening at '${this.url.href}'. Original error:: ${err.message}`);
                return null;
            }
        }
        let lastError = null;
        let status = null;
        try {
            await (0, asyncbox_1.waitForCondition)(async () => {
                try {
                    status = await sendGetStatus();
                    return true;
                }
                catch (err) {
                    lastError = err;
                }
                return false;
            }, {
                waitMs: timeoutMs,
                intervalMs: 300,
            });
        }
        catch (err) {
            this.log.debug(`Failed to get the status endpoint in ${timeoutMs} ms. ` +
                `The last error while accessing ${this.url.href}: ${lastError}. Original error:: ${err.message}.`);
            throw new Error(`WDA was not ready in ${timeoutMs} ms.`, { cause: err });
        }
        return status;
    }
    async _cleanupProjectIfFresh() {
        if (this.canSkipXcodebuild) {
            return;
        }
        const packageInfo = JSON.parse(await support_1.fs.readFile(node_path_1.default.join(utils_1.BOOTSTRAP_PATH, 'package.json'), 'utf8'));
        const box = (0, strongbox_1.strongbox)(packageInfo.name);
        let boxItem = box.getItem(RECENT_MODULE_VERSION_ITEM_NAME);
        if (!boxItem) {
            const timestampPath = node_path_1.default.resolve(process.env.HOME ?? '', constants_1.WDA_UPGRADE_TIMESTAMP_PATH);
            if (await support_1.fs.exists(timestampPath)) {
                // TODO: It is probably a bit ugly to hardcode the recent version string,
                // TODO: hovewer it should do the job as a temporary transition trick
                // TODO: to switch from a hardcoded file path to the strongbox usage.
                try {
                    boxItem = await box.createItemWithValue(RECENT_MODULE_VERSION_ITEM_NAME, '5.0.0');
                }
                catch (e) {
                    this.log.warn(`The actual module version cannot be persisted: ${e.message}`);
                    return;
                }
            }
            else {
                this.log.info('There is no need to perform the project cleanup. A fresh install has been detected');
                try {
                    await box.createItemWithValue(RECENT_MODULE_VERSION_ITEM_NAME, packageInfo.version);
                }
                catch (e) {
                    this.log.warn(`The actual module version cannot be persisted: ${e.message}`);
                }
                return;
            }
        }
        let recentModuleVersion = await boxItem.read();
        try {
            recentModuleVersion = support_1.util.coerceVersion(recentModuleVersion, true);
        }
        catch (e) {
            this.log.warn(`The persisted module version string has been damaged: ${e.message}`);
            this.log.info(`Updating it to '${packageInfo.version}' assuming the project clenup is not needed`);
            await boxItem.write(packageInfo.version);
            return;
        }
        if (support_1.util.compareVersions(recentModuleVersion, '>=', packageInfo.version)) {
            this.log.info(`WebDriverAgent does not need a cleanup. The project sources are up to date ` +
                `(${recentModuleVersion} >= ${packageInfo.version})`);
            return;
        }
        this.log.info(`Cleaning up the WebDriverAgent project after the module upgrade has happened ` +
            `(${recentModuleVersion} < ${packageInfo.version})`);
        try {
            await this.xcodebuild.cleanProject();
            await boxItem.write(packageInfo.version);
        }
        catch (e) {
            this.log.warn(`Cannot perform WebDriverAgent project cleanup. Original error: ${e.message}`);
        }
    }
    /**
     * Launch WDA with preinstalled package with 'xcrun devicectl device process launch'.
     * The WDA package must be prepared properly like published via
     * https://github.com/appium/WebDriverAgent/releases
     * with proper sign for this case.
     *
     * @param opts launching WDA with devicectl command options.
     */
    async _launchViaDevicectl(opts = {}) {
        const { env } = opts;
        await this.device.devicectl.launchApp(this.bundleIdForXctest, {
            env,
            terminateExisting: true,
        });
    }
    /**
     * Launch WDA with preinstalled package without xcodebuild.
     * @param sessionId Launch WDA and establish the session with this sessionId
     */
    async launchWithPreinstalledWDA(sessionId) {
        const xctestEnv = {
            USE_PORT: this.wdaLocalPort || WDA_AGENT_PORT,
            WDA_PRODUCT_BUNDLE_IDENTIFIER: this.bundleIdForXctest,
        };
        if (this.mjpegServerPort) {
            xctestEnv.MJPEG_SERVER_PORT = this.mjpegServerPort;
        }
        if (this.wdaBindingIP) {
            xctestEnv.USE_IP = this.wdaBindingIP;
        }
        this.log.info('Launching WebDriverAgent on the device without xcodebuild');
        if (this.isRealDevice) {
            await this._launchViaDevicectl({ env: xctestEnv });
        }
        else {
            await this.device.simctl.exec('launch', {
                args: ['--terminate-running-process', this.device.udid, this.bundleIdForXctest],
                env: xctestEnv,
            });
        }
        this.setupProxies(sessionId);
        let status;
        try {
            status = await this.getStatus(this.wdaLaunchTimeout);
        }
        catch {
            throw new Error(`Failed to start the preinstalled WebDriverAgent in ${this.wdaLaunchTimeout} ms. ` +
                `The WebDriverAgent might not be properly built or the device might be locked. ` +
                `The 'appium:wdaLaunchTimeout' capability modifies the timeout.`);
        }
        this.started = true;
        return status;
    }
}
exports.WebDriverAgent = WebDriverAgent;
//# sourceMappingURL=webdriveragent.js.map
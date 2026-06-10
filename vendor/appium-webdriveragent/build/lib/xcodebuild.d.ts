import type { AppiumLogger, StringRecord } from '@appium/types';
import type { AppleDevice, RetrieveBuildSettingsOptions, XcodeBuildArgs, XcodeBuildSettings } from './types';
import type { NoSessionProxy } from './no-session-proxy';
export declare class XcodeBuild {
    readonly device: AppleDevice;
    readonly realDevice: boolean;
    readonly agentPath: string;
    readonly bootstrapPath: string;
    readonly platformVersion?: string;
    readonly platformName?: string;
    readonly iosSdkVersion?: string;
    readonly xcodeSigningId: string;
    private xcodebuild?;
    private usePrebuiltWDA?;
    private derivedDataPath?;
    private readonly log;
    private readonly showXcodeLog?;
    private readonly xcodeConfigFile?;
    private readonly xcodeOrgId?;
    private readonly keychainPath?;
    private readonly keychainPassword?;
    private readonly useSimpleBuildTest?;
    private readonly useXctestrunFile?;
    private readonly launchTimeout?;
    private readonly wdaRemotePort?;
    private readonly wdaBindingIP?;
    private readonly updatedWDABundleId?;
    private readonly mjpegServerPort?;
    private readonly prebuildDelay;
    private readonly allowProvisioningDeviceRegistration?;
    private readonly resultBundlePath?;
    private readonly resultBundleVersion?;
    private _didBuildFail;
    private _didProcessExit;
    private readonly _buildSettingsPromises;
    private noSessionProxy?;
    private xctestrunFilePath?;
    /**
     * Creates a new XcodeBuild instance.
     * @param device - The Apple device to build for
     * @param args - Configuration arguments for xcodebuild
     * @param log - Optional logger instance
     */
    constructor(device: AppleDevice, args: XcodeBuildArgs, log?: AppiumLogger | null);
    /**
     * Initializes the XcodeBuild instance with a no-session proxy.
     * Sets up xctestrun file if needed.
     * @param noSessionProxy - The proxy instance for WDA communication
     */
    init(noSessionProxy: NoSessionProxy): Promise<void>;
    /**
     * Retrieves Xcode build settings via `xcodebuild -showBuildSettings -json`.
     * @param options - Optional scheme, SDK, configuration, or destination
     * @returns Build settings for the `build` action, or `undefined` if they cannot be determined
     */
    retrieveBuildSettings(options?: RetrieveBuildSettingsOptions): Promise<XcodeBuildSettings | undefined>;
    /**
     * @returns The derived data path, or `undefined` if it cannot be determined
     */
    retrieveDerivedDataPath(): Promise<string | undefined>;
    /**
     * Pre-builds WebDriverAgent before launching tests.
     * Performs a build-only operation and sets usePrebuiltWDA flag.
     */
    prebuild(): Promise<void>;
    /**
     * Cleans the Xcode project to remove leftovers from previous installs.
     * Cleans both the library and runner schemes for the appropriate platform.
     */
    cleanProject(): Promise<void>;
    /**
     * Starts the xcodebuild process to build and/or test WebDriverAgent.
     * @param buildOnly - If `true`, only builds without running tests. Defaults to `false`.
     * @returns The WDA status record if tests are run, `void` if build-only
     * @throws Error if xcodebuild fails or cannot start
     */
    start(buildOnly?: boolean): Promise<StringRecord | void>;
    /**
     * Stops the xcodebuild process and cleans up resources.
     */
    quit(): Promise<void>;
    private fetchBuildSettings;
    private getCommand;
    private createSubProcess;
    private waitForStart;
}
//# sourceMappingURL=xcodebuild.d.ts.map
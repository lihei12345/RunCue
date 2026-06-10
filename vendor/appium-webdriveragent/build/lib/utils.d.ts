import type { SubProcess } from 'teen_process';
import type { DeviceInfo } from './types';
export declare const BOOTSTRAP_PATH: string;
/**
 * Arguments for setting xctestrun file
 */
export interface XctestrunFileArgs {
    deviceInfo: DeviceInfo;
    sdkVersion: string;
    bootstrapPath: string;
    wdaRemotePort: number | string;
    wdaBindingIP?: string;
}
/**
 * Find and terminate all processes matching the given pgrep pattern.
 */
export declare function killAppUsingPattern(pgrepPattern: string): Promise<void>;
/**
 * Return true if the platformName is tvOS
 * @param platformName The name of the platorm
 * @returns Return true if the platformName is tvOS
 */
export declare function isTvOS(platformName: string): boolean;
/**
 * Configure keychain access required for real-device code signing.
 */
export declare function setRealDeviceSecurity(keychainPath: string, keychainPassword: string): Promise<void>;
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
export declare function setXctestrunFile(args: XctestrunFileArgs): Promise<string>;
/**
 * Return the WDA object which appends existing xctest runner content
 * @param platformName - The name of the platform
 * @param wdaRemotePort - The remote port number
 * @param wdaBindingIP - The IP address to bind to. If not given, it binds to all interfaces.
 * @return returns a runner object which has USE_PORT and optionally USE_IP
 */
export declare function getAdditionalRunContent(platformName: string, wdaRemotePort: number | string, wdaBindingIP?: string): Record<string, any>;
/**
 * Return the path of xctestrun if it exists
 * @param deviceInfo
 * @param sdkVersion - The Xcode SDK version of OS.
 * @param bootstrapPath - The folder path containing xctestrun file.
 */
export declare function getXctestrunFilePath(deviceInfo: DeviceInfo, sdkVersion: string, bootstrapPath: string): Promise<string>;
/**
 * Return the name of xctestrun file
 * @param deviceInfo
 * @param version - The Xcode SDK version of OS.
 * @return returns xctestrunFilePath for given device
 */
export declare function getXctestrunFileName(deviceInfo: DeviceInfo, version: string): string;
/**
 * Ensures the process is killed after the timeout
 */
export declare function killProcess(name: string, proc: SubProcess | null | undefined): Promise<void>;
/**
 * Generate a random integer in range [low, high). `low` is inclusive and `high` is exclusive.
 */
export declare function randomInt(low: number, high: number): number;
/**
 * Retrieves WDA upgrade timestamp. The manifest only gets modified on package upgrade.
 */
export declare function getWDAUpgradeTimestamp(): Promise<number | null>;
/**
 * Escape regular expression metacharacters in a string.
 */
export declare function escapeRegExp(value: string): string;
/**
 * Truncate a string to the given length and append ellipsis if needed.
 */
export declare function truncateString(value: string, length: number): string;
/**
 * Kills running XCTest processes for the particular device.
 */
export declare function resetTestProcesses(udid: string, isSimulator: boolean): Promise<void>;
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
export declare function getPIDsListeningOnPort(port: string | number, filteringFunc?: ((cmdline: string) => boolean | Promise<boolean>) | null): Promise<string[]>;
//# sourceMappingURL=utils.d.ts.map
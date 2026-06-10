import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import type { Config, VLMProviderConfig } from "../core/types.js";

const CONFIG_DIR = path.join(os.homedir(), ".runcue");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

const DEFAULT_CONFIG: Config = {
  defaultDevice: "",
  maxSteps: 10,
  stepDelay: 500,

  device: {
    defaultPlatform: "ios-simulator",
  },

  wda: {
    scheme: "WebDriverAgentRunner",
    bootstrapPolicy: "auto",
    reuseSession: true,
    startupTimeoutMs: 60_000,
    requestTimeoutMs: 10_000,
    healthCheckIntervalMs: 5_000,
    autoRestart: true,
    signing: {
      teamId: "${RUNCUE_WDA_TEAM_ID}",
      bundleIdPrefix: "com.runcue.wda",
    },
  },

  vlm: {
    default: "dashscope-vl-plus",
    providers: {
      "dashscope-stable": {
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        model: "qwen3.7-plus",
        apiKey: "${DASHSCOPE_API_KEY}",
      },
      "dashscope-balanced": {
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        model: "qwen3.6-plus",
        apiKey: "${DASHSCOPE_API_KEY}",
      },
      "dashscope-fast": {
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        model: "qwen3.5-flash",
        apiKey: "${DASHSCOPE_API_KEY}",
      },
      "qwencloud-stable": {
        baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        model: "qwen3.7-plus",
        apiKey: "${DASHSCOPE_API_KEY}",
      },
      "qwencloud-balanced": {
        baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        model: "qwen3.6-plus",
        apiKey: "${DASHSCOPE_API_KEY}",
      },
      "qwencloud-fast": {
        baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        model: "qwen3.5-flash",
        apiKey: "${DASHSCOPE_API_KEY}",
      },
      "dashscope-vl-flash": {
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        model: "qwen3-vl-flash",
        apiKey: "${DASHSCOPE_API_KEY}",
      },
      "dashscope-vl-plus": {
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        model: "qwen3-vl-plus",
        apiKey: "${DASHSCOPE_API_KEY}",
      },
      dashscope: {
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        model: "qwen3-vl-flash",
        apiKey: "${DASHSCOPE_API_KEY}",
      },
      "dashscope-plus": {
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        model: "qwen3-vl-plus",
        apiKey: "${DASHSCOPE_API_KEY}",
      },
      google: {
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        model: "gemini-2.5-pro",
        apiKey: "${GOOGLE_API_KEY}",
      },
      zhipu: {
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        model: "autoglm-phone",
        apiKey: "${ZHIPU_API_KEY}",
      },
      openai: {
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-5.4",
        apiKey: "${OPENAI_API_KEY}",
      },
      "openai-mini": {
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-5.4-mini",
        apiKey: "${OPENAI_API_KEY}",
      },
    },
  },
};

function mergeConfig(userConfig: Partial<Config>): Config {
  return {
    ...DEFAULT_CONFIG,
    ...userConfig,
    device: {
      ...DEFAULT_CONFIG.device,
      ...userConfig.device,
    },
    wda: {
      ...DEFAULT_CONFIG.wda,
      ...userConfig.wda,
      signing: {
        ...DEFAULT_CONFIG.wda.signing,
        ...userConfig.wda?.signing,
      },
    },
    vlm: {
      ...DEFAULT_CONFIG.vlm,
      ...userConfig.vlm,
      providers: {
        ...DEFAULT_CONFIG.vlm.providers,
        ...userConfig.vlm?.providers,
      },
    },
  };
}

/** Resolve environment variable references like ${VAR_NAME} */
function resolveEnvVars(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? "");
}

export async function loadConfig(): Promise<Config> {
  try {
    const raw = await fs.readFile(CONFIG_FILE, "utf-8");
    const userConfig = JSON.parse(raw) as Partial<Config>;
    return mergeConfig(userConfig);
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(config: Config): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

export function getProviderConfig(
  config: Config,
  providerName?: string,
): VLMProviderConfig {
  const name = providerName ?? config.vlm.default;
  const provider = config.vlm.providers[name];
  if (!provider) {
    throw new Error(
      `Unknown VLM provider: ${name}. Available: ${Object.keys(config.vlm.providers).join(", ")}`,
    );
  }

  return {
    baseUrl: resolveEnvVars(provider.baseUrl),
    model: provider.model,
    apiKey: resolveEnvVars(provider.apiKey),
    wireApi: provider.wireApi,
    inputMode: provider.inputMode,
    headers: provider.headers,
  };
}

export function resolveWDAConfig(config: Config): Config["wda"] {
  return {
    ...config.wda,
    endpoint: config.wda.endpoint ? resolveEnvVars(config.wda.endpoint) : undefined,
    projectPath: config.wda.projectPath ? resolveEnvVars(config.wda.projectPath) : undefined,
    signing: config.wda.signing
      ? {
          teamId: config.wda.signing.teamId
            ? resolveEnvVars(config.wda.signing.teamId)
            : undefined,
          bundleIdPrefix: config.wda.signing.bundleIdPrefix
            ? resolveEnvVars(config.wda.signing.bundleIdPrefix)
            : undefined,
        }
      : undefined,
  };
}

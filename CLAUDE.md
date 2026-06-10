# RunCue

RunCue 是开发者 UI 导航工具：在 XcodeBuildMCP 已经构建并启动 app 后，用自然语言完成 iOS UI 导航、输入和状态检查。

## 项目结构

- `src/core/agent-loop.ts` — Agent Loop 核心（view tree -> VLM -> action -> repeat）
- `src/core/types.ts` — 核心类型定义
- `src/vlm/cloud-api.ts` — OpenAI-compatible VLM 适配器
- `src/vlm/prompt-templates/` — VLM prompt 模板
- `src/device/wda.ts` — 唯一 iOS 设备 adapter，基于 WebDriverAgent
- `src/device/wda-manager.ts` — WDA endpoint、启动、doctor
- `src/device/xcode-devices.ts` — Xcode 设备枚举，基于 `xcrun xctrace list devices`
- `src/device/factory.ts` — WDA-only adapter factory
- `src/mcp/server.ts` — MCP Server
- `src/mcp/schemas.ts` — MCP tool schema
- `src/cli.ts` — CLI

## 开发命令

```bash
npm run build
npm run test
npm run dev
```

## 当前架构原则

1. **WDA-only**：不保留 `simctl` / `legacy-simctl` 设备路径，不暴露 `backend` 参数。
2. **工具分工清晰**：XcodeBuildMCP 负责 build/install/launch/logs；RunCue 只负责 UI 导航和检查。
3. **输入走 WDA**：`type(text)` 通过 WDA `/keys`，不走剪贴板、长按、粘贴菜单。
4. **tree-first**：普通场景只发 view tree；tree 不可用、稀疏或不变化时才发送当前截图。
5. **通用性优先**：不要针对某个 app、某段文案、某个业务页面写启发式逻辑。

## RunCue + XcodeBuildMCP 协作规则

1. 先用 XcodeBuildMCP `build_run_sim` 或等效流程启动 app。
2. 把同一个设备的 UDID 或名称传给 RunCue 的 `--device` / `deviceId`。WDA path 下不要传 `booted`。
3. UI 导航、点击、滑动、输入文本统一通过 RunCue。
4. 日志、截图、断点、构建结果仍通过 XcodeBuildMCP。
5. RunCue 完成后再截图，避免截到转场中间态。

## MCP Tools

```text
runcue_run(task, deviceId, platform?, bundleId?, maxSteps?, hints?, timeout?)
runcue_check(question, deviceId, platform?, bundleId?)
runcue_devices()
runcue_doctor(deviceId?, platform?)
```

## CLI 示例

```bash
runcue devices
runcue doctor --device "iPhone 17 Pro Simulator" --platform ios-simulator
runcue run "登录并进入订单详情页" --device "iPhone 17 Pro Simulator" --platform ios-simulator --bundle-id com.example.MyApp
runcue check "当前是否在订单详情页？" --device "iPhone 17 Pro Simulator" --platform ios-simulator
```

## 输入模式

| 模式 | 发送内容 | 触发条件 |
| --- | --- | --- |
| `viewtree` | accessibility tree | tree 可用且信息足够 |
| `hybrid` | tree + 当前截图 | tree 稀疏，常见于 WebView/自绘 UI |
| `screenshot` | 当前截图 | tree 获取失败，或上一步操作后 tree 完全不变 |

## 模型配置

默认 provider 是 `dashscope-vl-plus`，模型为 `qwen3-vl-plus`。planner 和 visual locator 统一走 VL 模型。成本敏感场景可用：

- `dashscope-vl-flash` / `qwen3-vl-flash`

## 架构文档

当前架构见 `docs/architecture.md`，使用说明见 `docs/usage.md`，agent 集成见 `docs/agent-integration.md`。详细设计记录见 `docs/tech-solution-v2.md`；旧 `docs/archive/tech-solution-v1.md` 是 v1 历史方案，不再代表当前实现。

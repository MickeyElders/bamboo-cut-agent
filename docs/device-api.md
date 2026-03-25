# Device API

设备对外只暴露被动能力，不感知云端或上层系统存在。

目标是让上层系统基于统一抽象完成接入：
- 设备身份
- 设备能力
- 设备状态
- 设备事件
- 设备命令

## Endpoints

### `GET /api/device/identity`

返回设备身份信息：
- `schema_version`
- `local_uid`
- `hostname`
- `model`
- `hardware_revision`
- `software_version`

示例：

```json
{
  "schema_version": "device-api.v1",
  "local_uid": "device-001122334455",
  "hostname": "bamboo-station-01",
  "model": "Linux-6.6.74+rpt-rpi-2712-aarch64-with-glibc2.38",
  "hardware_revision": "Raspberry Pi 5 Model B Rev 1.0",
  "software_version": "0.1.0"
}
```

### `GET /api/device/capabilities`

返回设备能力清单与命令描述：
- `capabilities`
- `commands`

能力示例：
- 自动运行
- 手动调试
- 灯光控制
- 切割配置
- 输入反馈
- 事件历史

命令示例：
- `set_mode_auto`
- `set_mode_manual`
- `emergency_stop`
- `fault_reset`
- `apply_cut_config`
- `apply_light_config`

示例：

```json
{
  "capabilities": [
    {
      "key": "mode.auto",
      "label": "自动运行",
      "supported": true,
      "detail": "支持自动切割流程"
    },
    {
      "key": "light.control",
      "label": "灯光控制",
      "supported": true,
      "detail": "支持 WS2812 灯光控制"
    }
  ],
  "commands": [
    {
      "command": "set_mode_auto",
      "label": "切换自动模式",
      "category": "mode",
      "dangerous": false,
      "manual_only": false,
      "detail": "",
      "parameters": []
    },
    {
      "command": "apply_light_config",
      "label": "应用灯光配置",
      "category": "config",
      "dangerous": false,
      "manual_only": false,
      "detail": "",
      "parameters": [
        { "name": "count", "type": "integer", "required": true, "min": 0, "max": 16, "detail": "亮灯数量" },
        { "name": "brightness", "type": "integer", "required": true, "min": 0, "max": 255, "detail": "灯光亮度" }
      ]
    }
  ]
}
```

### `GET /api/device/status`

返回设备当前状态，包含：
- 契约版本
- 树莓派状态
- CanMV 状态
- 作业状态
- 输入信号
- 启动检查
- 当前告警
- 最近事件

示例：

```json
{
  "schema_version": "device-status.v1",
  "raspberry_pi": {
    "hostname": "bamboo-station-01",
    "cpu_percent": 12.5,
    "memory_percent": 34.2,
    "uptime_seconds": 86400.0
  },
  "canmv_connected": true,
  "canmv_last_seen_seconds": 0.2,
  "canmv_fps": 18.4,
  "canmv_status": {
    "cpu_percent": 22.1,
    "kpu_percent": 41.8,
    "memory_percent": 37.0,
    "temperature_c": 54.3
  },
  "job_status": {
    "mode": "auto",
    "auto_state": "feeding",
    "cycle_count": 128,
    "last_action": "cycle_complete",
    "cut_request_active": false,
    "fault_active": false,
    "fault_code": null,
    "fault_detail": null
  },
  "input_signals": [],
  "startup_checks": [],
  "alerts": [],
  "recent_events": []
}
```

### `GET /api/device/events?limit=100`

返回运行事件历史，适合用于：
- 运维追踪
- 故障复盘
- 审计记录
- 上层状态归档

支持的查询参数：
- `limit`
- `category`
- `level`
- `since`

示例：

```json
[
  {
    "timestamp": 1710000000.123,
    "category": "runtime",
    "level": "info",
    "code": "cycle_complete",
    "message": "自动切割循环完成"
  },
  {
    "timestamp": 1710000010.456,
    "category": "fault",
    "level": "error",
    "code": "auto_cut_timeout",
    "message": "切割阶段超时"
  }
]
```

### `POST /api/device/commands`

通过标准命令模型驱动设备，而不是直接暴露 GPIO 语义。

请求示例：

```json
{
  "command": "apply_light_config",
  "params": {
    "count": 8,
    "brightness": 180,
    "red": 255,
    "green": 244,
    "blue": 214
  }
}
```

响应示例：

```json
{
  "ok": true,
  "command": "apply_light_config",
  "value": null,
  "timestamp": 1710000000.123
}
```

切割配置示例：

```json
{
  "command": "apply_cut_config",
  "params": {
    "line_ratio_x": 0.5,
    "tolerance_ratio_x": 0.015,
    "show_guide": true,
    "min_hits": 3,
    "hold_ms": 200
  }
}
```

## Design Rules

- 设备是被动服务端，只暴露能力，不感知云端。
- 上层系统负责身份编排、协同、监控和权限控制。
- 设备命令表达业务动作，不暴露底层 GPIO 细节。
- 现场 HMI 不使用这组接口做自检或调试。
- 现场 HMI 与外部集成是两层边界，不混用。

## Error Responses

设备契约接口在业务错误场景下统一返回：

```json
{
  "detail": "Unsupported device command: unknown_command"
}
```

常见错误：
- `400 Bad Request`
  - 命令不支持
  - 参数缺失
  - 参数范围非法
  - 当前设备状态不允许执行
- `500 Internal Server Error`
  - 设备内部服务异常
  - 驱动层异常
  - 未捕获的运行错误

建议上层系统处理策略：
- `400` 视为请求侧错误，不自动重试
- `500` 视为设备侧异常，可按退避策略重试
- 对危险命令单独保留人工确认链路

## Command Semantics

### 幂等性建议

- 可视为幂等：
  - `set_mode_auto`
  - `set_mode_manual`
  - `fault_reset`
  - `apply_cut_config`
  - `apply_light_config`

说明：
- 对相同目标状态重复调用，设备最终状态应保持一致
- 上层系统可以在超时但不确定是否成功时谨慎重试

- 不应直接自动重试：
  - `emergency_stop`

说明：
- 急停属于安全动作，应视为高优先级人工确认命令
- 即使重复调用本身通常安全，也不建议把它放入普通自动重试链路

### 重试策略建议

- 读取接口
  - `GET /api/device/identity`
  - `GET /api/device/capabilities`
  - `GET /api/device/status`
  - `GET /api/device/events`
  - 可按退避策略重试

- 写入接口
  - `POST /api/device/commands`
  - 仅对明确幂等的命令进行重试

### 云端接入建议

- 先调用 `identity` 获取设备识别基础信息
- 再调用 `capabilities` 识别设备是否支持目标功能
- 运行期先检查 `schema_version`，再用 `status` 和 `events` 做监控与审计
- 执行命令前做能力校验和人工权限校验

## Event Categories

事件分类用于做筛选、告警路由和归档：
- `runtime`
  - 自动流程运行事件
- `control`
  - 本地控制命令事件
- `fault`
  - 故障与故障恢复事件
- `hardware`
  - 硬件驱动与硬件异常事件
- `system`
  - 控制器启动、停机等系统事件

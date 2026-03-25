# Local HMI

现场 HMI 是设备本地操作界面，负责：
- 运行状态展示
- 视频监看
- 灯光与切割配置
- 手动调试
- 设备维护

现场 HMI 不负责：
- 对外契约验证
- 云端接入调试
- 设备开放接口测试

## Runtime Channels

### `WS /ws/ui`

现场界面的主状态通道，只接收两类消息：
- `system_status`
- `ai_frame`

说明：
- 前端不再轮询设备状态
- 运行状态以推送为主
- 控制命令和状态通道分离

### `WS /ws/video`

视频播放使用后端 WebRTC 信令通道。

### `WS /ws/canmv`

仅供 CanMV 上报识别数据，不是现场 HMI 直接使用的通道。

## Local APIs

### 状态与配置

- `GET /api/video/config`
  - 读取视频配置
- `GET /api/cut-config`
  - 读取切割配置
- `PUT /api/cut-config`
  - 保存切割配置，并同步下发给 CanMV
- `GET /api/system/maintenance`
  - 读取设备维护信息
- `GET /api/system/events`
  - 读取本地运行事件历史
  - 支持 `limit`、`category`、`level`、`since` 查询参数

### 控制接口

- `POST /api/control/mode`
- `POST /api/control/feed`
- `POST /api/control/clamp`
- `POST /api/control/cutter`
- `POST /api/control/light`
- `POST /api/control/emergency-stop`
- `POST /api/control/fault-reset`
- `POST /api/system/action`

## Operation Flows

### 自动运行

现场默认工作方式是自动运行：
- 设备处于自动模式
- 前端通过 `WS /ws/ui` 接收状态推送
- CanMV 提供识别结果和切割触发
- 树莓派执行自动送料、压紧、切割和释放流程

### 手动调试

手动调试只用于安装、校准和维护：
- 操作者先进入手动调试
- 设备切换为手动模式
- 操作者按需单独控制送料、压紧、切刀等机构
- 退出手动调试后，设备回到自动模式

### 灯光设置

灯光配置通过独立弹窗完成：
- 设置亮灯数量
- 设置亮度
- 设置颜色
- 点击应用后写入设备
- 点击关灯时立即关闭全部灯珠

### 切割信息设置

切割信息通过独立弹窗完成：
- 调整切割线位置
- 调整容差范围
- 调整命中次数
- 调整保持时间
- 保存后同步下发给 CanMV

### 故障处理

当设备进入故障状态时：
- 前端只展示故障信息和当前保护状态
- 现场确认后执行故障复位
- 若无法恢复，再进入手动调试进行维护排查

### 设备维护

设备维护通过维护弹窗完成：
- 重启应用
- 重启网络
- 重启设备
- 关闭设备

## Error Responses

本地接口发生业务错误时，统一返回：

```json
{
  "detail": "Command requires manual mode: feed_start"
}
```

常见场景：
- `400 Bad Request`
  - 参数缺失
  - 动作不支持
  - 当前模式不允许该控制
  - 当前故障状态阻止执行
- `500 Internal Server Error`
  - 后端内部异常
  - 外设驱动异常
  - 未捕获的运行错误

## Status Dictionary

### 作业模式

- `manual`
  - 手动调试模式
- `auto`
  - 自动运行模式

### `auto_state`

- `manual_ready`
  - 手动模式待命
- `feeding`
  - 自动送料中，等待切割触发
- `position_reached`
  - 已到切割位，准备进入切割循环
- `clamping`
  - 压紧执行中
- `cutting`
  - 切刀下压切割中
- `blade_return`
  - 切刀回程中
- `release`
  - 夹具释放中
- `emergency_stop`
  - 急停保护状态

### 启动检查 `startup_checks`

- `cut_config`
  - 切割配置是否已加载
- `light_driver`
  - 灯光驱动是否可用
- `video_config`
  - 视频链路是否启用
- `canmv_link`
  - CanMV 通信是否在线
- `gpio_inputs`
  - GPIO 输入反馈是否已配置

### 告警 `alerts`

- `canmv_offline`
  - CanMV 离线，尚未收到最新状态
- `light_driver`
  - 灯光驱动异常
- `pi_memory_high`
  - 树莓派内存占用过高
- `estop_active`
  - 急停回路输入处于激活状态
- `fault_code`
  - 自动流程故障编码，来自设备控制器

### 故障 `fault_code`

当前控制器内已经使用的故障码包括：
- `emergency_stop`
  - 设备进入急停保护
- `auto_position_timeout`
  - 等待切割位完成超时
- `auto_clamp_timeout`
  - 压紧阶段超时
- `auto_cut_timeout`
  - 切割阶段超时
- `auto_release_timeout`
  - 释放阶段超时

## Design Rules

- 现场 HMI 只处理现场操作，不承担上层系统职责。
- 控制命令通过独立接口发送，不与状态模型混用。
- 设备内部控制状态不直接暴露为前端公共模型。
- 手动调试是临时维护入口，不是默认工作流。

# GestureSeek — 设计文档 (v2,已技术核验)

> 摄像头捏合手势拖动视频进度条的 Chrome 扩展
> 日期:2026-06-07
> 状态:已通过 brainstorm + 技术核验。**v2 因核验推翻了 offscreen 摄像头方案,改用扩展源 iframe。**

---

## 1. 目标与范围

用 USB 摄像头识别**捏合手势(👌)+ 水平移动手**,在 **YouTube** 和 **Bilibili** 上像拖真进度条一样**实时**拖动视频播放进度。

**调研结论**:不存在做了这件事的现成插件。现有项目要么是摄像头手势但只做滚动/播放暂停,要么是进度条拖动但用鼠标/触摸。本项目是空白点。

### 核心交互(已确认)
- **手势**:捏合(拇指尖 ↔ 食指尖距离变小)= 抓住进度条;松开 = 放下。
- **响应**:实时拖动,视频画面跟手移动而跳转。
- **映射**:满屏宽度 = 整条视频(按总长比例)。
- **相对锚定**:捏的瞬间以当前播放点为起点,手不动则视频不动,绝不一捏就跳。
- **摄像头**:进入 YouTube/Bilibili 标签页即自动开启追踪(USB 摄像头,不担心耗电)。首次需点一次"允许"授权。
- **反馈**:正常使用不加任何额外 UI,靠原生进度条反映变化;仅在出错(摄像头未授权等)时弹一个会自动消失的小提示。

### 不做的事(YAGNI)
- ❌ 其它手势(播放/暂停/音量)
- ❌ 设置页(灵敏度按"满屏=整条视频"写死)
- ❌ 常驻摄像头预览 / 骨架 UI
- ❌ YouTube / Bilibili 以外的网站

---

## 2. 架构(v2 — 核验后修正)

### 为什么不是 offscreen(原 v1 方案被推翻)
核验发现两条硬约束:
1. **offscreen 文档里 `getUserMedia` 开摄像头会失败**——offscreen 是隐藏页,浏览器无法在其中弹授权框(`USER_MEDIA` 理由只对屏幕捕获/tabCapture 有效)。
2. **MediaPipe 的 wasm 需要 `wasm-unsafe-eval`**,而网站(YouTube)的页面 CSP 会拦截注入页面的 wasm。

### v2:注入页面的"扩展源 iframe"
摄像头 + MediaPipe 放进一个 **iframe,其 src 指向扩展自己的页面 `camera.html`**(经 `web_accessible_resources` 暴露)。这个 iframe:
- 是**扩展源**文档 → 受扩展 CSP(含 `wasm-unsafe-eval`)管辖,wasm 能跑,且**完全绕开网站 CSP**;
- 是页面里一个**真实存在的(非 display:none)可见文档** + `allow="camera"` → `getUserMedia` 能弹授权框,**以扩展名义申请、只问一次、跨标签页持久**。

```
┌──────────── youtube.com / bilibili.com 页面 ────────────┐
│                                                          │
│  content.js  (内容脚本,隔离世界,不受页面 CSP)           │
│   • 定位主 <video>(MutationObserver 等待出现)           │
│   • 注入 <iframe src="chrome-extension://…/camera.html"   │
│             allow="camera">(1×1、近乎不可见、不挡点击)   │
│   • 运行手势状态机 + 节流写 video.currentTime            │
│   • 仅出错时显示自动消失的小 toast                       │
│           ▲ window 'message'         │ postMessage       │
│           │ {x, d, present}          │ (可选:回传状态)  │
│  ┌────────┴──────────────────────────▼───────────────┐  │
│  │  iframe: camera.html + camera.js  (扩展源)         │  │
│  │   • getUserMedia(camera) — 扩展 CSP 允许、可授权   │  │
│  │   • MediaPipe HandLandmarker(本地 wasm + 模型)    │  │
│  │   • 每帧输出:手 x(已镜像 0~1)、捏合距离 d、是否有手│  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

**无需 service worker / background**(MV3 允许不要),也无需 offscreen。组件最小化。

### 职责边界(单一职责,便于测试)
| 模块 | 唯一职责 | 关键点 |
|------|----------|--------|
| `camera.js`(iframe 内) | 纯"手势传感器":摄像头 + MediaPipe → 每帧发 `{x, d, present}` | 不碰视频,不做业务判断 |
| `content.js`(内容脚本) | 注入 iframe + 手势状态机 + 改 `<video>.currentTime` | 所有决策逻辑集中在此,可单测 |
| `gesture-core.js` | 纯函数:状态机 + 平滑 + 滞后阈值(被 content.js 引入,也被单测引入) | 无 DOM 依赖,纯逻辑 |
| `manifest.json` | 权限、注入规则、CSP、web_accessible_resources | — |

> 把状态机抽成无 DOM 的纯模块 `gesture-core.js`,这样能用 node 直接单测,不需要浏览器。

---

## 3. 核心算法:捏合 → 拖进度条

### 传感器输出(camera.js,每帧)
MediaPipe HandLandmarker 每帧返回每只手 21 个归一化关键点([0,1])。取:
- `landmark[4]` = 拇指尖,`landmark[8]` = 食指尖
- `handX = mirror(( x₄ + x₈ ) / 2) = 1 − ( x₄ + x₈ ) / 2`(镜像翻转:手往用户右 = 视频往后)
- `d = 归一化欧氏距离(landmark[4], landmark[8])`(捏合度)
- `present = 是否检测到手`
- 只取置信度最高的一只手(`numHands: 1`)

发送给父窗口:`{ type:'gs-frame', x, d, present }`

### 决策(content.js + gesture-core.js,每帧)
```
平滑:xSmooth = EMA(x, α=0.5)            // 指数移动平均,去抖
滞后阈值:
  IDLE → DRAGGING 当 d < 0.05
  DRAGGING → IDLE 当 d > 0.07

状态 IDLE:
  若 present 且 d<0.05:
    进入 DRAGGING
    anchorX = xSmooth
    anchorFraction = clamp01(video.currentTime / video.duration)   // 相对锚定

状态 DRAGGING:
  每帧:
    Δ = xSmooth − anchorX
    target = clamp01(anchorFraction + Δ)             // 满屏 Δ=±1 = 整条视频
    节流(≤20次/秒)后:video.currentTime = target × video.duration
  若 !present 或 d>0.07:
    回到 IDLE(保持当前进度)
```

### 关键设计点
- **相对锚定**:避免"一捏就跳"。
- **镜像翻转**:在 camera.js 端做,content.js 拿到的就是符合直觉的 x。
- **滞后 + EMA 平滑**:防止进度条抖动和误触发。
- **节流**:`video.currentTime` 写入限制 ≤20 次/秒。
- **duration 守卫**:`duration` 为 0 / NaN / Infinity(直播或未就绪)时跳过该帧。

---

## 4. 技术栈与目录结构

### 技术栈
- **Manifest V3** Chrome 扩展,纯前端,无构建工具,无后端,无 background。
- **`@mediapipe/tasks-vision` 0.10.35** 的 `HandLandmarker`,`runningMode:"VIDEO"`,`detectForVideo()`,GPU delegate(回退 CPU)。
- **本地** `hand_landmarker.task` 模型 + wasm 运行时(不联网、隐私 OK)。
- 原生 JavaScript,ES module。

### 关键 manifest 字段
- `content_scripts`:匹配 `*://*.youtube.com/*`、`*://*.bilibili.com/*`,注入 `content.js`。
- `content_security_policy.extension_pages`: `"script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"`(让 camera.html 能跑 wasm)。
- `web_accessible_resources`:把 `camera.html` 暴露给上述两站(以便页面能 iframe 它;其加载的 lib/模型是同源子资源,无需单列)。
- `host_permissions`:同上两站。
- 摄像头:**不是 chrome 权限**,通过 iframe 的 `getUserMedia` 获取(扩展源,授权一次)。

### 目录(`C:\Project\GestureSeek`)
```
GestureSeek/
├── manifest.json
├── content.js                  ← 注入页面:定位 video + 注入 iframe + 状态机 + 改 currentTime + 出错 toast
├── gesture-core.js             ← 纯逻辑:状态机/平滑/阈值(无 DOM,可单测)
├── camera.html                 ← iframe 文档(扩展源)
├── camera.js                   ← iframe 内:摄像头 + MediaPipe → 每帧发 {x,d,present}
├── lib/
│   ├── vision_bundle.mjs       ← @mediapipe/tasks-vision 运行时(本地)
│   └── wasm/                    ← MediaPipe wasm(本地)
├── models/
│   └── hand_landmarker.task    ← 模型(本地,7.8MB)
├── icons/                      ← 16/32/48/128
├── tools/gen-icons.js          ← 图标生成脚本(开发用)
├── tests/gesture-core.test.js  ← 状态机单测(node 跑,CommonJS)
├── README.md                   ← 安装与使用说明
└── docs/superpowers/specs/     ← 本设计文档
```

---

## 5. 边界情况与错误处理

| 情况 | 处理 |
|------|------|
| 页面无 `<video>` / 尚未加载 | `MutationObserver` 等视频出现再激活;并监听 SPA 路由变化重新绑定 |
| 摄像头被占用 / 拒绝授权 | camera.js 捕获错误 → 通知 content.js → 弹自动消失 toast,不刷屏 |
| YouTube Trusted Types CSP(`require-trusted-types-for 'script'`) | content.js 只用 `createElement`+属性赋值+`textContent`,**绝不用 innerHTML/srcdoc** 等解析型 sink |
| 检测到多只手 | `numHands:1`,只取置信度最高 |
| 全屏播放 | `<video>` 仍可访问;iframe 仍在 DOM 中,正常工作 |
| `duration` 为 NaN/0/Infinity(直播/未就绪) | 跳过该帧 seek |
| YouTube SPA 换视频(URL 变但不刷新) | 监听 `yt-navigate-finish` / URL 变化,重新定位 `<video>` |
| 手移出画面 | `present=false` → 退出 DRAGGING,保持当前进度 |

---

## 6. 验收标准
1. youtube.com 视频页捏合右移手 → 视频实时前进;松手停住。
2. bilibili.com 同样生效,且与 YouTube 共用同一套 content.js / gesture-core.js。
3. 捏合瞬间视频不跳变(相对锚定)。
4. 手往用户右侧 → 视频前进(镜像正确)。
5. 首次弹一次摄像头授权;授权后再进这两站自动开始,不再询问。
6. 全程不向任何外部服务器发送图像数据(全部本地)。
7. `tests/gesture-core.test.js` 全绿(状态机逻辑,24 项含 NaN/创移回归)。

---

## 7. 技术核验结论(2026-06-07,主线程联网核验)
| 编号 | 假设 | 结论 |
|------|------|------|
| A1 | offscreen 能开摄像头 | ❌ **推翻** → 改扩展源 iframe(`allow="camera"`) |
| A2 | MediaPipe 本地加载 + 扩展 CSP | ✅ 需 `script-src 'self' 'wasm-unsafe-eval'`;tasks-vision 0.10.35 可跑 |
| A3 | 关键点 4=拇指尖/8=食指尖,归一化 [0,1] | ✅ |
| A4 | content script 改 YT/B站 `<video>.currentTime` | ✅(等 duration、防 NaN) |
| A5 | 绕开网站 CSP | ✅ 扩展源 iframe 受扩展 CSP;内容脚本隔离世界 |
| A6 | offscreen 生命周期 | ⊘ 作废(已无 offscreen / background) |
| A7 | 浏览器内性能足够 | ✅ GPU delegate 30+ fps |
| 新 | YT/B站 是否用 `Permissions-Policy` 禁 camera | ✅ 实测:YouTube 仅限制 `ch-ua-*` 未碰 camera;Bilibili 无任何限制头 → `allow="camera"` 两站可委派成功 |

> 来源:chrome.offscreen 官方文档、chrome-extensions-samples #821、mediapipe #4028、Chrome CSP 文档、MDN getUserMedia/Permissions-Policy,及对两站响应头的实测。

---

## 8. 多 agent 代码审查与加固(v2.1,2026-06-07)

代码写完后用 13 个并行 agent 做对抗式审查(0 blocker / 10 major / 9 minor / 12 nit),据此加固:

**逻辑(gesture-core.js)**
- 修复 EMA 创移 bug:进入 DRAGGING 时把平滑值 `xSmooth` 锚定到原始 `frame.x`,保证"捏住后手不动 → 视频不动"(原实现用滞后平滑值,会让视频自己往前爬几十秒)。
- 全面 NaN 防护:`frame.x`/`d`/`currentTime` 非有限值时安全降级;`clamp01(NaN)=0`;NaN 距离会释放拖动而非锁死。
- 新增 6 个回归测试覆盖上述场景(共 24 项)。

**生命周期(content.js)**
- **仅在视频页激活**(YouTube `/watch /shorts /embed /live`、Bilibili `/video /bangumi /list …`),避免在首页就弹摄像头授权、避免误锁首页预览 `<video>`。
- **站点无关的 SPA 导航**:轮询 `location.href` + `popstate` + YouTube 的 `yt-navigate-finish`,任一变化即重置状态机、重选视频(修复 Bilibili 切视频不生效)。
- MutationObserver 改为常驻 + 去抖(300ms),可重新发现后出现/被替换的播放器与 iframe;不再一次性 disconnect。
- `pickVideo` 要求正面积,跳过 0×0/隐藏视频;缓存失效条件加入面积归零。
- 错误提示区分可恢复/致命(致命 12s)。

**传感器(camera.js)**
- USB 摄像头中途断开(track `ended`)→ 上报 `camera-lost`。
- 连续推理失败累计 ~2s → 上报一次 `detect-failed`,不再静默失效。

**清单(manifest.json)**
- `web_accessible_resources` 收敛为仅 `camera.html`(其余为扩展同源子资源,无需暴露);移除冗余 `host_permissions`;新增 `storage`(仅用于"首次提示只显示一次")。

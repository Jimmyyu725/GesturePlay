# GestureSeek

用 USB 摄像头的**捏合手势**,像拖真进度条一样**实时拖动** YouTube / Bilibili 视频进度。

捏合拇指与食指 = 抓住进度条 → 左右移动手 = 拖动 → 松开 = 放下。
手往右 = 视频前进;手扫过摄像头整个宽度 = 跨越整条视频。

全程在本地处理(MediaPipe 手部识别),**摄像头画面绝不上传**。

拖动时直接驱动 **YouTube / B站自带的进度条**(不额外加进度条);**播放、暂停、全屏**下均可用。

---

## 安装(加载已解压的扩展)

1. 打开 Chrome,地址栏输入 `chrome://extensions` 回车。
2. 打开右上角的 **「开发者模式 / Developer mode」** 开关。
3. 点 **「加载已解压的扩展程序 / Load unpacked」**。
4. 选择文件夹:**`C:\Project\GestureSeek`**(就是包含 `manifest.json` 的这个目录)。
5. 列表里出现 **GestureSeek** 即安装成功。

> 仅支持 Chrome / Edge 等 Chromium 内核浏览器(用的是 Manifest V3 + offscreen 之外的扩展能力)。

## 第一次使用

1. 打开任意一个 **YouTube** 或 **Bilibili** 视频页。
2. 浏览器会弹出**摄像头授权**提示(以 "GestureSeek" 名义),点 **「允许」**。
   - 只需授权一次,之后两个网站都自动生效。
   - 如果没弹或点了拒绝:点地址栏左侧的摄像头/锁图标,把摄像头改为"允许",然后刷新页面。
3. 把手伸到摄像头前,**捏合并左右移动**即可拖动进度。

## 使用手势

| 动作 | 效果 |
|------|------|
| 捏合(拇指尖贴食指尖) | 抓住进度条 |
| 捏住 + 手向右移 | 视频前进 |
| 捏住 + 手向左移 | 视频后退 |
| 松开手指 | 放下,停在当前位置 |
| 手移出画面 | 自动放下 |

灵敏度:**摄像头画面整个宽度 = 整条视频**。所以短视频更灵敏、长视频一扫就能跳很远。

---

## 工作原理(技术)

```
youtube/bilibili 页面
 └─ content.js(内容脚本,隔离世界)
     ├─ 定位主 <video>,注入一个扩展源 <iframe>(camera.html,1×1 近乎不可见)
     ├─ 运行捏合状态机(gesture-core.js)
     └─ 把目标时间写入 video.currentTime(节流 ≤20次/秒)
   camera.html / camera.js(iframe,扩展源)
     ├─ getUserMedia 开摄像头(扩展源可授权,且只问一次)
     ├─ MediaPipe HandLandmarker(本地 wasm + 模型,绕开网站 CSP)
     └─ 每帧把 {手x(已镜像), 捏合距离, 是否有手} 发回 content.js
```

- **为什么用 iframe 而不是 offscreen**:offscreen 文档是隐藏页,无法弹摄像头授权框;扩展源 iframe 既是可见文档(能授权)又受扩展 CSP(允许 wasm)管辖。
- **隐私**:MediaPipe 运行时和模型全部打包在本地(`lib/`、`models/`),没有任何联网请求,摄像头数据不出本机。

## 开发

```bash
node tests/gesture-core.test.js   # 跑状态机单元测试
node tools/gen-icons.js           # 重新生成图标
```

设计文档:`docs/superpowers/specs/2026-06-07-gesture-seek-design.md`

## 已知限制

- 只支持 youtube.com 和 bilibili.com。
- 需要 USB / 内置摄像头,且光线足够让 MediaPipe 识别到手。
- 直播(无固定 duration)无法拖动进度。

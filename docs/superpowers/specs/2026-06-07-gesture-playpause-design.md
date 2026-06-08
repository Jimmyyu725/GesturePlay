# GestureSeek — 握拳切换播放/暂停 + 修复握拳误判(v0.5)

> 日期:2026-06-07
> 状态:已 brainstorm 通过,待实现
> 关联:扩展自 `2026-06-07-gesture-seek-design.md`

---

## 1. 目标

1. **新功能**:**握拳 ✊ = 切换 播放/暂停**(toggle);张开手掌 = 中性(休息位,不触发)。
2. **修 bug**:当前握拳时拇指尖与食指尖靠近,被误判为捏合 → 误触发拖进度。修复后握拳不再误触发。

用户选择:
- 播放/暂停映射 = **握拳切换**(方案 A),避免"张开=播放"在休息位被误触发。
- 识别引擎 = **GestureRecognizer(方案②)** 现用;**HandLandmarker(方案①)** 保留,常量可切换。

## 2. 关键洞察:bug 与新功能同源

当前捏合判定只看"拇指尖↔食指尖距离 < 阈值"。握拳时这两指尖也靠近 → 误判捏合。要可靠识别握拳,必须能区分"捏合 vs 握拳",而这恰好修掉 bug。用 GestureRecognizer 的训练好标签 `Closed_Fist` 来判握拳,既准又顺手解决。

## 3. 手势引擎(双保留,常量切换)

`camera.js` 顶部常量 `ENGINE`:
- `"gesture"`(**默认 = 方案②**):`GestureRecognizer` + `models/gesture_recognizer.task`,`recognizeForVideo()`。返回**手势标签 + 21 关键点**。
- `"landmarker"`(**保留 = 方案①**):现有 `HandLandmarker` + `models/hand_landmarker.task`,`detectForVideo()`。只有捏合、无握拳(等于当前行为)。

两个模型都打包;切换只改这一个常量。GPU delegate(回退 CPU)两者都用。

### GestureRecognizer 返回结构(已核验)
- `result.landmarks[handIndex][pointIndex] = {x, y, z}`,x/y 归一化 [0,1]。
- `result.gestures[handIndex][0].categoryName`:8 种之一(`None`/`Closed_Fist`/`Open_Palm`/`Pointing_Up`/`Thumb_Up`/`Thumb_Down`/`Victory`/`ILoveYou`)——**无 "pinch"**。
- 取置信度最高的一只手(`numHands: 1`)。

## 4. 三件事各自的来源

| 手势 | 来源 | 动作 |
|------|------|------|
| 捏合拖进度 | **关键点**:拇指尖(4)↔食指尖(8)距离,镜像 x(同现状) | 拖 `currentTime` |
| 握拳切换 | **标签** `categoryName === "Closed_Fist"` | `video.play()/pause()` 切换 |
| 张开 / 其它 | 中性 | 无 |

## 5. 每帧消息(camera.js → content.js)

`{ type:"gs-frame", x, d, present, fist }`
- `x` = 镜像后手 x(0~1),`d` = 拇指-食指归一化距离,`present` = 是否有手。
- `fist` = `(ENGINE==="gesture") && categoryName==="Closed_Fist"`;`landmarker` 引擎下恒 `false`。

## 6. 判定逻辑(gesture-core.js,纯函数、可单测)

捏合状态机保持不变,**新增握拳处理**:

```
输入每帧:{x, d, present, fist}, video:{currentTime, duration, paused?}

// 捏合(拖进度):不变。但 fist 为 true 时不进入 DRAGGING(因为握拳≠捏合)
//   —— 实际上 GestureRecognizer 下握拳=Closed_Fist,与捏合互斥;
//      gesture-core 仍显式:进入 DRAGGING 需要 !fist,彻底挡掉误触发。

// 握拳切换(去抖 + 边沿 + 拖动中屏蔽):
fistStableFrames:若 fist 持续为 true 累加,否则清零
canToggle:一个布尔"闸门",握拳触发后置 false,必须经历一帧 !fist 才复位为 true

每帧:
  if state==DRAGGING: 不处理握拳(拖动中不切),且 fist 不应为真(互斥)
  else if fist:
     if 持续时间 ≥ HOLD(约0.35s,按帧数≈ HOLD_FRAMES) 且 canToggle:
        输出 togglePlay = true(仅这一帧)
        canToggle = false
  else (非握拳):
     canToggle = true(松开后才能再次触发)
     fistStableFrames = 0
```

输出新增字段:`togglePlay: boolean`(那一帧是否要切换播放/暂停)。捏合输出 `seekTo` 不变。

**互斥保证**:捏合进入条件加 `!fist`;握拳处理只在非 DRAGGING 时进行。两者不会同帧都触发。

## 7. content.js

- 收 `gs-frame` → `machine.update(...)`:
  - `res.seekTo != null` → 拖进度(同现状,自适应节流 + 松手精确落点)。
  - `res.togglePlay === true` → `v.paused ? v.play() : v.pause()`(忽略 play() 的 promise 拒绝)。同时 `nudgeControls(v)` 让原生 UI 可见。
- 不加任何自定义 UI;播放/暂停用网站原生动画。

## 8. 防误触参数(初值)

- `HOLD_FRAMES`:约 0.35s。检测节流为 30fps(setTimeout 33ms)→ 约 10 帧。用时间戳更稳:记录握拳开始时间,持续 ≥ 350ms 触发。
- 边沿:一次握拳只切一次;必须出现一帧非握拳才允许下次。
- 拖动中(DRAGGING)不响应握拳。

## 9. 边界与回归

| 情况 | 处理 |
|------|------|
| 捏合释放瞬间手型经过类拳形 | 去抖(350ms)+ 边沿 → 不误切 |
| 握拳一直保持 | 只切一次(边沿),不连续切 |
| `landmarker` 引擎(方案①) | `fist` 恒 false → 无握拳功能,捏合行为同现状 |
| 直播 / duration 无效 | 捏合不触发(同现状);握拳切换仍可用(play/pause 与 duration 无关) |
| 两只手 | `numHands:1`,取置信度最高 |

## 10. 测试(gesture-core.test.js 扩展)

- 握拳稳定保持 ≥ 阈值 → `togglePlay` 仅触发一次(边沿)。
- 握拳保持但未到阈值 → 不触发。
- 触发后继续保持 → 不再触发;松开(非握拳一帧)后再次握拳 → 再触发一次。
- DRAGGING 中 fist=true → 不 toggle、不影响拖动(且捏合进入要求 !fist)。
- 现有 26 项捏合测试保持全绿。

## 10b. v0.5.1:捏合需"三指竖起"才触发(降误触)

用户反馈:只看拇指-食指距离时误触率高(手放嘴边等也被当捏合)。改为**进入拖动需要刻意姿势**:拇指+食指捏合 **且 中/无名/小指都竖起**。

- camera.js 用关键点算三指伸展数 `ext`(0~3):某指**指尖离手腕距离 > 该指 PIP 离手腕距离** = 伸直(2D,旋转无关)。随帧发 `ext`。
- gesture-core 进入 DRAGGING 增加条件 `frame.ext >= requiredFingers`(默认 3)。**仅入口检查**:一旦拖动,手指轻微抖动不会中断(继续只看捏合距离)。
- 向后兼容:`frame.ext` 缺省时跳过该门槛(旧测试不受影响)。
- 测试:`ext>=3` 进入;`ext∈{0,1,2}` 不进入;入口后 `ext` 掉到 0 仍继续拖;缺省 ext 仍可进入。

## 10c. v0.5.2:起步死区(刚捏合不动,手移动够大才拖)

用户反馈:刚捏合时进度条会因微小晃动而抖动。增加**起步激活死区**:

- 进入 DRAGGING 后先 `dragActive=false`,不出 `seekTo`;当 `|xSmooth − anchorX| ≥ deadzone`(默认 0.05 归一化宽度)才 `dragActive=true` 开始拖。
- 激活时把 deadzone **折进锚点**(`anchorX += ±deadzone`):激活瞬间不跳变,且死区之外的位移完整保留(eff = raw − deadzone)。
- **仅起步检查**:激活后正常 1:1 跟随(死区不再生效),手回拉也不会因再次进死区而抖。
- 释放/reset 清 `dragActive`。`deadzone:0` 关闭(测试用)。

## 11. 不做(YAGNI)

- 不用 `Open_Palm` 做任何动作(握拳已能双向切换)。
- 不为播放/暂停加自定义 UI(用原生)。
- 不做其它手势(👍👎✌️ 等)。

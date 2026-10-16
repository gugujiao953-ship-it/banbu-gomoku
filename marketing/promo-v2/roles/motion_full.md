# 高级动效宣传片方案｜Playwright截图 + renderFrame(t)纯函数动画
> 约束前置
> - 画布：1920×1080，30fps，帧间隔 `dt=1/30≈0.0333s`
> - 所有动画**无CSS transition/animation**，全部在`renderFrame(t)`内计算内联style
> - 禁止`backdrop-filter`，`filter:blur`仅允许单字符小半径使用，禁止整容器大面积模糊
> - 全部数值为硬编码可直接写入JS，缓动为纯JS实现，不依赖CSS
> - 工具函数（全局纯函数，在renderFrame外部定义）
```js
function lerp(a,b,p){ return a + (b-a)*clamp(p,0,1); }
function clamp(v,min,max){ return Math.max(min, Math.min(max,v)); }
function easeOutCubic(p){ return 1 - Math.pow(1-p,3); }
function easeInOutCubic(p){ return p<0.5 ? 4*p**3 : 1-Math.pow(-2*p+2,3)/2; }
function easeOutQuart(p){ return 1 - Math.pow(1-p,4); }
function easeOutSine(p){ return Math.sin(p * Math.PI / 2); }
```

---

## 1. 手机壳3D呈现方案
手机素材尺寸：360w ×780h；父容器固定样式：`perspective:1200px; transform-style:preserve-3d`
> 所有旋转/位移在手机DOM的`transform`内联计算

### ① 入场动画（时长0.6s，对齐1拍，BPM=100）
- 时间区间：`tStart ~ tStart+0.6`
- progress = `clamp((t-tStart)/0.6,0,1)`
- 缓动：`easeOutQuart`
| 属性 | tStart（起始） | tStart+0.6（结束） |
|---|---|---|
| rotateY | -18deg | 0deg |
| rotateX | +6deg | 0deg |
| translate3d | -120px, 40px, -180px | 0px,0px,0px |
| scale | 0.88 | 1.0 |

### ② 手机间转场（A退场+B入场，时长0.6s）
- A（旧手机）：
`rotateY: lerp(0, +14deg, p)`，`rotateX: lerp(0,-4deg,p)`，`translate3d: lerp(0,90,-30,-120,p)`，`scale:lerp(1,0.92,p)`，`opacity:lerp(1,0,p)`
- B（新手机）：
`rotateY: lerp(-14,0,p)`，`rotateX: lerp(4,0,p)`，`translate3d: lerp(-90,30,-120,0,p)`，`scale:lerp(0.92,1,p)`，`opacity:lerp(0,1,p)`

### ③ 静止悬浮呼吸（常驻循环，无起止，纯三角函数）
周期`T=3.2s`，`phase = t * (Math.PI*2 /3.2)`
```js
rotateY = Math.sin(phase) * 2.2;
rotateX = Math.cos(phase) * 1.1;
translateZ = Math.sin(phase) * 12;
```
> 效果：极微小缓慢摇摆，高级静置感，不干扰主体展示

---

## 2. Ken Burns 静态截图运镜（手机内截图图层，叠加在3D手机壳内部）
> 原理：截图素材尺寸大于可视区域，每一帧计算`scale`+`translate`，无CSS动画；最大scale限制1.2避免模糊
progress = `clamp((t-tStart)/duration,0,1)`

| 运镜类型 | 时长 | scale变化 | XY平移 | 缓动 | 适用场景 |
|---|---|---|---|---|---|
| 慢推特写 | 3.2s | 1.05 →1.18 | X:0 → -65px；Y:0 →-35px | easeOutCubic | App界面细节放大 |
| 横向漫游 | 4.0s | 1.03 →1.09 | X:0 →-140px；Y固定+12px | easeOutSine | 多页面横向浏览 |
| 缓慢拉远 | 2.4s | 1.12 →1.04 | X:-40→0；Y:-20→0 | easeInOutCubic | 转场前收束画面 |

> 叠加规则：外层手机执行3D旋转，内部截图独立执行Ken Burns变换，变换矩阵嵌套。

---

## 3. 8种转场库（全部renderFrame实时计算内联样式，禁止CSS transition）
通用定义：转场局部时间`localT = t - transitionStart`，`progress = clamp(localT/dur,0,1)`

### 1. 线性擦除 Wipe｜dur=0.6s（1拍）
- JS要点：`clip-path: inset(0% ${(1-progress)*100}% 0% 0%)`
- 逻辑：新画面从左向右展开，右侧遮罩逐步消失；上下擦除替换为`inset(${(1-progress)*100}% 0% 0% 0%)`
- 适用：功能模块切换，干净利落，低性能开销

### 2. 圆缩转场 Circle Mask｜dur=0.5s
- JS要点：`const r = lerp(0, Math.hypot(1920,1080)*1.2, easeOutQuart(progress))`；`clip-path: circle(${r}px at center)`
- 逻辑：旧画面圆形遮罩收缩归零；新画面圆形遮罩从中心点向外扩张
- 适用：产品亮点重点登场，强视觉焦点

### 3. 滑入推镜 Slide Push｜dur=0.4s
- JS要点：
旧画面：`transform: translateX(lerp(0,1920,easeOutCubic(progress)))`
新画面：`transform: translateX(lerp(-1920,0,easeOutCubic(progress)))`
- 逻辑：新画面把旧画面横向推出画布
- 适用：App同级页面左右跳转叙事

### 4. 挤压转场 Squash｜dur=0.3s（半拍，强卡点）
- JS要点：transform origin `50% 50%`
旧画面：`scaleX:lerp(1,0.25,easeInOutCubic(progress))` opacity `1→0`
新画面：`scaleX:lerp(0.25,1,easeInOutCubic(progress))` opacity `0→1`
- 适用：音乐重鼓点强卡点，短快冲击力

### 5. 百叶窗 Blinds｜dur=0.55s
- JS要点：画面切8条横向切片，单条高度=1080/8=135px；切片索引`i=0~7`
`const offset = i * 0.07; const p = clamp(progress-offset,0,1)`
单条clip-path：`inset(${lerp(0,100*(1-p),easeOutSine(p))}% 0% 0% 0%)`
i越大，切片启动越晚，依次打开
- 适用：卡片列表、多模块页面切换，创意感

### 6. 溶解 Crossfade｜dur=0.38s
- JS要点：旧画面opacity `lerp(1,0,easeInOutCubic(p))`；新画面opacity `lerp(0,1,easeInOutCubic(p))`，无transform
- 适用：章节柔和过渡，不抢夺手机主体视觉，性能最优

### 7. 径向光转场 Radial Mask｜dur=0.5s
- JS要点：`mask-image: radial-gradient(circle ${r}px at 1344px 324px, #fff 0%, transparent 0%)`；`r=lerp(0,Math.hypot(1920,1080)*1.1,easeOutQuart(p))`；光源起点固定画布右上角70%×30%
- 适用：高光产品特写登场，模拟光线扫过；⚠️mask开销偏高，不要叠加其他滤镜

### 8. 像素网格 Pixel Grid｜dur=0.6s
- JS要点：画布划24列×14行网格单元；单元索引`xIdx,yIdx`
`dist = Math.sqrt((xIdx-12)**2 + (yIdx-7)**2)`；`localP = clamp(progress - dist*0.025,0,1)`
单元opacity：`lerp(0,1,easeOutSine(localP))`；离中心越远单元越晚亮起；旧画面反向熄灭
- 适用：开篇/收尾，科技数字化产品调性

---

## 4. 卡点剪辑：小节对齐策略（BPM=100，4/4拍）
基础节拍计算：
- 单拍时长 `beatDur = 60/100 = 0.6s`
- 1小节 = 4拍 = `2.4s`
```js
function getBeatInfo(t){
  const barDur = 2.4;
  const barIndex = Math.floor(t / barDur);
  const beatInBar = Math.floor((t % barDur)/0.6); //0,1,2,3
  return {barIndex, beatInBar};
}
```
### 段落触发规则
1. **强拍 beatInBar=0（小节第一拍）**：触发大动作。手机3D入场、章节大转场、主标题登场。动画startTime强制对齐小节线。
2. **弱拍 beatInBar=1/3**：次级动画。Ken Burns启动、字幕弹出、小元素入场。
3. **半拍 0.3s偏移**：快速短转场（挤压转场），适配鼓点副拍。

### 剪辑约束
- 所有动画duration只能取：`0.3 / 0.6 /1.2 /2.4 /3.0 /3.6`，均为半拍/整拍倍数；禁止任意时长
- 转场不可跨超过1个强拍；大段落切分边界**强制落在小节线**
- 时间轴预先生成`beatTimes[]`数组，`renderFrame(t)`读取当前拍号，判断是否触发动画startTime

---

## 5. 文字动效｜逐字位移+透明度+模糊收敛
> 实现：每个字符独立DOM节点；仅单字符blur，非整容器模糊，符合性能约束
### 主标题入场（dur=0.6s，1拍）
字符索引`i`，单字符延迟：`delay_i = i *0.04s`
`charT = t - tStart - delay_i`；`p = clamp(charT/0.6,0,1)`，缓动`easeOutQuart`
- opacity：`lerp(0,1,p)`
- translateY：`lerp(24,0,p)`
- filter blur：`lerp(2.2,0,p)`
- scaleX：`lerp(0.94,1,p)`

### 底部字幕入场（dur=0.4s）
字符延迟：`delay_i = i *0.025s`
- opacity：`lerp(0,1,p)`
- translateY：`lerp(12,0,p)`
- filter blur：`lerp(1.4,0,p)`
- scale：`lerp(0.97,1,p)`

### 退场反向
opacity `1→0`，translateY `0→-16`，blur `0→1.8px`

---

## 6. 背景氛围｜网格/粒子/光线（纯三角函数，无任何Math.random）
全部元素在renderFrame逐帧计算，无随机，参数基于全局时间`t`

### ① 动态网格背景
20根竖线，12根横线
竖线(idx 0~19):
```js
const x = lerp(100,1820, idx/19);
const oscY = Math.sin(t *1.8)*6;
const opacity = 0.18 + Math.sin(t*2.2 + idx*0.25)*0.08;
```
横线(idx 0~11):
```js
const y = lerp(100,980, idx/11);
const oscX = Math.cos(t*1.5 + idx*0.3)*5;
const opacity = 0.15 + Math.cos(t*1.9 + idx*0.15)*0.06;
```
线条宽1px，线性浅灰。

### ② 确定性粒子阵列（16列 ×9行，共144粒子）
粒子索引`i`：`ix = i%16; iy = Math.floor(i/16)`
```js
const baseX = 120 + ix*112;
const baseY = 80 + iy*112;
const offsetX = Math.sin(t*2.4 + ix*0.4 + iy*0.2)*14;
const offsetY = Math.cos(t*2.1 + ix*0.2 + iy*0.3)*10;
const opacity = 0.25 + Math.sin(t*3 + ix*0.1)*0.15;
const scale = 0.4 + Math.sin(t*1.7 + iy*0.25)*0.22;
```

### ③ 斜向扫描光线（2条光带）
光带A（28°）
```js
const xOffset = Math.sin(t*0.75)*420;
const opacity = 0.12 * (1 + Math.sin(t*1.2));
```
光带B（-28°）
```js
const xOffset = Math.cos(t*0.9)*380;
const opacity = 0.09 * (1 + Math.cos(t*1.1));
```
光带DOM：宽2200px，高1.5px，线性渐变半透白，transform旋转。

---

# 流水线收尾说明
1. HTML舞台：所有DOM元素样式由`renderFrame(t)`返回对象，`requestAnimationFrame`循环驱动，每一帧覆盖style
2. Playwright：无头浏览器打开页面，按时间戳 `t = frameIndex / 30` 截图输出PNG序列
3. FFmpeg：图片序列编码为成片，音频对齐BPM 100

如果你需要，我可以下一步输出：
- 完整可直接运行的HTML+JS最小Demo（包含renderFrame实现），或者
- 时间轴脚本JSON（可以直接导入剪辑软件，标记所有动画/转场/beat点）

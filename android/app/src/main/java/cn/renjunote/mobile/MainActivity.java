package cn.renjunote.mobile;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSObject;

import java.io.File;

public class MainActivity extends BridgeActivity {
    private static final String MIGRATION_PREFERENCES = "banbu_native_migrations";
    // Bump this whenever the bundled web UI changes in a way that could be
    // masked by a legacy WebView service-worker/cache entry. The preference
    // is app-local; changing it clears only cached web resources, not user
    // records or settings.
    // 迁移 key 必须随 package.json 的版本号 bump 同步改（1.2.3 → v123）：它决定这次
    // 升级要不要清一次 WebView 缓存。漏改不会报错，只是新前端被旧缓存盖住。
    // 由 src/android-web-cache-migration.test.ts 守住这条一致性。
    // v121：持续分析改造（worker 换手零延迟/迟到收尾行守卫/增量同步）——同版本
    // 覆盖安装时 WebView 的 HTTP 缓存会把旧 worker 盖住（用户实测「半点没变」），
    // bump 强制清一次缓存 + reload，确保新 worker 被加载。
    // v122：旗舰引擎持续分析修复（收尾行归属窗口、kata-analyze 不落子、静默看门狗、
    // 自愈保活、行棋方修正）——同样必须清缓存，否则用户装到的还是旧 worker。
    // v123：诊断版（打开 GTP 消息流文件日志，排查「引擎满载但面板全 -」）。
    // v124：诊断版第二轮（progress 载荷 + App 侧 aiAnalysis 状态对照）。
    // v125：诊断版第三轮（关键标记不受日志条数上限约束）。
    // v126：真因修复版（分析槽被裸 terminate 后仍被复用 → analyze 投进虚空）；
    //       仍保留诊断日志以便装机复验，正式版会关回 false。
    // v127：kata 展示修正版（速度=访问/秒、0 访问候选过滤、kata 专属面板：去掉
    //       深度/评估分、节点→访问；小数位≤2；汇报提速 0.2s），诊断日志关回 false。
    // v128：撤掉 v127 的胜率折算——装机实测空盘显示黑方胜率 3%，证明引擎输出本就
    //       是行棋方视角（SIDETOMOVE 名副其实），两个独立真机局面交叉验证后定案
    //       为原样透传。
    // v129：恒全量重摆（增量同步守不住引擎盘面一致性，真机实证被占点出现在候选
    //       里）+ 搜索命令不带行棋方参数（引擎用盘面行棋方，App 侧推错也不再
    //       分析错边）。
    // v1210：展示层防御——候选列表过滤已占点（棋盘标记本就跳过，列表此前没有）。
    // v1211：回退 NNAPI 启用（装机实测该机会话初始化挂起：引擎不就绪、候选全无），
    //        恢复纯 CPU 路径；引擎能力保留待换机验证。
    // v1212：引擎后端换成 Eigen（对手「五子棋分析」同款路线，同一份作者网权重）——
    //        ORT-CPU 在本类手机持续只有 ~20 访问/秒（热节流），Eigen 稳定 100+；
    //        同时启动 6s→<1s、内存 850MB→小、APK 去掉 17.6MB 的 libonnxruntime.so。
    //        （key 按「版本号去点」规则派生，两位数补丁号形如 v1212，由
    //        android-web-cache-migration.test.ts 守住一致性。）
    // v1182：修正 v1212 的致命错配——Eigen 后端读不了随包的 .onnx 模型（源码只认
    //        .bin/.bin.gz），引擎每次启动即崩、静默回落 Rapfi（真机日志 6 次实锤）。
    //        引擎换回 ORT-CPU，并打上上游两处硬编码的解锁补丁（搜索线程/批大小，
    //        真机实测每手搜索量 2.15×）。版本号同时回到 1.1.8.2（1.1.9 尚未发布，
    //        测试版沿 1.1.8.x 递增；只有发到 GitHub 的正式版才进 1.2.x）。
    // v1185：旗舰面板换成 KataGo 真正有的指标（和棋率/PV，去掉深度与评估分）；
    //        选点上限放开到 30/全部；引擎失败时选择器同步切回 rapfi；
    //        新增 iKataGo 云引擎（用户填自己的服务器地址自连，WebSocket）。
    // v1186：修云引擎「没有选点」——candidateVisible 漏了 ikatago 分支，云引擎落到
    //        Rapfi 判据（要求 depth≥N，而 KataGo 帧无 depth 字段）→ 只剩首选一个点；
    //        并把 12 处 `=== "kata"` 分流统一成 isKataFamily()，防同类漏网；
    //        和棋率改为「选点显示内容」里的可选项（不再常驻统计行）。
    // v1187：**胜率黑白颠倒定案**——真机用「黑四连+黑走=黑必赢」标定四种视角设置，
    //        证实 SIDETOMOVE 在本构建给的是「对手视角」（输出 0）而非行棋方视角，
    //        而前端按行棋方折算 → 方向整个反了。改为 cfg 设 BLACK（引擎恒输出黑方
    //        胜率）+ 前端对 KataGo 系不再折算；缓存条目补 engine 字段（视角随引擎
    //        不同，只按 mover 翻面会弄反）。附源码级守卫测试钉住配置与折算规则。
    //        另修：PanelSelect 菜单内部滑动会误关菜单（capture 捕获了自身滚动）。
    //        v1.1.8.8：胜率视角改回**行棋方视角**（引擎 cfg 与启动参数双重保证）——面板/候选点
    //        直接显示引擎原值、标签跟着行棋方走，曲线与复盘仍折到黑方视角；缓存与复盘键升版
    //        作废旧视角数据。另照搬「KataGomo 智子本地版」的双引擎适配：旗舰引擎新增「档位」
    //        （自带 / 智子·普通 Eigen 小网 / 智子·增强 ORT b24c256），切换即重启生效。
    // v1189：修「切到智子档其实没换引擎」——智子档的引擎二进制曾当 assets 铺到应用私有
    //        目录再 chmod +x，而 Android 10+ 禁止执行可写目录里的文件（W^X），真机必然
    //        `error=13 Permission denied`、分析回落 rapfi。现改走 jniLibs
    //        （libkatago_zz.so）→ nativeLibraryDir；档位名同时改成如实标注
    //        （自带小网 b10c128 / 智子大网 b24c256）。
    // v11810：按用户要求移除「智子迷你网」档（6b64，棋力最弱、等时对抗 0:5）——
    //        该档的引擎/模型不再入包，设备上残留的 engine.choice="gl" 自动归到默认档。
    // v11812：修 1.1.8.11 引入的回归——增量同步会让 kataSetupAcks 窗口计数错位、
    //         引擎的 info 帧被当成旧收尾行全部吞掉（真机实证 82 帧 info / 0 条 progress，
    //         面板只剩「思考中」）。回退为恒全量重摆（实测增量无收益），并修正过期帧
    //         守卫改读 ref（闭包里的旧 key 会把健康帧全判成过期）。
    // v11813：选点候选源加局面守卫（落子换面瞬间旧选点/旧列表整批消失，用户 10-01
    //         报「落子后旧的会残余」）；档位名改「b10c128 小网，快 / b24c256 大网，慢」。
    // v11814-17：worker 丢弃换手时旧搜索的管道残行（选点残留真因）；诊断日志 400 行
    //         预算改滚动窗口（解除取证失明）；档位名精简；缓存档扩到 1.6G；云端改 ikatago。
    // v11818：大网模型 int8 化（zhizi-b24-fp16 → int8 静态量化，K20 实测 1.95×，
    //         等预算对局持平；PAYLOAD_VERSION 8→9 回收旧模型 44MB）。
    // v11819：Rapfi 引擎 0.43.01→0.43.02（官方 master 重编 arm64 + 新格式经典模型；
    //         限时搜索同窗口多算 14%~48% 节点，等时自对弈 3:3 持平；Renju wincheck 修复）。
    // v11820：native rapfi 两处对齐 kata——① 轮次守卫（旧搜索收尾残行排在 START 的
    //         OK 之前，此前会被算进新轮 → 用户报的「前面的胜率/选点残留」）；
    //         ② 换手立即打断（先发 YXSTOP，新局面的分析不再等旧轮 2 秒预算跑完）。
    // v119：1.1.9（minor 版本，版本号改成三段）。这一轮是用户能直接看见的一整批：
    //         棋钟规则修正、设置压成一屏、20 套主题逐屏对比度与字号大修、对弈界面不再
    //         跳动、公用效果实时预览、新增战绩与等级分；引擎侧大网换 int8 权重（21.9MB）、
    //         Rapfi 原生版 0.43.02。覆盖安装同样必须清一次 WebView 缓存，否则旧 worker
    //         把新前端盖住（1.1.8 那次漏改这个标记就出过「装了却没变」）。
    // v1191：1.1.9.1。修的是「从别的软件点开却什么都没发生」「大数据库在手机上打不开」这一批，
    //         另加设置→关于→兼容性自检。标记必须跟着换：不换的话装完还是旧前端。
    // v1192：1.1.9.2。接着修「从别处点开还是要等下次启动才处理」（热启动那发事件会丢）
    //         与「选了 rapfi，对局里下一手却变成旗舰在想」（本局引擎档没跟着设置走）。
    // v1193：1.1.9.3。人机对局「重开」不再把难度跳回初级（恢复快照时同步对局设置面板），
    //         并把「最近导入」换成默认开启（键名也换了，见 enhancement-settings 的注释）。
    // v1194：1.1.9.4。「界面动效」关掉之后皮肤自带动画仍在跑（真机实测静止也每帧重绘），
    //         现在由 library.css 里的 html[data-motion=off] 一并压住。
    // v1195：1.1.9.5。识谱建出来的静态局面也画禁手点；棋子不再自带循环动效；
    //         敦煌那类逐条线的位移滤镜合并成整层一次（落子更跟手）。
    // v1196：1.1.9.6。落子不再「弹一下」（内置 stone-enter 与极光棋子的常驻渐变动画都删了）。
    // v1197：1.1.9.7。「对弈」新增 VCF 挑战；挑战棋盘改为与主盘同一套几何（曾出现「子不在格子里、
    //         手数错位」）；外观新增「琥珀木盘 / 经典黑白」；在线去掉自建题库通道。
    // v1198：1.1.9.8。VCF 挑战一批修复：解答颜色、摆棋退出不再重开、1–2 手入门题入库、
    //         等级分封顶 2600（最高等级 5）、设置面板改「确定才生效」、切档/下一题不再顿一下。
    // v1199：1.1.9.9。引擎设置面板补满最后一行（KataGo 那格不再缺一块）；VCF 补题改走棋题生成器
    //         同一台引擎（不再是一道题的形变）；生成器出的题在「做题」里正常打开，不再跳回生成器。
    // v11910：1.1.9.10。深题真的深下去了：生成器按等级分出 14–40 手题（封顶 5300 / 最高 12 级）；
    //         引擎设置改成一行两个；高等级不再走「开宝现场验题」（那一步白等十来秒）。
    // v11911：1.1.9.11。题分改「1 手 1000、每多一手 +200」（13 手 3400 / 20 手 4800 / 40 手 8800，
    //         封顶 9100 / 最高 23 级）；一二手题各减半到 500 道（题池 8025）。
    // v11912：1.1.9.12。对弈页去掉标题下的说明文字；VCF 摆棋改复盘式（只在空点按手序落子、
    //         颜色自动交替、撤销把颜色一起退回来，点已有子不再消子）。
    // v11913：1.1.9.13。对弈子页面（VCF 挑战 / 人机对战）切版面再回来保持原页且局面/计时不重建；
    //         返回先回对弈首页；VCF 一局未结算时退出先弹应用内确认；切后台暂停计时、不判负。
    // v11915：1.1.9.15。引擎切换修复（切走不再留幽灵引擎进程、就绪确认超时 3 分钟收紧到 1 分钟）；
    //         VCF 挑战解答修复（坏题不进对局、答案不再是满铺同色）+ 胜负结算弹窗。
    // v11916：1.1.9.16。切换提速：切走旗舰 60 秒内切回直接复用活进程（秒回）；改线程/缓存/档位
    //         改为后台防抖重启 + 立即预热，不再等下一次分析才冷启。
    // v11917：1.1.9.17。向下兼容到 Chrome 79（群友 Android 10 老 WebView）：引擎 worker 去掉
    //         ES2020 语法、worker 产物改 classic、主包 target 降到 chrome79；导入去重（同一
    //         文件被 getData+EXTRA_STREAM 交两次不再出现「第 2/2 份」）；数据库混在批量里正确打开。
    // v11918：1.1.9.18。旗舰设置（线程/缓存/档位）改回「改一个立刻生效」：不做防抖攒批，
    //         每次改动当场停旧进程并按新设置拉起。
    // v11919：1.1.9.19。识谱提速：导入跳过无用读号、复原复用网格检测、修模型会话重复装载。
    //         ⚠ 这一版必须 bump：用户实测「装了新版但速度没变」——迁移 key 停在 v11918 时
    //         手机上这个布尔值早就是 true，覆盖安装不会清 Service Worker/CacheStorage，
    //         WebView 继续用**上一个版本的前端 JS**（旧代码照旧慢）。迁移 key 与版本号
    //         同步 bump 是本项目既有规矩（见上面各条的说明）。
    // v11920：1.1.9.19 第二发。修「手机 WebView 不支持跨源隔离 → 模型分片走 worker
    //         慢 4 倍且冲爆 20s 超时 → 降级重算」这条真机根因（CV/模型降级分离、
    //         装载按需等待、非隔离环境模型任务走主线程）。**key 必须再 bump 一次**：
    //         上一条已经在用户手机上置为 true，同值覆盖安装不会清缓存、新前端不会生效。
    // v11921：1.1.9.21。**跨源隔离适配**（用户问「为啥电脑识谱快，你不能适配吗」）：
    //         同一份识谱代码网页版 1～2 秒、APK 十几倍慢，差别只在「跨源隔离」的有无
    //         ——隔离后 ORT 的 wasm 才能多线程（实测非隔离下 numThreads 1→8 毫无差别，
    //         因为 SharedArrayBuffer 不存在、根本起不了线程池）。
    //         这一版两条注入同时上：① 本类旁边的 IsolatedWebViewClient 在 Java 层给
    //         本地资源响应补 COOP/COEP；② 网页层去掉「安卓不注册 SW」的限制，让
    //         sw.js 也能接管（与网页版同一套）。两者都拿不到隔离时行为与之前完全一致。
    //         key 必须 bump：手机上 v11920 已置 true，同值不会清缓存、新前端不生效。
    // v11926：老 WebView（K20/83）主题适配修复 —— `:is()` 展开、`dvh`→`vh` 兜底、
    //         黄昏骑行层尺寸兜底、顶/底栏底色可调。同样必须 bump：1.1.9.25 已装机，
    //         不 bump 的话用户看到的还是旧前端（这条是实测踩过的坑）。
    // v11927：真机调试收尾版 —— 底栏底色跟着透明度调节（老内核走 JS 算好的 rgba）、
    //         「下一手」等 accent 按钮不再被透明度规则吃掉强调底色、棋盘落子等其余修复。
    // v11928：棋魂一套定稿（主题/棋盘/棋子 + 每日一题专门界面、本机凭证、道具购买等
    //         10-10 之后的全部改动）。必须 bump —— 1.1.9.27 已装机，不 bump 的话
    //         WebView 还吃着旧前端的缓存，用户看到的不是这一版。
    // v11935：分析期棋盘闪动的修复（引擎每出一帧就重画棋盘 → 读数与候选点分档合流）。
    //         必须 bump：1.1.9.34 已装机，不 bump 的话 WebView 还吃着旧前端缓存，
    //         用户装了这个包看到的仍然会闪。
    private static final String SERVICE_WORKER_MIGRATION = "service_worker_cache_cleared_v120";


    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Must run before super.onCreate so the bridge picks the plugin up.
        registerPlugin(ExportDirectoryPlugin.class);
        registerPlugin(PhotoPickerPlugin.class);
        registerPlugin(NativeEnginePlugin.class);
        // KataGo 旗舰引擎（可选项，2026-09-25 实装）：独立插件，与 Rapfi 互不干扰。
        registerPlugin(NativeKataGoPlugin.class);
        registerPlugin(ApkInstallPlugin.class);
        registerPlugin(PipPlugin.class);
        registerPlugin(IncomingFilePlugin.class);
        // 触觉反馈（用户 09-28 真机反馈「没生效」）：navigator.vibrate 在 Capacitor WebView
        // 里是空操作（BridgeWebChromeClient 没实现 onVibrate），震动必须走原生 Vibrator。
        registerPlugin(HapticsPlugin.class);
        // 系统栏图标深浅 + 全屏模式（见 SystemBarsPlugin）。
        registerPlugin(SystemBarsPlugin.class);
        // 冷启动接收外部文件（用户从微信/文件管理器点棋谱、或分享过来时应用没开）：
        // 此刻 bridge 还没就绪，发 JS 事件会丢，所以这里只把文件暂存下来，
        // 等网页层启动后自己调 IncomingFile.takeFiles() 取走。
        IncomingFilePlugin.stageFromIntent(this, getIntent());
        boolean shouldRefreshBundledWebUi = shouldRefreshBundledWebUi();
        if (shouldRefreshBundledWebUi) {
            clearLegacyServiceWorkerStorage();
        }
        super.onCreate(savedInstanceState);
        // 默认**不接管**窗口：安卓系统自己给状态栏/导航栏留位，网页层从那两条下面开始画
        // （用户 2026-10-14：「就之前那样挺好的」）。要顶到最上方请用设置里的「全屏模式」，
        // 那条走 SystemBarsPlugin.setStyle({enabled:true})，由原生把真实内缩写成 CSS 变量。
        /* 大模型调试通道（用户 2026-10-09 提议「搞一个专门适配大模型调试的模式功能」）：
           打开 WebView 远程调试，于是外部可以用 Chrome DevTools 协议（CDP）直接读写页面状态、
           执行 JS（例如 `__bb.click('外观与音效')`）、点按钮、读控制台 —— 不用再靠 adb tap
           猜坐标（K20 实测点三四次都不中，纯人肉试错）。

           ⚠ 触发条件走**构建期常量** `BuildConfig.DEBUG` 之外的判断：本工程没开
             `buildFeatures.buildConfig`，那个类不存在（编译报"找不到符号"）。
           改用包名后缀——但 K20（MIUI）**拒绝安装 debug 签名的包**
             （`INSTALL_FAILED_USER_RESTRICTED`，adb / pm install / 流式安装三种都试过），
             所以真机调试只能走 release 签名。
           因此这里加一个**显式的调试开关**：`android/gradle.properties` 里的
             `banbu.debugWebview=true` 时，即使 release 包也开调试端口 + 挂网页调试桥。
             ⚠ 正式发版**必须确认它是 false**（否则发布包带着调试端口）；
               把这条当成"发布前检查项"，与 VERSION 一起看。 */
        boolean debugWebview = getPackageName().endsWith(".debug") || isDebugWebviewBuild();
        if (debugWebview && bridge != null && bridge.getWebView() != null) {
            android.webkit.WebView.setWebContentsDebuggingEnabled(true);
        }
        /* 告诉网页层"我在调试模式"：网页侧的调试桥（src/debug-bridge.ts）靠它决定要不要挂
           `window.__bb`。为什么不能网页侧自己判断：debug 与 release 用**同一份 dist**，
           打包时 `import.meta.env.DEV` 已是 false，网页分不清自己跑在哪个包里 —— 只能由原生告知。
           ⚠ 用**全局变量**而不是 localStorage（这里改过一版，原因是实测踩坑）：
             localStorage 持久化在设备上，装过一次带调试的包后，再装干净包它仍在
             ⇒ 干净包也会挂调试桥（正式包里冒出 DIAG 条）。全局变量随页面进程存在、重启即失效，
             正是"临时调试能力"该有的生命周期。 */
        injectDebugBuildFlag();
        if (shouldRefreshBundledWebUi && bridge != null && bridge.getWebView() != null) {
            // Capacitor's index.html can also be held by the ordinary WebView
            // HTTP cache. Clearing only Service Worker/CacheStorage is not
            // enough when several APKs reuse the same version name.
            bridge.getWebView().clearCache(true);
            bridge.getWebView().post(() -> {
                if (bridge == null || bridge.getWebView() == null) {
                    return;
                }
                bridge.getWebView().reload();
                getSharedPreferences(MIGRATION_PREFERENCES, MODE_PRIVATE)
                        .edit()
                        .putBoolean(SERVICE_WORKER_MIGRATION, true)
                        .apply();
            });
        }
        // 跨源隔离适配（2026-10-09，用户问「为啥电脑识谱快，你不能适配吗」）：
        // 网页版靠服务器下发的 COOP/COEP 拿到 crossOriginIsolated → ORT 的 wasm 走
        // 多线程；APK 里 WebView 从本地资产加载、没人下发这两个头 → 只能单线程，
        // 同一份识谱代码因此慢十几倍（降频 6× 实测：225 格 cell-cls 要 37 秒）。
        // 这里给本地资源响应补上这两个头，让 APK 也进入隔离状态。
        // 换 WebViewClient 必须等 bridge 就绪之后（client 由 bridge 提供）。
        if (bridge != null) {
            bridge.setWebViewClient(new IsolatedWebViewClient(bridge));
        }
    }

    /**
     * 热启动接收外部文件：MainActivity 是 singleTask（见 AndroidManifest），
     * 应用已在后台时再收到 VIEW/SEND，系统不会新建实例而是走这里。
     * 这时 bridge 已经活着，所以暂存之外再发一个事件，网页层不必等下次启动。
     */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        IncomingFilePlugin.stageFromIntent(this, intent);
        notifyIncomingFiles();
    }

    /**
     * 回到前台再补一次通知。只发一次事件是会丢的：WebView 在 onStop 时被 pause()，
     * 那一刻的 evaluateJavascript 可能整个落空；冷启动的 onResume 更是早于页面加载。
     * 用户 2026-10-03 报的「从别处用本应用打开文件，界面开了但什么都不做，
     * 下次启动才处理」就是这一类——所以通知按「暂存区还剩几份」来发，
     * 网页层取走即删，发多次也只会被处理一次。
     */
    @Override
    public void onResume() {
        super.onResume();
        notifyIncomingFiles();
        /* 补一次调试标记注入：冷启动的 onCreate 早于页面 JS 执行，那一刻注入会落空
           （与 notifyIncomingFiles 同一个道理，见上面那段注释）。 */
        injectDebugBuildFlag();
    }

    /** 暂存区里还有没被取走的文件就提醒网页层来取（没有就什么都不发）。 */
    private void notifyIncomingFiles() {
        if (bridge == null) {
            return;
        }
        int pending = IncomingFilePlugin.countStaged(this);
        if (pending <= 0) {
            return;
        }
        JSObject payload = new JSObject();
        payload.put("count", pending);
        bridge.triggerJSEvent("incomingFiles", "window", payload.toString());
    }

    @Override
    public void onBackPressed() {
        if (bridge != null && bridge.getWebView() != null && bridge.getWebView().canGoBack()) {
            bridge.getWebView().goBack();
            return;
        }
        super.onBackPressed();
    }

    /**
     * 画中画态变化时通知前端（用户 09-17 第二批⑥）。
     * 前端要按这个状态决定：小窗里继续跑引擎分析（不进"后台取消"分支）、
     * 退出小窗后恢复。WebView 在 PiP 下只是 onPause（可见但失焦），
     * 所以不能用 onPause/onResume 代替。
     */
    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, android.content.res.Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        if (bridge == null) {
            return;
        }
        JSObject payload = new JSObject();
        payload.put("active", isInPictureInPictureMode);
        bridge.triggerJSEvent("pictureInPicture", "window", payload.toString());
    }

    /** 把"本包是否带调试能力"注入网页（`window.__bbDebugBuild`）。因为网页分不清自己跑在
     *  debug 还是 release 包里（同一份 dist），只能由原生告知。
     *  onCreate 与 onResume 各调一次：冷启动时 onCreate 可能早于页面 JS 执行、那一刻注入会落空。
     *  ⚠ 非调试构建时**顺手清掉** `localStorage['banbu-debug-bridge']`：那是上一版调试包留下的
     *    持久化痕迹，网页侧也会读它 —— 不清的话，装过调试包的设备再装干净包仍会挂调试桥
     *    （2026-10-09 实测：正式包里冒出 DIAG 条）。 */
    private void injectDebugBuildFlag() {
        if (bridge == null || bridge.getWebView() == null) {
            return;
        }
        final boolean debug = getPackageName().endsWith(".debug") || isDebugWebviewBuild();
        final String script = debug
                ? "window.__bbDebugBuild=true;"
                : "window.__bbDebugBuild=false;try{localStorage.removeItem('banbu-debug-bridge')}catch(e){}";
        bridge.getWebView().post(() -> {
            if (bridge == null || bridge.getWebView() == null) return;
            bridge.getWebView().evaluateJavascript(script, null);
        });
    }

    /** 这个包是否要开"大模型调试"（WebView 调试端口 + 网页调试桥）。
     *  取值来自 build.gradle 的 `resValue("string","banbu_debug_webview", …)`：
     *  debug 包恒 true；release 包看 gradle 属性 `banbu.debugWebview`（默认 false）。
     *  ⚠ 为什么不用 BuildConfig：本工程没开 buildFeatures.buildConfig，那个类不存在。
     *  ⚠ 正式发版必须确认它是 false —— 发布包不该带调试端口。 */
    private boolean isDebugWebviewBuild() {
        try {
            int id = getResources().getIdentifier("banbu_debug_webview", "string", getPackageName());
            return id != 0 && "true".equalsIgnoreCase(getString(id));
        } catch (Exception ignored) {
            return false;
        }
    }

    private boolean shouldRefreshBundledWebUi() {
        return !getSharedPreferences(MIGRATION_PREFERENCES, MODE_PRIVATE)
                .getBoolean(SERVICE_WORKER_MIGRATION, false);
    }

    private void clearLegacyServiceWorkerStorage() {
        File webViewRoot = new File(getDataDir(), "app_webview");
        deleteRecursively(new File(webViewRoot, "Default/Service Worker"));
        deleteRecursively(new File(webViewRoot, "Service Worker"));
        deleteRecursively(new File(webViewRoot, "Default/CacheStorage"));
        deleteRecursively(new File(webViewRoot, "CacheStorage"));
    }

    private boolean deleteRecursively(File target) {
        if (!target.exists()) {
            return true;
        }
        File[] children = target.listFiles();
        if (children != null) {
            for (File child : children) {
                if (!deleteRecursively(child)) {
                    return false;
                }
            }
        }
        return target.delete();
    }
}

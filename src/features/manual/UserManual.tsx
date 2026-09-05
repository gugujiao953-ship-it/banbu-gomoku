import { useEffect, useState } from "react";
import {
  ArchiveRestore, BookOpen, Bot, Check, ChevronDown, CircleHelp, Download, Eye, FilePlus2,
  FolderOpen, GitBranch, Home, Info, Library, ListTree, MessageSquareText, Palette, Save,
  Settings, Tag, Undo2, Upload, X,
} from "lucide-react";

type ManualIconName = "home" | "new" | "save" | "import" | "export" | "library" | "folder" | "comment" | "mark" | "branch" | "tree" | "ai" | "undo" | "backup" | "settings" | "review" | "palette" | "help" | "info";

interface ManualSection {
  icon: ManualIconName;
  title: string;
  summary: string;
  features: Array<{ title: string; text: string; image?: string }>;
  steps: string[];
  tip: string;
  ruleEntry?: boolean;
}

const manualSections: ManualSection[] = [
  {
    icon: "home", title: "第一次打开：先认识主界面", summary: "不用一次学完，先看懂顶部、棋盘和底部工具。",
    features: [
      { title: "顶部状态区", text: "这里会告诉你当前打开的是哪份棋谱或棋题、走到第几手、轮到哪一方，以及内容是否已经保存。" },
      { title: "中间棋盘", text: "落子、查看手数、标注和研究变化都在这里完成；手机上会尽量把棋盘和常用按钮同时放进首屏。", image: "/manual/s1f2.jpg" },
      { title: "工作模式", text: "打谱用于编辑，读谱用于安心浏览，做题用于练习。三种模式共用同一块棋盘，但权限和按钮会按用途变化。", image: "/manual/s1f1.jpg" },
      { title: "底部工具", text: "新建、导入、棋谱库、AI、设置等常用入口都在页面下方，不需要记住复杂菜单。", image: "/manual/s1f4.jpg" },
      { title: "快捷中心", text: "点顶部应用图标可以打开快捷中心，随手调整思考方式、自动演示和主题外观，不用进设置页翻找。", image: "/manual/s1f5.jpg" },
    ],
    steps: ["先看顶部名称，确认当前是不是你想操作的棋谱。", "在棋盘上试着落一手，再用上一手返回。", "打开底部工具看一遍入口，不必马上设置所有选项。"],
    tip: "看到不确定的按钮可以先点开看看；涉及删除、放弃草稿或覆盖资料时，应用会再次确认。",
  },
  {
    icon: "home", title: "最近项目与恢复上次局面", summary: "下次回来，可以接着上一次的位置继续。",
    features: [
      { title: "恢复上次局面", text: "开启后，重新进入应用会恢复上次的棋谱、当前节点和工作模式，不必重新寻找位置。" },
      { title: "最近棋谱与棋题", text: "点击顶部棋谱名称，可以快速切换最近打开的棋谱或最近练习的题目。", image: "/manual/s2f2.jpg" },
      { title: "最近导入", text: "这是独立的可选功能。开启后会记录最近 5 个导入来源，小文件通常可以直接再次打开。" },
      { title: "不想自动恢复", text: "关闭恢复开关后，下次启动会从新的空白棋局开始，但棋谱库里的内容不会被删除。" },
    ],
    steps: ["进入设置，找到“文件与存储”。", "开启或关闭“退出后恢复上次局面”。", "回到主界面，点击顶部名称查看最近项目。"],
    tip: "大型文件受系统文件权限影响，有时仍需要重新选择原文件，这是正常的安全限制。",
  },
  {
    icon: "new", title: "新建、保存与草稿保护", summary: "放心编辑，先形成草稿，确认后再正式保存。",
    features: [
      { title: "新建棋谱", text: "会开始一盘新的空白棋局，不会删除棋谱库里已经保存的旧棋谱。" },
      { title: "自动草稿", text: "落子、删除分支、修改注释、添加标注或更改棋谱信息后，应用会先保留为草稿。", image: "/manual/s3f2.jpg" },
      { title: "正式保存", text: "点击保存后，草稿才会写入本机棋谱库。顶部显示“已保存”时，这次修改才算完成。" },
      { title: "放弃修改", text: "如果这次编辑不想要了，可以放弃草稿，回到最近一次保存的状态。" },
      { title: "大型资料保护", text: "LIB、DP、DB 等大型资料按只读或编辑副本方式处理，不会擅自改写你的原始数据库。" },
    ],
    steps: ["点击底部“新建”，开始一份空白棋谱。", "落子、写注释或建立变化。", "点击保存，并等顶部状态变成“已保存”后再切换。"],
    tip: "切谱、新建或导入前如果还有草稿，应用会提醒你先保存、放弃或取消操作。",
  },
  {
    icon: "review", title: "打谱、读谱与做题有什么区别", summary: "先选对模式，后面的操作会简单很多。",
    features: [
      { title: "打谱", text: "可以落子、建立新分支、修改注释和棋谱信息，也可以编辑原谱标注。打谱的“走棋”区域没有播放按钮，这是为了保持编辑操作清楚。" },
      { title: "读谱", text: "只能沿原谱已有变化浏览，不会因为误点空位而改坏棋谱；自动播放按钮只在读谱中提供。", image: "/manual/s4f2.jpg" },
      { title: "读谱本机标注", text: "读谱时仍可圈点、画形状或写标签。这些标注只保存在本机，并按棋谱和当前局面分别保存，不修改原谱。" },
      { title: "做题", text: "会载入题目初始局面并判断正确、失败和完成；提示会短暂出现，不会一直遮挡棋盘。", image: "/manual/s4f4.jpg" },
    ],
    steps: ["在顶部状态区选择打谱、读谱或做题。", "只想看谱时选择读谱，再使用前后导航或播放。", "需要增加变化或修改内容时，再切回打谱。"],
    tip: "读谱走到末尾后，点击空位只会提示已经到达末尾，不会生成草稿。",
  },
  {
    icon: "tree", title: "棋谱树、分支与书签", summary: "把复杂变化摊开看，也能在手机上直接拖动画布。",
    features: [
      { title: "查看变化树", text: "每个方块代表一个局面，连线表示走棋关系。当前路径、当前局面和黑白落子会用不同样式区分。", image: "/manual/s5f1.jpg" },
      { title: "移动与缩放", text: "手机上用单指拖动画布寻找分支，用双指缩放；也可以直接选 30%、50%、100%、2×、5×、10× 等快捷比例。即使从节点上开始拖也能移动，轻点节点仍然是选中。" },
      { title: "分支操作", text: "选中节点后，可以定位、新建、展开、重命名或删除分支。长按节点还可以打开快捷操作。" },
      { title: "读谱模式重命名", text: "读谱模式下重命名分支只会保存为本机名称，不会修改原谱，适合给大型棋谱里的分支加自己的标签。" },
      { title: "复制与粘贴", text: "复制分支会带上该节点下面的全部后代，粘贴时会创建独立副本，不覆盖原分支。" },
      { title: "书签", text: "重要局面可以添加标题、备注和玉青、金、蓝、玫红四种颜色标识，之后在书签页按标题或备注搜索并快速跳回。" },
    ],
    steps: ["打开棋谱树，单指拖动查看不同区域。", "轻点一个节点，再从下方选择定位或其他操作。", "遇到值得复习的局面，添加书签并写一句容易记住的说明。"],
    tip: "如果目标位置已有相同着法，或粘贴会形成非法局面，应用会拒绝操作，不会只粘贴一半。",
  },
  {
    icon: "undo", title: "前后导航、读谱播放与撤销", summary: "浏览不会删谱，撤销和放弃才会处理编辑内容。",
    features: [
      { title: "前后导航", text: "起点、上一手、下一手和终点只会改变正在看的节点，不会删除棋子或修改棋谱。" },
      { title: "读谱播放", text: "读谱模式可以自动播放，并设置速度、遇到分支时暂停或沿主线继续。打谱模式不提供播放按钮。" },
      { title: "撤销", text: "只回退最近一次草稿操作，适合修正刚刚的误落、误删或文字修改。" },
      { title: "放弃", text: "会清除当前全部未保存修改，并回到最近一次正式保存的状态。" },
    ],
    steps: ["先用上一手、下一手熟悉当前变化。", "需要连续观看时切到读谱，再开始播放。", "编辑出错时先用撤销；整批修改都不要时再选择放弃。"],
    tip: "在旧节点上重新落子通常会建立一条新变化，不会悄悄覆盖原来的主线。",
  },
  {
    icon: "comment", title: "注释、棋谱信息与棋盘标注", summary: "把想法写在正确的位置，之后回来仍能看懂。",
    features: [
      { title: "节点注释", text: "默认打开，适合记录这一手的思路、变化判断或教学说明。只读长文本可以在框内滚动，双击可放大约三倍。", image: "/manual/s7f1.jpg" },
      { title: "棋谱信息", text: "可以填写名称、棋手、赛事或主题、日期、结果、规则和开局规则，方便以后搜索和导出。", image: "/manual/s7f2.jpg" },
      { title: "棋盘标注", text: "支持数字、字母、胜/败/平/平衡/攻/守/要/疑等结论记号、常用记号、自定义文字，以及圆圈、三角、叉号、五角星、太阳、月亮等形状，可选十二种颜色。", image: "/manual/s7f3.jpg" },
      { title: "标注高亮", text: "可以给标注加白色、金色或蓝色轮廓高亮，深色棋盘上看不清时换一档。" },
      { title: "标注中的“取消”", text: "选择标注后，状态栏会在同一位置显示“取消”。点击只退出当前标注工具，不会清掉已经画好的标注。" },
      { title: "读谱保护", text: "读谱不能修改原谱的注释、元数据、书签或分支，只能使用本机独立标注。" },
    ],
    steps: ["切到需要说明的局面。", "在注释框写下思路，或打开标注后点选棋盘位置。", "打谱中的修改记得保存；读谱本机标注会独立保留。"],
    tip: "标注不是落子，不改变轮次，也不会参与胜负判断。",
  },
  {
    icon: "import", title: "导入文件与图片识谱", summary: "从常见棋谱文件或一张棋盘图片开始。",
    features: [
      { title: "常见棋谱格式", text: "支持 SGF、FGF、REN、RENJS、WZQ、JSON、POS、PSQ、LIB、DP、DB 和兼容坐标文本等格式。", image: "/manual/s8f1.jpg" },
      { title: "大型文件", text: "导入时会依次显示读取、解析、建立索引或保存等状态，请让页面保持打开，完成后再开始浏览。" },
      { title: "图片识谱", text: "从棋盘图片中定位网格并识别黑白棋子，适合从截图或照片恢复局面；以常见十五路为主，也会尝试十三、十九、十七、九路等尺寸。", image: "/manual/s8f3.jpg" },
      { title: "识别后先检查", text: "图片结果会先进入可核对的会话，不会直接写进棋谱库；有完整手数时才会尝试恢复落子顺序。" },
      { title: "最近导入", text: "开启后可保留最近 5 个来源，方便再次打开常用的小型棋谱。" },
    ],
    steps: ["点击底部“导入”，选择棋谱文件或图片识谱。", "等待处理完成，不要在中途连续重复点击。", "重点核对棋盘路数、黑白棋子、最后一手、分支和注释，再决定是否保存。"],
    tip: "图片越端正、边界越完整、反光越少，识别越可靠；棋盘边缘和最后一手最值得仔细检查。",
  },
  {
    icon: "export", title: "导出棋谱、原文件与分享图片", summary: "先看清导出范围，再选择适合的方式。",
    features: [
      { title: "完整棋谱", text: "普通棋谱可以重新生成完整 SGF，也可以导出包含应用字段的 JSON，还能把主线导出为简洁的 POS 坐标文本。", image: "/manual/s9f1.jpg" },
      { title: "原文件直出", text: "未编辑且满足条件的 LIB、DP、DB 可以直接导出原文件，最大程度保留原始内容。" },
      { title: "当前可见内容", text: "大型数据库中的这个选项只包含你已经打开的路径和分支，不代表导出了完整数据库。" },
      { title: "棋盘图片", text: "可以把当前主题、棋盘、棋子、坐标、手数、标注和水印一起生成 PNG，适合分享或讲解。" },
      { title: "导出不等于保存", text: "导出是在系统里创建一份副本，不会自动把当前草稿写进本机棋谱库。" },
    ],
    steps: ["打开“导出与分享”。", "阅读选项下方的范围说明，确认需要完整棋谱、原文件还是图片。", "导出后在目标软件中抽查棋盘路数、规则和关键分支。"],
    tip: "长期迁移整套应用资料请使用完整备份；与其他棋谱软件交换时，通常优先选择 SGF。",
  },
  {
    icon: "library", title: "棋谱库、文件夹与批量整理", summary: "把棋谱和题集分门别类，找起来更轻松。",
    features: [
      { title: "棋谱与题库", text: "两类内容有各自的列表和文件夹体系，不会混在一起。", image: "/manual/s10f1.jpg" },
      { title: "搜索", text: "可以按名称等信息筛选，资料多时先搜索通常比逐个翻找更快。" },
      { title: "文件夹", text: "可新建文件夹并移动棋谱或题集，适合按开局、赛事、老师或学习阶段整理。" },
      { title: "批量处理", text: "进入后，手机底部会固定显示全选、移动、删除、更多和退出，不用再滑回页面顶部。" },
      { title: "手动排序", text: "列表支持拖拽调整顺序，也可以一键按标题升序或降序排列。" },
      { title: "回收站", text: "普通删除会先进入回收站，批量删除也会再次确认，给误操作留出恢复机会。" },
    ],
    steps: ["进入棋谱库，先选择棋谱或题库。", "用搜索或文件夹找到目标内容。", "需要整理多项时进入批量处理，勾选后从底部操作栏执行。"],
    tip: "大型 LIB、DP、DB 不参加批量改写，避免对庞大原始资料做不透明的修改。",
  },
  {
    icon: "mark", title: "做题、规则与错题本", summary: "选好题目和规则，再开始练习。",
    features: [
      { title: "题集选择", text: "题目和题集使用浮层选择，不会把手机上的棋盘挤到页面下面。", image: "/manual/s11f1.jpg" },
      { title: "有禁与无禁", text: "禁手模式按连珠黑方规则判断；无禁手模式适合普通五子棋题。" },
      { title: "答题反馈", text: "应用会根据题目答案判断正确、失败和完成，反馈短暂显示后自动让出棋盘。" },
      { title: "摆题与应战", text: "可以先自由摆出初始盘面再开始应战；摆棋时能锁定黑或白，也能让颜色自动交替。" },
      { title: "悔棋与重启", text: "做题悔棋按人和电脑各回退一手，重启只恢复本题初始局面，不会污染你的尝试记录。" },
      { title: "翻题与进度", text: "可以上一题、下一题连续练习，每个题集会记录完成进度，方便回看还剩哪些。" },
      { title: "错题本", text: "尝试过但尚未攻克的题目会集中起来，方便之后继续复习。", image: "/manual/s11f7.jpg" },
      { title: "旧题目规则", text: "不同来源可能使用不同规则语义，开始前应先看题目显示的规则与棋盘路数。" },
    ],
    steps: ["切换到“做题”。", "打开题目选择，选中题集和具体题目。", "确认有禁或无禁规则后开始，失败的题目之后可在错题本继续练。"],
    tip: "规则会直接影响落子是否合法以及答案如何判定，不确定时可以打开完整规则说明。",
    ruleEntry: true,
  },
  {
    icon: "branch", title: "VCF 出题训练", summary: "把连续冲四练习做成题，也可以直接从现有棋谱生成。",
    features: [
      { title: "VCF 出题", text: "选“变形”给真题换朝向，或选“原创”现编新局，再选难度（短、中、深）和数量（1、5、10 道）。" },
      { title: "逐题做", text: "生成后会存进“我的题库”，用左右翻页逐题做，点中间数字直接开始。" },
      { title: "解答与导出", text: "可以对当前盘面求解答，也可以把这一批生成的题目导出成题库 JSON。" },
    ],
    steps: ["在做题模式打开 VCF 出题面板。", "选择模式、难度和数量，等待生成。", "逐题练习，做错的题会进入错题本；需要分享时导出题目集。"],
    tip: "这些题同样会进入错题本，未攻克的可以稍后再练。",
  },
  {
    icon: "ai", title: "AI 人机对战", summary: "从规则、执子到强度，按目录一步步设置。",
    features: [
      { title: "规则目录", text: "包含无禁手、无禁六不胜、一手交换、三手交换、五手两打、五手多打、山口、索索夫-8、塔十和塔拉共十项。", image: "/manual/s13f1.jpg" },
      { title: "有禁与无禁标签", text: "前四项标为无禁，后六项标为有禁；每项右侧的问号可以查看具体流程。" },
      { title: "山口与索索夫-8", text: "山口由先手方在开局时宣布打点数量；索索夫-8 由白方在第 4 手宣布 1–8 个打点、之后黑方还有一次交换权，适合想练习正式开局流程的棋友。" },
      { title: "五手多打", text: "打点数量会在白4之后的对局中临场选择，候选点以 A1、A2 等半透明发光棋子显示。" },
      { title: "思考可以取消", text: "有限或不限时思考都能停止；切谱、退出对弈或进入后台后，旧请求不会迟到落子。" },
      { title: "禁手辅助偏好", text: "AI 对战会尊重你原有的禁手辅助显示偏好，不会在退出后悄悄改掉设置。" },
    ],
    steps: ["点击底部“AI”。", "展开规则目录，选择规则、执子和强度；不懂规则时点问号。", "开始对局，需要时使用停止思考或退出对弈。"],
    tip: "禁手提示适合学习和日常判断，但复杂禁三仍不应代替正式比赛裁判。",
    ruleEntry: true,
  },
  {
    icon: "tree", title: "局面思考、候选点与分析结果", summary: "让 AI 提供方向，但最后的判断仍由你决定。",
    features: [
      { title: "分析当前局面", text: "思考只针对启动时的当前节点，局面一旦改变，旧结果就会失效。", image: "/manual/s14icon.jpg" },
      { title: "结果呈现", text: "思考结果可显示胜率（仅在引擎真正给出时）、Top-3 候选与最多十手的主变化；也可以设置完成后直接落子、打开结果面板，或只在棋盘上显示推荐点。", image: "/manual/s14f1.jpg" },
      { title: "棋谱内查找", text: "在当前棋谱里按坐标、手数、注释、局面文字或着法评价查找，点结果直接跳到那一手。", image: "/manual/s14f5.jpg" },
      { title: "跨谱查找相同局面", text: "在本地棋谱里找结构相同的局面，可选择把旋转和镜像也算作同一局面，便于横向比较不同棋谱。", image: "/manual/s14f4.jpg" },
      { title: "候选点", text: "用于比较可能的落点和搜索信息，是研究提示，不等于每个候选都已经得到完整证明。" },
      { title: "专项结论", text: "VCF 等专项分析会单独说明证明范围，不会把普通推荐点包装成确定必胜。" },
      { title: "随时停止", text: "等待时间过长或不再需要时可以取消，不必退出整个应用。" },
    ],
    steps: ["停在想研究的局面，启动思考。", "等待完成，或在需要时主动取消。", "查看候选和说明，再决定落子、建立变化还是继续深入。"],
    tip: "分析结果更适合帮你缩小研究范围，而不是代替你理解棋形和规则。",
  },
  {
    icon: "backup", title: "资料安全、回收站与完整备份", summary: "重要棋谱不只要保存，还要定期备份。",
    features: [
      { title: "回收站", text: "误删的普通内容可以在这里查看并恢复，真正清空前会再次确认。", image: "/manual/s15f2.jpg" },
      { title: "完整备份", text: "可打包普通棋谱、题库、进度、草稿、文件夹、书签和主要设置，导出为带说明文件的 ZIP 备份包，适合换设备或长期留存。", image: "/manual/s15f3.jpg" },
      { title: "恢复校验", text: "导入备份前会检查结构，恢复中出现错误时会尽量回滚，避免留下半套数据。" },
      { title: "大型资料清单", text: "备份会保留大型棋谱索引与相关信息，但原始大型数据库文件不一定被完整装入备份。" },
      { title: "没有自动云上传", text: "应用不会因为本地快照或同步预留能力，就宣称已经把私人棋谱上传到云端。" },
    ],
    steps: ["从棋谱库打开“资料安全”，或进入设置中的数据与兼容区域。", "导出完整备份，并把文件保存到可靠位置。", "换设备时选择恢复备份，等待校验和恢复全部完成。"],
    tip: "重要的 LIB、DP、DB 原文件请另外保留一份；应用备份不能替代原始资料归档。",
  },
  {
    icon: "palette", title: "主题、棋盘、棋子与透明度", summary: "把棋盘调成自己看得舒服、看得清楚的样子。",
    features: [
      { title: "主题", text: "提供二十多套整体氛围，并对深色、护眼和减少动态效果进行独立适配。", image: "/manual/s16f1.jpg" },
      { title: "棋盘", text: "提供十四种棋盘材质，也支持背景与透明效果；旋转、镜像和分享图片会同步考虑当前外观。", image: "/manual/s16f2.jpg" },
      { title: "棋子", text: "十六种棋子材质，除常规外还有协调双色的卡哇伊棋子、冰晶与结冰感更明显的雪晶棋子，以及金色、钻石等风格。", image: "/manual/s16f3.jpg" },
      { title: "组合透明度预览", text: "设置页预览会同时反映当前棋盘与棋子材质，拖动时更容易判断实际效果。", image: "/manual/s16f4.jpg" },
      { title: "标注高亮", text: "棋盘标注可选择无、白色、金色或蓝色高亮，深色棋盘上看不清黑色标注时可以换一档。" },
    ],
    steps: ["进入设置，用搜索框输入“主题”“棋盘”或“棋子”。", "展开“外观与音效”中的对应子目录。", "边看预览边调整材质、透明度和标注高亮，直到棋子与标注都清楚。"],
    tip: "棋盘透明度最低保留 35%，是为了避免网格和棋面层次完全消失；棋子透明度只影响棋子本体。",
  },
  {
    icon: "settings", title: "字号、显示、手势与设备布局", summary: "根据手机、平板和自己的习惯慢慢调整。",
    features: [
      { title: "字号", text: "可选择正常、大字或特大字，主要控件会一起变大，但不会强行把棋盘拉出屏幕。", image: "/manual/s17f1.jpg" },
      { title: "棋盘辅助", text: "可以控制坐标、手数、最后一手、禁手提示和候选点等显示。" },
      { title: "触摸手势", text: "可按需要开启双指缩放、双指切手等增强；棋谱树则始终支持单指拖动和双指缩放。" },
      { title: "外接键盘", text: "连接键盘后，可以用左右方向键在当前棋谱里前进、后退。" },
      { title: "平板布局", text: "横屏双栏是独立开关，默认保持更稳妥的单栏布局。" },
      { title: "设置搜索", text: "记不住选项在哪时，直接在设置顶部输入关键词，比逐个展开目录更快。", image: "/manual/s17f6.jpg" },
    ],
    steps: ["进入设置，在搜索框输入想调整的关键词。", "一次只改一两项，并回到棋盘确认实际效果。", "如果界面变得太复杂，可以关闭不常用的增强功能。"],
    tip: "常用按钮尽量保持适合触摸的高度；如果使用特大字号，建议同时检查横屏和竖屏是否顺手。",
  },
  {
    icon: "help", title: "格式兼容与规则边界", summary: "导入成功不代表所有软件都用完全相同的规则和字段。",
    features: [
      { title: "格式能力不同", text: "SGF、JSON、LIB、DP、DB 等格式能保存的字段并不相同，导入和导出页面会说明保真范围。" },
      { title: "棋盘路数", text: "应用支持多种方形棋盘尺寸，但题库、图片和特定文件格式可能有自己的路数限制。" },
      { title: "有禁规则", text: "采用连珠黑方禁手；长连、三三、四四等判断会影响黑方落子是否合法。" },
      { title: "无禁与交换规则", text: "无禁手、无禁手六不胜及不同交换开局的胜负和开局流程并不完全相同。" },
      { title: "导入后核对", text: "最好检查棋盘大小、规则名称、坐标基准、主线、分支和注释，尤其是来自旧软件的文件。" },
    ],
    steps: ["进入设置→数据与兼容→格式兼容说明。", "导入后先看棋盘路数与规则，再检查几个关键节点。", "跨软件交换后，在目标软件中再次抽查分支与注释。"],
    tip: "遇到结构不明确的文件，应用会拒绝或给出提示，不会靠猜测静默改写重要数据。",
    ruleEntry: true,
  },
  {
    icon: "info", title: "检查更新、关于与反馈", summary: "遇到问题时，提供清楚的信息会更容易解决。",
    features: [
      { title: "关于页面", text: "可以查看当前版本、产品说明以及项目相关入口。", image: "/manual/s19f1.jpg" },
      { title: "检查更新", text: "只有在你主动点击时才会联网读取版本信息，不会在后台反复打扰。" },
      { title: "反馈不会自动带走棋谱", text: "反馈入口不会自动上传你的私人棋谱，需要附文件时应先确认内容是否适合分享。" },
      { title: "有用的反馈信息", text: "请写清复现步骤、设备型号、Android 或浏览器版本、文件格式，以及问题发生前后的操作。" },
      { title: "截图与诊断", text: "能附截图或诊断信息会更容易定位，但请先遮住私人名称、账号或敏感棋谱内容。" },
    ],
    steps: ["进入设置→关于，先确认当前版本。", "需要时主动检查更新并阅读更新说明。", "反馈问题时按“做了什么→看到了什么→原本希望怎样”的顺序描述。"],
    tip: "请注明问题发生在网页、PWA 还是 Android 安装包；同一功能在不同运行环境下可能表现不同。",
  },
];

function ManualIcon({ name }: { name: ManualIconName }) {
  const props = { size: 20, strokeWidth: 2 };
  if (name === "home") return <Home {...props}/>;
  if (name === "new") return <FilePlus2 {...props}/>;
  if (name === "save") return <Save {...props}/>;
  if (name === "import") return <Download {...props}/>;
  if (name === "export") return <Upload {...props}/>;
  if (name === "library") return <Library {...props}/>;
  if (name === "folder") return <FolderOpen {...props}/>;
  if (name === "comment") return <MessageSquareText {...props}/>;
  if (name === "mark") return <Tag {...props}/>;
  if (name === "branch") return <GitBranch {...props}/>;
  if (name === "tree") return <ListTree {...props}/>;
  if (name === "ai") return <Bot {...props}/>;
  if (name === "undo") return <Undo2 {...props}/>;
  if (name === "backup") return <ArchiveRestore {...props}/>;
  if (name === "settings") return <Settings {...props}/>;
  if (name === "review") return <Eye {...props}/>;
  if (name === "palette") return <Palette {...props}/>;
  if (name === "help") return <CircleHelp {...props}/>;
  return <Info {...props}/>;
}

export function UserManual({ onClose, onOpenRules }: { onClose: () => void; onOpenRules?: () => void }) {
  const [zoom, setZoom] = useState<{ src: string; caption: string } | null>(null);
  useEffect(() => {
    if (!zoom) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setZoom(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);
  return <div className="sheet-body manual-sheet">
    <div className="manual-intro"><span className="manual-intro-icon"><BookOpen size={24}/></span><div><b>别担心，跟着做一遍就会了</b><p>不用一次看完所有内容。第一次使用建议先读第 01、03、04 节；遇到具体问题时，再回来展开对应章节。功能点旁的小图可点击放大，直观看到每个界面长什么样。</p></div></div>
    <div className="manual-icon-legend"><span>常用图标</span><div><span><Home size={15}/>主界面</span><span><Save size={15}/>保存</span><span><Download size={15}/>导入</span><span><Bot size={15}/>AI</span><span><Settings size={15}/>设置</span></div></div>
    <div className="manual-list">{manualSections.map((section, index) => <details className="manual-item" key={section.title} open={index === 0 ? true : undefined}><summary><span className="manual-icon-shot"><ManualIcon name={section.icon}/></span><span className="manual-summary-copy"><b>{String(index + 1).padStart(2, "0")} · {section.title}</b><small>{section.summary}</small></span><ChevronDown className="manual-chevron" size={18}/></summary><div className="manual-item-body">
      <div className="manual-feature-list"><b>这里可以做什么</b>{section.features.map((feature, featureIndex) => <div className="manual-feature" key={feature.title}><span>{featureIndex + 1}</span><p><b>{feature.title}</b><small>{feature.text}</small></p>{feature.image && <button type="button" className="manual-feature-thumb" onClick={() => setZoom({ src: feature.image!, caption: feature.title })} aria-label={`查看 ${feature.title} 截图`}><img src={feature.image} alt={`${feature.title}界面`} loading="lazy" decoding="async"/><span className="manual-thumb-hint"><Eye size={11}/>点击放大</span></button>}</div>)}</div>
      <div className="manual-steps"><b>跟着做</b><ol>{section.steps.map((step) => <li key={step}>{step}</li>)}</ol></div>
      <div className="manual-tip"><Info size={15}/><span><b>贴心提示</b>{section.tip}</span></div>
      {section.ruleEntry && onOpenRules && <button type="button" className="manual-rule-entry" onClick={onOpenRules}><CircleHelp size={16}/>打开完整规则说明</button>}
    </div></details>)}</div>
    {zoom && <div className="manual-lightbox" role="dialog" aria-label={`${zoom.caption} 截图`} onClick={() => setZoom(null)}><button type="button" className="manual-lightbox-close" aria-label="关闭大图" onClick={() => setZoom(null)}><X size={20}/></button><figure onClick={(event) => event.stopPropagation()}><img src={zoom.src} alt={`${zoom.caption}界面大图`}/><figcaption>{zoom.caption}</figcaption></figure></div>}
    <button className="primary-button" onClick={onClose}><Check/>看完了，开始使用</button>
  </div>;
}

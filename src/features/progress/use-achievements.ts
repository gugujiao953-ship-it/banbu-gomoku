import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { loadAchievementState, loadPendingSoulRewards, runAchievementCheck, type AchievementSources, type AchievementState } from "./achievements";
import { collectAchievementSources } from "./achievement-sources";
import {
  grantSoul, loadSoulLedger, loadSoulTuning, saveSoulTuning, setActiveSoulTuning, soulLedger, soulLedgerRevision,
  spendSoul, subscribeSoulLedger, summarizeSoul,
  type SoulLedger, type SoulMutationCode, type SoulReason, type SoulSummary, type SoulTuning,
} from "./soul";
// 账本一有变动就通知商店那份快照（它自己也持有余额，见 refreshSoulShop 的注释）。
import { refreshSoulShop } from "./use-soul-shop";
import { bumpAchievementCounter, recordAchievementSignals, type AchievementSignals } from "./signal-store";
import type { RewardItem } from "./ProgressReward";
import type { AchievementDefinition } from "./achievement-catalog";

/**
 * 成就与棋魂在 App 里的接线层（用户 2026-10-09）。
 *
 * ## 为什么要单独一个 hook
 *
 * `App.tsx` 已经一万行出头、且**长期有并行会话在改**（改造表里反复出现"两个会话撞车"）。
 * 所以接线必须**最小侵入**：App 里只留几种一行调用——
 *
 * ```tsx
 * const progress = useProgress();
 * progress.check()                                   // 结算点：判定成就
 * progress.signal({ readManual: true })               // 没有账本可查的一次性动作
 * progress.earn({ reason: "duel-win", amount: 8, ... }) // 结算点：记棋魂
 * ```
 *
 * 其余（读账本、判定、发奖、维护队列、控制弹窗、棋魂账本）全在这里。
 *
 * ## 棋魂与成就是两条独立的线（用户 2026-10-09 纠正）
 *
 * ⚠ 上一版把棋魂写成"解锁成就才给"，错了。棋魂是**参与度货币**：下棋、做题、复盘、
 * 识谱、打谱批注、每日一题都给（来源表见 `soul.ts` 的 `SOUL_EARN_RULES`），
 * 成就只是其中偏大奖的一档。所以两者在这里是**两个独立的 API**：
 *  · `check()` / `signal()` → 成就（解锁时**自动**顺带发成就那部分的棋魂，见 `runAchievementCheck`）；
 *  · `earn()` → 日常行为的棋魂，与成就是否解锁无关。
 *
 * ## 判定触发时机
 *
 * 1. **启动后一次**（把历史数据一次性兑现成成就）；
 * 2. **`check()` 被显式调用时**（各结算点）；
 * 3. 打开成就面板前。
 *
 * 每次判定都**幂等**，所以多调几次没有副作用，宁可多调也不要漏调。
 */

export interface UseProgressResult {
  /** 成就解锁表（面板渲染用） */
  state: AchievementState;
  /** 棋魂汇总（说明页渲染用） */
  soul: SoulSummary;
  /** 棋魂账本（说明页要看最近 50 条流水） */
  ledger: SoulLedger;
  /** 棋魂余额（徽章显示用） */
  balance: number;
  /** 当前生效的调度项（说明页要把倍率/开关如实显示出来） */
  tuning: SoulTuning;
  /** 待播的奖励提示队列（成就大卡 / 棋魂紧凑条，共用一个位置） */
  queue: readonly RewardItem[];
  /** 队列播完（弹窗组件回调） */
  drain: () => void;
  /** 跑一次成就判定。`overrides` 补最新事实，避免"写盘→读盘"的时序差。 */
  check: (overrides?: Partial<AchievementSources>) => readonly AchievementDefinition[];
  /** 记一次性信号（没有账本可查的动作走这里） */
  signal: (patch: AchievementSignals) => void;
  /**
   * 累加型计数（目前只有点魂火）。**顺带判一次成就**——连点的手感就是
   * "点着点着突然弹一个成就"，攒到打开面板时才判就完全没那个意思了。
   *
   * 放在这里而不是让 App 直接调 `bumpAchievementCounter`：App 不该知道
   * "信号位存在哪儿、判定的时机怎么配合"这些细节（那是这一层的活）。
   */
  countUp: (key: "tapCount", delta?: number) => void;
  /**
   * 记一笔棋魂（日常行为）。**带 token 保证幂等**——各结算点都要给一个稳定的 token
   * （例如 `duel:<gameId>`、`puzzle:<collection>/<id>`），否则刷新/恢复会重复入账。
   */
  earn: (input: { reason: SoulReason; amount: number; detail: string; token?: string; tokenRetention?: "session" | "persistent"; silent?: boolean }) => SoulMutationCode;
  /**
   * 改调度项（存盘 + 立刻生效 + 重算面板口径）。
   *
   * 为什么要有 setter 而不是让外面直接调 `saveSoulTuning`：调度项一改，
   * 面板上的"累计获得"口径（连点算不算）与余额都要跟着重算，
   * 所以必须由持有 state 的这里广播出去，否则界面会停在旧数字上。
   */
  setTuning: (next: SoulTuning) => void;
  /**
   * 花棋魂。**返回失败原因**（`insufficient` / `daily-limit` / …）而不是布尔——
   * 消费端要据此给用户不同的话（"棋魂不够"和"今天花超了"不是一件事）。
   */
  spend: (input: { amount: number; reason: SoulReason; detail: string; token?: string }) => SoulMutationCode;
}

export function useProgress(): UseProgressResult {
  const [state, setState] = useState<AchievementState>(() => loadAchievementState());
  /**
   * 账本：**不再自己持有一份副本**（2026-10-11 修的真漏洞，见 `soul.ts` 共享账本那段）。
   *
   * 上一版这里 `useState(() => loadSoulLedger())`，然后所有写入都作用在这份副本上、
   * 再把副本整段写回存储。问题是商店（`useSoulShop`）自己也读一份 ——
   * 于是"商店买了东西扣了钱 → 本 hook 再 earn 一笔"会把那笔消费**整段覆盖掉**：
   * 钱退回、东西还在（解锁集合存在另一个键上）。
   *
   * 现在账本是模块级单例（`soulLedger()`），本 hook 只是**订阅它的变更号**并渲染：
   * 谁写的都一样，写在同一份数据上，写完广播一次，两边界面一起更新。
   */
  const revision = useSyncExternalStore(subscribeSoulLedger, soulLedgerRevision, soulLedgerRevision);
  const ledger = soulLedger();
  /**
   * 调度项：**在 useState 的初始化里就装到模块单例上**（不是放 useEffect）。
   *
   * 理由是执行顺序：`useEffect` 在首次渲染之后才跑，而首次渲染期间
   * `check()`（启动兑现历史成就）已经在发棋魂了——若那时单例还是出厂默认，
   * 用户设的倍率就漏掉了这一批。初始化函数同步执行、且一定在 `check()` 之前，
   * 所以放这里才能保证"从第一笔开始就按用户的调度走"。
   */
  const [tuning, setTuningState] = useState<SoulTuning>(() => setActiveSoulTuning(loadSoulTuning()));
  const [queue, setQueue] = useState<readonly RewardItem[]>([]);
  const stateRef = useRef(state);
  const pendingSoulRewardsRef = useRef<string[] | null>(null);
  const retryStatePersistenceRef = useRef(false);
  if (!pendingSoulRewardsRef.current) pendingSoulRewardsRef.current = loadPendingSoulRewards();
  stateRef.current = state;

  /**
   * 汇总要跟着**账本变更号**与调度项一起重算。
   *
   * ⚠ 依赖里必须有 `revision`：账本是同一个对象（entries 数组被替换、但对象没换），
   * 只依赖 `ledger` 的话这个 memo 永远不会重算 —— 界面就停在旧余额上
   * （这正是"两处各记一份"的另一种表现，写的时候要盯着）。
   */
  const soul = useMemo(() => summarizeSoul(soulLedger(), tuning), [revision, tuning]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * 账本刚被写过之后：通知商店重读余额与库存。
   *
   * 方向是 **账本 → 商店**。反方向（商店 → 这里）已经由 `subscribeSoulLedger`
   * 那条订阅覆盖了，两边合起来才是完整的同步。
   */
  const commitLedger = useCallback(() => {
    refreshSoulShop();
  }, []);

  const check = useCallback((overrides: Partial<AchievementSources> = {}) => {
    const sources = collectAchievementSources(overrides);
    const result = runAchievementCheck(sources, {
      state: stateRef.current,
      ledger: soulLedger(),
      pendingSoulRewards: pendingSoulRewardsRef.current ?? [],
      retryStatePersistence: retryStatePersistenceRef.current,
    });
    pendingSoulRewardsRef.current = result.pendingSoulRewards;
    retryStatePersistenceRef.current = !result.statePersisted;
    if (result.soulGranted > 0) commitLedger();
    if (result.unlocked.length) {
      stateRef.current = result.state;
      setState(result.state);
      // 队列**追加**而不是替换：连续两次判定的解锁要都能看到，
      // 不然前一秒解的会被后一秒的顶掉（用户看不到就白解锁了）。
      setQueue((current) => [...current, ...result.unlocked.map((definition): RewardItem => ({ kind: "achievement", definition }))]);
    }
    return result.unlocked;
  }, [commitLedger]);

  const signal = useCallback((patch: AchievementSignals) => {
    recordAchievementSignals(patch);
    // 记完顺手判一次——信号类成就（打开手册、导出棋谱）当场就该弹出来。
    check();
  }, [check]);

  /**
   * 记一笔棋魂。
   *
   * `silent: true` 时**不推顶部提示条**——专门给"点一下 +1"那个无限连点机制用
   * （用户 10-09 第十轮）。理由：那个机制可以一直点，如果每次都推一条顶部提示，
   * 队列会被塞满、提示条会一直挂着不消失（每 2.2 秒一条、点得比它播得快就永远播不完），
   * 既挡视线又浪费渲染。连点的手感反馈改由**面板内就地飘出的 +1** 承担（见 SoulPanel）。
   */
  const earn = useCallback((input: { reason: SoulReason; amount: number; detail: string; token?: string; tokenRetention?: "session" | "persistent"; silent?: boolean }) => {
    const result = grantSoul(soulLedger(), input);
    // 幂等跳过（token 重复）时 ok=false 且没写流水，此时不必重渲染、也不弹提示
    // （刷新/恢复重放不能又弹一次获得棋魂）。
    if (result.ok) {
      commitLedger();
      // 棋魂获得也要有动效提示（用户 2026-10-09）：推一条紧凑条进同一个队列，
      // 与成就大卡共用顶栏下沿那个奖励区域。
      if (!input.silent) {
        setQueue((current) => [...current, {
          kind: "soul",
          amount: result.entry!.amount,
          label: input.detail,
          balance: result.balance,
        }]);
      }
    }
    return result.code;
  }, [commitLedger]);

  const drain = useCallback(() => setQueue([]), []);

  const countUp = useCallback((key: "tapCount", delta = 1) => {
    bumpAchievementCounter(key, delta);
    check();
  }, [check]);

  /**
   * 改调度项：**存盘 → 装单例 → 更新 state**，三步都要做，少一步就有一半是假的。
   *
   * `saveSoulTuning` 的返回值不在这里报错：存储写不进去（隐私模式/配额满）时
   * 本次会话的调度仍生效（单例已经换了），下次启动回落到上次成功的值——
   * 这是本项目对存储失败的一贯处理（设置类改动不该因为存不下就整个不做事）。
   */
  const setTuning = useCallback((next: SoulTuning) => {
    const normalized = setActiveSoulTuning(next);
    saveSoulTuning(normalized);
    setTuningState(normalized);
  }, []);

  /**
   * 花棋魂。同样走**共享账本**（`soulLedger()`，见 `soul.ts` 那段：写在同一个对象上，
   * 才不会被另一处的读-改-写覆盖）。失败时不推提示条也不重渲染——
   * 失败不该有"获得了什么"的动效。
   */
  const spend = useCallback((input: { amount: number; reason: SoulReason; detail: string; token?: string }): SoulMutationCode => {
    const result = spendSoul(soulLedger(), input);
    if (result.ok) commitLedger();
    return result.code;
  }, [commitLedger]);

  // 启动后一次：把历史数据兑现成成就。
  useEffect(() => {
    check();
    // 只在挂载时跑一次；`check` 是稳定引用（useCallback 依赖 commitLedger，而它也是稳定的）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { state, soul, ledger, balance: soul.balance, tuning, queue, drain, check, signal, countUp, earn, spend, setTuning };
}

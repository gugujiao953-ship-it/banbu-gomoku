import { Lock, Sparkles, Trophy } from "lucide-react";
import {
  ACHIEVEMENT_CATALOG,
  ACHIEVEMENT_GROUPS,
  achievementsInGroup,
  type AchievementDefinition,
} from "./achievement-catalog";
import type { AchievementState } from "./achievements";

/**
 * 成就面板（用户 2026-10-09）。
 *
 * ## 这一版只放成就，棋魂已经搬走
 *
 * 上一版把棋魂和成就塞在同一屏（理由是"棋魂唯一来源是成就"）。用户当场纠正了两件事：
 *  ① 棋魂**不是只有成就才给**（下棋/做题/复盘/识谱/打谱都给）；
 *  ② 棋魂要有自己的入口（对弈页标题行最左的魂火徽章）与自己的说明页。
 * 所以这个面板回到它本该有的样子：**只管成就**。棋魂相关的一切在
 * `SoulBadge.tsx`（徽章）+ `SoulPanel.tsx`（说明页）+ `soul.ts`（账本与规则）。
 *
 * ## 显示口径
 *
 *  · 隐藏成就解锁前**不显示条件**（只给占位），这是成就系统的乐趣；
 *  · 累积型成就显示进度；
 *  · 已解锁的排在未解锁前面——用户先看到"我有什么"。
 */

export interface AchievementsPanelProps {
  state: AchievementState;
  /** 关闭面板 */
  onClose: () => void;
}

const formatAt = (at: number): string => {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

function AchievementRow({ item, unlockedAt }: { item: AchievementDefinition; unlockedAt?: number }) {
  const locked = unlockedAt === undefined;
  const secretLocked = locked && item.secret;
  return (
    <li className={`achievement-row${locked ? " locked" : ""}${item.secret ? " secret" : ""}`} data-achievement-row={item.id}>
      <span className="achievement-row-medal" aria-hidden="true">
        {locked ? <Lock size={15}/> : <Trophy size={15}/>}
      </span>
      <div className="achievement-row-copy">
        <b>{secretLocked ? "隐藏成就" : item.title}</b>
        <small>{secretLocked ? "达成后揭晓" : item.text}</small>
        {!locked && unlockedAt !== undefined && (
          <em className="achievement-row-at">{formatAt(unlockedAt)} 达成 · +{item.soul} 棋魂</em>
        )}
      </div>
      {!locked && <span className="achievement-row-soul">+{item.soul}</span>}
    </li>
  );
}

export function AchievementsPanel({ state, onClose }: AchievementsPanelProps) {
  const done = ACHIEVEMENT_CATALOG.filter((item) => state[item.id] !== undefined).length;
  const total = ACHIEVEMENT_CATALOG.length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <div className="achievements-panel" data-achievements-panel="">
      {/* 进度 */}
      <section className="achievements-progress" aria-label="成就进度">
        <div className="achievements-progress-head">
          <span className="achievements-progress-icon" aria-hidden="true"><Sparkles size={15}/></span>
          <b data-achievements-done="">{done}</b>
          <small>/ {total} 项成就</small>
          <strong>{percent}%</strong>
        </div>
        <div className="achievements-progress-bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="成就完成度">
          <i style={{ width: `${percent}%` }}/>
        </div>
      </section>

      {ACHIEVEMENT_GROUPS.map((group) => {
        const items = achievementsInGroup(group.id);
        const groupDone = items.filter((item) => state[item.id] !== undefined).length;
        return (
          <section className="achievements-group" key={group.id} aria-label={group.title}>
            <header>
              <b>{group.title}</b>
              <small>{group.summary}</small>
              <em>{groupDone}/{items.length}</em>
            </header>
            <ul>
              {/* 已解锁的排前面，未解锁的保持目录顺序——用户先看到"我有什么"。 */}
              {[...items].sort((a, b) => {
                const aLocked = state[a.id] === undefined ? 1 : 0;
                const bLocked = state[b.id] === undefined ? 1 : 0;
                return aLocked - bLocked;
              }).map((item) => <AchievementRow key={item.id} item={item} unlockedAt={state[item.id]}/>)}
            </ul>
          </section>
        );
      })}

      <p className="achievements-foot">
        成就会在讲解、复盘、对弈等环节自动记录；已解锁的成就永久保留。
        解锁成就会得到棋魂，但棋魂不止来自成就——下棋、做题、复盘、识谱、打谱批注都会攒，
        详见对弈页左上角的棋魂说明。
      </p>
    </div>
  );
}

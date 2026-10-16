import { Play, Settings2, Sparkles, Swords, Timer } from 'lucide-react';
import type { TourStep } from '../../onboarding/tour-steps';

export const ch20: TourStep[] = [
  { id: 'vcf-enter', title: 'VCF 挑战', lead: '在“对弈”里进这个只许冲四的闯关界面。', tab: 'duel',
    tips: [{ sel: '[data-duel-entry="vcf"]', name: 'VCF 挑战', desc: '每一手都必须带四；按题目手数与用时涨落等级分，题池上万道。', icon: Swords }] },
  { id: 'vcf-play', title: '每一手都要带四', lead: '落子必须形成四（或直接连五），否则这一手会被拦下。', tab: 'duel', vcfChallenge: true,
    tips: [
      { sel: '.vcfch-board', name: '挑战棋盘', desc: '棋盘与棋子跟随你选的棋盘/棋子材质；执黑时踩到禁手（四四、长连、双三）不能落。', icon: Swords },
      { sel: '.vcfch-primary', name: '开始挑战 / 认输', desc: '点「开始挑战」按等级分匹配一道题；中途不做可以认输（判负扣分）。', icon: Play },
    ] },
  { id: 'vcf-status', title: '等级分与计时', lead: '题目等级 = 手数（1 级 1 手…13 级 13 手，挑战最高匹配 35 手）；等级分每级 300 分，0 起、9999 封顶（最高 34 级）', tab: 'duel', vcfChallenge: true,
    tips: [
      { sel: '.vcfch-top', name: '等级分与设置', desc: '右上角齿轮：你执子、出题档、计时难度、允许使用题目生成器、起始档位与做题记录。换档位/执子/计时难度会作废当前这一局。', icon: Settings2 },
      { sel: '.vcfch-clock', name: '计时', desc: '三档计时难度（默认 ×2 / 充裕 ×1 / 休闲 ×0.5），时限随等级伸缩：1–3 级 30/35/40 秒起，在 4/6/9/11/12/13 级各加一次，13 级后每 2 级加一次，最高级封顶 120/210/300 秒；最后一秒转红，超时判负。', icon: Timer },
      { sel: '.vcfch-items', name: '三道道具', desc: '加时卡、提示卡、悔棋卡：卡面上半是图标与你的数量，下半那条「+」点开是用法＋单价＋买一个。这一手用不了就不扣（钱不够也不扣），人机对弈那边没有道具卡。', icon: Sparkles },
    ] },
  { id: 'vcf-solution-title', title: '看解答与下一题', lead: '完成或认输后可以看解答，再继续挑战。', tab: 'duel', vcfChallenge: true, final: true,
    tips: [
      { sel: '.vcfch-board', name: '解答棋盘', desc: '完成或认输后会显示解答工具。点「查看解答」后可用上一手/下一手走解法，棋子标有手序，红环标当前手；「存为图片」导出当前棋盘。', icon: Play },
      { sel: '.vcfch-bottom', name: '下一题', desc: '点「下一题」继续；做题记录里点任意一条可把那道题载入摆棋重做（不计分）。', icon: Play },
    ] },
];

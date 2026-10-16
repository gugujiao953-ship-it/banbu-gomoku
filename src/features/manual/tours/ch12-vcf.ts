import { Download, Play, Sparkles } from 'lucide-react';
import type { TourStep } from '../../onboarding/tour-steps';

export const ch12: TourStep[] = [
  { id: 'generator-enter', title: '棋题生成器', lead: '在“对弈”打开独立生成界面。', tab: 'duel', generator: false,
    tips: [{ sel: '[data-duel-entry="generator"]', name: '棋题生成器', desc: '从空棋盘生成原创 VCF 题，支持黑白先、抓禁手、文字和图案。', icon: Sparkles }] },
  { id: 'generator-settings', title: '选择题型与手数', lead: '手数只数进攻方落子，包含最后连五。', tab: 'duel', generator: true,
    tips: [{ sel: '.generator-settings', name: '生成设置', desc: '默认使用标准 15 路。允许扩展时优先小棋盘，最多 30 路；文字每个字、图案每个部分都会参与解题。生成的题一律只保留一个正确首手（这不是开关）；棋盘设置用步进器选择 5–30 路。', icon: Sparkles }] },
  { id: 'generator-play', title: '生成后直接做题', lead: '生成的题先保存在这台设备的“历史生成”。', tab: 'duel', generator: true,
    tips: [{ sel: '.generator-stage', name: '题目棋盘', desc: '选题后可以直接做题、播放完整答案、放大棋盘或导出题集。停止生成会保留已完成的题，搜索超时可以增加时间重试。', icon: Play }] },
  { id: 'generator-save', title: '以后还能接着练', lead: '在题库重新打开生成题，会回到这个专门界面。', tab: 'duel', generator: true,
    tips: [{ sel: '.generator-bar-actions', name: '保存与历史', desc: '点“保存本批”把题目加入“我的题库”，也可从“历史”继续练习。题集 JSON 和软件备份都会保留题面、答案和图案数据，重新打开时会再验题。', icon: Download }], final: true },
];

import { describe, expect, it, vi } from 'vitest';
import { generate, verify, evaluateMove } from '../../../vcf-generator/lib/browser.mjs';
import { GENERATED_DEFAULT_FOLDER, generatedCollection, generatedCollectionIdForFolder, generatedMatchesPuzzle, mergeGeneratedCollection, readGeneratedProof, readGeneratedProofText } from './collection';
import { replayPrefix, replaySteps } from './replay';
import { appendBatch, historyPuzzles, loadBatches } from './history';
import { DEFAULT_GENERATOR_SETTINGS, isGeneratedPuzzle, validateSettings, type ProofNode, type SolutionMove } from './model';
import { coordinateName, parseCoordinate, createDocument, boardAt } from '../../game';
import { createPuzzleDocument, exportPuzzleCollectionJson, importKaibaoPuzzleJson } from '../../puzzles';
import { parseCoordinateCode } from '../../coordinate-code';

describe('portable generator and application boundary', () => {
  it('bounds experimental hard search while preserving old settings', () => {
    expect(() => validateSettings(DEFAULT_GENERATOR_SETTINGS)).not.toThrow();
    const hard = { ...DEFAULT_GENERATOR_SETTINGS, hardSearch: true, moreObstacles: true };
    expect(() => validateSettings(hard)).not.toThrow();
    for (const patch of [{ depth: 5 }, { depth: 13 }, { expand: true }, { moreObstacles: false }, { kind: 'shape' as const }]) {
      expect(() => validateSettings({ ...hard, ...patch })).toThrow('深算死路');
    }
    expect(() => validateSettings({ ...hard, hardSearch: 'yes' as unknown as boolean })).toThrow('请检查生成设置');
  });
  const puzzle = generate({ count: 1, depth: 5, size: 15, attacker: 'white', ending: 'forbidden', seed: 7, timeMs: 10000 }).puzzles[0];
  it('keeps complete certificates through native export/import and refuses mismatched boards', () => {
    expect(puzzle).toBeTruthy(); expect(isGeneratedPuzzle(puzzle)).toBe(true);
    const collection = generatedCollection([puzzle], 'batch', '生成题集');
    const imported = importKaibaoPuzzleJson(exportPuzzleCollectionJson(collection)).collection;
    expect(imported.puzzles[0].generated).toEqual(puzzle);
    expect(generatedMatchesPuzzle(imported.puzzles[0].generated, imported.puzzles[0])).toBe(true);
    expect(verify(imported.puzzles[0].generated!).valid).toBe(true);
    const duplicate = structuredClone(puzzle);
    duplicate.stones.black.push(duplicate.stones.black[0]);
    expect(generatedMatchesPuzzle(duplicate, imported.puzzles[0])).toBe(false);
    const json = JSON.parse(exportPuzzleCollectionJson(collection));
    json.puzzles[0].side = 1;
    expect(() => importKaibaoPuzzleJson(JSON.stringify(json))).toThrow('没有找到可用题目');
  });
  it('plays a whole forced line, including a forbidden black block, and finishes on actual five', () => {
    let proof = puzzle.proof, moves: typeof puzzle.solution = [], won = false, passed = false;
    for (let turn = 0; turn < puzzle.depth; turn++) {
      const result = evaluateMove(puzzle, moves, proof, proof.at);
      expect(['accepted','won']).toContain(result.status);
      if (result.status !== 'accepted' && result.status !== 'won') throw new Error(result.note);
      moves = [...moves, ...result.moves]; passed ||= result.moves.some(m => m.note === 'pass');
      won = result.status === 'won'; if (won) break; proof = result.proof!;
    }
    expect(won).toBe(true); expect(passed).toBe(true); expect(moves).toEqual(puzzle.solution);
    const empty = Array.from({ length: 225 }, (_, at) => at).find(at => ![...puzzle.stones.black,...puzzle.stones.white].some(p => p.row * 15 + p.col === at) && at !== puzzle.proof.at)!;
    const response = evaluateMove(puzzle, [], puzzle.proof, empty);
    expect(['wrong','accepted','budget']).toContain(response.status);
    expect(response.status).not.toBe('won');
  });
  it('lets a dead side line be walked to its end instead of rejecting it at once', () => {
    const heavy = generate({ count: 1, depth: 8, size: 15, layout: 'compact', naturalStyle: true, uniqueFirst: true,
      rules: 'renju', routingNoise: 1, seed: 11, timeMs: 15000, maxAttempts: 400, solveMs: 9000, verifyMs: 4000 }).puzzles[0];
    expect(heavy).toBeTruthy();
    const occupied = new Set([...heavy.stones.black, ...heavy.stones.white].map(s => s.row * heavy.size + s.col));
    const empties = Array.from({ length: heavy.size * heavy.size }, (_, at) => at).filter(at => !occupied.has(at));
    type WalkStep = { moves: SolutionMove[]; proof: ProofNode | null; note: string };
    // 试走入口：点到一个"能冲四但算不赢"的空点——走进去＝这一手与对方唯一应手都被接受、
    // 证明树置空；不再"点一下就说不成立"。实测这条考卷（D8 seed 11）有 3 条这样的岔路。
    let entry: WalkStep | null = null;
    for (const at of empties) {
      const step = evaluateMove(heavy, [], heavy.proof, at);
      if (step.status === 'accepted' && step.proof === null && empties.some(next =>
        evaluateMove(heavy, step.moves, null, next).status === 'accepted')) { entry = step; break; }
    }
    expect(entry, 'D8 seed 11 应该有可走进去的死岔路').toBeTruthy();
    expect(entry!.moves).toHaveLength(2);
    // 沿岔路继续冲：每一手仍被接受，直到出现死路结论（"几步的支线死线"）。
    let moves = [...entry!.moves], note = entry!.note, guard = 0;
    while (guard++ < 12 && !/此路不通/.test(note)) {
      let next: WalkStep | null = null;
      for (const at of empties) {
        const step = evaluateMove(heavy, moves, null, at);
        if (step.status === 'accepted') { next = step; break; }
      }
      if (!next) break;
      moves = [...moves, ...next.moves]; note = next.note;
    }
    expect(moves.length, '岔路至少要走出两手攻方才算"几步的支线"').toBeGreaterThanOrEqual(4);
    expect(/此路不通/.test(note), `岔路应能走到头并给出死路结论：${note}`).toBe(true);
    // 主解线不受影响：按答案第一手照旧推进证明树。
    const mainAt = heavy.solution.find(m => m.at !== null)!.at as number;
    const mainStep = evaluateMove(heavy, [], heavy.proof, mainAt);
    if (mainStep.status !== 'accepted' && mainStep.status !== 'won') throw new Error(`主解线首手应被接受：${mainStep.note}`);
    expect(mainStep.status).toBe('accepted');
    expect(mainStep.proof).not.toBeNull();
  });
  it('does not trust a verification marker on a corrupted proof', () => {
    const corrupt = structuredClone(puzzle); corrupt.proof.at = corrupt.stones.white[0].row * 15 + corrupt.stones.white[0].col;
    expect(corrupt.verification?.valid).toBe(true); expect(verify(corrupt).valid).toBe(false);
    const cyclic = structuredClone(puzzle); cyclic.proof.replies = [{ at: 0, child: cyclic.proof }];
    expect(isGeneratedPuzzle(cyclic)).toBe(false);
  });
  it('supports all 30 columns in coordinates, native imports and setup documents', () => {
    expect(coordinateName({ row: 0, col: 29 },30)).toBe('AD30');
    expect(parseCoordinate('AA1',30)).toEqual({ row:29,col:26 }); expect(parseCoordinate('AE1',30)).toBeNull();
    expect(parseCoordinateCode('Z30AA29AD1',30).positions).toEqual([{ row:0,col:25 },{ row:1,col:26 },{ row:29,col:29 }]);
    const imported = importKaibaoPuzzleJson(JSON.stringify({ puzzles: [{ size:30, side:1, blackStones:'AA30 AD1', whiteStones:'Z1' }] })).collection.puzzles[0];
    expect(imported.stones).toHaveLength(3); expect(imported.boardSize).toBe(30);
    const session = createPuzzleDocument(imported);
    expect(boardAt(session.document,session.initialNodeId)[0][26]).toBe('black');
    expect(boardAt(session.document,session.initialNodeId)[29][29]).toBe('black');
    expect(createDocument('30 路',30).metadata.boardSize).toBe(30);
  });
  it('keeps a verified 100-move request inside the 30-line application boundary', () => {
    const long = generate({ count: 1, size: 30, depth: 100, attacker: 'black', rules: 'renju', layout: 'compact', seed: 7, timeMs: 10000, solveMs: 5000, verifyMs: 10000, maxAttempts: 20, constructionNodes: 250000 }).puzzles[0];
    expect(long?.size).toBe(30);
    expect(long?.depth).toBe(100);
    expect(long?.verification?.valid).toBe(true);
    expect(isGeneratedPuzzle(long)).toBe(true);
  });
  it('keeps native collections when generated puzzles are merged', () => {
    const native = { id: 'native-kaibao-1', title: '内置题库', source: 'native', license: 'bundled', puzzles: [] };
    const existing = generatedCollection([puzzle], 'batch', '旧生成题集');
    const added = generate({ count: 1, depth: 5, size: 15, attacker: 'black', seed: 19, timeMs: 5000 }).puzzles[0];
    const merged = mergeGeneratedCollection([native, existing], [added], 'batch', '新标题');
    expect(merged.map(collection => collection.id)).toEqual(['native-kaibao-1', 'batch']);
    expect(merged.find(collection => collection.id === 'native-kaibao-1')).toBe(native);
    expect(merged.find(collection => collection.id === 'batch')?.puzzles).toHaveLength(2);
  });
  it('centres text themes and requires every character to participate', () => {
    const glyphs = {
      中: ['000010','000010','011110','010010','011110','000010'],
      秋: ['001100','111001','001010','111000','011000','101001'],
      国: ['111111','100001','101101','100001','101101','100001'],
      庆: ['000010','011111','010000','011110','010010','100101'],
    } as const;
    const characters = ['中', '秋', '国', '庆'] as const;
    const text = characters.join('');
    const mask = Array.from({ length: 6 }, (_, row) => characters.map(character => glyphs[character][row]).join('0'));
    const textRaster = { source: 'test', glyphSize: 6, textLayout: 'horizontal', gap: 1, characters,
      glyphBoxes: characters.map((char, index) => ({ text, char, character: char, index, row: 0, col: index * 7, height: 6, width: 6 })) };
    const generated = generate({ count: 1, text, mask, textRaster, size: 30, depth: 12, attacker: 'black', rules: 'renju', layout: 'compact', seed: 7, timeMs: 5000, solveMs: 2000, verifyMs: 4000, maxAttempts: 30, constructionNodes: 4000 }).puzzles[0];
    expect(generated?.verification?.valid).toBe(true);
    expect(generated?.theme?.row).toBe(12);
    expect(generated?.theme?.col).toBe(1);
    const generatedCharacters = generated?.theme?.characters as Array<{ critical?: unknown[] }> | undefined;
    expect(generatedCharacters?.every(character => Array.isArray(character.critical) && character.critical.length > 0)).toBe(true);
    expect(generated?.theme?.critical.length).toBe(generatedCharacters?.reduce((count, character) => count + (character.critical?.length || 0), 0));
  });
  it('keeps a deep single-character text route inside the 15-line phone board', () => {
    const text = '秋';
    const mask = ['110100','011101','111110','111110','110110','011001'];
    const textRaster = { source: 'canvas-font', glyphSize: 6, textLayout: 'horizontal', gap: 1, characters: [text],
      glyphBoxes: [{ text, char: text, character: text, index: 0, row: 0, col: 0, height: 6, width: 6 }] };
    const generated = generate({ count: 1, text, mask, textRaster, size: 15, depth: 32, attacker: 'black', rules: 'renju', layout: 'compact', seed: 73,
      timeMs: 5000, solveMs: 4000, verifyMs: 7000, maxAttempts: 12, constructionNodes: 10000, naturalStyle: true }).puzzles[0];
    expect(generated?.size).toBe(15);
    expect(generated?.depth).toBe(32);
    expect(generated?.verification?.valid).toBe(true);
    const themedCharacters = generated?.theme?.characters as Array<{ critical?: unknown[] }> | undefined;
    expect(themedCharacters?.[0]?.critical?.length).toBeGreaterThanOrEqual(2);
    expect(generated?.theme?.critical.length).toBe(themedCharacters?.[0]?.critical?.length);
  });
  it('validates the public settings without enabling unimplemented engines or shrinking long requests', () => {
    expect(() => validateSettings(DEFAULT_GENERATOR_SETTINGS)).not.toThrow();
    expect(() => validateSettings({ ...DEFAULT_GENERATOR_SETTINGS, engine:'vct' })).toThrow();
    expect(() => validateSettings({ ...DEFAULT_GENERATOR_SETTINGS, kind:'forbidden' })).toThrow();
    expect(() => validateSettings({ ...DEFAULT_GENERATOR_SETTINGS, depth:40 })).not.toThrow();
    expect(() => validateSettings({ ...DEFAULT_GENERATOR_SETTINGS, depth:100, expand:true, maxSize:30 })).not.toThrow();
    expect(() => validateSettings({ ...DEFAULT_GENERATOR_SETTINGS, depth:101 })).toThrow();
    expect(DEFAULT_GENERATOR_SETTINGS.uniqueFirst).toBe(true);
    expect(DEFAULT_GENERATOR_SETTINGS.qualityRoute).toBe(true);
    expect(() => validateSettings({ ...DEFAULT_GENERATOR_SETTINGS, qualityRoute: false })).not.toThrow();
    expect(() => validateSettings({ ...DEFAULT_GENERATOR_SETTINGS, qualityRoute: 'yes' as unknown as boolean })).toThrow('请检查生成设置');
    expect(DEFAULT_GENERATOR_SETTINGS.moreObstacles).toBe(false);
    expect(() => validateSettings({ ...DEFAULT_GENERATOR_SETTINGS, moreObstacles: true })).not.toThrow();
    expect(() => validateSettings({ ...DEFAULT_GENERATOR_SETTINGS, expand:true, maxSize:5 })).not.toThrow();
    expect(() => validateSettings({ ...DEFAULT_GENERATOR_SETTINGS, expand:true, maxSize:30 })).not.toThrow();
    expect(() => validateSettings({ ...DEFAULT_GENERATOR_SETTINGS, expand:true, maxSize:31 })).toThrow();
    expect(() => validateSettings({ ...DEFAULT_GENERATOR_SETTINGS, kind:'text',text:'中秋',expand:true })).not.toThrow();
    expect(() => validateSettings({ ...DEFAULT_GENERATOR_SETTINGS, kind:'text',text:'中秋快乐',expand:true,depth:12,maxSize:30 })).not.toThrow();
    expect(() => validateSettings({ ...DEFAULT_GENERATOR_SETTINGS, kind:'text',text:'中秋快乐',expand:true,depth:8,maxSize:30 })).toThrow(/至少生成/);
    const customMask = ['00100','01110','11111'];
    const customPoints = customMask.flatMap((row, r) => [...row].flatMap((bit, col) => bit === '1' ? [{ row: r, col }] : []));
    expect(() => validateSettings({ ...DEFAULT_GENERATOR_SETTINGS, kind:'shape',shape:'custom',expand:true,maxSize:15,customShape:{ id:'custom',label:'月牙',source:'custom-mask',mask:customMask,parts:[{ id:'outline',label:'整个轮廓',points:customPoints }] } })).not.toThrow();
    const onePointMask = ['1'];
    expect(() => validateSettings({ ...DEFAULT_GENERATOR_SETTINGS, kind:'shape', shape:'custom', shapeComplexity:true, expand:true, maxSize:5,
      customShape:{ id:'custom',label:'一点',source:'custom-mask',mask:onePointMask,parts:[{ id:'outline',label:'整个轮廓',points:[{ row:0, col:0 }] }] } })).toThrow(/至少有 2 个点/);
  });
});

describe('答案回放游标与生成题的本机记录', () => {
  const solution: SolutionMove[] = [
    { at: 10, player: 2, note: 'four' }, { at: 11, player: 1, note: 'block' },
    { at: 20, player: 2, note: 'four' }, { at: null, player: 1, note: 'pass' },
    { at: 30, player: 2, note: 'five' },
  ];
  it('停着不算一步，所以退/进每一步都真的有子变化', () => {
    const steps = replaySteps(solution);
    expect(steps.map(step => step.move.at)).toEqual([10, 11, 20, 30]);
    expect(steps.map(step => step.passBefore)).toEqual([false, false, false, true]);
    // 第 N 步取到的解线长度必须严格变长——用户报的「退一步只把上一步盖掉」就是这里没变。
    expect(steps.map((_, index) => replayPrefix(solution, index + 1))).toEqual([1, 2, 3, 5]);
    expect(replayPrefix(solution, 0)).toBe(0);
    const trailing: SolutionMove[] = [{ at: 5, player: 2, note: 'five' }, { at: null, player: 1, note: 'pass' }];
    expect(replaySteps(trailing).map(step => step.passBefore)).toEqual([true]);
  });
  it('历史只留最近 100 道、新的在前；默认文件夹沿用固定集合 ID', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
    const sample = generate({ count: 1, depth: 5, size: 15, seed: 3, timeMs: 10000 }).puzzles[0];
    expect(isGeneratedPuzzle(sample)).toBe(true);
    const batch = (n: number) => Array.from({ length: n }, () => sample);
    appendBatch(batch(10), 'batch-a');
    appendBatch(batch(10), 'batch-b');
    expect(loadBatches()[0].id).toBe('batch-b');
    for (let index = 0; index < 12; index += 1) appendBatch(batch(10), `batch-c${index}`);
    expect(historyPuzzles()).toHaveLength(100);
    expect(loadBatches().length).toBeLessThanOrEqual(10);
    expect(generatedCollectionIdForFolder(GENERATED_DEFAULT_FOLDER)).toBe('generated-vcf-library');
    expect(generatedCollectionIdForFolder('我的题库')).toBe('generated-vcf-library');
    expect(generatedCollectionIdForFolder('节日特辑')).not.toBe(generatedCollectionIdForFolder('另一辑'));
    vi.unstubAllGlobals();
  });
});

/**
 * 「导入生成题证明 JSON」（用户 2026-10-11 报「json 文件导入失败」）。
 *
 * 这一组守两件事，缺一不可：
 *  ① **认得出来**——两种真实形态都要认：裸证明、以及 `{puzzle:{…}}` 外壳
 *     （`artifacts/research/**` 里两种都有）；而且认出来的必须是**内层那份题**；
 *  ② **不误认**——认不出返回 null 而不是抛：同一目录里混着研究报表
 *     （`{stats:…}`、source-hashes 那种"路径→哈希"的映射），它们不是题，
 *     必须原样落回既有流程去报自己的错。**这条才是真正的回归防线**：
 *     当年 `.json` 一旦被判错就会回落到别的解析器、把画法一起弄丢，根因就是判据太宽。
 */
describe('生成题证明 JSON 的识别（导入入口的判据）', () => {
  const proof = generate({ count: 1, depth: 5, size: 15, attacker: 'white', ending: 'forbidden', seed: 7, timeMs: 10000 }).puzzles[0];

  it('① 裸证明认得出来', () => {
    expect(isGeneratedPuzzle(proof)).toBe(true);
    expect(readGeneratedProof(proof)).toEqual(proof);
    expect(readGeneratedProofText(JSON.stringify(proof))).toEqual(proof);
  });

  it('① 带 {puzzle:…} 外壳的认得出来，且取的是内层那份题', () => {
    const wrapped = { puzzle: proof, difficulty: { status: 'complete', states: 70 }, geometry: { span: 11 }, stats: { attempts: 281 } };
    expect(readGeneratedProof(wrapped)).toEqual(proof);
    expect(readGeneratedProofText(JSON.stringify(wrapped))).toEqual(proof);
  });

  it('② 研究报表 / 棋谱 / 题库集合一律不认（返回 null，不抛）', () => {
    const record = createDocument('棋谱', 15);
    const collection = generatedCollection([proof], 'batch', '生成题集');
    const negatives: Array<[string, string]> = [
      ['统计报表', JSON.stringify({ stats: { constructed: 150 }, examples: [] })],
      ['源码哈希表', JSON.stringify({ 'vcf-generator/lib/difficulty.mjs': 'deadbeef' })],
      ['棋谱文档', JSON.stringify(record)],
      // ⚠ 题库集合必须**不被这里认领**：它由 handleFiles 的 ① 号分支（isPuzzleJsonText）走题库导入。
      ['题库集合', exportPuzzleCollectionJson(collection)],
      ['数组', JSON.stringify([1, 2, 3])],
      ['空对象', '{}'],
      ['坏 JSON', '{ oops'],
      ['纯文本', 'hello'],
    ];
    for (const [label, text] of negatives) {
      expect(readGeneratedProofText(text), label).toBeNull();
    }
  });

  it('② 认不出的东西不等于"报错"——调用方靠 null 走回既有流程', () => {
    // 这几条只要不抛就算过：抛了会把"导入失败"变成一个 500 式的意外。
    expect(() => readGeneratedProofText('{ oops')).not.toThrow();
    expect(() => readGeneratedProofText('null')).not.toThrow();
    expect(() => readGeneratedProofText('"字符串"')).not.toThrow();
    expect(readGeneratedProof(null)).toBeNull();
    expect(readGeneratedProof(undefined)).toBeNull();
  });

  it('认出来的证明并进题库后能被当成生成题玩（generatedMatchesPuzzle 为真、复核通过）', () => {
    const collections = mergeGeneratedCollection([], [proof], GENERATED_DEFAULT_FOLDER, 'VCF 生成题');
    const puzzle = collections[0].puzzles[0];
    expect(generatedMatchesPuzzle(puzzle.generated, puzzle)).toBe(true);
    expect(verify(puzzle.generated!).valid).toBe(true);
  });
});

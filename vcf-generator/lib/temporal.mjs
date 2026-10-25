// Equivalent to replaying every earlier turn of a five-cell window. The first
// turn with three attackers determines its only allowed attack/reply holes.
// If those holes are the planned pair, the next turn is already blocked; if
// this is the terminal open four, there is no later construction turn.
//
// `allowLatentThree` (第 70 轮) releases exactly one family of those rejections: a window
// that already holds three attacker stones but whose completion can only ever be a closed
// four (冲四). Such a latent three is a legitimate branching decoy — several forcing lines
// converging on the same winning cell, which is the shape real puzzles have and the old
// `own >= 3 ⇒ turn = 0` rule made unconstructable. A three that could be filled into an open
// four still goes through the original rule, because that plan is a shortcut the exact
// replay downstream would reject anyway. Only construction-time pruning is relaxed here; no
// acceptance gate changes.
export function causalWindows(windows, affected, cells, attackTime, replyTime, path, blocks, backEnds, stage, depth, attacker, ending, allowLatentThree, endpoints) {
  const defender = 3 - attacker;
  // An endpoint counts as open when a stone could still be played there by either side:
  // an attacker there (on board or scheduled) completes the line, and an empty cell turns
  // the four into an open four. Only a defender stone or a planned reply closes the line.
  const open = q => q >= 0 && cells[q] !== defender && replyTime[q] < 0;
  for (const id of affected) {
    const points = windows[id];
    let own = 0, firstReply = Infinity, staticBlock = false;
    let first=Infinity,second=Infinity,third=Infinity;
    let endpointHoles = 0;
    for (let i=0;i<points.length;i++) {
      const q=points[i];
      if (cells[q]) {
        if (cells[q] === attacker) own++;
        else { staticBlock = true; break; }
      } else {
        if(i===0)endpointHoles|=1;
        else if(i===4)endpointHoles|=2;
        const time=attackTime[q];
        if(time>=0){if(time<first){third=second;second=first;first=time;}else if(time<second){third=second;second=time;}else if(time<third)third=time;}
        if (replyTime[q] >= 0) firstReply = Math.min(firstReply, replyTime[q]);
      }
    }
    if (staticBlock) continue;
    if (allowLatentThree && own === 3 && endpoints) {
      const { before, after } = endpoints(id);
      // 只有坐在窗口端点上的孔被填上另一孔时才会成四；四的远端必须已经堵死。
      let canOpenFour = false;
      if ((endpointHoles&1)&&open(after)||(endpointHoles&2)&&open(before)) canOpenFour = true;
      if (!canOpenFour) continue;
    }
    const turn = own >= 3 ? 0 : (own===2?first:own===1?second:third)+1;

    if (turn <= stage && firstReply >= turn) {
      if (own >= 4) return false;
      const a = path[turn], d = blocks[turn];
      const extra = turn === depth-2 && ending !== 'forbidden' ? backEnds[turn] : -1;
      for (let i=0;i<points.length;i++) {
        const q=points[i];
        if (cells[q] === attacker || attackTime[q] >= 0 && attackTime[q] < turn) continue;
        if (q !== a && q !== d && q !== extra) return false;
      }
    }
    // Swapping the two holes can create a new three only at the first reply
    // belonging to this window. Earlier replies would permanently block it.
    if (firstReply <= stage && !points.includes(path[firstReply])) {
      let count=own;
      for(let i=0;i<points.length;i++){const q=points[i];if(!cells[q]&&attackTime[q]>=0&&attackTime[q]<firstReply)count++;}
      if (count >= 2) return false;
    }
  }
  return true;
}

// A reply-made defender four must already be blocked by the next attacking
// move. Check its first occurrence after that move, not before it: a legal
// attack may both stop a counter-threat and create its own four.
export function counterFourWindows(windows, affected, cells, attackTime, replyTime, stage, attacker, rule, endpoints) {
  const defender=3-attacker;
  for(const id of affected){
    const points=windows[id];
    let own=0,firstAttack=Infinity,blocked=false;
    let first=Infinity,second=Infinity,third=Infinity,fourth=Infinity;
    for(let i=0;i<points.length;i++){
      const q=points[i];
      if(cells[q]){
        if(cells[q]===defender)own++;
        else{blocked=true;break;}
      }else{
        const time=replyTime[q];
        if(time>=0){if(time<first){fourth=third;third=second;second=first;first=time;}else if(time<second){fourth=third;third=second;second=time;}else if(time<third){fourth=third;third=time;}else if(time<fourth)fourth=time;}
        if(attackTime[q]>=0)firstAttack=Math.min(firstAttack,attackTime[q]);
      }
    }
    if(blocked)continue;
    const turn=own>=4?0:(own===3?first:own===2?second:own===1?third:fourth)+1;
    if(turn>stage||firstAttack<=turn)continue;
    if(defender===1&&rule==='renju'&&own<5){
      const {before,after}=endpoints(id);
      const black=q=>q>=0&&(cells[q]===1||replyTime[q]>=0&&replyTime[q]<turn);
      // A black overline is not a winning five. This conservative prune only
      // rejects a guaranteed exact five; other cases go to the exact replay.
      if(black(before)||black(after))continue;
    }
    return false;
  }
  return true;
}

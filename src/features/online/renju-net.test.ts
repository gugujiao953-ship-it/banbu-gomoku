// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { importRecordFile } from "../../formats";
import { mainLineLength } from "../../formats";
import gamePage from "./__fixtures__/renju-net/game-190334.html?raw";
import peopleJson from "./__fixtures__/renju-net/people-kawada.json?raw";
import searchPage from "./__fixtures__/renju-net/search-2024.html?raw";
import tournamentPage from "./__fixtures__/renju-net/tournament-2058.html?raw";
import {
  RENJU_NET_ORIGIN,
  buildRenjuNetSgf,
  parseRenjuNetGamePage,
  parseRenjuNetMoves,
  parseRenjuNetSearchPage,
  parseRenjuNetTournamentPage,
  renjuNetResultValue,
  searchUrlFor,
} from "./renju-net";
import { RENJU_OPENINGS, renjuOpeningByCode, renjuRuleSetFor } from "./renju-reference";

/** Fixtures are real responses captured from renju.net (2026-09-15), trimmed to
 *  the blocks the parsers read. They keep the decoys the live pages contain. */
describe("renju.net coordinates", () => {
  it("maps the site's bottom-up row numbers onto this app's top-down rows", () => {
    // h8 is the mandatory first move and must land on the board centre.
    expect(parseRenjuNetMoves("h8")).toEqual([{ col: 7, row: 7 }]);
    // h9/h6 are the direct-opening pair; the coordinate the site prints is
    // one row above centre, i.e. row index 6 after the flip.
    expect(parseRenjuNetMoves("h8h9h6")).toEqual([
      { col: 7, row: 7 },
      { col: 7, row: 6 },
      { col: 7, row: 9 },
    ]);
    // Two-digit rows must not be split into two moves.
    expect(parseRenjuNetMoves("i10j11")).toEqual([{ col: 8, row: 5 }, { col: 9, row: 4 }]);
  });

  it("tolerates the separators older records use", () => {
    expect(parseRenjuNetMoves("h8 h9, h6;i10")).toHaveLength(4);
  });
});

describe("renju.net result list", () => {
  const result = parseRenjuNetSearchPage(searchPage, 1);

  it("reads the totals and page count", () => {
    expect(result.total).toBe(7362);
    expect(result.pageCount).toBe(37);
    expect(result.page).toBe(1);
  });

  it("reads the games, ignoring the statistics table that shares the class name", () => {
    expect(result.items).toHaveLength(4);
    expect(result.items[0]).toMatchObject({
      id: "173639",
      tournamentId: "3416",
      black: "Kato Daisuke",
      white: "Kawada Miki",
      result: "1 : 0",
      date: "2024-06-23",
      url: `${RENJU_NET_ORIGIN}/tournament/3416/game/173639/`,
    });
    expect(result.items.map((item) => item.result)).toEqual(["1 : 0", "1 : 0", "0 : 1", "0 : 1"]);
  });

  it("builds a search URL with ids, not display names, for the pickers", () => {
    const url = searchUrlFor({ player1: "1020", yearFrom: "2024", yearTo: "2024", ruleId: "1" }, 3);
    expect(url).toBe(`${RENJU_NET_ORIGIN}/game/search?player1=1020&year_from=2024&year_to=2024&rule=1&p=3`);
    expect(searchUrlFor({}, 1)).toBe(`${RENJU_NET_ORIGIN}/game/search`);
  });
});

describe("renju.net game page", () => {
  const detail = parseRenjuNetGamePage(gamePage);

  it("extracts the published move list verbatim", () => {
    expect(detail.moves).toHaveLength(39);
    expect(detail.moves[0]).toEqual({ col: 7, row: 7 });
    expect(detail.rawMoves).toContain("h8h9h6i10");
  });

  it("extracts players in board order with their result words", () => {
    expect(detail.black).toBe("Dmitry Ilyin");
    expect(detail.white).toBe("Andrey Fyodorov");
    expect(detail.blackResult).toBe("win");
    expect(detail.whiteResult).toBe("loss");
  });

  it("extracts round, rule, opening and event", () => {
    expect(detail.round).toBe("12");
    expect(detail.ruleName).toBe("Classic");
    expect(detail.openingCode).toBe("d11");
    expect(detail.tournamentId).toBe("2058");
    expect(detail.event).toBe("5th All-Union Tournament");
  });

  it("refuses a game whose record carries no moves", () => {
    expect(() => parseRenjuNetGamePage('<div class="renjuboardbbcode" id="board" game=""></div>')).toThrow("没有公开着法记录");
  });
});

describe("renju.net tournament page", () => {
  it("reads place, rule and the date range", () => {
    const tournament = parseRenjuNetTournamentPage(tournamentPage, "2058");
    expect(tournament.name).toBe("5th All-Union Tournament");
    expect(tournament.place).toBe("Moscow, Russian Renju Association");
    expect(tournament.ruleName).toBe("Classic");
    expect(tournament.rated).toBe("Yes");
    expect(tournament.dateFrom).toBe("1988-04-04");
    expect(tournament.dateTo).toBe("1988-04-11");
  });
});

describe("RIF vocabulary tables", () => {
  it("lists the 26 openings in the order the search form numbers them", () => {
    expect(RENJU_OPENINGS).toHaveLength(26);
    expect(RENJU_OPENINGS[0]).toMatchObject({ code: "i1", zhName: "长星" });
    expect(RENJU_OPENINGS[23]).toMatchObject({ code: "d11", zhName: "瑞星" });
    expect(renjuOpeningByCode("D11")?.zhName).toBe("瑞星");
  });

  it("maps only the RIF rules whose procedure this app actually implements", () => {
    expect(renjuRuleSetFor("Classic")).toBe("renju");
    expect(renjuRuleSetFor("Gomoku - Pro")).toBe("standard");
    expect(renjuRuleSetFor("Gomoku - Swap 2")).toBe("freestyle");
    expect(renjuRuleSetFor("Not A RIF Rule")).toBeUndefined();
  });

  it("does not let the word 'free' in a RIF name decide the ruleset", () => {
    // "Swap-5 free" is a renju rule; keyword matching on RU would call it freestyle.
    expect(renjuRuleSetFor("Swap-5 free")).toBe("renju");
  });
});

describe("SGF built from a renju.net game", () => {
  const detail = parseRenjuNetGamePage(gamePage);
  const tournament = parseRenjuNetTournamentPage(tournamentPage, "2058");
  const sgf = buildRenjuNetSgf({
    detail,
    result: "0 : 1",
    date: "1988-04-05",
    sourceUrl: `${RENJU_NET_ORIGIN}/tournament/2058/game/190334/`,
    tournament,
  });

  it("carries every piece of game information the source publishes", () => {
    expect(sgf).toContain("GN[Dmitry Ilyin - Andrey Fyodorov]");
    expect(sgf).toContain("PB[Dmitry Ilyin]PW[Andrey Fyodorov]");
    expect(sgf).toContain("DT[1988-04-05]");
    expect(sgf).toContain("EV[5th All-Union Tournament]");
    expect(sgf).toContain("RE[W+]");
    expect(sgf).toContain("RU[Classic]");
    expect(sgf).toContain("RO[12]");
    expect(sgf).toContain("PC[Moscow, Russian Renju Association]");
    expect(sgf).toContain("ON[瑞星（d11）]");
    expect(sgf).toContain("SO[https://www.renju.net/tournament/2058/game/190334/]");
  });

  it("writes the move list in SGF coordinates, alternating from black", () => {
    const moves = [...sgf.matchAll(/([BW])\[([a-o]{2})\]/g)];
    expect(moves).toHaveLength(39);
    expect(moves[0][1]).toBe("B");
    expect(moves[0][2]).toBe("hh");
    expect(moves[1][2]).toBe("hg");
    expect(moves.map((move) => move[1]).join("").startsWith("BWBW")).toBe(true);
  });
});

describe("result conversion", () => {
  it("converts the site's score notation to SGF", () => {
    expect(renjuNetResultValue("1 : 0")).toBe("B+");
    expect(renjuNetResultValue("0 : 1")).toBe("W+");
    expect(renjuNetResultValue("0.5 : 0.5")).toBe("0");
    expect(renjuNetResultValue("")).toBe("");
  });
});

describe("player lookup payload", () => {
  it("parses the JSON array shape the picker endpoint returns", () => {
    const rows = JSON.parse(peopleJson) as unknown[];
    expect(rows).toEqual([
      [1020, "Kawada Miki", "Hamamatsu, Japan", "010272"],
      [2106, "Kawada Rikuto", "Hamamatsu, Japan", "010314"],
    ]);
  });
});

describe("an imported renju.net game lands in the local library intact", () => {
  const detail = parseRenjuNetGamePage(gamePage);
  const tournament = parseRenjuNetTournamentPage(tournamentPage, "2058");
  const sgf = buildRenjuNetSgf({
    detail,
    result: "0 : 1",
    date: "1988-04-05",
    sourceUrl: `${RENJU_NET_ORIGIN}/tournament/2058/game/190334/`,
    tournament,
  });

  const import2 = () => importRecordFile(
    new File([sgf], "renju-190334.sgf", { type: "application/octet-stream" }),
    { metadata: { rule: renjuRuleSetFor(detail.ruleName), openingRule: "five-two", sourceFormat: "sgf", sourceFileName: "renju-190334.sgf" } },
  );

  it("replays the full move order from the centre outward", async () => {
    const { document } = await import2();
    expect(mainLineLength(document)).toBe(39);
    const sequence: Array<{ player: string; row: number; col: number }> = [];
    let node = document.nodes[document.rootId];
    while (node?.children.length) {
      node = document.nodes[node.preferredChildId || node.children[0]];
      if (node?.move) sequence.push({ player: node.move.player, row: node.move.row, col: node.move.col });
    }
    expect(sequence[0]).toEqual({ player: "black", row: 7, col: 7 });
    expect(sequence[1]).toEqual({ player: "white", row: 6, col: 7 });
    expect(sequence.slice(0, 6).map((move) => move.player === "black" ? "B" : "W").join("")).toBe("BWBWBW");
    // The last published move is k5 -> column k, row 5 from the bottom = index 10.
    expect(sequence[38]).toEqual({ player: "black", row: 10, col: 10 });
  });

  it("keeps every piece of game information", async () => {
    const { document } = await import2();
    expect(document.metadata).toMatchObject({
      black: "Dmitry Ilyin",
      white: "Andrey Fyodorov",
      event: "5th All-Union Tournament",
      date: "1988-04-05",
      result: "W+",
      round: "12",
      place: "Moscow, Russian Renju Association",
      openingName: "瑞星（d11）",
      ruleText: "Classic",
      rule: "renju",
      openingRule: "five-two",
      boardSize: 15,
      sourceUrl: "https://www.renju.net/tournament/2058/game/190334/",
    });
  });

  it("re-exports the information instead of dropping it", async () => {
    const { document } = await import2();
    const { exportSgf } = await import("../../formats");
    const again = exportSgf(document);
    expect(again).toContain("RO[12]");
    expect(again).toContain("PC[Moscow, Russian Renju Association]");
    expect(again).toContain("ON[瑞星（d11）]");
    expect(again).toContain("SO[https://www.renju.net/tournament/2058/game/190334/]");
  });
});

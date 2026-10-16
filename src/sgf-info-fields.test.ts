// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { exportSgf, importRecordFile } from "./formats";

const toFile = (text: string, name = "game.sgf") => new File([text], name, { type: "application/octet-stream" });

const FULL_INFO_SGF =
  "(;GM[4]FF[4]CA[UTF-8]SZ[15]GN[Ilyin - Fyodorov]PB[Dmitry Ilyin]PW[Andrey Fyodorov]" +
  "DT[1988-04-05]EV[5th All-Union Tournament]RE[0:1]RU[Renju]RO[12]PC[Moscow]BR[6 dan]WR[5 dan]" +
  "KM[0]TM[3600]OT[5x60 byo-yomi]ON[D11 Rui Xing]AN[Alexey Skuridin]CP[RIF]" +
  "SO[https://www.renju.net/tournament/2058/game/190334/]B[hh]W[ig]B[gg])";

describe("SGF game-information properties", () => {
  it("reads the full information set into metadata", async () => {
    const result = await importRecordFile(toFile(FULL_INFO_SGF));
    const metadata = result.document.metadata;

    expect(metadata).toMatchObject({
      black: "Dmitry Ilyin",
      white: "Andrey Fyodorov",
      event: "5th All-Union Tournament",
      date: "1988-04-05",
      result: "0:1",
      round: "12",
      place: "Moscow",
      blackRank: "6 dan",
      whiteRank: "5 dan",
      komi: "0",
      timeLimit: "3600",
      overtime: "5x60 byo-yomi",
      openingName: "D11 Rui Xing",
      annotator: "Alexey Skuridin",
      copyright: "RIF",
      sourceUrl: "https://www.renju.net/tournament/2058/game/190334/",
      ruleText: "Renju",
    });
  });

  it("round-trips the information set through export and re-import", async () => {
    const first = await importRecordFile(toFile(FULL_INFO_SGF));
    const exported = exportSgf(first.document);
    const second = await importRecordFile(toFile(exported));

    expect(second.document.metadata.round).toBe("12");
    expect(second.document.metadata.place).toBe("Moscow");
    expect(second.document.metadata.blackRank).toBe("6 dan");
    expect(second.document.metadata.whiteRank).toBe("5 dan");
    expect(second.document.metadata.timeLimit).toBe("3600");
    expect(second.document.metadata.overtime).toBe("5x60 byo-yomi");
    expect(second.document.metadata.openingName).toBe("D11 Rui Xing");
    expect(second.document.metadata.annotator).toBe("Alexey Skuridin");
    expect(second.document.metadata.copyright).toBe("RIF");
    expect(second.document.metadata.sourceUrl).toBe("https://www.renju.net/tournament/2058/game/190334/");
    // The move list itself must survive untouched.
    expect(exportSgf(second.document)).toBe(exported);
  });

  it("never invents empty information properties for records that lack them", async () => {
    const plain = await importRecordFile(toFile("(;GM[4]FF[4]SZ[15]DT[2000-01-01]PB[黑方]PW[白方]B[hh]W[ig])"));
    const exported = exportSgf(plain.document);

    for (const key of ["RO", "PC", "BR", "WR", "KM", "TM", "OT", "ON", "AN", "CP", "SO"]) {
      expect(exported).not.toContain(`${key}[`);
    }
    // Exporting an unannotated record must stay byte-identical to the pre-feature output.
    expect(exported).toBe(
      "(;GM[4]FF[4]CA[UTF-8]AP[RenjuNote:1.0]SZ[15]GN[导入棋谱]PB[黑方]PW[白方]DT[2000-01-01]EV[]RE[]RU[renju];B[hh];W[ig])",
    );
  });

  it("accepts OP as an opening-name fallback for exporters that do not write ON", async () => {
    const result = await importRecordFile(toFile("(;GM[4]FF[4]SZ[15]OP[花月]B[hh])"));
    expect(result.document.metadata.openingName).toBe("花月");
  });
});

import { CHANCE_CARDS } from "@universum/rules/board";
import { afterEach, describe, expect, it } from "vitest";
import { baseLocale, overwriteGetLocale, type Locale } from "#paraglide/runtime.js";
import { chanceCardText, formatMoney } from "#text.ts";

const LOCALES: Locale[] = ["hu", "en", "de"];
const inLanguage = (locale: Locale) => overwriteGetLocale(() => locale);
// Intl separates groups and units with no-break spaces; compare with plain ones.
const plain = (text: string) => text.replaceAll(/[\u00a0\u202f]/g, " ");

afterEach(() => {
  inLanguage(baseLocale);
});

/** The cards this ticket adds, with the amount their text must name. */
const NEW_CARDS = [
  { card: "textbookFair", amount: 150_000 },
  { card: "teachingAssistantJob", amount: 300_000 },
] as const;

describe("a Chance card's title and text", () => {
  it("exist for every card in hu, en and de", () => {
    for (const locale of LOCALES) {
      inLanguage(locale);
      for (const card of CHANCE_CARDS) {
        const { title, text } = chanceCardText(card);
        expect(title.trim()).not.toBe("");
        expect(text.trim()).not.toBe("");
      }
    }
  });

  it("name the Textbook fair's and the Teaching assistant job's amount in every language", () => {
    for (const locale of LOCALES) {
      inLanguage(locale);
      for (const { card, amount } of NEW_CARDS) {
        expect(plain(chanceCardText(card).text)).toContain(plain(formatMoney(amount)));
      }
    }
  });

  it("use the card names agreed for the overlay", () => {
    inLanguage("en");
    expect(chanceCardText("textbookFair").title).toBe("Textbook fair");
    expect(chanceCardText("teachingAssistantJob").title).toBe("Teaching assistant job");
    expect(chanceCardText("examPeriod").title).toBe("Exam period");
    expect(chanceCardText("scholarshipTransfer").title).toBe("Scholarship transfer");
    inLanguage("hu");
    expect(chanceCardText("textbookFair").title).toBe("Tankönyvvásár");
    expect(chanceCardText("teachingAssistantJob").title).toBe("Demonstrátori állás");
    expect(chanceCardText("examPeriod").title).toBe("Vizsgaidőszak");
    expect(chanceCardText("scholarshipTransfer").title).toBe("Ösztöndíj-átutalás");
  });

  it("explain the movement cards' Quarantine and Round bonus effects in every language", () => {
    const effects = {
      hu: { quarantine: "karantén", bonus: "körbónusz" },
      en: { quarantine: "Quarantine", bonus: "Round bonus" },
      de: { quarantine: "Quarantäne", bonus: "Rundenbonus" },
    } as const;
    for (const locale of LOCALES) {
      inLanguage(locale);
      const texts = effects[locale];
      expect(chanceCardText("examPeriod").text).toContain(texts.quarantine);
      expect(chanceCardText("examPeriod").text).toContain(texts.bonus);
      expect(chanceCardText("scholarshipTransfer").text).toContain("Start");
      expect(chanceCardText("scholarshipTransfer").text).toContain(texts.bonus);
    }
  });
});

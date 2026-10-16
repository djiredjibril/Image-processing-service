/** Tests du calque SVG de filigrane : échappement (anti-injection), position, taille. */
import { describe, expect, it } from "vitest";
import { buildWatermarkSvg, escapeXml } from "../../src/infrastructure/image/watermark-svg.js";

const svgOf = (text: string, position: "center" | "top-left" | "top-right" | "bottom-left" | "bottom-right" = "bottom-right", width = 400, height = 200, opacity = 0.5): string =>
  buildWatermarkSvg({ text, position, opacity }, width, height);

describe("escapeXml", () => {
  it("échappe les cinq caractères spéciaux", () => {
    expect(escapeXml(`<a href="x">Tom & Jerry's</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;");
  });

  it("échappe & en premier : pas de double échappement des autres entités", () => {
    expect(escapeXml("&lt;")).toBe("&amp;lt;");
  });
});

describe("buildWatermarkSvg", () => {
  it("n'insère jamais de balisage venu du texte : même un texte hostile reste du contenu inerte", () => {
    const hostile = '</text><script>alert(1)</script><text x="0">';
    const svg = svgOf(hostile);
    expect(svg).not.toContain("<script");
    expect(svg).not.toContain('<text x="0">');
    expect(svg.match(/<text /g)).toHaveLength(1);
    expect(svg.match(/<\/text>/g)).toHaveLength(1);
    expect(svg).toContain("&lt;/text&gt;&lt;script&gt;");
  });

  it("a les dimensions exactes de l'image", () => {
    const svg = svgOf("Hi", "center", 640, 480);
    expect(svg).toContain('width="640"');
    expect(svg).toContain('height="480"');
  });

  it.each([
    ["top-left", "start"],
    ["top-right", "end"],
    ["bottom-left", "start"],
    ["bottom-right", "end"],
    ["center", "middle"],
  ] as const)("position %s : ancrage du texte « %s »", (position, anchor) => {
    expect(svgOf("Hi", position)).toContain(`text-anchor="${anchor}"`);
  });

  it("place le texte en haut pour top-*, en bas pour bottom-*, au milieu pour center", () => {
    const yOf = (position: Parameters<typeof svgOf>[1]): number => Number(/ y="([\d.]+)"/.exec(svgOf("Hi", position))?.[1]);
    expect(yOf("top-left")).toBeLessThan(100);
    expect(yOf("bottom-left")).toBeGreaterThan(100);
    expect(yOf("center")).toBeGreaterThan(90);
    expect(yOf("center")).toBeLessThan(120);
  });

  it("réduit la police pour que le texte tienne dans la largeur, sans descendre sous 8 px", () => {
    const sizeOf = (svg: string): number => Number(/font-size="(\d+)"/.exec(svg)?.[1]);
    const long = "a".repeat(30);
    expect(sizeOf(svgOf(long, "center", 400, 400))).toBeLessThan(sizeOf(svgOf("a", "center", 400, 400)));
    expect(sizeOf(svgOf(long, "center", 10, 10))).toBe(8);
  });

  it("transmet l'opacité", () => {
    expect(svgOf("Hi", "center", 400, 200, 0.3)).toContain('opacity="0.3"');
  });
});

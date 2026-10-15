/**
 * Génération du calque SVG d'un filigrane texte.
 *
 * Couche : infrastructure (image). Le SVG est superposé à l'image par `sharp`. Tout texte inséré dans le
 * document est échappé : un texte ne doit jamais pouvoir ajouter du balisage (injection SVG).
 */
import { countCharacters, type Watermark } from "../../domain/value-objects/watermark.js";

// Largeur moyenne d'un caractère en proportion de la taille de police (police sans empattement en gras).
const AVERAGE_CHAR_WIDTH = 0.62;
const MARGIN_RATIO = 0.03;
const FONT_RATIO = 0.07;
const MIN_FONT_SIZE = 8;

/**
 * Échappe les cinq caractères spéciaux XML.
 *
 * @param text - Texte brut.
 * @returns Le texte, sûr à insérer comme contenu d'un élément SVG.
 */
export function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * Construit le SVG du filigrane, aux dimensions exactes de l'image.
 *
 * La taille de police suit la taille de l'image (7 % du plus petit côté) mais est réduite pour que le texte
 * tienne toujours dans la largeur. Le texte est blanc avec un contour sombre, lisible sur fond clair comme foncé.
 *
 * @param watermark - Texte, emplacement et opacité.
 * @param width - Largeur de l'image en pixels.
 * @param height - Hauteur de l'image en pixels.
 * @returns Le document SVG.
 */
export function buildWatermarkSvg(watermark: Pick<Watermark, "text" | "position" | "opacity">, width: number, height: number): string {
  const margin = Math.max(2, Math.round(Math.min(width, height) * MARGIN_RATIO));
  const characters = countCharacters(watermark.text);
  const fitting = Math.floor((width - 2 * margin) / (characters * AVERAGE_CHAR_WIDTH));
  const fontSize = Math.max(MIN_FONT_SIZE, Math.min(Math.round(Math.min(width, height) * FONT_RATIO), fitting));

  const [vertical, horizontal] = watermark.position === "center" ? ["center", "center"] : watermark.position.split("-");
  const anchor = horizontal === "left" ? "start" : horizontal === "right" ? "end" : "middle";
  const x = horizontal === "left" ? margin : horizontal === "right" ? width - margin : width / 2;
  // `y` est la ligne de base du texte.
  const y = vertical === "top" ? margin + fontSize : vertical === "bottom" ? height - margin : height / 2 + fontSize * 0.35;
  const stroke = Math.max(1, Math.round(fontSize / 12));

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}">` +
    `<text x="${String(x)}" y="${String(y)}" text-anchor="${anchor}" font-family="sans-serif" font-weight="bold" ` +
    `font-size="${String(fontSize)}" fill="white" stroke="black" stroke-width="${String(stroke)}" paint-order="stroke" ` +
    `opacity="${String(watermark.opacity)}">${escapeXml(watermark.text)}</text></svg>`
  );
}

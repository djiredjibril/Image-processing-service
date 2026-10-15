/**
 * Value Object représentant un filigrane texte.
 *
 * Couche : domaine.
 */
import { InvalidTransformationError } from "../errors/image-errors.js";
import { err, ok, type Result } from "../shared/result.js";

/** Emplacements possibles du filigrane. */
export const WATERMARK_POSITIONS = ["center", "top-left", "top-right", "bottom-left", "bottom-right"] as const;

/** Emplacement du filigrane : le centre ou l'un des quatre coins. */
export type WatermarkPosition = (typeof WATERMARK_POSITIONS)[number];

/** Longueur maximale du texte, en caractères. */
export const WATERMARK_MAX_LENGTH = 30;
/** Opacité minimale : en dessous, le filigrane serait invisible. */
export const WATERMARK_MIN_OPACITY = 0.1;
const DEFAULT_OPACITY = 0.5;
const DEFAULT_POSITION: WatermarkPosition = "bottom-right";

// Liste blanche : lettres et chiffres (toutes langues), espace et ponctuation courante. Ni `<`, `>`, guillemet
// double, saut de ligne ou caractère de contrôle : le texte finit dans un document SVG, où ils sont dangereux.
const ALLOWED_TEXT = /^[\p{L}\p{M}\p{N} .,'’:;!?@#&()©_-]+$/u;

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Compte les caractères tels qu'un humain les voit (un « é » décomposé en deux points de code compte pour 1).
 *
 * @param text - Texte à mesurer.
 * @returns Le nombre de caractères visibles.
 */
export function countCharacters(text: string): number {
  return Array.from(GRAPHEMES.segment(text)).length;
}

/** Filigrane tel que reçu (valeurs non vérifiées). */
export interface RawWatermark {
  readonly text: string;
  readonly position?: string | undefined;
  readonly opacity?: number | undefined;
}

/**
 * Filigrane texte à superposer à l'image.
 *
 * Invariants : texte de 1 à 30 caractères, limité à une liste blanche de caractères sûrs (pas de balisage) ;
 * `position` vaut un des cinq emplacements (coin bas-droit par défaut) ; `opacity` est un nombre entre 0,1 et 1
 * (0,5 par défaut).
 */
export class Watermark {
  private constructor(
    public readonly text: string,
    public readonly position: WatermarkPosition,
    public readonly opacity: number,
  ) {}

  /**
   * Construit un filigrane valide.
   *
   * @param raw - Texte, emplacement et opacité demandés.
   * @returns `Ok(Watermark)`, ou `Err(InvalidTransformationError)` si le texte est vide, trop long ou contient un caractère non autorisé, si l'emplacement est inconnu ou si l'opacité est hors bornes.
   */
  static create(raw: RawWatermark): Result<Watermark, InvalidTransformationError> {
    const text = raw.text.trim();
    const length = countCharacters(text);
    if (length < 1 || length > WATERMARK_MAX_LENGTH) {
      return err(new InvalidTransformationError(`watermark.text doit faire de 1 à ${String(WATERMARK_MAX_LENGTH)} caractères`));
    }
    if (!ALLOWED_TEXT.test(text)) {
      return err(new InvalidTransformationError("watermark.text : caractères autorisés = lettres, chiffres, espace et . , ' : ; ! ? @ # & ( ) © _ -"));
    }

    const position = raw.position ?? DEFAULT_POSITION;
    if (!isPosition(position)) {
      return err(new InvalidTransformationError(`watermark.position doit valoir : ${WATERMARK_POSITIONS.join(", ")}`));
    }

    const opacity = raw.opacity ?? DEFAULT_OPACITY;
    if (!Number.isFinite(opacity) || opacity < WATERMARK_MIN_OPACITY || opacity > 1) {
      return err(new InvalidTransformationError(`watermark.opacity doit être un nombre entre ${String(WATERMARK_MIN_OPACITY)} et 1`));
    }
    return ok(new Watermark(text, position, opacity));
  }
}

/** Type guard : la valeur est-elle un emplacement connu ? */
function isPosition(value: string): value is WatermarkPosition {
  return (WATERMARK_POSITIONS as readonly string[]).includes(value);
}

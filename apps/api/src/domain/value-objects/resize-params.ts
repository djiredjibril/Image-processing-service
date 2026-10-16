/**
 * Value Object représentant un redimensionnement.
 *
 * Couche : domaine.
 */
import { InvalidTransformationError } from "../errors/image-errors.js";
import { err, ok, type Result } from "../shared/result.js";

/** Modes d'ajustement acceptés (vocabulaire de `sharp`). */
export const RESIZE_FITS = ["cover", "contain", "fill", "inside", "outside"] as const;

/** Mode d'ajustement : `cover` rogne, `contain` ajoute des marges, `fill` déforme, `inside`/`outside` gardent le ratio. */
export type ResizeFit = (typeof RESIZE_FITS)[number];

/** Redimensionnement tel que reçu (valeurs non vérifiées). */
export interface RawResize {
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly fit?: string | undefined;
}

/**
 * Taille cible d'une image.
 *
 * Invariants : au moins une dimension est donnée (l'autre se déduit en gardant le ratio) ;
 * chaque dimension donnée est un entier entre 1 et la limite par côté ; `fit` vaut `inside`
 * par défaut (ratio conservé, jamais de rognage ni de déformation).
 */
export class ResizeParams {
  private constructor(
    public readonly width: number | null,
    public readonly height: number | null,
    public readonly fit: ResizeFit,
  ) {}

  /**
   * Construit un redimensionnement valide.
   *
   * @param raw - Largeur, hauteur et mode d'ajustement demandés.
   * @param maxSide - Taille maximale autorisée par côté, en pixels.
   * @returns `Ok(ResizeParams)`, ou `Err(InvalidTransformationError)` si rien n'est demandé, si une taille est hors bornes ou si `fit` est inconnu.
   */
  static create(raw: RawResize, maxSide: number): Result<ResizeParams, InvalidTransformationError> {
    if (raw.width === undefined && raw.height === undefined) {
      return err(new InvalidTransformationError("resize : width ou height est requis"));
    }
    for (const [name, value] of [["width", raw.width], ["height", raw.height]] as const) {
      if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > maxSide)) {
        return err(new InvalidTransformationError(`resize.${name} doit être un entier entre 1 et ${String(maxSide)}`));
      }
    }
    const fit = raw.fit ?? "inside";
    if (!isResizeFit(fit)) {
      return err(new InvalidTransformationError(`resize.fit doit valoir : ${RESIZE_FITS.join(", ")}`));
    }
    return ok(new ResizeParams(raw.width ?? null, raw.height ?? null, fit));
  }
}

/** Type guard : la valeur est-elle un mode d'ajustement connu ? */
function isResizeFit(value: string): value is ResizeFit {
  return (RESIZE_FITS as readonly string[]).includes(value);
}

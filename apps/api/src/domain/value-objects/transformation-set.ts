/**
 * Value Object regroupant l'ensemble validé des transformations demandées sur une image.
 *
 * Couche : domaine.
 */
import { InvalidTransformationError } from "../errors/image-errors.js";
import { err, isErr, ok, type Result } from "../shared/result.js";
import { CropParams, type RawCrop } from "./crop-params.js";
import type { ImageDimensions } from "./image-dimensions.js";
import { ImageFilter } from "./image-filter.js";
import { ImageFormat } from "./image-format.js";
import { Quality } from "./quality.js";
import { type RawResize, ResizeParams } from "./resize-params.js";
import { Rotation } from "./rotation.js";

/** Transformations telles que reçues (valeurs non vérifiées, toutes optionnelles). */
export interface RawTransformationInput {
  readonly crop?: RawCrop | undefined;
  readonly rotate?: number | undefined;
  readonly flip?: boolean | undefined;
  readonly mirror?: boolean | undefined;
  readonly resize?: RawResize | undefined;
  readonly filter?: string | undefined;
  readonly format?: string | undefined;
  readonly quality?: number | undefined;
}

/** Limites de validation. */
export interface TransformationLimits {
  /** Taille maximale d'un côté en pixels (`MAX_IMAGE_PIXELS_SIDE`). */
  readonly maxSide: number;
}

/**
 * Ensemble de transformations à appliquer, dans un ORDRE FIXE : orientation EXIF → crop →
 * rotate → flip → mirror → resize → filtre → format et qualité.
 *
 * Invariants : chaque élément présent est valide ; au moins une opération est demandée ;
 * `flip` est le retournement vertical, `mirror` le miroir horizontal.
 */
export class TransformationSet {
  private constructor(
    public readonly crop: CropParams | null,
    public readonly rotation: Rotation | null,
    public readonly flip: boolean,
    public readonly mirror: boolean,
    public readonly resize: ResizeParams | null,
    public readonly filter: ImageFilter | null,
    public readonly format: ImageFormat | null,
    public readonly quality: Quality | null,
  ) {}

  /**
   * Valide les paramètres bruts et construit l'ensemble.
   *
   * @param raw - Transformations demandées.
   * @param limits - Limites de la configuration.
   * @returns `Ok(TransformationSet)`, ou `Err(InvalidTransformationError)` pour le premier paramètre invalide ou si aucune opération n'est demandée.
   */
  static create(raw: RawTransformationInput, limits: TransformationLimits): Result<TransformationSet, InvalidTransformationError> {
    const crop = optional(raw.crop, (value) => CropParams.create(value));
    if (isErr(crop)) return err(crop.error);
    const rotation = optional(raw.rotate, (value) => Rotation.create(value));
    if (isErr(rotation)) return err(rotation.error);
    const resize = optional(raw.resize, (value) => ResizeParams.create(value, limits.maxSide));
    if (isErr(resize)) return err(resize.error);
    const filter = optional(raw.filter, (value) => ImageFilter.create(value));
    if (isErr(filter)) return err(filter.error);
    const format = optional(raw.format, parseFormat);
    if (isErr(format)) return err(format.error);
    const quality = optional(raw.quality, (value) => Quality.create(value));
    if (isErr(quality)) return err(quality.error);

    const set = new TransformationSet(
      crop.value,
      rotation.value,
      raw.flip === true,
      raw.mirror === true,
      resize.value,
      filter.value,
      format.value,
      quality.value,
    );
    return set.hasOperation() ? ok(set) : err(new InvalidTransformationError("aucune transformation demandée"));
  }

  /**
   * Format du fichier produit : celui demandé, sinon celui de la source.
   *
   * @param sourceFormat - Format de l'image source.
   * @returns Le format de sortie.
   */
  outputFormat(sourceFormat: ImageFormat): ImageFormat {
    return this.format ?? sourceFormat;
  }

  /**
   * Vérifie la cohérence avec l'image source : le recadrage doit tenir dans l'image, et la
   * qualité n'a de sens que pour un format avec perte (JPEG, WebP).
   *
   * @param source - Dimensions et format de l'image source.
   * @returns Une erreur, ou `null` si tout est cohérent.
   */
  checkAgainst(source: { readonly dimensions: ImageDimensions; readonly format: ImageFormat }): InvalidTransformationError | null {
    if (this.crop !== null && !this.crop.fitsWithin(source.dimensions)) {
      return new InvalidTransformationError(
        `crop dépasse l'image (${String(source.dimensions.width)}×${String(source.dimensions.height)} px)`,
      );
    }
    if (this.quality !== null && this.outputFormat(source.format) === ImageFormat.PNG) {
      return new InvalidTransformationError("quality ne s'applique qu'aux formats jpeg et webp (le png est sans perte)");
    }
    return null;
  }

  /** `true` si au moins une opération a un effet. Une rotation de 0° ou `flip: false` n'en est pas une. */
  private hasOperation(): boolean {
    const rotates = this.rotation !== null && !this.rotation.isIdentity;
    return (
      this.crop !== null || rotates || this.flip || this.mirror || this.resize !== null ||
      this.filter !== null || this.format !== null || this.quality !== null
    );
  }
}

/** Applique `build` si la valeur est présente ; sinon renvoie `Ok(null)`. */
function optional<T, V>(value: V | undefined, build: (value: V) => Result<T, InvalidTransformationError>): Result<T | null, InvalidTransformationError> {
  if (value === undefined) {
    return ok(null);
  }
  return build(value);
}

/** Convertit un nom de format en `ImageFormat`. */
function parseFormat(raw: string): Result<ImageFormat, InvalidTransformationError> {
  const format = ImageFormat.fromName(raw);
  return format === null ? err(new InvalidTransformationError("format doit valoir : jpeg, png, webp")) : ok(format);
}

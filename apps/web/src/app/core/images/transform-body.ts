/**
 * Construction et validation du corps d'une transformation à partir du formulaire.
 *
 * Rôle : fonction PURE (sans Angular) qui transforme les champs saisis en corps JSON pour l'API, en refusant tout de suite ce que l'API
 * refuserait (bornes identiques). Le serveur reste l'autorité : cette validation évite seulement un aller-retour inutile.
 */
import { Filter, OutputFormat, ResizeFit, TransformBody, WatermarkPosition } from './transform.models';

/** Valeurs brutes du formulaire (`null` / chaîne vide = champ non rempli). */
export interface TransformFormValue {
  readonly rotate: number | null;
  readonly flip: boolean;
  readonly mirror: boolean;
  readonly resizeWidth: number | null;
  readonly resizeHeight: number | null;
  readonly resizeFit: ResizeFit | '';
  readonly filter: Filter | '';
  readonly cropX: number | null;
  readonly cropY: number | null;
  readonly cropWidth: number | null;
  readonly cropHeight: number | null;
  readonly watermarkText: string;
  readonly watermarkPosition: WatermarkPosition | '';
  readonly watermarkOpacity: number | null;
  readonly format: OutputFormat | '';
  readonly quality: number | null;
}

/** Résultat : le corps à envoyer, ou la liste des erreurs à afficher. */
export type BuildResult =
  | { readonly ok: true; readonly body: TransformBody }
  | { readonly ok: false; readonly errors: readonly string[] };

/** Plus grande taille acceptée par l'API pour un côté (`MAX_IMAGE_PIXELS_SIDE` par défaut). */
export const MAX_SIDE = 8000;
/** Longueur maximale du texte d'un filigrane, en caractères (graphèmes). */
export const WATERMARK_MAX_LENGTH = 30;

/** Vrai si la valeur est un entier compris entre `min` et `max` inclus. */
function isIntegerIn(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

/** Nombre de caractères visibles (un emoji ou une lettre accentuée composée compte pour 1, comme côté serveur). */
function graphemeCount(text: string): number {
  return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length;
}

/**
 * Construit le corps de la requête.
 *
 * @param value - Valeurs du formulaire.
 * @returns `{ ok: true, body }` si tout est valide et qu'au moins une opération est choisie, sinon `{ ok: false, errors }` (messages en français).
 */
export function buildTransformBody(value: TransformFormValue): BuildResult {
  const errors: string[] = [];
  const body: { -readonly [K in keyof TransformBody]: TransformBody[K] } = {};

  if (value.rotate !== null) {
    if (isIntegerIn(value.rotate, -360, 360)) body.rotate = value.rotate;
    else errors.push('Rotation : un entier entre -360 et 360.');
  }
  if (value.flip) body.flip = true;
  if (value.mirror) body.mirror = true;

  const sizes = [
    ['Largeur', value.resizeWidth],
    ['Hauteur', value.resizeHeight],
  ] as const;
  for (const [label, size] of sizes) {
    if (size !== null && !isIntegerIn(size, 1, MAX_SIDE)) errors.push(`${label} : un entier entre 1 et ${String(MAX_SIDE)}.`);
  }
  if (value.resizeWidth !== null || value.resizeHeight !== null) {
    body.resize = {
      ...(value.resizeWidth === null ? {} : { width: value.resizeWidth }),
      ...(value.resizeHeight === null ? {} : { height: value.resizeHeight }),
      ...(value.resizeFit === '' ? {} : { fit: value.resizeFit }),
    };
  } else if (value.resizeFit !== '') {
    errors.push('Ajustement : indiquez aussi une largeur ou une hauteur.');
  }

  if (value.filter !== '') body.filter = value.filter;

  const crop = [value.cropX, value.cropY, value.cropWidth, value.cropHeight];
  if (crop.some((part) => part !== null)) {
    const [x, y, width, height] = crop;
    if (x === null || y === null || width === null || height === null) {
      errors.push('Recadrage : renseignez x, y, largeur et hauteur.');
    } else if (!isIntegerIn(x, 0, Number.MAX_SAFE_INTEGER) || !isIntegerIn(y, 0, Number.MAX_SAFE_INTEGER) || !isIntegerIn(width, 1, Number.MAX_SAFE_INTEGER) || !isIntegerIn(height, 1, Number.MAX_SAFE_INTEGER)) {
      errors.push('Recadrage : x et y entiers ≥ 0, largeur et hauteur entiers ≥ 1.');
    } else {
      body.crop = { x, y, width, height };
    }
  }

  const text = value.watermarkText.trim();
  if (text !== '') {
    if (graphemeCount(text) > WATERMARK_MAX_LENGTH) {
      errors.push(`Filigrane : ${String(WATERMARK_MAX_LENGTH)} caractères au plus.`);
    } else if (value.watermarkOpacity !== null && !(value.watermarkOpacity >= 0.1 && value.watermarkOpacity <= 1)) {
      errors.push("Filigrane : l'opacité doit être comprise entre 0,1 et 1.");
    } else {
      body.watermark = {
        text,
        ...(value.watermarkPosition === '' ? {} : { position: value.watermarkPosition }),
        ...(value.watermarkOpacity === null ? {} : { opacity: value.watermarkOpacity }),
      };
    }
  } else if (value.watermarkOpacity !== null || value.watermarkPosition !== '') {
    errors.push("Filigrane : saisissez un texte (la position et l'opacité s'appliquent à lui).");
  }

  if (value.format !== '') body.format = value.format;
  if (value.quality !== null) {
    if (isIntegerIn(value.quality, 1, 100)) body.quality = value.quality;
    else errors.push('Qualité : un entier entre 1 et 100.');
  }

  if (errors.length === 0 && Object.keys(body).length === 0) {
    errors.push('Choisissez au moins une transformation.');
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, body };
}

/**
 * Erreurs métier typées liées aux images.
 *
 * Couche : domaine. Des valeurs (pas des exceptions) renvoyées dans un `Result` ; le champ
 * `kind` permet de les traduire en codes HTTP en un seul endroit, côté infrastructure.
 */

/** Le fichier dépasse le poids maximal autorisé. */
export class FileTooLargeError {
  readonly kind = "FileTooLarge" as const;

  constructor(public readonly maxBytes: number) {}
}

/** Le fichier est vide (0 octet). */
export class EmptyFileError {
  readonly kind = "EmptyFile" as const;
}

/** Le contenu réel du fichier n'est ni du JPEG, ni du PNG, ni du WebP. */
export class UnsupportedImageFormatError {
  readonly kind = "UnsupportedImageFormat" as const;
}

/**
 * Une des dimensions de l'image dépasse le maximum autorisé.
 *
 * Traduite en 413 (et non 400) : la requête est bien formée, mais la ressource dépasse
 * une limite de taille, ici exprimée en pixels, exactement comme pour le poids.
 */
export class ImageDimensionsTooLargeError {
  readonly kind = "ImageDimensionsTooLarge" as const;

  constructor(public readonly maxSide: number) {}
}

/** Le fichier a l'en-tête d'une image mais son contenu est illisible ou incohérent. */
export class CorruptedImageError {
  readonly kind = "CorruptedImage" as const;

  constructor(public readonly reason: string) {}
}

/**
 * Image introuvable POUR CET UTILISATEUR.
 *
 * Volontairement identique pour « n'existe pas » et « appartient à quelqu'un d'autre » :
 * répondre 403 révélerait qu'une image existe. Traduite en 404 dans les deux cas.
 */
export class ImageNotFoundError {
  readonly kind = "ImageNotFound" as const;
}

/** Les paramètres de pagination (page, limite) sont hors bornes. */
export class InvalidPaginationError {
  readonly kind = "InvalidPagination" as const;

  constructor(public readonly reason: string) {}
}

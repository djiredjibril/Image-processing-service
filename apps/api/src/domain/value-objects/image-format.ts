/**
 * Value Object représentant un format d'image accepté.
 *
 * Couche : domaine.
 */

/** Noms des formats acceptés en phase 1. */
export type ImageFormatName = "jpeg" | "png" | "webp";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Vrai si `bytes` commence par `signature` à la position `offset`. */
function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((value, index) => bytes[offset + index] === value);
}

/**
 * Format d'image accepté (JPEG, PNG ou WebP).
 *
 * Invariants : seules trois instances existent (constructeur privé). Le format est déduit
 * du CONTENU du fichier (magic bytes), jamais de son extension ni de son `Content-Type`,
 * qui sont librement falsifiables par le client.
 */
export class ImageFormat {
  static readonly JPEG = new ImageFormat("jpeg", "jpg", "image/jpeg");
  static readonly PNG = new ImageFormat("png", "png", "image/png");
  static readonly WEBP = new ImageFormat("webp", "webp", "image/webp");

  private constructor(
    public readonly name: ImageFormatName,
    public readonly extension: string,
    public readonly mimeType: string,
  ) {}

  /**
   * Détecte le format réel à partir des premiers octets du fichier.
   *
   * Signatures : JPEG `FF D8 FF` ; PNG `89 50 4E 47 0D 0A 1A 0A` ; WebP `RIFF....WEBP`.
   *
   * @param bytes - Contenu (ou début du contenu) du fichier.
   * @returns Le format, ou `null` si la signature n'est pas reconnue.
   */
  static fromMagicBytes(bytes: Uint8Array): ImageFormat | null {
    if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
      return ImageFormat.JPEG;
    }
    if (startsWith(bytes, PNG_SIGNATURE)) {
      return ImageFormat.PNG;
    }
    // WebP : "RIFF" (octets 0-3), taille (4-7), puis "WEBP" (octets 8-11).
    if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
      return ImageFormat.WEBP;
    }
    return null;
  }

  /**
   * Retrouve un format à partir de son nom (ex. valeur relue depuis la base).
   *
   * @param name - Nom du format.
   * @returns Le format, ou `null` si le nom est inconnu.
   */
  static fromName(name: string): ImageFormat | null {
    return [ImageFormat.JPEG, ImageFormat.PNG, ImageFormat.WEBP].find((format) => format.name === name) ?? null;
  }
}

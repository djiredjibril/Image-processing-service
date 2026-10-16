/**
 * Lecture complète d'un flux en mémoire.
 *
 * Couche : application (partagé). À réserver aux fichiers de taille bornée (ici <= `MAX_UPLOAD_BYTES`) :
 * un traitement d'image a besoin de l'image entière.
 */

/**
 * Lit un flux jusqu'à la fin.
 *
 * @param stream - Flux de lecture (ex. renvoyé par `IFileStorage.get`).
 * @returns Le contenu complet.
 */
export async function readAll(stream: NodeJS.ReadableStream): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : (chunk as Uint8Array);
    chunks.push(bytes);
    total += bytes.byteLength;
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

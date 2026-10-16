/**
 * Fonctions pures de la page de supervision : formats lisibles, historique, débit, tracé du graphique.
 *
 * Rôle : tout ce qui se calcule sans Angular, pour le tester simplement.
 */
import { TransformBody } from '../images/transform.models';
import { QueueCounts } from './monitoring.models';

/** Un point de l'historique : l'instant, et l'état de la file à cet instant. */
export interface Sample {
  /** Instant du relevé (millisecondes depuis 1970). */
  readonly at: number;
  readonly counts: QueueCounts;
}

/** Nombre maximal de points conservés (1 relevé par seconde : une minute d'historique). */
export const HISTORY_SIZE = 60;

/**
 * Formate une taille en octets (« 2,5 Mo »).
 *
 * @param bytes - Taille en octets, ou `null` si inconnue.
 * @returns Le texte lisible, ou « – » si la valeur est inconnue.
 */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '–';
  const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const text = unit === 0 ? String(Math.round(value)) : value.toFixed(1).replace('.', ',');
  return `${text} ${units[unit] ?? 'o'}`;
}

/**
 * Formate une durée en secondes (« 3 h 05 min », « 12 min », « 45 s »).
 *
 * @param seconds - Durée en secondes, ou `null` si inconnue.
 * @returns Le texte lisible, ou « – » si la valeur est inconnue.
 */
export function formatUptime(seconds: number | null): string {
  if (seconds === null) return '–';
  if (seconds < 60) return `${String(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = String(minutes % 60).padStart(2, '0');
  if (hours < 24) return `${String(hours)} h ${rest} min`;
  return `${String(Math.floor(hours / 24))} j ${String(hours % 24)} h`;
}

/**
 * Part des réponses servies par le cache parmi les transformations.
 *
 * @param hits - Réponses servies par le cache.
 * @param misses - Calculs réels.
 * @returns Le pourcentage (0 à 100, arrondi), ou `null` s'il n'y a encore aucune transformation.
 */
export function hitRatioPercent(hits: number, misses: number): number | null {
  const total = hits + misses;
  return total === 0 ? null : Math.round((hits / total) * 100);
}

/**
 * Ajoute un relevé à l'historique en gardant les `max` plus récents.
 *
 * @param history - Historique actuel (non modifié).
 * @param sample - Nouveau relevé.
 * @param max - Taille maximale.
 * @returns Un nouvel historique.
 */
export function pushSample(history: readonly Sample[], sample: Sample, max: number = HISTORY_SIZE): readonly Sample[] {
  return [...history, sample].slice(-max);
}

/**
 * Débit de traitement : jobs terminés par seconde entre deux relevés.
 *
 * @param previous - Relevé précédent, ou `null`.
 * @param current - Relevé courant.
 * @returns Jobs terminés par seconde (≥ 0), ou `null` s'il n'y a pas de relevé précédent ou si le temps n'a pas avancé.
 * Un compteur qui diminue (file purgée ou Redis vidé) donne 0 et non un débit négatif.
 */
export function throughputPerSecond(previous: Sample | null, current: Sample): number | null {
  if (previous === null || current.at <= previous.at) return null;
  const delta = Math.max(0, current.counts.completed + current.counts.failed - (previous.counts.completed + previous.counts.failed));
  return delta / ((current.at - previous.at) / 1000);
}

/**
 * Calcule les points d'une courbe pour un graphique SVG.
 *
 * @param values - Valeurs à tracer, dans l'ordre chronologique.
 * @param width - Largeur du graphique.
 * @param height - Hauteur du graphique.
 * @param minimumMax - Valeur maximale minimale de l'échelle (évite qu'un 1 s'affiche comme un pic plein hauteur).
 * @returns La chaîne `x,y x,y ...` de l'attribut `points` d'une `<polyline>` (vide s'il y a moins de 2 valeurs). Les valeurs vont de bas (0) en haut (max).
 */
export function sparklinePoints(values: readonly number[], width: number, height: number, minimumMax = 5): string {
  if (values.length < 2) return '';
  const max = Math.max(minimumMax, ...values);
  const step = width / (values.length - 1);
  return values
    .map((value, index) => `${(index * step).toFixed(1)},${(height - (value / max) * height).toFixed(1)}`)
    .join(' ');
}

/**
 * Fabrique les paramètres d'une transformation « de démonstration », différents à chaque appel.
 *
 * Pourquoi différents : une transformation identique serait servie par le cache sans travail, et la file ne montrerait rien. Rotation (1 à 359°),
 * largeur (200 à 1000 px) et format WebP donnent plus de 600 combinaisons.
 *
 * @param random - Source d'aléa dans [0, 1[ (injectable pour les tests).
 * @returns Le corps de la requête.
 */
export function randomLoadBody(random: () => number = Math.random): TransformBody {
  return {
    rotate: 1 + Math.floor(random() * 359),
    resize: { width: 200 + Math.floor(random() * 801) },
    format: 'webp',
  };
}

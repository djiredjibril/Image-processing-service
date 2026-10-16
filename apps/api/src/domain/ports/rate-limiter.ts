/**
 * Port `IRateLimiter` : limitation du nombre de requêtes par fenêtre de temps.
 *
 * Couche : domaine (port). Implémentation : `RedisRateLimiter` ; fake en mémoire pour les tests.
 */

/** Règle de limitation : au plus `limit` requêtes par fenêtre de `windowSeconds` secondes. */
export interface RateLimitPolicy {
  /** Nombre maximal de requêtes acceptées par fenêtre (entier >= 1). */
  readonly limit: number;
  /** Durée de la fenêtre, en secondes (entier >= 1). */
  readonly windowSeconds: number;
}

/** Résultat de la consommation d'un « jeton » de requête. */
export interface RateLimitDecision {
  /** `true` si la requête est acceptée, `false` si la limite est dépassée. */
  readonly allowed: boolean;
  /** Limite de la règle appliquée. */
  readonly limit: number;
  /** Requêtes encore acceptées dans la fenêtre courante (0 si dépassée). */
  readonly remaining: number;
  /** Secondes avant la réinitialisation de la fenêtre (au moins 1). */
  readonly resetSeconds: number;
}

/**
 * Contrat d'un limiteur de débit : chaque appel à `consume` compte UNE requête pour une clé donnée.
 *
 * Fenêtre fixe : le compteur démarre à la première requête et se remet à zéro à la fin de la fenêtre.
 * Le comptage est atomique : des requêtes simultanées ne peuvent pas « rater » le compte.
 *
 * Un limiteur est une PROTECTION, pas une fonction vitale : toute implémentation est « fail-open ».
 * Si son stockage est indisponible, `consume` ne lève jamais d'erreur et renvoie `null` (« pas de
 * décision »), et l'appelant laisse passer la requête.
 */
export interface IRateLimiter {
  /**
   * Compte une requête.
   *
   * @param key - Identité limitée, ex. `transform:<userId>` ou `auth:<ip>`.
   * @param policy - Règle à appliquer.
   * @returns La décision, ou `null` si le limiteur est indisponible (la requête doit alors passer).
   */
  consume(key: string, policy: RateLimitPolicy): Promise<RateLimitDecision | null>;
}

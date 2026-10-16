/**
 * Port `ITransformCache` : cache des transformations d'images.
 *
 * Couche : domaine (port). Implémentation : `RedisTransformCache` ; fakes en mémoire pour les tests.
 */
import type { TransformCacheKey } from "../value-objects/transform-cache-key.js";

/** Verrou obtenu sur une clé : son détenteur est seul à calculer cette transformation. */
export interface CacheLock {
  /**
   * Libère le verrou. Sans effet si on n'en est plus le détenteur (verrou expiré puis repris par un autre).
   * Ne lève jamais d'erreur.
   */
  release(): Promise<void>;
}

/**
 * Contrat du cache des transformations : il associe une clé de transformation à l'identifiant de l'image
 * dérivée déjà produite.
 *
 * Un cache est une OPTIMISATION : toute implémentation est « fail-open ». Si le stockage du cache est
 * indisponible, aucune méthode ne lève d'erreur et l'appelant continue comme si le cache était vide : `get`
 * renvoie `null`, `set` ne fait rien, `acquireLock` accorde un verrou sans effet, `waitFor` renvoie `null`.
 */
export interface ITransformCache {
  /**
   * Cherche l'image dérivée associée à une clé.
   *
   * @param key - Clé de la transformation.
   * @returns L'identifiant de l'image dérivée, ou `null` si la clé est absente ou le cache indisponible.
   */
  get(key: TransformCacheKey): Promise<string | null>;

  /**
   * Associe une clé à une image dérivée, pour une durée limitée.
   *
   * @param key - Clé de la transformation.
   * @param derivedImageId - Identifiant de l'image dérivée (déjà enregistrée en base).
   */
  set(key: TransformCacheKey, derivedImageId: string): Promise<void>;

  /**
   * Tente de devenir le seul à calculer cette transformation (« single-flight »), pour éviter que deux
   * requêtes identiques simultanées produisent chacune un dérivé (« cache stampede »).
   *
   * @param key - Clé de la transformation.
   * @returns Un verrou si on l'obtient, ou `null` si une autre requête le détient déjà. Le verrou expire
   * tout seul au bout d'un délai, pour ne jamais bloquer si son détenteur plante.
   */
  acquireLock(key: TransformCacheKey): Promise<CacheLock | null>;

  /**
   * Attend le résultat d'une requête identique en cours.
   *
   * @param key - Clé de la transformation.
   * @param timeoutMs - Durée maximale d'attente.
   * @returns L'identifiant du dérivé dès qu'il est disponible, ou `null` si le délai est dépassé ou si le
   * détenteur du verrou a abandonné sans produire de résultat.
   */
  waitFor(key: TransformCacheKey, timeoutMs: number): Promise<string | null>;
}

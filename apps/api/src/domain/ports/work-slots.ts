/**
 * Port `IWorkSlots` : plafond de travaux lourds simultanés dans un process.
 *
 * Couche : domaine (port). Implémentation : `LocalWorkSlots` (compteur en mémoire).
 */

/** Une place obtenue : à rendre avec `release()` quand le travail est fini (qu'il ait réussi ou échoué). */
export interface WorkSlot {
  /** Rend la place. Sans effet si elle a déjà été rendue. Ne lève jamais d'erreur. */
  release(): void;
}

/**
 * Contrat d'un plafond de concurrence.
 *
 * Pourquoi : une transformation d'image peut occuper ~1 Go de RAM. Le rate limiting borne le NOMBRE de requêtes par minute, pas
 * combien de traitements tournent EN MÊME TEMPS. Le plafond ne s'applique qu'au travail coûteux (calculer un dérivé), jamais aux
 * requêtes bon marché (réponse servie par le cache) : sinon une rafale de lectures de cache serait refusée à tort.
 */
export interface IWorkSlots {
  /**
   * Tente de prendre une place, sans attendre.
   *
   * @returns La place, ou `null` si le plafond est atteint (l'appelant refuse le travail plutôt que de le mettre en attente :
   * une file en mémoire garderait les requêtes ouvertes et la RAM occupée).
   */
  tryAcquire(): WorkSlot | null;
}

/** Plafond « sans limite » : pour les contextes où la concurrence est déjà bornée ailleurs (ex. la concurrence du worker BullMQ). */
export const UNLIMITED_WORK_SLOTS: IWorkSlots = {
  tryAcquire: () => ({ release: () => undefined }),
};

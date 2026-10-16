/**
 * Erreurs métier typées liées aux jobs de transformation asynchrone.
 *
 * Couche : domaine. Des valeurs (pas des exceptions) renvoyées dans un `Result`.
 */

/** Le job n'existe pas (ou n'appartient pas à l'appelant : même erreur, pour ne rien révéler). */
export class JobNotFoundError {
  readonly kind = "JobNotFound" as const;
}

/** Une transition d'état interdite a été demandée (ex. terminer un job déjà échoué). */
export class InvalidJobTransitionError {
  readonly kind = "InvalidJobTransition" as const;

  constructor(
    public readonly from: string,
    public readonly to: string,
  ) {}
}

/** La file d'attente est injoignable : le job n'a pas pu être mis en file. */
export class QueueUnavailableError {
  readonly kind = "QueueUnavailable" as const;
}

/**
 * Ré-export du type `Result` défini dans le domaine.
 *
 * Couche : application (partagé). Conserve le chemin `application/shared/result` pour les
 * use cases tout en respectant le sens des dépendances (application → domaine).
 */
export * from "../../domain/shared/result.js";

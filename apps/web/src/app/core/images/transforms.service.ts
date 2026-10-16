/**
 * Service des transformations d'images : synchrones, asynchrones (jobs) et lien temporaire.
 *
 * Rôle : seul endroit qui connaît les routes `/images/:id/transform`, `/images/:id/jobs`, `/jobs/:id` et `/images/:id/url`.
 * L'authentification est ajoutée par l'intercepteur.
 */
import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { exhaustMap, map, Observable, take, takeWhile, timer } from 'rxjs';
import { API_BASE_URL } from '../api-config';
import { ImageSummary } from './image.models';
import { isFinalStatus, JobSummary, PresignedUrl, TransformBody, TransformResult } from './transform.models';

/** Intervalle entre deux interrogations d'un job, en millisecondes. */
export const POLL_INTERVAL_MS = 1000;
/** Nombre maximal d'interrogations avant d'abandonner l'attente (2 minutes à 1 s) ; le job continue côté serveur. */
export const MAX_POLLS = 120;

/** Appels HTTP vers les routes de transformation (toutes protégées par jeton). */
@Injectable({ providedIn: 'root' })
export class TransformsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /**
   * Transforme une image PENDANT la requête (synchrone) et renvoie le dérivé.
   *
   * @param imageId - Image source.
   * @param body - Transformations demandées.
   * @returns Le dérivé ; `cached` vaut `true` si l'API répond 200 (déjà produit, aucun recalcul). Erreurs : 400, 401, 404, 429, 503.
   */
  transform(imageId: string, body: TransformBody): Observable<TransformResult> {
    return this.http
      .post<ImageSummary>(`${this.baseUrl}/images/${encodeURIComponent(imageId)}/transform`, body, { observe: 'response' })
      .pipe(
        map((response) => {
          if (response.body === null) throw new Error('Réponse vide de la transformation');
          return { image: response.body, cached: response.status === 200 };
        }),
      );
  }

  /**
   * Crée un job de transformation traité en arrière-plan (réponse 202 immédiate).
   *
   * @param imageId - Image source.
   * @param body - Transformations demandées.
   * @returns Le job `queued`. Erreurs : 400, 401, 404, 429, 503 (file injoignable).
   */
  createJob(imageId: string, body: TransformBody): Observable<JobSummary> {
    return this.http.post<JobSummary>(`${this.baseUrl}/images/${encodeURIComponent(imageId)}/jobs`, body);
  }

  /**
   * Lit le statut d'un job.
   *
   * @param jobId - Identifiant du job.
   * @returns Le statut. Erreurs : 401, 404 (inconnu ou d'un autre utilisateur).
   */
  getJob(jobId: string): Observable<JobSummary> {
    return this.http.get<JobSummary>(`${this.baseUrl}/jobs/${encodeURIComponent(jobId)}`);
  }

  /**
   * Suit un job jusqu'à son terme (« polling »).
   *
   * Émet chaque statut lu (la première lecture est immédiate), puis s'arrête après le statut final (`completed` ou `failed`)
   * ou après `maxPolls` lectures. Se désabonner arrête aussi les requêtes.
   *
   * @param jobId - Identifiant du job.
   * @param intervalMs - Délai entre deux lectures.
   * @param maxPolls - Nombre maximal de lectures.
   * @returns Un flux de statuts, dont le dernier est final sauf si l'attente a été abandonnée.
   */
  pollJob(jobId: string, intervalMs = POLL_INTERVAL_MS, maxPolls = MAX_POLLS): Observable<JobSummary> {
    return timer(0, intervalMs).pipe(
      take(maxPolls),
      // exhaustMap : si une réponse tarde, on n'empile pas de nouvelles requêtes (switchMap les annulerait en boucle).
      exhaustMap(() => this.getJob(jobId)),
      takeWhile((job) => !isFinalStatus(job.status), true),
    );
  }

  /**
   * Demande une URL signée et temporaire pour télécharger l'image directement depuis le stockage S3.
   *
   * @param imageId - Image concernée.
   * @returns L'URL et son expiration. Erreurs : 401, 404, 501 (stockage sur disque : pas d'URL signée).
   */
  getTemporaryUrl(imageId: string): Observable<PresignedUrl> {
    return this.http.get<PresignedUrl>(`${this.baseUrl}/images/${encodeURIComponent(imageId)}/url`);
  }
}

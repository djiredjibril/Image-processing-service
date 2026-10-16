/**
 * Service de supervision : lecture de `GET /monitoring/overview` et surveillance en continu.
 *
 * Rôle : seul endroit qui connaît la route de supervision. L'authentification est ajoutée par l'intercepteur.
 */
import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, exhaustMap, map, Observable, of, timer } from 'rxjs';
import { describeApiError } from '../api-error';
import { API_BASE_URL } from '../api-config';
import { MonitoringOverview, MonitoringReading } from './monitoring.models';

/** Intervalle entre deux relevés, en millisecondes. */
export const MONITORING_INTERVAL_MS = 1000;

/** Accès à la supervision. */
@Injectable({ providedIn: 'root' })
export class MonitoringService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /**
   * Lit une photographie du système.
   *
   * @returns Redis, la file, les compteurs et les jobs de l'utilisateur. Erreurs : 401, 429.
   */
  getOverview(): Observable<MonitoringOverview> {
    return this.http.get<MonitoringOverview>(`${this.baseUrl}/monitoring/overview`);
  }

  /**
   * Surveille le système : un relevé immédiat, puis un par intervalle, sans jamais s'arrêter sur une erreur.
   *
   * Une erreur (API arrêtée, quota dépassé) devient un relevé `{ ok: false, message }` et la surveillance continue : la page peut afficher la panne
   * puis se rétablir seule. `exhaustMap` : si une réponse tarde, on n'empile pas de requêtes. Se désabonner arrête tout.
   *
   * @param intervalMs - Délai entre deux relevés.
   * @returns Un flux de relevés.
   */
  watch(intervalMs: number = MONITORING_INTERVAL_MS): Observable<MonitoringReading> {
    return timer(0, intervalMs).pipe(
      exhaustMap(() =>
        this.getOverview().pipe(
          map((overview): MonitoringReading => ({ ok: true, overview })),
          catchError((error: unknown) => of<MonitoringReading>({ ok: false, message: describeApiError(error) })),
        ),
      ),
    );
  }
}

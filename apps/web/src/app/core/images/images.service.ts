/**
 * Service d'accès aux images de l'API : liste, envoi, téléchargement.
 *
 * Rôle : seul endroit qui connaît les routes `/images`. L'authentification est ajoutée par l'intercepteur.
 */
import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../api-config';
import { ImagePage, ImageSummary } from './image.models';

/** Appels HTTP vers les routes d'images (toutes protégées par jeton). */
@Injectable({ providedIn: 'root' })
export class ImagesService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /**
   * Liste les images de l'utilisateur, la plus récente d'abord.
   *
   * @param page - Numéro de page, à partir de 1.
   * @param limit - Taille de page (1 à 50).
   * @returns La page demandée avec le total.
   */
  list(page: number, limit: number): Observable<ImagePage> {
    return this.http.get<ImagePage>(`${this.baseUrl}/images`, { params: { page, limit } });
  }

  /**
   * Envoie une image (multipart, champ `image`).
   *
   * @param file - Fichier choisi. Son nom n'est jamais utilisé par l'API pour stocker.
   * @returns Les métadonnées de l'image créée. Erreurs : 400, 401, 413 (poids/dimensions), 415 (format).
   */
  upload(file: File): Observable<ImageSummary> {
    const body = new FormData();
    body.append('image', file);
    return this.http.post<ImageSummary>(`${this.baseUrl}/images`, body);
  }

  /**
   * Télécharge le fichier d'une image.
   *
   * Pourquoi en blob : une balise `<img src>` ne peut pas envoyer l'en-tête `Authorization`.
   * On télécharge donc le fichier avec `HttpClient` (qui ajoute le jeton), puis on l'affiche
   * via une URL objet locale.
   *
   * @param id - Identifiant de l'image.
   * @returns Le contenu binaire. Erreurs : 401, 404 (inconnue ou appartenant à un autre utilisateur).
   */
  download(id: string): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/images/${encodeURIComponent(id)}`, { responseType: 'blob' });
  }
}

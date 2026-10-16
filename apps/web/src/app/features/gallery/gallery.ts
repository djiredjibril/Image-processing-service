/**
 * Page galerie : liste paginée des images de l'utilisateur.
 */
import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { describeApiError } from '../../core/api-error';
import { ImagePage } from '../../core/images/image.models';
import { ImagesService } from '../../core/images/images.service';
import { AuthedImage } from '../../shared/authed-image';

/** Taille de page de la galerie (l'API accepte de 1 à 50). */
export const GALLERY_PAGE_SIZE = 12;

/** Grille de miniatures avec navigation précédent/suivant. */
@Component({
  selector: 'app-gallery',
  imports: [RouterLink, DatePipe, AuthedImage],
  template: `
    <div class="mb-6 flex items-center justify-between">
      <h1 class="text-2xl font-semibold">Mes images</h1>
      <a routerLink="/images/new" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">Envoyer une image</a>
    </div>

    @if (error(); as message) {
      <p role="alert" class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{{ message }}</p>
    } @else if (data(); as result) {
      @if (result.total === 0) {
        <div class="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-600">
          Aucune image pour l'instant.
          <a routerLink="/images/new" class="text-indigo-600 hover:underline">Envoyez votre première image.</a>
        </div>
      } @else {
        <ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          @for (item of result.items; track item.id) {
            <li>
              <a [routerLink]="['/images', item.id]" class="group block overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm hover:shadow-md">
                <div class="aspect-square overflow-hidden bg-slate-100">
                  <app-authed-image [imageId]="item.id" [alt]="'Image ' + item.format" imgClass="h-full w-full object-cover transition group-hover:scale-105" class="h-full w-full" />
                </div>
                <div class="px-3 py-2 text-xs text-slate-600">
                  <div class="font-medium uppercase">
                    {{ item.format }} · {{ item.width }}×{{ item.height }}
                    @if (item.originalId !== null) { <span class="ml-1 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold normal-case text-indigo-700">dérivée</span> }
                  </div>
                  <div>{{ item.createdAt | date: 'dd/MM/yyyy HH:mm' }}</div>
                </div>
              </a>
            </li>
          }
        </ul>
        <nav class="mt-6 flex items-center justify-between text-sm" aria-label="Pagination">
          <button type="button" (click)="goTo(result.page - 1)" [disabled]="result.page <= 1 || loading()"
                  class="rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">Précédent</button>
          <span class="text-slate-600">Page {{ result.page }} / {{ totalPages() }} · {{ result.total }} image(s)</span>
          <button type="button" (click)="goTo(result.page + 1)" [disabled]="result.page >= totalPages() || loading()"
                  class="rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">Suivant</button>
        </nav>
      }
    } @else {
      <p class="text-slate-500">Chargement…</p>
    }
  `,
})
export class Gallery {
  private readonly images = inject(ImagesService);

  protected readonly data = signal<ImagePage | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Nombre de pages (au moins 1), déduit du total renvoyé par l'API. */
  protected readonly totalPages = computed(() => {
    const page = this.data();
    return page === null ? 1 : Math.max(1, Math.ceil(page.total / page.limit));
  });

  constructor() {
    this.goTo(1);
  }

  /**
   * Charge une page. Ignore les numéros hors bornes (déjà désactivés côté boutons).
   *
   * @param page - Numéro de page, à partir de 1.
   */
  protected goTo(page: number): void {
    if (page < 1) {
      return;
    }
    this.loading.set(true);
    this.images.list(page, GALLERY_PAGE_SIZE).subscribe({
      next: (result) => {
        this.data.set(result);
        this.error.set(null);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(describeApiError(error));
        this.loading.set(false);
      },
    });
  }
}

/**
 * Page de visualisation d'une image.
 */
import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthedImage } from '../../shared/authed-image';

/** Affiche une image en grand. L'identifiant vient de la route (`/images/:id`). */
@Component({
  selector: 'app-image-detail',
  imports: [RouterLink, AuthedImage],
  template: `
    <a routerLink="/images" class="mb-4 inline-block text-sm text-indigo-600 hover:underline">← Retour à la galerie</a>
    <div class="overflow-hidden rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
      <div class="flex min-h-48 items-center justify-center">
        <app-authed-image [imageId]="id()" alt="Image" imgClass="max-h-[75vh] w-auto max-w-full rounded-lg" />
      </div>
    </div>
    <p class="mt-3 break-all text-xs text-slate-500">Identifiant : {{ id() }}</p>
  `,
})
export class ImageDetail {
  /** Identifiant de l'image, injecté depuis le paramètre de route `:id`. */
  readonly id = input.required<string>();
}

/**
 * Panneau de transformation d'une image : formulaire, exécution synchrone ou en arrière-plan, résultats.
 */
import { Component, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { describeApiError } from '../../core/api-error';
import { ImageSummary } from '../../core/images/image.models';
import { buildTransformBody } from '../../core/images/transform-body';
import {
  FILTERS,
  Filter,
  JobStatus,
  OUTPUT_FORMATS,
  OutputFormat,
  RESIZE_FITS,
  ResizeFit,
  TransformBody,
  WATERMARK_POSITIONS,
  WatermarkPosition,
} from '../../core/images/transform.models';
import { TransformsService } from '../../core/images/transforms.service';
import { AuthedImage } from '../../shared/authed-image';

/** Une ligne de la liste des résultats : une transformation en cours, réussie ou échouée. */
interface Entry {
  readonly key: number;
  readonly state: 'working' | 'done' | 'failed';
  /** Texte d'état (« En file d'attente… », « Déjà produite : aucun recalcul », message d'erreur...). */
  readonly message: string;
  readonly image: ImageSummary | null;
}

/** Libellés lisibles des états d'un job. */
const JOB_MESSAGES: Readonly<Record<JobStatus, string>> = {
  queued: "En file d'attente…",
  processing: 'Traitement en cours…',
  completed: 'Terminé',
  failed: 'Échec',
};

/** Classes communes des champs de saisie. */
const FIELD = 'w-full rounded-md border border-slate-300 px-2 py-1.5';

/**
 * Formulaire de transformation.
 *
 * Deux modes : synchrone (la requête attend le résultat) ou « en arrière-plan » (l'API répond tout de suite 202 et un worker traite l'image ;
 * le panneau interroge le statut toutes les secondes). Les paramètres sont validés ici avec les mêmes bornes que l'API pour éviter un aller-retour inutile.
 */
@Component({
  selector: 'app-transform-panel',
  imports: [ReactiveFormsModule, RouterLink, AuthedImage],
  template: `
    <section class="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="transform-title">
      <h2 id="transform-title" class="mb-1 text-lg font-semibold">Transformer cette image</h2>
      <p class="mb-4 text-sm text-slate-600">L'original n'est jamais modifié : chaque transformation crée une nouvelle image.</p>

      <form [formGroup]="form" (ngSubmit)="submit()" class="space-y-4" novalidate>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <fieldset class="space-y-2">
            <legend class="text-sm font-medium">Orientation</legend>
            <label class="block text-xs text-slate-600" for="rotate">Rotation (°, -360 à 360)</label>
            <input id="rotate" type="number" formControlName="rotate" [class]="field" />
            <label class="flex items-center gap-2 text-sm"><input type="checkbox" formControlName="flip" /> Retourner (vertical)</label>
            <label class="flex items-center gap-2 text-sm"><input type="checkbox" formControlName="mirror" /> Miroir (horizontal)</label>
          </fieldset>

          <fieldset class="space-y-2">
            <legend class="text-sm font-medium">Redimensionner</legend>
            <div class="flex gap-2">
              <div class="flex-1">
                <label class="block text-xs text-slate-600" for="resizeWidth">Largeur (px)</label>
                <input id="resizeWidth" type="number" formControlName="resizeWidth" [class]="field" />
              </div>
              <div class="flex-1">
                <label class="block text-xs text-slate-600" for="resizeHeight">Hauteur (px)</label>
                <input id="resizeHeight" type="number" formControlName="resizeHeight" [class]="field" />
              </div>
            </div>
            <label class="block text-xs text-slate-600" for="resizeFit">Ajustement</label>
            <select id="resizeFit" formControlName="resizeFit" [class]="field">
              <option value="">Par défaut (inside)</option>
              @for (fit of fits; track fit) {
                <option [value]="fit">{{ fit }}</option>
              }
            </select>
          </fieldset>

          <fieldset class="space-y-2">
            <legend class="text-sm font-medium">Couleur et sortie</legend>
            <label class="block text-xs text-slate-600" for="filter">Filtre</label>
            <select id="filter" formControlName="filter" [class]="field">
              <option value="">Aucun</option>
              @for (filter of filters; track filter) {
                <option [value]="filter">{{ filter }}</option>
              }
            </select>
            <label class="block text-xs text-slate-600" for="format">Format</label>
            <select id="format" formControlName="format" [class]="field">
              <option value="">Inchangé</option>
              @for (format of formats; track format) {
                <option [value]="format">{{ format }}</option>
              }
            </select>
            <label class="block text-xs text-slate-600" for="quality">Qualité (1-100, jpeg et webp)</label>
            <input id="quality" type="number" formControlName="quality" [class]="field" />
          </fieldset>

          <fieldset class="space-y-2">
            <legend class="text-sm font-medium">Recadrer (pixels de l'image source)</legend>
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="block text-xs text-slate-600" for="cropX">x</label>
                <input id="cropX" type="number" formControlName="cropX" [class]="field" />
              </div>
              <div>
                <label class="block text-xs text-slate-600" for="cropY">y</label>
                <input id="cropY" type="number" formControlName="cropY" [class]="field" />
              </div>
              <div>
                <label class="block text-xs text-slate-600" for="cropWidth">Largeur</label>
                <input id="cropWidth" type="number" formControlName="cropWidth" [class]="field" />
              </div>
              <div>
                <label class="block text-xs text-slate-600" for="cropHeight">Hauteur</label>
                <input id="cropHeight" type="number" formControlName="cropHeight" [class]="field" />
              </div>
            </div>
          </fieldset>

          <fieldset class="space-y-2 sm:col-span-2">
            <legend class="text-sm font-medium">Filigrane texte</legend>
            <div class="grid gap-2 sm:grid-cols-2">
              <div class="sm:col-span-2">
                <label class="block text-xs text-slate-600" for="watermarkText">Texte (30 caractères au plus)</label>
                <input id="watermarkText" type="text" formControlName="watermarkText" [class]="field" />
              </div>
              <div>
                <label class="block text-xs text-slate-600" for="watermarkPosition">Position</label>
                <select id="watermarkPosition" formControlName="watermarkPosition" [class]="field">
                  <option value="">Par défaut (bas droite)</option>
                  @for (position of positions; track position) {
                    <option [value]="position">{{ position }}</option>
                  }
                </select>
              </div>
              <div>
                <label class="block text-xs text-slate-600" for="watermarkOpacity">Opacité (0,1 à 1)</label>
                <input id="watermarkOpacity" type="number" step="0.1" formControlName="watermarkOpacity" [class]="field" />
              </div>
            </div>
          </fieldset>
        </div>

        <label class="flex items-start gap-2 text-sm">
          <input type="checkbox" formControlName="background" class="mt-1" />
          <span>
            Traiter en arrière-plan
            <span class="text-slate-500">(réponse immédiate, le résultat apparaît plus bas ; nécessite le worker)</span>
          </span>
        </label>

        @if (errors().length > 0) {
          <ul role="alert" class="space-y-1 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            @for (message of errors(); track message) {
              <li>{{ message }}</li>
            }
          </ul>
        }
        <div class="flex gap-3">
          <button type="submit" [disabled]="running()" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
            {{ running() ? 'Envoi…' : 'Appliquer' }}
          </button>
          <button type="button" (click)="reset()" class="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50">Réinitialiser</button>
        </div>
      </form>

      @if (entries().length > 0) {
        <h3 class="mt-6 mb-2 text-sm font-semibold">Résultats</h3>
        <ul class="space-y-2" aria-live="polite">
          @for (entry of entries(); track entry.key) {
            <li class="flex items-center gap-3 rounded-lg border border-slate-200 p-2" [attr.data-state]="entry.state">
              @if (entry.image; as image) {
                <a [routerLink]="['/images', image.id]" class="block h-16 w-16 shrink-0 overflow-hidden rounded bg-slate-100">
                  <app-authed-image [imageId]="image.id" alt="Résultat" imgClass="h-full w-full object-cover" class="h-full w-full" />
                </a>
              } @else if (entry.state === 'working') {
                <div class="h-16 w-16 shrink-0 animate-pulse rounded bg-slate-200" aria-hidden="true"></div>
              }
              <div class="min-w-0 text-sm">
                <div [class]="entry.state === 'failed' ? 'font-medium text-red-700' : 'font-medium'">{{ entry.message }}</div>
                @if (entry.image; as image) {
                  <a [routerLink]="['/images', image.id]" class="text-indigo-600 hover:underline">
                    Ouvrir le résultat ({{ image.format }} · {{ image.width }}×{{ image.height }})
                  </a>
                }
              </div>
            </li>
          }
        </ul>
      }
    </section>
  `,
})
export class TransformPanel {
  /** Identifiant de l'image source. */
  readonly imageId = input.required<string>();

  protected readonly field = FIELD;
  protected readonly fits: readonly ResizeFit[] = RESIZE_FITS;
  protected readonly filters: readonly Filter[] = FILTERS;
  protected readonly formats: readonly OutputFormat[] = OUTPUT_FORMATS;
  protected readonly positions: readonly WatermarkPosition[] = WATERMARK_POSITIONS;

  protected readonly form = new FormGroup({
    rotate: new FormControl<number | null>(null),
    flip: new FormControl(false, { nonNullable: true }),
    mirror: new FormControl(false, { nonNullable: true }),
    resizeWidth: new FormControl<number | null>(null),
    resizeHeight: new FormControl<number | null>(null),
    resizeFit: new FormControl<ResizeFit | ''>('', { nonNullable: true }),
    filter: new FormControl<Filter | ''>('', { nonNullable: true }),
    cropX: new FormControl<number | null>(null),
    cropY: new FormControl<number | null>(null),
    cropWidth: new FormControl<number | null>(null),
    cropHeight: new FormControl<number | null>(null),
    watermarkText: new FormControl('', { nonNullable: true }),
    watermarkPosition: new FormControl<WatermarkPosition | ''>('', { nonNullable: true }),
    watermarkOpacity: new FormControl<number | null>(null),
    format: new FormControl<OutputFormat | ''>('', { nonNullable: true }),
    quality: new FormControl<number | null>(null),
    background: new FormControl(false, { nonNullable: true }),
  });
  protected readonly errors = signal<readonly string[]>([]);
  protected readonly running = signal(false);
  protected readonly entries = signal<readonly Entry[]>([]);

  private readonly transforms = inject(TransformsService);
  private readonly destroyRef = inject(DestroyRef);
  private polls = new Subscription();
  private nextKey = 1;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.polls.unsubscribe();
    });
    // En passant d'une image à une autre (ex. ouvrir un résultat), on repart d'une liste vide et on arrête les suivis en cours.
    effect(() => {
      this.imageId();
      untracked(() => {
        this.polls.unsubscribe();
        this.polls = new Subscription();
        this.entries.set([]);
        this.errors.set([]);
      });
    });
  }

  /** Remet le formulaire à zéro. */
  protected reset(): void {
    this.form.reset();
    this.errors.set([]);
  }

  /** Valide le formulaire, puis lance la transformation (synchrone ou en arrière-plan selon la case cochée). */
  protected submit(): void {
    if (this.running()) return;
    const { background, ...fields } = this.form.getRawValue();
    const built = buildTransformBody(fields);
    if (!built.ok) {
      this.errors.set(built.errors);
      return;
    }
    this.errors.set([]);
    if (background) this.startJob(built.body);
    else this.startSync(built.body);
  }

  private startSync(body: TransformBody): void {
    this.running.set(true);
    this.transforms
      .transform(this.imageId(), body)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.running.set(false);
          this.add({
            state: 'done',
            message: result.cached ? 'Déjà produite : renvoyée sans recalcul' : 'Image créée',
            image: result.image,
          });
        },
        error: (error: unknown) => {
          this.running.set(false);
          this.errors.set([describeApiError(error)]);
        },
      });
  }

  private startJob(body: TransformBody): void {
    this.running.set(true);
    this.transforms
      .createJob(this.imageId(), body)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (job) => {
          this.running.set(false);
          const key = this.add({ state: 'working', message: JOB_MESSAGES[job.status], image: null });
          this.polls.add(
            this.transforms.pollJob(job.id).subscribe({
              next: (current) => {
                if (current.status === 'completed') this.update(key, { state: 'done', message: 'Terminé', image: current.image });
                else if (current.status === 'failed') this.update(key, { state: 'failed', message: current.error?.message ?? 'Échec', image: null });
                else this.update(key, { state: 'working', message: JOB_MESSAGES[current.status], image: null });
              },
              error: (error: unknown) => {
                this.update(key, { state: 'failed', message: describeApiError(error), image: null });
              },
              complete: () => {
                const last = this.entries().find((entry) => entry.key === key);
                if (last?.state === 'working') {
                  this.update(key, { state: 'working', message: `Toujours en cours : le traitement continue côté serveur (job ${job.id}).`, image: null });
                }
              },
            }),
          );
        },
        error: (error: unknown) => {
          this.running.set(false);
          this.errors.set([describeApiError(error)]);
        },
      });
  }

  private add(entry: Omit<Entry, 'key'>): number {
    const key = this.nextKey++;
    this.entries.update((entries) => [{ key, ...entry }, ...entries]);
    return key;
  }

  private update(key: number, changes: Omit<Entry, 'key'>): void {
    this.entries.update((entries) => entries.map((entry) => (entry.key === key ? { key, ...changes } : entry)));
  }
}

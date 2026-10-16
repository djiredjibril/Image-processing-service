/**
 * Page « Supervision » : Redis, file BullMQ, workers et compteurs d'activité en temps (quasi) réel.
 */
import { DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom, Subscription } from 'rxjs';
import { describeApiError } from '../../core/api-error';
import { ImageSummary } from '../../core/images/image.models';
import { ImagesService } from '../../core/images/images.service';
import { JobStatus } from '../../core/images/transform.models';
import { TransformsService } from '../../core/images/transforms.service';
import { MonitoringOverview } from '../../core/monitoring/monitoring.models';
import { MonitoringService } from '../../core/monitoring/monitoring.service';
import {
  formatBytes,
  formatUptime,
  hitRatioPercent,
  pushSample,
  randomLoadBody,
  Sample,
  sparklinePoints,
  throughputPerSecond,
} from '../../core/monitoring/monitoring-utils';

/** Largeur et hauteur du graphique SVG. */
const CHART_WIDTH = 300;
const CHART_HEIGHT = 80;

/** Couleurs des badges de statut d'un job. */
const BADGES: Readonly<Record<JobStatus, string>> = {
  queued: 'bg-amber-100 text-amber-800',
  processing: 'bg-sky-100 text-sky-800',
  completed: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-red-100 text-red-800',
};

/** Libellés des statuts. */
const LABELS: Readonly<Record<JobStatus, string>> = {
  queued: 'en file',
  processing: 'en cours',
  completed: 'terminé',
  failed: 'échec',
};

/**
 * Tableau de bord de supervision.
 *
 * Interroge `GET /monitoring/overview` chaque seconde (« polling ») ; la surveillance continue même si l'API répond en erreur, et peut être mise en pause.
 * Les chiffres de charge sont globaux ; la liste de jobs est celle de l'utilisateur connecté.
 */
@Component({
  selector: 'app-monitoring',
  imports: [DatePipe, FormsModule, RouterLink],
  template: `
    <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">Supervision</h1>
        <p class="text-sm text-slate-600">Redis, file BullMQ et workers, rafraîchis chaque seconde.</p>
      </div>
      <div class="flex items-center gap-3 text-sm">
        @if (overview(); as current) {
          <span class="text-slate-500">Mis à jour à {{ current.generatedAt | date: 'HH:mm:ss' }}</span>
        }
        <button type="button" (click)="togglePause()" class="rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50">
          {{ paused() ? 'Reprendre' : 'Pause' }}
        </button>
      </div>
    </div>

    @if (error(); as message) {
      <p role="alert" class="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">Lecture impossible : {{ message }} (nouvelle tentative chaque seconde)</p>
    }

    @if (overview(); as current) {
      <section class="mb-4 grid gap-3 sm:grid-cols-3" aria-label="Santé">
        <div class="rounded-xl border bg-white p-4 shadow-sm" [class]="current.redis.available ? 'border-emerald-300' : 'border-red-300'">
          <div class="text-xs uppercase text-slate-500">Redis</div>
          <div class="text-lg font-semibold" [class]="current.redis.available ? 'text-emerald-700' : 'text-red-700'" data-testid="redis-status">
            {{ current.redis.available ? 'en ligne' : 'indisponible' }}
          </div>
        </div>
        <div class="rounded-xl border bg-white p-4 shadow-sm" [class]="current.queue.available ? 'border-emerald-300' : 'border-red-300'">
          <div class="text-xs uppercase text-slate-500">File BullMQ</div>
          <div class="text-lg font-semibold" [class]="current.queue.available ? 'text-emerald-700' : 'text-red-700'" data-testid="queue-status">
            {{ current.queue.available ? 'disponible' : 'indisponible' }}
          </div>
        </div>
        <div class="rounded-xl border bg-white p-4 shadow-sm" [class]="current.queue.workers > 0 ? 'border-emerald-300' : 'border-amber-300'">
          <div class="text-xs uppercase text-slate-500">Workers connectés</div>
          <div class="text-lg font-semibold" data-testid="workers">{{ current.queue.workers }}</div>
        </div>
      </section>

      @if (current.queue.available && current.queue.workers === 0) {
        <p role="status" class="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid="no-worker">
          Aucun worker connecté : les jobs restent « en file ». Lancez <code>npm run worker -w apps/api</code>.
        </p>
      }

      <section class="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="queue-title">
        <h2 id="queue-title" class="mb-3 text-lg font-semibold">File de transformations</h2>
        <dl class="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div class="rounded-lg bg-amber-50 p-3"><dt class="text-xs text-amber-800">En attente</dt><dd class="text-2xl font-semibold" data-testid="waiting">{{ current.queue.counts.waiting }}</dd></div>
          <div class="rounded-lg bg-sky-50 p-3"><dt class="text-xs text-sky-800">En cours</dt><dd class="text-2xl font-semibold" data-testid="active">{{ current.queue.counts.active }}</dd></div>
          <div class="rounded-lg bg-violet-50 p-3"><dt class="text-xs text-violet-800">Nouvelle tentative</dt><dd class="text-2xl font-semibold" data-testid="delayed">{{ current.queue.counts.delayed }}</dd></div>
          <div class="rounded-lg bg-emerald-50 p-3"><dt class="text-xs text-emerald-800">Terminés</dt><dd class="text-2xl font-semibold" data-testid="completed">{{ current.queue.counts.completed }}</dd></div>
          <div class="rounded-lg bg-red-50 p-3"><dt class="text-xs text-red-800">Échoués</dt><dd class="text-2xl font-semibold" data-testid="failed">{{ current.queue.counts.failed }}</dd></div>
        </dl>
        <div class="mt-4 flex flex-wrap items-center gap-4">
          <svg [attr.viewBox]="'0 0 ' + chartWidth + ' ' + chartHeight" class="h-24 w-full max-w-md rounded-md bg-slate-50" role="img" aria-label="Historique de la file sur la dernière minute">
            <polyline [attr.points]="waitingPoints()" fill="none" stroke="#d97706" stroke-width="2" />
            <polyline [attr.points]="activePoints()" fill="none" stroke="#0284c7" stroke-width="2" />
          </svg>
          <div class="text-sm text-slate-600">
            <div><span class="mr-1 inline-block h-2 w-4 rounded bg-amber-600 align-middle"></span>en attente</div>
            <div><span class="mr-1 inline-block h-2 w-4 rounded bg-sky-600 align-middle"></span>en cours</div>
            <div class="mt-2 font-medium" data-testid="throughput">Débit : {{ throughputLabel() }}</div>
          </div>
        </div>
      </section>

      <div class="mb-4 grid gap-4 md:grid-cols-2">
        <section class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="redis-title">
          <h2 id="redis-title" class="mb-3 text-lg font-semibold">Redis</h2>
          @if (current.redis.available) {
            <dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt class="text-slate-500">Version</dt><dd>{{ current.redis.version }}</dd>
              <dt class="text-slate-500">Mémoire utilisée</dt><dd>{{ memory() }}</dd>
              <dt class="text-slate-500">Clients connectés</dt><dd>{{ current.redis.connectedClients }}</dd>
              <dt class="text-slate-500">En fonctionnement depuis</dt><dd>{{ uptime() }}</dd>
              @if (current.redis.keys; as keys) {
                <dt class="text-slate-500">Entrées de cache</dt><dd data-testid="cache-entries">{{ keys.cacheEntries }}{{ current.redis.approximate ? '+' : '' }}</dd>
                <dt class="text-slate-500">Verrous en cours</dt><dd>{{ keys.activeLocks }}</dd>
                <dt class="text-slate-500">Compteurs de quota</dt><dd>{{ keys.rateLimitCounters }}</dd>
                <dt class="text-slate-500">Clés de la file</dt><dd>{{ keys.queueKeys }}</dd>
              }
            </dl>
          } @else {
            <p class="text-sm text-red-700">Redis ne répond pas : le cache et les quotas sont inactifs (l'API continue de fonctionner), la file est indisponible.</p>
          }
        </section>

        <section class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="activity-title">
          <h2 id="activity-title" class="mb-3 text-lg font-semibold">Activité</h2>
          <dl class="space-y-2 text-sm">
            <div class="flex justify-between"><dt class="text-slate-500">Réponses servies par le cache</dt><dd data-testid="cache-hit">{{ current.counters.cache_hit }}</dd></div>
            <div class="flex justify-between"><dt class="text-slate-500">Calculs réels (sharp)</dt><dd data-testid="cache-miss">{{ current.counters.cache_miss }}</dd></div>
            <div class="flex justify-between"><dt class="text-slate-500">Requêtes refusées (429)</dt><dd data-testid="rate-limited">{{ current.counters.rate_limited }}</dd></div>
          </dl>
          <div class="mt-3">
            <div class="mb-1 flex justify-between text-xs text-slate-500">
              <span>Taux de cache</span><span data-testid="hit-ratio">{{ hitRatio() === null ? '–' : hitRatio() + ' %' }}</span>
            </div>
            <div class="h-2 overflow-hidden rounded bg-slate-100"><div class="h-full bg-emerald-500 transition-all" [style.width.%]="hitRatio() ?? 0"></div></div>
          </div>
          <p class="mt-3 text-xs text-slate-500">Compteurs globaux depuis le dernier vidage de Redis.</p>
        </section>
      </div>

      <section class="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="jobs-title">
        <h2 id="jobs-title" class="mb-3 text-lg font-semibold">Vos derniers jobs</h2>
        @if (current.recentJobs.length === 0) {
          <p class="text-sm text-slate-500">Aucun job pour l'instant. Utilisez le générateur ci-dessous, ou « Traiter en arrière-plan » sur la page d'une image.</p>
        } @else {
          <ul class="divide-y divide-slate-100 text-sm" data-testid="jobs">
            @for (job of current.recentJobs; track job.id) {
              <li class="flex flex-wrap items-center gap-3 py-2" [attr.data-status]="job.status">
                <span class="rounded-full px-2 py-0.5 text-xs font-medium" [class]="badge(job.status)">{{ label(job.status) }}</span>
                <span class="text-slate-500">{{ job.createdAt | date: 'HH:mm:ss' }}</span>
                <span class="text-xs text-slate-400">{{ job.id.slice(0, 8) }}</span>
                @if (job.attempts > 1) { <span class="text-xs text-violet-700">{{ job.attempts }} tentatives</span> }
                @if (job.image; as image) { <a [routerLink]="['/images', image.id]" class="text-indigo-600 hover:underline">voir le résultat</a> }
                @if (job.error; as failure) { <span class="text-red-700">{{ failure.message }}</span> }
              </li>
            }
          </ul>
        }
      </section>
    } @else if (!error()) {
      <p class="text-slate-500">Chargement…</p>
    }

    <section class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="load-title">
      <h2 id="load-title" class="mb-1 text-lg font-semibold">Générateur de charge</h2>
      <p class="mb-3 text-sm text-slate-600">
        Envoie des jobs de transformation (paramètres tous différents, donc sans cache) pour voir la file se remplir, les workers la vider et les compteurs bouger.
        Chaque job compte dans votre quota « transformations » : pour une démonstration, lancez l'API avec <code>RATE_LIMIT_TRANSFORM=1000</code>.
      </p>
      <div class="flex flex-wrap items-end gap-3">
        <div>
          <label for="load-image" class="block text-xs text-slate-600">Image source</label>
          <select id="load-image" [(ngModel)]="selectedImageId" class="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
            @for (image of sources(); track image.id) {
              <option [value]="image.id">{{ image.format }} · {{ image.width }}×{{ image.height }} · {{ image.id.slice(0, 8) }}</option>
            }
          </select>
        </div>
        <div>
          <label for="load-count" class="block text-xs text-slate-600">Nombre de jobs (1 à 50)</label>
          <input id="load-count" type="number" min="1" max="50" [(ngModel)]="loadCount" class="w-24 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        </div>
        <button type="button" (click)="generateLoad()" [disabled]="sending() || sources().length === 0"
                class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
          {{ sending() ? 'Envoi…' : 'Lancer' }}
        </button>
      </div>
      @if (sources().length === 0) {
        <p class="mt-2 text-sm text-slate-500">Aucune image : <a routerLink="/images/new" class="text-indigo-600 hover:underline">envoyez-en une</a> d'abord.</p>
      }
      @if (loadSummary(); as summary) {
        <p class="mt-3 text-sm" [class]="summary.failed ? 'text-amber-800' : 'text-emerald-700'" data-testid="load-summary" role="status">{{ summary.text }}</p>
      }
    </section>
  `,
})
export class Monitoring implements OnInit {
  protected readonly chartWidth = CHART_WIDTH;
  protected readonly chartHeight = CHART_HEIGHT;

  protected readonly overview = signal<MonitoringOverview | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly paused = signal(false);
  private readonly history = signal<readonly Sample[]>([]);

  protected readonly sources = signal<readonly ImageSummary[]>([]);
  protected selectedImageId = '';
  protected loadCount = 10;
  protected readonly sending = signal(false);
  protected readonly loadSummary = signal<{ text: string; failed: boolean } | null>(null);

  protected readonly waitingPoints = computed(() => sparklinePoints(this.history().map((sample) => sample.counts.waiting), CHART_WIDTH, CHART_HEIGHT));
  protected readonly activePoints = computed(() => sparklinePoints(this.history().map((sample) => sample.counts.active), CHART_WIDTH, CHART_HEIGHT));
  protected readonly throughputLabel = computed(() => {
    const samples = this.history();
    const rate = throughputPerSecond(samples.at(-2) ?? null, samples.at(-1) ?? { at: 0, counts: { waiting: 0, active: 0, delayed: 0, completed: 0, failed: 0 } });
    return rate === null ? '–' : `${rate.toFixed(1).replace('.', ',')} job(s)/s`;
  });
  protected readonly hitRatio = computed(() => {
    const counters = this.overview()?.counters;
    return counters === undefined ? null : hitRatioPercent(counters.cache_hit, counters.cache_miss);
  });
  protected readonly memory = computed(() => formatBytes(this.overview()?.redis.usedMemoryBytes ?? null));
  protected readonly uptime = computed(() => formatUptime(this.overview()?.redis.uptimeSeconds ?? null));

  private readonly monitoring = inject(MonitoringService);
  private readonly images = inject(ImagesService);
  private readonly transforms = inject(TransformsService);
  private watching: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.stop();
    });
  }

  /** Démarre la surveillance et charge les images utilisables par le générateur de charge. */
  ngOnInit(): void {
    this.start();
    this.images.list(1, 12).subscribe({
      next: (page) => {
        const originals = page.items.filter((image) => image.originalId === null);
        this.sources.set(originals);
        this.selectedImageId = originals[0]?.id ?? '';
      },
      error: () => {
        this.sources.set([]);
      },
    });
  }

  /** Met la surveillance en pause (plus aucune requête) ou la reprend. */
  protected togglePause(): void {
    if (this.paused()) {
      this.paused.set(false);
      this.start();
    } else {
      this.paused.set(true);
      this.stop();
    }
  }

  /** Classes CSS du badge d'un statut. */
  protected badge(status: JobStatus): string {
    return BADGES[status];
  }

  /** Libellé d'un statut. */
  protected label(status: JobStatus): string {
    return LABELS[status];
  }

  /**
   * Envoie `loadCount` jobs de démonstration, l'un après l'autre.
   *
   * S'arrête à la première erreur (quota 429, file 503...) et le dit : inutile d'insister contre une limite.
   */
  protected async generateLoad(): Promise<void> {
    const count = Math.min(50, Math.max(1, Math.floor(Number(this.loadCount) || 1)));
    this.sending.set(true);
    this.loadSummary.set(null);
    let sent = 0;
    try {
      for (let index = 0; index < count; index++) {
        await firstValueFrom(this.transforms.createJob(this.selectedImageId, randomLoadBody()));
        sent += 1;
      }
      this.loadSummary.set({ text: `${String(sent)} job(s) envoyé(s). Regardez la file se remplir puis se vider.`, failed: false });
    } catch (error) {
      this.loadSummary.set({ text: `${String(sent)} job(s) envoyé(s), puis arrêt : ${describeApiError(error)}`, failed: true });
    } finally {
      this.sending.set(false);
    }
  }

  private start(): void {
    this.stop();
    this.watching = this.monitoring.watch().subscribe((reading) => {
      if (reading.ok) {
        this.error.set(null);
        this.overview.set(reading.overview);
        this.history.update((samples) => pushSample(samples, { at: new Date(reading.overview.generatedAt).getTime(), counts: reading.overview.queue.counts }));
      } else {
        this.error.set(reading.message);
      }
    });
  }

  private stop(): void {
    this.watching?.unsubscribe();
    this.watching = null;
  }
}

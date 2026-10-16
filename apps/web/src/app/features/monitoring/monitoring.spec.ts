/** Tests de la page de supervision : états (chargement, panne, absence de worker), compteurs, jobs, pause, générateur de charge. */
import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of, Subject, throwError } from 'rxjs';
import { ImageSummary } from '../../core/images/image.models';
import { ImagesService } from '../../core/images/images.service';
import { JobSummary } from '../../core/images/transform.models';
import { TransformsService } from '../../core/images/transforms.service';
import { MonitoringOverview, MonitoringReading } from '../../core/monitoring/monitoring.models';
import { MonitoringService } from '../../core/monitoring/monitoring.service';
import { Monitoring } from './monitoring';

const ORIGINAL: ImageSummary = { id: 'o1aaaaaa-0000', originalId: null, format: 'png', sizeBytes: 10, width: 40, height: 20, createdAt: '2026-01-01T00:00:00.000Z' };
const DERIVED: ImageSummary = { ...ORIGINAL, id: 'd1', originalId: 'o1aaaaaa-0000' };

function job(status: JobSummary['status'], extra: Partial<JobSummary> = {}): JobSummary {
  return { id: 'job-12345678', status, sourceImageId: 'o1', attempts: 1, image: null, error: null, createdAt: '2026-01-01T10:00:05.000Z', updatedAt: '2026-01-01T10:00:05.000Z', ...extra };
}

function overview(changes: Partial<MonitoringOverview> = {}): MonitoringOverview {
  return {
    generatedAt: '2026-01-01T10:00:00.000Z',
    redis: { available: true, version: '7.4.11', usedMemoryBytes: 2_584_040, connectedClients: 7, uptimeSeconds: 3900, keys: { cacheEntries: 8, activeLocks: 0, rateLimitCounters: 5, queueKeys: 9 }, approximate: false },
    queue: { available: true, counts: { waiting: 3, active: 1, delayed: 2, completed: 40, failed: 1 }, workers: 2 },
    counters: { cache_hit: 1, cache_miss: 3, rate_limited: 4 },
    recentJobs: [],
    ...changes,
  };
}

describe('Monitoring', () => {
  const stream = new Subject<MonitoringReading>();
  let watchSubscribed = 0;
  let watchUnsubscribed = 0;
  const createJob = vi.fn();
  let list: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<Monitoring>;
  let el: HTMLElement;

  beforeEach(async () => {
    watchSubscribed = 0;
    watchUnsubscribed = 0;
    createJob.mockReset();
    list = vi.fn(() => of({ items: [ORIGINAL, DERIVED], page: 1, limit: 12, total: 2 }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: MonitoringService,
          useValue: {
            watch: () =>
              new Observable<MonitoringReading>((subscriber) => {
                watchSubscribed += 1;
                const inner = stream.subscribe(subscriber);
                return () => {
                  watchUnsubscribed += 1;
                  inner.unsubscribe();
                };
              }),
          },
        },
        { provide: ImagesService, useValue: { list } },
        { provide: TransformsService, useValue: { createJob } },
      ],
    });
    fixture = TestBed.createComponent(Monitoring);
    await fixture.whenStable();
    el = fixture.nativeElement as HTMLElement;
  });

  const emit = async (reading: MonitoringReading): Promise<void> => {
    stream.next(reading);
    await fixture.whenStable();
  };
  const show = (value: MonitoringOverview): Promise<void> => emit({ ok: true, overview: value });
  const text = (testId: string): string => (el.querySelector(`[data-testid="${testId}"]`)?.textContent ?? '').replace(/\s+/g, ' ').trim();

  it('affiche « Chargement » avant le premier relevé, puis les chiffres de la file', async () => {
    expect(el.textContent).toContain('Chargement');
    await show(overview());
    expect(el.textContent).not.toContain('Chargement…');
    expect(text('waiting')).toBe('3');
    expect(text('active')).toBe('1');
    expect(text('delayed')).toBe('2');
    expect(text('completed')).toBe('40');
    expect(text('failed')).toBe('1');
    expect(text('workers')).toBe('2');
  });

  it('suit la file en direct : les chiffres changent à chaque relevé', async () => {
    await show(overview());
    await show(overview({ queue: { available: true, counts: { waiting: 0, active: 2, delayed: 0, completed: 44, failed: 1 }, workers: 2 } }));
    expect(text('waiting')).toBe('0');
    expect(text('active')).toBe('2');
    expect(text('completed')).toBe('44');
  });

  it('affiche Redis (version, mémoire lisible, clients, durée) et ses familles de clés', async () => {
    await show(overview());
    expect(text('redis-status')).toBe('en ligne');
    const redisSection = el.querySelector('[aria-labelledby="redis-title"]')?.textContent ?? '';
    expect(redisSection).toContain('7.4.11');
    expect(redisSection).toContain('2,5 Mo');
    expect(redisSection).toContain('1 h 05 min');
    expect(text('cache-entries')).toBe('8');
  });

  it('marque « + » quand le comptage des clés a été plafonné', async () => {
    await show(overview({ redis: { ...overview().redis, approximate: true } }));
    expect(text('cache-entries')).toBe('8+');
  });

  it("calcule le taux de cache et affiche les compteurs d'activité", async () => {
    await show(overview());
    expect(text('cache-hit')).toBe('1');
    expect(text('cache-miss')).toBe('3');
    expect(text('rate-limited')).toBe('4');
    expect(text('hit-ratio')).toBe('25 %');
  });

  it("taux de cache « – » tant qu'il n'y a aucune transformation", async () => {
    await show(overview({ counters: { cache_hit: 0, cache_miss: 0, rate_limited: 0 } }));
    expect(text('hit-ratio')).toBe('–');
  });

  it("avertit quand AUCUN worker n'est connecté (les jobs restent en file) et l'explique", async () => {
    await show(overview({ queue: { available: true, counts: { waiting: 5, active: 0, delayed: 0, completed: 0, failed: 0 }, workers: 0 } }));
    expect(text('no-worker')).toContain('Aucun worker connecté');
    expect(text('no-worker')).toContain('npm run worker');
    await show(overview());
    expect(el.querySelector('[data-testid="no-worker"]')).toBeNull();
  });

  it('Redis et file indisponibles : états en rouge, message clair, pas de faux zéros trompeurs sur Redis', async () => {
    await show(overview({ redis: { available: false, version: null, usedMemoryBytes: null, connectedClients: null, uptimeSeconds: null, keys: null, approximate: false }, queue: { available: false, counts: { waiting: 0, active: 0, delayed: 0, completed: 0, failed: 0 }, workers: 0 } }));
    expect(text('redis-status')).toBe('indisponible');
    expect(text('queue-status')).toBe('indisponible');
    expect(el.textContent).toContain('Redis ne répond pas');
    expect(el.querySelector('[data-testid="no-worker"]')).toBeNull(); // sans file, « aucun worker » n'a pas de sens
  });

  it("affiche l'erreur de lecture, garde les dernières valeurs, puis se rétablit toute seule", async () => {
    await show(overview());
    await emit({ ok: false, message: "Impossible de joindre l'API. Est-elle démarrée ?" });
    expect(el.querySelector('[role="alert"]')?.textContent).toContain("Impossible de joindre l'API");
    expect(text('waiting')).toBe('3'); // les dernières valeurs restent visibles
    await show(overview());
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });

  it('liste VOS jobs avec statut lisible, tentatives, lien vers le résultat et message d\'échec', async () => {
    await show(
      overview({
        recentJobs: [
          job('completed', { id: 'aaaaaaaa-1', image: DERIVED }),
          job('queued', { id: 'bbbbbbbb-2', attempts: 0 }),
          job('failed', { id: 'cccccccc-3', error: { kind: 'ImageNotFound', message: 'Image source introuvable' } }),
          job('processing', { id: 'dddddddd-4', attempts: 3 }),
        ],
      }),
    );
    const items = Array.from(el.querySelectorAll('[data-testid="jobs"] li'));
    expect(items.map((li) => li.getAttribute('data-status'))).toEqual(['completed', 'queued', 'failed', 'processing']);
    expect(items[0]?.textContent).toContain('terminé');
    expect(items[0]?.querySelector('a[href="/images/d1"]')).not.toBeNull();
    expect(items[1]?.textContent).toContain('en file');
    expect(items[2]?.textContent).toContain('Image source introuvable');
    expect(items[3]?.textContent).toContain('3 tentatives');
  });

  it("message d'invitation quand l'utilisateur n'a encore aucun job", async () => {
    await show(overview());
    expect(el.textContent).toContain('Aucun job pour l\'instant');
  });

  it("dessine un historique : deux courbes (en attente, en cours) après plusieurs relevés", async () => {
    for (let i = 0; i < 4; i++) {
      await show(overview({ generatedAt: `2026-01-01T10:00:0${String(i)}.000Z`, queue: { available: true, counts: { waiting: i, active: 1, delayed: 0, completed: i * 2, failed: 0 }, workers: 1 } }));
    }
    const lines = Array.from(el.querySelectorAll('polyline'));
    expect(lines).toHaveLength(2);
    expect(lines[0]?.getAttribute('points')?.split(' ')).toHaveLength(4);
  });

  it("calcule le débit à partir des jobs terminés entre deux relevés", async () => {
    await show(overview({ generatedAt: '2026-01-01T10:00:00.000Z', queue: { available: true, counts: { waiting: 0, active: 0, delayed: 0, completed: 10, failed: 0 }, workers: 1 } }));
    await show(overview({ generatedAt: '2026-01-01T10:00:02.000Z', queue: { available: true, counts: { waiting: 0, active: 0, delayed: 0, completed: 14, failed: 0 }, workers: 1 } }));
    expect(text('throughput')).toBe('Débit : 2,0 job(s)/s');
  });

  describe('pause', () => {
    it('Pause arrête la surveillance (désabonnement) ; Reprendre la relance', async () => {
      expect(watchSubscribed).toBe(1);
      const button = (): HTMLButtonElement => Array.from(el.querySelectorAll('button')).find((b) => /Pause|Reprendre/.test(b.textContent)) as HTMLButtonElement;
      button().click();
      await fixture.whenStable();
      expect(watchUnsubscribed).toBe(1);
      expect(button().textContent).toContain('Reprendre');
      button().click();
      await fixture.whenStable();
      expect(watchSubscribed).toBe(2);
      expect(button().textContent).toContain('Pause');
    });

    it('la surveillance est arrêtée quand la page est détruite', () => {
      fixture.destroy();
      expect(watchUnsubscribed).toBe(1);
    });
  });

  describe('générateur de charge', () => {
    const select = (): HTMLSelectElement => el.querySelector('#load-image') as HTMLSelectElement;
    const setCount = async (value: number): Promise<void> => {
      const input = el.querySelector('#load-count') as HTMLInputElement;
      input.value = String(value);
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };
    const launch = async (): Promise<void> => {
      (Array.from(el.querySelectorAll('button')).find((b) => b.textContent.includes('Lancer')) as HTMLButtonElement).click();
      await fixture.whenStable();
      await fixture.whenStable();
    };

    it("ne propose que les images ORIGINALES comme source (pas les dérivées)", () => {
      expect(Array.from(select().options).map((o) => o.value)).toEqual([ORIGINAL.id]);
    });

    it('envoie N jobs à l\'image choisie avec des paramètres différents, puis le résume', async () => {
      createJob.mockImplementation(() => of(job('queued')));
      await setCount(5);
      await launch();
      expect(createJob).toHaveBeenCalledTimes(5);
      expect(createJob.mock.calls.every((call) => call[0] === ORIGINAL.id)).toBe(true);
      expect(new Set(createJob.mock.calls.map((call) => JSON.stringify(call[1]))).size).toBeGreaterThan(1);
      expect(text('load-summary')).toContain('5 job(s) envoyé(s)');
    });

    it("plafonne à 50 et à 1 au minimum", async () => {
      createJob.mockImplementation(() => of(job('queued')));
      await setCount(500);
      await launch();
      expect(createJob).toHaveBeenCalledTimes(50);
      createJob.mockClear();
      await setCount(0);
      await launch();
      expect(createJob).toHaveBeenCalledTimes(1);
    });

    it("s'arrête à la première erreur (quota 429) et le dit avec le nombre déjà envoyé", async () => {
      createJob
        .mockReturnValueOnce(of(job('queued')))
        .mockReturnValueOnce(of(job('queued')))
        .mockReturnValue(throwError(() => new HttpErrorResponse({ status: 429, error: { error: 'TooManyRequests', message: 'Trop de requêtes : réessayez dans 30 s' } })));
      await setCount(10);
      await launch();
      expect(createJob).toHaveBeenCalledTimes(3); // 2 réussis + le refusé, pas d'insistance
      expect(text('load-summary')).toContain('2 job(s) envoyé(s), puis arrêt : Trop de requêtes');
    });

    it('désactive le bouton pendant l\'envoi (pas de double lancement)', async () => {
      const pending = new Subject<JobSummary>();
      createJob.mockReturnValue(pending);
      await setCount(1);
      (Array.from(el.querySelectorAll('button')).find((b) => b.textContent.includes('Lancer')) as HTMLButtonElement).click();
      await fixture.whenStable();
      const button = Array.from(el.querySelectorAll('button')).find((b) => b.textContent.includes('Envoi')) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      pending.next(job('queued'));
      pending.complete();
      await fixture.whenStable();
      await fixture.whenStable();
      expect(Array.from(el.querySelectorAll('button')).find((b) => b.textContent.includes('Lancer'))?.hasAttribute('disabled')).toBe(false);
    });

    it("sans image : invite à en envoyer une et désactive le lancement", async () => {
      list.mockReturnValue(of({ items: [], page: 1, limit: 12, total: 0 }));
      fixture = TestBed.createComponent(Monitoring);
      await fixture.whenStable();
      el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('envoyez-en une');
      expect((Array.from(el.querySelectorAll('button')).find((b) => b.textContent.includes('Lancer')) as HTMLButtonElement).disabled).toBe(true);
    });
  });
});

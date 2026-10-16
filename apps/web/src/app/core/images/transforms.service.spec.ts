/** Tests du service de transformations : routes, corps, interprétation des statuts et suivi (« polling ») des jobs. */
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../api-config';
import { JobSummary } from './transform.models';
import { MAX_POLLS, POLL_INTERVAL_MS, TransformsService } from './transforms.service';

const IMAGE = { id: 'd1', originalId: 'o1', format: 'webp', sizeBytes: 10, width: 5, height: 5, createdAt: '2026-01-01T00:00:00.000Z' };
const job = (status: JobSummary['status'], extra: Partial<JobSummary> = {}): JobSummary => ({
  id: 'j1',
  status,
  sourceImageId: 'o1',
  attempts: 0,
  image: null,
  error: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...extra,
});

describe('TransformsService', () => {
  let service: TransformsService;
  let http: HttpTestingController;
  let api: string;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(TransformsService);
    http = TestBed.inject(HttpTestingController);
    api = TestBed.inject(API_BASE_URL);
  });
  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  it('transform envoie le corps en POST ; 201 = nouvelle image (cached: false)', () => {
    let result: unknown;
    service.transform('o1', { rotate: 90 }).subscribe((value) => (result = value));
    const request = http.expectOne(`${api}/images/o1/transform`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ rotate: 90 });
    request.flush(IMAGE, { status: 201, statusText: 'Created' });
    expect(result).toEqual({ image: IMAGE, cached: false });
  });

  it('transform : 200 = déjà produite (cached: true)', () => {
    let result: unknown;
    service.transform('o1', { rotate: 90 }).subscribe((value) => (result = value));
    http.expectOne(`${api}/images/o1/transform`).flush(IMAGE, { status: 200, statusText: 'OK' });
    expect(result).toEqual({ image: IMAGE, cached: true });
  });

  it("encode l'identifiant dans l'URL", () => {
    service.transform('a/b', { flip: true }).subscribe();
    http.expectOne(`${api}/images/a%2Fb/transform`).flush(IMAGE, { status: 201, statusText: 'Created' });
  });

  it('createJob poste sur /images/:id/jobs et renvoie le job', () => {
    let result: JobSummary | null = null;
    service.createJob('o1', { filter: 'sepia' }).subscribe((value) => (result = value));
    const request = http.expectOne(`${api}/images/o1/jobs`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ filter: 'sepia' });
    request.flush(job('queued'), { status: 202, statusText: 'Accepted' });
    expect((result as JobSummary | null)?.status).toBe('queued');
  });

  it('getJob lit /jobs/:id', () => {
    service.getJob('j1').subscribe();
    const request = http.expectOne(`${api}/jobs/j1`);
    expect(request.request.method).toBe('GET');
    request.flush(job('queued'));
  });

  it('getTemporaryUrl lit /images/:id/url', () => {
    service.getTemporaryUrl('o1').subscribe();
    http.expectOne(`${api}/images/o1/url`).flush({ url: 'http://s3/x', expiresInSeconds: 300, expiresAt: '2026-01-01T00:05:00.000Z' });
  });

  describe('pollJob', () => {
    it('lit tout de suite, puis chaque seconde, et se termine APRÈS le statut final (inclus)', () => {
      const seen: string[] = [];
      let completed = false;
      service.pollJob('j1').subscribe({ next: (value) => seen.push(value.status), complete: () => (completed = true) });
      vi.advanceTimersByTime(0); // le 1er tick (timer(0)) part au prochain cycle

      http.expectOne(`${api}/jobs/j1`).flush(job('queued'));
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
      http.expectOne(`${api}/jobs/j1`).flush(job('processing'));
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
      http.expectOne(`${api}/jobs/j1`).flush(job('completed', { image: IMAGE as JobSummary['image'] }));

      expect(seen).toEqual(['queued', 'processing', 'completed']);
      expect(completed).toBe(true);
      vi.advanceTimersByTime(POLL_INTERVAL_MS * 5);
      http.expectNone(`${api}/jobs/j1`); // plus aucune requête après le statut final
    });

    it("un échec (`failed`) est aussi un statut final", () => {
      let completed = false;
      service.pollJob('j1').subscribe({ complete: () => (completed = true) });
      vi.advanceTimersByTime(0);
      http.expectOne(`${api}/jobs/j1`).flush(job('failed', { error: { kind: 'InvalidTransformation', message: 'x' } }));
      expect(completed).toBe(true);
    });

    it('abandonne après le nombre maximal de lectures (le job continue côté serveur)', () => {
      const seen: string[] = [];
      let completed = false;
      service.pollJob('j1', 100, 3).subscribe({ next: (value) => seen.push(value.status), complete: () => (completed = true) });
      vi.advanceTimersByTime(0);
      for (let i = 0; i < 3; i++) {
        http.expectOne(`${api}/jobs/j1`).flush(job('queued'));
        vi.advanceTimersByTime(100);
      }
      expect(seen).toHaveLength(3);
      expect(completed).toBe(true);
      http.expectNone(`${api}/jobs/j1`);
    });

    it("n'empile pas de requêtes tant qu'une réponse est attendue (exhaustMap)", () => {
      service.pollJob('j1', 100).subscribe();
      vi.advanceTimersByTime(0);
      const first = http.expectOne(`${api}/jobs/j1`);
      vi.advanceTimersByTime(500); // 5 ticks, la 1re réponse n'est pas arrivée
      http.expectNone(`${api}/jobs/j1`);
      first.flush(job('queued'));
    });

    it('se désabonner arrête les lectures', () => {
      const subscription = service.pollJob('j1', 100).subscribe();
      vi.advanceTimersByTime(0);
      http.expectOne(`${api}/jobs/j1`).flush(job('queued'));
      subscription.unsubscribe();
      vi.advanceTimersByTime(1000);
      http.expectNone(`${api}/jobs/j1`);
    });

    it('propage une erreur HTTP (ex. 404) et s\'arrête', () => {
      let failed = false;
      service.pollJob('j1').subscribe({ error: () => (failed = true) });
      vi.advanceTimersByTime(0);
      http.expectOne(`${api}/jobs/j1`).flush({ error: 'JobNotFound', message: 'Job introuvable' }, { status: 404, statusText: 'Not Found' });
      expect(failed).toBe(true);
    });

    it('a des valeurs par défaut raisonnables (1 s, 2 minutes)', () => {
      expect(POLL_INTERVAL_MS).toBe(1000);
      expect(MAX_POLLS * POLL_INTERVAL_MS).toBe(120_000);
    });
  });
});

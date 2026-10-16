/** Tests du service de supervision : route, surveillance continue, erreurs converties en relevés, arrêt. */
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../api-config';
import { MonitoringOverview, MonitoringReading } from './monitoring.models';
import { MonitoringService } from './monitoring.service';

const OVERVIEW: MonitoringOverview = {
  generatedAt: '2026-01-01T00:00:00.000Z',
  redis: { available: true, version: '7.4.0', usedMemoryBytes: 1, connectedClients: 1, uptimeSeconds: 1, keys: null, approximate: false },
  queue: { available: true, counts: { waiting: 0, active: 0, delayed: 0, completed: 0, failed: 0 }, workers: 1 },
  counters: { cache_hit: 0, cache_miss: 0, rate_limited: 0 },
  recentJobs: [],
};

describe('MonitoringService', () => {
  let service: MonitoringService;
  let http: HttpTestingController;
  let api: string;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(MonitoringService);
    http = TestBed.inject(HttpTestingController);
    api = TestBed.inject(API_BASE_URL);
  });
  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  it('getOverview lit /monitoring/overview', () => {
    let result: MonitoringOverview | null = null;
    service.getOverview().subscribe((value) => (result = value));
    const request = http.expectOne(`${api}/monitoring/overview`);
    expect(request.request.method).toBe('GET');
    request.flush(OVERVIEW);
    expect(result).toEqual(OVERVIEW);
  });

  it('watch lit tout de suite puis à chaque intervalle, en émettant des relevés réussis', () => {
    const readings: MonitoringReading[] = [];
    const subscription = service.watch(1000).subscribe((reading) => readings.push(reading));
    vi.advanceTimersByTime(0);
    http.expectOne(`${api}/monitoring/overview`).flush(OVERVIEW);
    vi.advanceTimersByTime(1000);
    http.expectOne(`${api}/monitoring/overview`).flush(OVERVIEW);
    expect(readings).toEqual([
      { ok: true, overview: OVERVIEW },
      { ok: true, overview: OVERVIEW },
    ]);
    subscription.unsubscribe();
  });

  it("une erreur HTTP devient un relevé en échec avec le message de l'API, et la surveillance CONTINUE", () => {
    const readings: MonitoringReading[] = [];
    const subscription = service.watch(1000).subscribe((reading) => readings.push(reading));
    vi.advanceTimersByTime(0);
    http.expectOne(`${api}/monitoring/overview`).flush({ error: 'TooManyRequests', message: 'Trop de requêtes' }, { status: 429, statusText: 'Too Many Requests' });
    vi.advanceTimersByTime(1000);
    http.expectOne(`${api}/monitoring/overview`).flush(OVERVIEW); // rétablissement
    expect(readings[0]).toEqual({ ok: false, message: 'Trop de requêtes' });
    expect(readings[1]).toEqual({ ok: true, overview: OVERVIEW });
    subscription.unsubscribe();
  });

  it("API injoignable (statut 0) : message explicite, sans planter", () => {
    const readings: MonitoringReading[] = [];
    const subscription = service.watch(1000).subscribe((reading) => readings.push(reading));
    vi.advanceTimersByTime(0);
    http.expectOne(`${api}/monitoring/overview`).error(new ProgressEvent('error'));
    expect(readings[0]).toMatchObject({ ok: false });
    expect((readings[0] as { message: string }).message).toContain("Impossible de joindre l'API");
    subscription.unsubscribe();
  });

  it("n'empile pas de requêtes tant qu'une réponse est attendue (exhaustMap)", () => {
    const subscription = service.watch(100).subscribe();
    vi.advanceTimersByTime(0);
    const first = http.expectOne(`${api}/monitoring/overview`);
    vi.advanceTimersByTime(500);
    http.expectNone(`${api}/monitoring/overview`);
    first.flush(OVERVIEW);
    subscription.unsubscribe();
  });

  it('se désabonner arrête les requêtes', () => {
    const subscription = service.watch(100).subscribe();
    vi.advanceTimersByTime(0);
    http.expectOne(`${api}/monitoring/overview`).flush(OVERVIEW);
    subscription.unsubscribe();
    vi.advanceTimersByTime(1000);
    http.expectNone(`${api}/monitoring/overview`);
  });
});

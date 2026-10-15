/** Tests du service d'images : routes, paramètres et format des requêtes. */
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../api-config';
import { ImagesService } from './images.service';

describe('ImagesService', () => {
  let service: ImagesService;
  let http: HttpTestingController;
  let api: string;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(ImagesService);
    http = TestBed.inject(HttpTestingController);
    api = TestBed.inject(API_BASE_URL);
  });
  afterEach(() => {
    http.verify();
  });

  it('list demande la page et la limite en paramètres de requête', () => {
    service.list(3, 12).subscribe();
    const request = http.expectOne((r) => r.url === `${api}/images`);
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('page')).toBe('3');
    expect(request.request.params.get('limit')).toBe('12');
    request.flush({ items: [], page: 3, limit: 12, total: 0 });
  });

  it('upload envoie un multipart avec le fichier dans le champ « image »', () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' });
    service.upload(file).subscribe();

    const request = http.expectOne(`${api}/images`);
    expect(request.request.method).toBe('POST');
    const body = request.request.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect((body.get('image') as File).name).toBe('photo.png');
    request.flush({ id: 'i1', format: 'png', sizeBytes: 3, width: 1, height: 1, createdAt: '2026-01-01T00:00:00.000Z' });
  });

  it('download demande le fichier en blob', () => {
    let received: Blob | null = null;
    service.download('abc-123').subscribe((blob) => (received = blob));

    const request = http.expectOne(`${api}/images/abc-123`);
    expect(request.request.responseType).toBe('blob');
    request.flush(new Blob(['x'], { type: 'image/png' }));
    expect(received).toBeInstanceOf(Blob);
  });

  it("download encode l'identifiant dans l'URL", () => {
    service.download('a/b').subscribe({ error: () => undefined });
    http.expectOne(`${api}/images/a%2Fb`).flush(null, { status: 404, statusText: 'Not Found' });
  });
});

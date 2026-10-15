/** Tests de l'intercepteur : ajout du Bearer vers l'API seulement, et déconnexion sur 401. */
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { API_BASE_URL } from '../api-config';
import { AuthService } from './auth.service';
import { authInterceptor } from './auth.interceptor';

describe('authInterceptor', () => {
  let http: HttpClient;
  let controller: HttpTestingController;
  let api: string;

  function setup(): void {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
    api = TestBed.inject(API_BASE_URL);
  }

  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    controller.verify();
  });

  it("ajoute Authorization: Bearer aux appels vers l'API quand un jeton existe", () => {
    localStorage.setItem('ips.token', 'abc');
    setup();
    http.get(`${api}/images`).subscribe();
    expect(controller.expectOne(`${api}/images`).request.headers.get('Authorization')).toBe('Bearer abc');
  });

  it("n'ajoute rien sans jeton (ex. connexion)", () => {
    setup();
    http.post(`${api}/login`, {}).subscribe();
    expect(controller.expectOne(`${api}/login`).request.headers.has('Authorization')).toBe(false);
  });

  it("n'envoie JAMAIS le jeton à un autre domaine", () => {
    localStorage.setItem('ips.token', 'abc');
    setup();
    http.get('https://autre-domaine.example/data').subscribe();
    expect(controller.expectOne('https://autre-domaine.example/data').request.headers.has('Authorization')).toBe(false);
  });

  it('sur 401 avec un jeton : déconnecte et redirige vers /login', () => {
    localStorage.setItem('ips.token', 'expiré');
    setup();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    http.get(`${api}/images`).subscribe({ error: () => undefined });
    controller.expectOne(`${api}/images`).flush({}, { status: 401, statusText: 'Unauthorized' });

    expect(TestBed.inject(AuthService).isAuthenticated()).toBe(false);
    expect(navigate).toHaveBeenCalledWith(['/login']);
  });

  it('sur 401 SANS jeton (mauvais mot de passe) : pas de redirection, l\'erreur est relayée', () => {
    setup();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    let status = 0;

    http.post(`${api}/login`, {}).subscribe({ error: (e: { status: number }) => (status = e.status) });
    controller.expectOne(`${api}/login`).flush({}, { status: 401, statusText: 'Unauthorized' });

    expect(status).toBe(401);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('relaie les autres erreurs sans déconnecter (ex. 404)', () => {
    localStorage.setItem('ips.token', 'abc');
    setup();
    http.get(`${api}/images/x`).subscribe({ error: () => undefined });
    controller.expectOne(`${api}/images/x`).flush({}, { status: 404, statusText: 'Not Found' });
    expect(TestBed.inject(AuthService).isAuthenticated()).toBe(true);
  });
});

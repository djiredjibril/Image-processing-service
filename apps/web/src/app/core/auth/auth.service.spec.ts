/** Tests du service d'authentification (HTTP simulé, stockage réel de jsdom). */
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../api-config';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let http: HttpTestingController;

  function setup(): AuthService {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    return TestBed.inject(AuthService);
  }
  const url = (path: string): string => `${TestBed.inject(API_BASE_URL)}${path}`;

  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    http.verify();
  });

  it('login envoie les identifiants, enregistre le jeton et ouvre la session', () => {
    const auth = setup();
    expect(auth.isAuthenticated()).toBe(false);

    let done = false;
    auth.login('a@b.co', 'motdepasse').subscribe(() => {
      done = true;
    });
    const request = http.expectOne(url('/login'));
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ email: 'a@b.co', password: 'motdepasse' });
    request.flush({ token: 'jeton-123' });

    expect(done).toBe(true);
    expect(auth.token()).toBe('jeton-123');
    expect(auth.isAuthenticated()).toBe(true);
    expect(localStorage.getItem('ips.token')).toBe('jeton-123');
  });

  it("n'ouvre pas de session si l'API répond 401", () => {
    const auth = setup();
    let status = 0;
    auth.login('a@b.co', 'mauvais').subscribe({ error: (e: { status: number }) => (status = e.status) });
    http.expectOne(url('/login')).flush({ error: 'InvalidCredentials' }, { status: 401, statusText: 'Unauthorized' });

    expect(status).toBe(401);
    expect(auth.isAuthenticated()).toBe(false);
    expect(localStorage.getItem('ips.token')).toBeNull();
  });

  it('logout efface le jeton en mémoire et dans le stockage', () => {
    localStorage.setItem('ips.token', 'ancien');
    const auth = setup();
    expect(auth.isAuthenticated()).toBe(true);

    auth.logout();

    expect(auth.token()).toBeNull();
    expect(localStorage.getItem('ips.token')).toBeNull();
  });

  it('restaure la session depuis le stockage au démarrage', () => {
    localStorage.setItem('ips.token', 'persisté');
    expect(setup().token()).toBe('persisté');
  });

  it('registerAndLogin crée le compte PUIS se connecte', () => {
    const auth = setup();
    let done = false;
    auth.registerAndLogin('a@b.co', 'motdepasse').subscribe(() => {
      done = true;
    });

    http.expectOne(url('/register')).flush({ id: 'u1', email: 'a@b.co' }, { status: 201, statusText: 'Created' });
    http.expectOne(url('/login')).flush({ token: 'jeton' });

    expect(done).toBe(true);
    expect(auth.isAuthenticated()).toBe(true);
  });

  it("registerAndLogin ne tente pas de connexion si l'inscription échoue (409)", () => {
    const auth = setup();
    let status = 0;
    auth.registerAndLogin('a@b.co', 'motdepasse').subscribe({ error: (e: { status: number }) => (status = e.status) });
    http.expectOne(url('/register')).flush({ error: 'EmailAlreadyUsed' }, { status: 409, statusText: 'Conflict' });

    http.expectNone(url('/login'));
    expect(status).toBe(409);
  });
});

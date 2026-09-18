import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE } from './api-url';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [AuthService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('posts login credentials and returns the authenticated user', () => {
    const credentials = { email: 'ana@example.com', password: 'secret' };
    const response = {
      token: 'token', expiresAt: '2026-07-01',
      user: { id: 'user-1', name: 'Ana', email: credentials.email },
    };
    service.login(credentials).subscribe((value) => expect(value).toEqual(response));
    const request = http.expectOne(`${API_BASE}/auth/login`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(credentials);
    request.flush(response);
  });

  it('posts registration data and exposes validation failures', () => {
    const payload = { name: 'Ana', email: 'invalid', password: 'secret' };
    let detail = '';
    service.register(payload).subscribe({ error: (error) => (detail = error.error.detail) });
    const request = http.expectOne(`${API_BASE}/auth/register`);
    expect(request.request.body).toEqual(payload);
    request.flush({ detail: 'Email inválido' }, { status: 400, statusText: 'Bad Request' });
    expect(detail).toBe('Email inválido');
  });

  it('loads the current user', () => {
    const user = { id: 'user-1', name: 'Ana', email: 'ana@example.com' };
    service.me().subscribe((value) => expect(value).toEqual(user));
    const request = http.expectOne(`${API_BASE}/auth/me`);
    expect(request.request.method).toBe('GET');
    request.flush(user);
  });
});

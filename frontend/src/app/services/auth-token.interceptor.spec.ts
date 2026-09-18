import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { authTokenInterceptor } from './auth-token.interceptor';

describe('authTokenInterceptor', () => {
  let client: HttpClient;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authTokenInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    client = TestBed.inject(HttpClient);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('adds the stored bearer token', () => {
    localStorage.setItem('invoice-manager-token', 'abc123');
    client.get('/api/test').subscribe();
    const request = http.expectOne('/api/test');
    expect(request.request.headers.get('Authorization')).toBe('Bearer abc123');
    request.flush({});
  });

  it('does not add a header when no token exists', () => {
    client.get('/api/test').subscribe();
    const request = http.expectOne('/api/test');
    expect(request.request.headers.has('Authorization')).toBeFalse();
    request.flush({});
  });

  it('preserves an explicit authorization header', () => {
    localStorage.setItem('invoice-manager-token', 'stored');
    client.get('/api/test', { headers: { Authorization: 'ApiKey explicit' } }).subscribe();
    const request = http.expectOne('/api/test');
    expect(request.request.headers.get('Authorization')).toBe('ApiKey explicit');
    request.flush({});
  });
});

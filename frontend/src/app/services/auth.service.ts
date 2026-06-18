import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { API_BASE } from './api-url';
import { AuthResponse, User } from '../models/invoice.models';

@Injectable({ providedIn: 'root' })
export class AuthService {
  constructor(private http: HttpClient) {}

  login(credentials: { email: string; password: string }) {
    return this.http.post<AuthResponse>(`${API_BASE}/auth/login`, credentials);
  }

  register(payload: { name: string; email: string; password: string }) {
    return this.http.post<AuthResponse>(`${API_BASE}/auth/register`, payload);
  }

  me() {
    return this.http.get<User>(`${API_BASE}/auth/me`);
  }
}

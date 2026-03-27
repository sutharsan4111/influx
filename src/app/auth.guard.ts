import { Injectable, Inject } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { PublicClientApplication } from '@azure/msal-browser';

@Injectable({ providedIn: 'root' })
export class AuthGuard implements CanActivate {

  constructor(
    @Inject('MSAL_INSTANCE') private msal: PublicClientApplication,
    private router: Router
  ) {}

  canActivate(): boolean {
  const token = sessionStorage.getItem('accessToken');

  if (!token) {
    this.router.navigate(['/login']);
    return false;
  }

  return true;
}

}
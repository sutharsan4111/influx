import { Injectable, Inject } from '@angular/core';
import { CanActivate, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { PublicClientApplication } from '@azure/msal-browser';

@Injectable({ providedIn: 'root' })
export class AuthGuard implements CanActivate {

  constructor(
    @Inject('MSAL_INSTANCE') private msal: PublicClientApplication,
    private router: Router
  ) {}

  canActivate(_route: unknown, state: RouterStateSnapshot): boolean {
  const token = localStorage.getItem('accessToken');

  if (!token) {
    this.router.navigate(['/login'], { queryParams: { returnUrl: state.url } });
    return false;
  }

  return true;
}

}
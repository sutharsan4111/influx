import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withPreloading, PreloadAllModules } from '@angular/router';
import { routes } from './app/app.routes';
import { PublicClientApplication } from '@azure/msal-browser';
import { authInterceptor } from './app/auth.interceptor';

// Detect environment and set redirect URI accordingly
const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const redirectUri = isLocalhost
  ? `${window.location.protocol}//${window.location.host}/`
  : 'https://influx.cloud.muraai.com/';

const msal = new PublicClientApplication({
  auth: {
    clientId: '88dd992a-c3c2-4629-920c-b8d035e9e3b1',
    authority: 'https://login.microsoftonline.com/583bbc8b-b4b7-4e5f-900d-c0554b41e2eb',
    redirectUri: redirectUri,
    navigateToLoginRequestUrl: false
  },
  cache: {
    cacheLocation: 'localStorage',
    storeAuthStateInCookie: false
  }
});

msal.initialize()
  .then(() => msal.handleRedirectPromise())
  .then(() => {
    bootstrapApplication(AppComponent, {
      providers: [
        provideHttpClient(
          withInterceptors([authInterceptor])
        ),
        provideRouter(routes, withPreloading(PreloadAllModules)),
        { provide: 'MSAL_INSTANCE', useValue: msal }
      ]
    });
  })
  .catch(err => console.error('MSAL init failed', err));

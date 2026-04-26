import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, finalize, shareReplay, switchMap, tap, throwError } from 'rxjs';

let refreshRequest$: Observable<any> | null = null;

export const authInterceptor: HttpInterceptorFn = (req, next) => {

  const http = inject(HttpClient);
  const token = sessionStorage.getItem('accessToken');
  const isApiRequest = req.url.startsWith('/api');

  let authReq = req;

  // Only attach app JWT to backend API calls, and do not override explicit headers.
  if (token && isApiRequest && !req.headers.has('Authorization')) {
    authReq = req.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`
      }
    });
  }

  return next(authReq).pipe(
    catchError(error => {
      const isAuthError = error?.status === 401 || error?.status === 403;
      const isRefreshEndpoint = req.url.includes('/api/refresh');

      // Refresh logic is only valid for our backend API calls.
      if (isApiRequest && isAuthError && !isRefreshEndpoint) {

        const refreshToken = sessionStorage.getItem('refreshToken');

        if (!refreshToken) {
          return throwError(() => error);
        }

        if (!refreshRequest$) {
          refreshRequest$ = http.post<any>('/api/refresh', { refreshToken }).pipe(
            tap(response => {
              if (response?.accessToken) {
                sessionStorage.setItem('accessToken', response.accessToken);
              }
            }),
            shareReplay({ bufferSize: 1, refCount: false }),
            finalize(() => {
              refreshRequest$ = null;
            })
          );
        }

        return refreshRequest$.pipe(
          switchMap(response => {
            if (!response?.accessToken) {
              return throwError(() => error);
            }

            const newReq = req.clone({
              setHeaders: {
                Authorization: `Bearer ${response.accessToken}`
              }
            });

            return next(newReq);
          }),
          catchError(refreshErr => {
            const refreshAuthError = refreshErr?.status === 401 || refreshErr?.status === 403;
            if (refreshAuthError) {
              sessionStorage.removeItem('accessToken');
              sessionStorage.removeItem('refreshToken');
            }
            return throwError(() => refreshErr);
          })
        );
      }

      return throwError(() => error);
    })
  );
};

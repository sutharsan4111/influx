import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, switchMap, throwError } from 'rxjs';

export const authInterceptor: HttpInterceptorFn = (req, next) => {

  const http = inject(HttpClient);
  const token = sessionStorage.getItem('accessToken');

  let authReq = req;

  if (token) {
    authReq = req.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`
      }
    });
  }

  return next(authReq).pipe(
    catchError(error => {

      // If token expired
      if (error.status === 403) {

        const refreshToken = sessionStorage.getItem('refreshToken');

        if (!refreshToken) {
          return throwError(() => error);
        }

        // Call refresh API
        return http.post<any>('/api/refresh', { refreshToken }).pipe(
          switchMap(response => {

            // Save new access token
            sessionStorage.setItem('accessToken', response.accessToken);

            const newReq = req.clone({
              setHeaders: {
                Authorization: `Bearer ${response.accessToken}`
              }
            });

            return next(newReq);
          })
        );
      }

      return throwError(() => error);
    })
  );
};

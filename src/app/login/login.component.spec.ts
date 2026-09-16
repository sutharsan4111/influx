import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { of, throwError } from 'rxjs';
import { LoginComponent } from './login.component';
import { MsalService } from '../services/msal.service';

describe('LoginComponent', () => {
  let component: LoginComponent;
  let fixture: ComponentFixture<LoginComponent>;
  let routerSpy: jasmine.SpyObj<Router>;
  let msalServiceSpy: jasmine.SpyObj<MsalService>;
  let routeMock: any;

  beforeEach(async () => {
    routerSpy = jasmine.createSpyObj('Router', ['navigate', 'navigateByUrl']);
    msalServiceSpy = jasmine.createSpyObj('MsalService', [
      'ensureInitialized',
      'loginPopup',
      'getActiveAccount',
      'getAccessToken'
    ]);

    routeMock = {
      snapshot: {
        queryParamMap: {
          get: jasmine.createSpy('get').and.returnValue(null)
        }
      }
    };

    await TestBed.configureTestingModule({
      imports: [LoginComponent, ReactiveFormsModule],
      providers: [
        { provide: Router, useValue: routerSpy },
        { provide: ActivatedRoute, useValue: routeMock },
        { provide: MsalService, useValue: msalServiceSpy }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('ngOnInit', () => {
    it('should set msalReady to true when ensureInitialized succeeds', fakeAsync(() => {
      msalServiceSpy.ensureInitialized.and.returnValue(Promise.resolve());
      
      component.ngOnInit();
      tick();
      
      expect(component.msalReady).toBeTrue();
      expect(component.error).toBe('');
    }));

    it('should set error when ensureInitialized fails', fakeAsync(() => {
      msalServiceSpy.ensureInitialized.and.returnValue(Promise.reject(new Error('Failed')));
      
      component.ngOnInit();
      tick();
      
      expect(component.msalReady).toBeFalse();
      expect(component.error).toBe('Authentication service unavailable');
    }));

    it('should set returnUrl from query params when valid', () => {
      routeMock.snapshot.queryParamMap.get.and.returnValue('/tickets/123');
      component.ngOnInit();
      expect((component as any).returnUrl).toBe('/tickets/123');
    });

    it('should not set returnUrl for absolute URLs', () => {
      routeMock.snapshot.queryParamMap.get.and.returnValue('http://evil.com');
      component.ngOnInit();
      expect((component as any).returnUrl).toBeNull();
    });

    it('should not set returnUrl for protocol-relative URLs', () => {
      routeMock.snapshot.queryParamMap.get.and.returnValue('//evil.com');
      component.ngOnInit();
      expect((component as any).returnUrl).toBeNull();
    });
  });

  describe('toggleLocalLogin', () => {
    it('should toggle showLocalLogin', () => {
      expect(component.showLocalLogin).toBeFalse();
      component.toggleLocalLogin();
      expect(component.showLocalLogin).toBeTrue();
      component.toggleLocalLogin();
      expect(component.showLocalLogin).toBeFalse();
    });

    it('should clear error when toggling', () => {
      component.error = 'Some error';
      component.toggleLocalLogin();
      expect(component.error).toBe('');
    });
  });

  describe('navigateByRole', () => {
    beforeEach(() => {
      (component as any).returnUrl = null;
    });

    it('should navigate to returnUrl when set', () => {
      (component as any).returnUrl = '/tickets/456';
      component['navigateByRole']('admin');
      expect(routerSpy.navigateByUrl).toHaveBeenCalledWith('/tickets/456');
    });

    it('should navigate to dashboard for cloudops role', () => {
      component['navigateByRole']('cloudops');
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/dashboard']);
    });

    it('should navigate to dashboard for itsm role', () => {
      component['navigateByRole']('itsm');
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/dashboard']);
    });

    it('should navigate to tickets with overview tab for admin role', () => {
      component['navigateByRole']('admin');
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/tickets'], { queryParams: { tab: 'overview' } });
    });

    it('should navigate to features for other roles', () => {
      component['navigateByRole']('user');
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/features']);
    });

    it('should navigate to features for product role', () => {
      component['navigateByRole']('product');
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/features']);
    });

    it('should navigate to features for hr role', () => {
      component['navigateByRole']('hr');
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/features']);
    });

    it('should navigate to features for support role', () => {
      component['navigateByRole']('support');
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/features']);
    });

    it('should navigate to features for muraai role', () => {
      component['navigateByRole']('muraai');
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/features']);
    });
  });

  describe('onSubmit (local login)', () => {
    const mockResponse = {
      accessToken: 'token123',
      refreshToken: 'refresh123',
      role: 'admin',
      roles: ['admin'],
      email: 'test@test.com'
    };

    beforeEach(() => {
      spyOn(window, 'fetch').and.returnValue(Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      } as Response));
    });

    it('should set error when form is invalid', () => {
      component.loginForm.setValue({ username: '', password: '' });
      component.onSubmit();
      expect(component.error).toBe('Please enter valid email and password');
    });

    it('should call fetch with correct credentials', () => {
      component.loginForm.setValue({ username: 'test@test.com', password: 'password123' });
      component.onSubmit();
      expect(window.fetch).toHaveBeenCalledWith('/api/login', jasmine.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@test.com', password: 'password123' })
      }));
    });

    it('should store tokens and navigate on successful login', fakeAsync(() => {
      component.loginForm.setValue({ username: 'test@test.com', password: 'password123' });
      component.onSubmit();
      tick();
      
      expect(localStorage.getItem('accessToken')).toBe('token123');
      expect(localStorage.getItem('refreshToken')).toBe('refresh123');
      expect(localStorage.getItem('role')).toBe('admin');
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/tickets'], { queryParams: { tab: 'overview' } });
    }));

    it('should set error when login fails', fakeAsync(() => {
      (window.fetch as jasmine.Spy).and.returnValue(Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ message: 'Invalid credentials' })
      } as Response));

      component.loginForm.setValue({ username: 'test@test.com', password: 'wrong' });
      component.onSubmit();
      tick();
      
      expect(component.error).toBe('Invalid credentials');
    }));

    it('should set error on network failure', fakeAsync(() => {
      (window.fetch as jasmine.Spy).and.returnValue(Promise.reject(new Error('Network error')));
      
      component.loginForm.setValue({ username: 'test@test.com', password: 'password123' });
      component.onSubmit();
      tick();
      
      expect(component.error).toContain('Backend authentication failed');
    }));
  });

  describe('loginWithMicrosoft', () => {
    beforeEach(() => {
      component.msalReady = true;
      msalServiceSpy.getActiveAccount.and.returnValue({ 
        username: 'user@test.com', 
        name: 'Test User',
        homeAccountId: 'homeAccountId',
        environment: 'environment',
        tenantId: 'tenantId',
        localAccountId: 'localAccountId'
      } as any);
      msalServiceSpy.getAccessToken.and.returnValue(Promise.resolve('msal-token'));
    });

    it('should return early if msalReady is false', async () => {
      component.msalReady = false;
      await component.loginWithMicrosoft();
      expect(msalServiceSpy.loginPopup).not.toHaveBeenCalled();
    });

    it('should call loginPopup with correct scopes', async () => {
      (window.fetch as jasmine.Spy).and.returnValue(Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          accessToken: 'backend-token',
          refreshToken: 'backend-refresh',
          role: 'user'
        })
      } as Response));

      await component.loginWithMicrosoft();
      
      expect(msalServiceSpy.loginPopup).toHaveBeenCalledWith([
        'openid', 'profile', 'email', 'User.Read', 'GroupMember.Read.All', 'Group.Read.All'
      ]);
    });

    it('should set error when email not retrieved', async () => {
      msalServiceSpy.getActiveAccount.and.returnValue(null);
      
      await component.loginWithMicrosoft();
      
      expect(component.error).toBe('Unable to retrieve email');
    });

    it('should call backend with email and accessToken', async () => {
      (window.fetch as jasmine.Spy).and.returnValue(Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          accessToken: 'backend-token',
          refreshToken: 'backend-refresh',
          role: 'cloudops'
        })
      } as Response));

      await component.loginWithMicrosoft();
      
      expect(window.fetch).toHaveBeenCalledWith('/api/msal-login', jasmine.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'user@test.com', accessToken: 'msal-token' })
      }));
    });

    it('should store tokens and navigate on successful MSAL login', fakeAsync(() => {
      (window.fetch as jasmine.Spy).and.returnValue(Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          accessToken: 'backend-token',
          refreshToken: 'backend-refresh',
          role: 'cloudops'
        })
      } as Response));

      component.loginWithMicrosoft();
      tick();
      
      expect(localStorage.getItem('accessToken')).toBe('backend-token');
      expect(localStorage.getItem('role')).toBe('cloudops');
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/dashboard']);
    }));

    it('should set error when backend auth fails', fakeAsync(() => {
      (window.fetch as jasmine.Spy).and.returnValue(Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ message: 'Backend auth failed' })
      } as Response));

      component.loginWithMicrosoft();
      tick();
      
      expect(component.error).toBe('Backend authentication failed');
    }));

    it('should set error on MSAL login failure', async () => {
      msalServiceSpy.loginPopup.and.returnValue(Promise.reject(new Error('MSAL error')));
      
      await component.loginWithMicrosoft();
      
      expect(component.error).toBe('Microsoft login failed');
    });
  });
});
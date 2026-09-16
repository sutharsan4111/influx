import { TestBed } from '@angular/core/testing';
import { MsalService } from './msal.service';
import { PublicClientApplication, AuthenticationResult, AccountInfo, InteractionRequiredAuthError } from '@azure/msal-browser';

describe('MsalService', () => {
  let service: MsalService;
  let msalInstanceSpy: jasmine.SpyObj<PublicClientApplication>;

  const mockAccount: AccountInfo = {
    username: 'user@test.com',
    name: 'Test User',
    homeAccountId: 'homeAccountId',
    environment: 'environment',
    tenantId: 'tenantId',
    localAccountId: 'localAccountId'
  };

  const mockAuthResult: AuthenticationResult = {
    accessToken: 'access-token',
    idToken: 'id-token',
    idTokenClaims: {},
    account: mockAccount,
    authority: 'authority',
    uniqueId: 'uniqueId',
    tenantId: 'tenantId',
    scopes: ['User.Read'],
    expiresOn: new Date(Date.now() + 3600000),
    extExpiresOn: new Date(Date.now() + 3600000),
    familyId: 'familyId',
    fromCache: false,
    state: 'state',
    cloudGraphHostName: 'cloudGraphHostName',
    msGraphHost: 'msGraphHost',
    tokenType: 'Bearer',
    correlationId: 'correlation-id'
  };

  beforeEach(() => {
    msalInstanceSpy = jasmine.createSpyObj('PublicClientApplication', [
      'initialize',
      'handleRedirectPromise',
      'loginPopup',
      'acquireTokenSilent',
      'acquireTokenPopup',
      'logoutPopup',
      'getActiveAccount',
      'getAllAccounts',
      'setActiveAccount'
    ]);

    msalInstanceSpy.getAllAccounts.and.returnValue([mockAccount]);
    msalInstanceSpy.getActiveAccount.and.returnValue(mockAccount);
    msalInstanceSpy.initialize.and.returnValue(Promise.resolve());
    msalInstanceSpy.handleRedirectPromise.and.returnValue(Promise.resolve(mockAuthResult));
    msalInstanceSpy.loginPopup.and.returnValue(Promise.resolve(mockAuthResult));
    msalInstanceSpy.acquireTokenSilent.and.returnValue(Promise.resolve(mockAuthResult));
    msalInstanceSpy.acquireTokenPopup.and.returnValue(Promise.resolve(mockAuthResult));
    msalInstanceSpy.logoutPopup.and.returnValue(Promise.resolve());

    TestBed.configureTestingModule({
      providers: [
        MsalService,
        { provide: 'MSAL_INSTANCE', useValue: msalInstanceSpy }
      ]
    });

    service = TestBed.inject(MsalService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('ensureInitialized', () => {
    it('should initialize MSAL when not initialized', async () => {
      await service.ensureInitialized();
      expect(msalInstanceSpy.initialize).toHaveBeenCalled();
      expect(msalInstanceSpy.handleRedirectPromise).toHaveBeenCalled();
    });

    it('should not re-initialize if already initialized', async () => {
      await service.ensureInitialized();
      await service.ensureInitialized();
      expect(msalInstanceSpy.initialize).toHaveBeenCalledTimes(1);
    });

    it('should throw error when MSAL instance is null', async () => {
      const nullMsalService = new MsalService(null as any);
      await expectAsync(nullMsalService.ensureInitialized()).toBeRejectedWithError('MSAL is not available');
    });
  });

  describe('getActiveAccount', () => {
    it('should return active account', () => {
      const account = service.getActiveAccount();
      expect(account).toEqual(mockAccount);
      expect(msalInstanceSpy.getActiveAccount).toHaveBeenCalled();
    });

    it('should return null when MSAL is not available', () => {
      const nullMsalService = new MsalService(null as any);
      expect(nullMsalService.getActiveAccount()).toBeNull();
    });
  });

  describe('loginPopup', () => {
    it('should call loginPopup with scopes and set active account', async () => {
      const scopes = ['User.Read', 'Profile'];
      await service.loginPopup(scopes);
      expect(msalInstanceSpy.loginPopup).toHaveBeenCalledWith({ scopes, prompt: 'select_account' });
      expect(msalInstanceSpy.setActiveAccount).toHaveBeenCalledWith(mockAccount);
    });

    it('should ensure initialized before login', async () => {
      await service.loginPopup(['User.Read']);
      expect(msalInstanceSpy.initialize).toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('should call logoutPopup', () => {
      service.logout();
      expect(msalInstanceSpy.logoutPopup).toHaveBeenCalledWith({ mainWindowRedirectUri: '/login' });
    });

    it('should not throw when MSAL is null', () => {
      const nullMsalService = new MsalService(null as any);
      expect(() => nullMsalService.logout()).not.toThrow();
    });
  });

  describe('isLoggedIn', () => {
    it('should return true when accounts exist', () => {
      expect(service.isLoggedIn()).toBeTrue();
      expect(msalInstanceSpy.getAllAccounts).toHaveBeenCalled();
    });

    it('should return false when no accounts', () => {
      msalInstanceSpy.getAllAccounts.and.returnValue([]);
      expect(service.isLoggedIn()).toBeFalse();
    });

    it('should return false when MSAL is null', () => {
      const nullMsalService = new MsalService(null as any);
      expect(nullMsalService.isLoggedIn()).toBeFalse();
    });
  });

  describe('getAccount', () => {
    it('should return first account', () => {
      const account = service.getAccount();
      expect(account).toEqual(mockAccount);
    });

    it('should return null when no accounts', () => {
      msalInstanceSpy.getAllAccounts.and.returnValue([]);
      expect(service.getAccount()).toBeNull();
    });

    it('should return null when MSAL is null', () => {
      const nullMsalService = new MsalService(null as any);
      expect(nullMsalService.getAccount()).toBeNull();
    });
  });

  describe('handleRedirectPromise', () => {
    it('should call handleRedirectPromise', async () => {
      const result = await service.handleRedirectPromise();
      expect(result).toEqual(mockAuthResult);
      expect(msalInstanceSpy.handleRedirectPromise).toHaveBeenCalled();
    });
  });

  describe('getAccessToken', () => {
    it('should acquire token silently', async () => {
      const token = await service.getAccessToken(['User.Read']);
      expect(token).toBe('access-token');
      expect(msalInstanceSpy.acquireTokenSilent).toHaveBeenCalled();
    });

    it('should fallback to popup on interaction required', async () => {
      const interactionError = new InteractionRequiredAuthError('interaction_required', 'Interaction required');
      msalInstanceSpy.acquireTokenSilent.and.returnValue(Promise.reject(interactionError));

      const token = await service.getAccessToken(['User.Read']);
      expect(token).toBe('access-token');
      expect(msalInstanceSpy.acquireTokenPopup).toHaveBeenCalled();
    });

    it('should throw error when no account', async () => {
      msalInstanceSpy.getAllAccounts.and.returnValue([]);
      await expectAsync(service.getAccessToken(['User.Read'])).toBeRejectedWithError('No signed-in account');
    });
  });

  describe('tryGetAccessTokenSilent', () => {
    it('should return token when successful', async () => {
      const token = await service.tryGetAccessTokenSilent(['User.Read']);
      expect(token).toBe('access-token');
    });

    it('should return null when silent acquisition fails', async () => {
      msalInstanceSpy.acquireTokenSilent.and.returnValue(Promise.reject(new Error('Failed')));
      const token = await service.tryGetAccessTokenSilent(['User.Read']);
      expect(token).toBeNull();
    });

    it('should return null when no account', async () => {
      msalInstanceSpy.getAllAccounts.and.returnValue([]);
      const token = await service.tryGetAccessTokenSilent(['User.Read']);
      expect(token).toBeNull();
    });
  });

  describe('isUserInGroup', () => {
    it('should return true when user is in group', async () => {
      spyOn(window, 'fetch').and.returnValue(Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          value: [{ mail: 'group@test.com', displayName: 'Test Group' }]
        })
      } as Response));

      const result = await service.isUserInGroup('group@test.com');
      expect(result).toBeTrue();
    });

    it('should return false when user is not in group', async () => {
      spyOn(window, 'fetch').and.returnValue(Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ value: [] })
      } as Response));

      const result = await service.isUserInGroup('other@test.com');
      expect(result).toBeFalse();
    });
  });

  describe('getUserGroupMails', () => {
    it('should return group mails and display names', async () => {
      spyOn(window, 'fetch').and.returnValue(Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          value: [{ mail: 'group1@test.com', displayName: 'Group 1' }]
        })
      } as Response));

      const mails = await service.getUserGroupMails();
      expect(mails).toContain('group1@test.com');
      expect(mails).toContain('Group 1');
    });
  });

  describe('getUserGroups', () => {
    it('should return sorted groups', async () => {
      spyOn(window, 'fetch').and.returnValue(Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          value: [
            { mail: 'b@test.com', displayName: 'B Group' },
            { mail: 'a@test.com', displayName: 'A Group' }
          ]
        })
      } as Response));

      const groups = await service.getUserGroups();
      expect(groups[0].displayName).toBe('A Group');
      expect(groups[1].displayName).toBe('B Group');
    });
  });

  describe('getDirectoryGroups', () => {
    it('should return directory groups', async () => {
      spyOn(window, 'fetch').and.returnValue(Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          value: [{ id: '1', mail: 'group@test.com', displayName: 'Test Group' }]
        })
      } as Response));

      const groups = await service.getDirectoryGroups();
      expect(groups.length).toBe(1);
      expect(groups[0].id).toBe('1');
    });
  });

  describe('getGroupMembersByEmail', () => {
    it('should return group members', async () => {
      spyOn(window, 'fetch')
        .and.returnValues(
          Promise.resolve({ ok: true, json: () => Promise.resolve({ value: [{ id: 'group-id', mail: 'group@test.com', displayName: 'Group' }] }) } as Response),
          Promise.resolve({ ok: true, json: () => Promise.resolve({ value: [{ mail: 'member@test.com', userPrincipalName: 'member@test.com', displayName: 'Member' }] }) } as Response)
        );

      const members = await service.getGroupMembersByEmail('group@test.com');
      expect(members.length).toBe(1);
      expect(members[0].email).toBe('member@test.com');
    });
  });

  describe('getOrganizationUsers', () => {
    it('should return organization users', async () => {
      spyOn(window, 'fetch').and.returnValue(Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          value: [{ mail: 'user@test.com', userPrincipalName: 'user@test.com', displayName: 'Test User' }]
        })
      } as Response));

      const users = await service.getOrganizationUsers();
      expect(users.length).toBe(1);
      expect(users[0].email).toBe('user@test.com');
    });
  });
});
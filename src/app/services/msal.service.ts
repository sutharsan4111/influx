import { Injectable, Inject } from '@angular/core';
import {
  PublicClientApplication,
  InteractionRequiredAuthError,
  AuthenticationResult
} from '@azure/msal-browser';

@Injectable({ providedIn: 'root' })
export class MsalService {

  private initialized = false;

  constructor(
    @Inject('MSAL_INSTANCE') private msal: PublicClientApplication | null
  ) {}

  // Ensure MSAL is ready
  async ensureInitialized(): Promise<void> {
    if (!this.msal) {
      throw new Error('MSAL is not available (HTTP deployment)');
    }
    if (!this.initialized) {
      await this.msal.initialize();
      await this.msal.handleRedirectPromise();
      this.initialized = true;
    }
  }
getActiveAccount() {
  return this.msal?.getActiveAccount() || null;
}
  // ✅ Microsoft Login (POPUP)
  async loginPopup(scopes: string[]): Promise<void> {
  await this.ensureInitialized();

  const result = await this.msal!.loginPopup({
    scopes,
    prompt: 'select_account'
  });

  // ✅ VERY IMPORTANT
  this.msal!.setActiveAccount(result.account);
}


  // ✅ App-only Logout (NOT browser logout)
  logout(): void {
    if (!this.msal) return;
    this.msal.logoutPopup({
      mainWindowRedirectUri: '/login'
    });
  }

  // Login state
  isLoggedIn(): boolean {
    if (!this.msal) return false;
    return this.msal.getAllAccounts().length > 0;
  }

  getAccount() {
    if (!this.msal) return null;
    return this.msal.getAllAccounts()[0] || null;
  }

  async handleRedirectPromise(): Promise<AuthenticationResult | null> {
    await this.ensureInitialized();
    return this.msal!.handleRedirectPromise();
  }

  async getAccessToken(scopes: string[]): Promise<string> {
    await this.ensureInitialized();
    const account = this.getAccount();

    if (!account) {
      throw new Error('No signed-in account');
    }

    try {
      const result = await this.msal!.acquireTokenSilent({ scopes, account });
      return result.accessToken;
    } catch (err) {
      if (err instanceof InteractionRequiredAuthError) {
        const result = await this.msal!.acquireTokenPopup({ scopes });
        return result.accessToken;
      }
      throw err;
    }
  }

  async isUserInGroup(groupEmail: string): Promise<boolean> {
    const token = await this.getAccessToken([
      'User.Read',
      'GroupMember.Read.All'
    ]);

    let url =
      'https://graph.microsoft.com/v1.0/me/transitiveMemberOf/microsoft.graph.group?$select=id,displayName,mail';
    const target = groupEmail.trim().toLowerCase();

    while (url) {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok) {
        throw new Error(`Graph request failed: ${response.status}`);
      }

      const data = await response.json();
      const groups = Array.isArray(data.value) ? data.value : [];

      const found = groups.some((g: any) => {
        const mail = (g.mail || '').toLowerCase();
        const name = (g.displayName || '').toLowerCase();
        return mail === target || name === target;
      });

      if (found) return true;

      url = data['@odata.nextLink'] || '';
    }

    return false;
  }

  async getUserGroupMails(): Promise<string[]> {
    const token = await this.getAccessToken([
      'User.Read',
      'GroupMember.Read.All'
    ]);

    let url =
      'https://graph.microsoft.com/v1.0/me/transitiveMemberOf/microsoft.graph.group?$select=mail,displayName';
    const mails = new Set<string>();

    while (url) {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok) {
        throw new Error(`Graph request failed: ${response.status}`);
      }

      const data = await response.json();
      const groups = Array.isArray(data.value) ? data.value : [];

      groups.forEach((g: any) => {
        const mail = (g.mail || '').trim().toLowerCase();
        const name = (g.displayName || '').trim().toLowerCase();
        if (mail) mails.add(mail);
        if (name) mails.add(name);
      });

      url = data['@odata.nextLink'] || '';
    }

    return Array.from(mails);
  }

  async getGroupMembersByEmail(groupEmail: string): Promise<{ email: string; displayName: string }[]> {
    const token = await this.getAccessToken([
      'User.Read',
      'GroupMember.Read.All',
      'Group.Read.All'
    ]);

    const normalizedTarget = groupEmail.trim().toLowerCase();
    const groupsUrl =
      `https://graph.microsoft.com/v1.0/groups?$filter=mail eq '${normalizedTarget}'&$select=id,displayName,mail`;

    const groupResponse = await fetch(groupsUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!groupResponse.ok) {
      throw new Error(`Graph group lookup failed: ${groupResponse.status}`);
    }

    const groupData = await groupResponse.json();
    let group = (groupData.value || [])[0];

    if (!group) {
      const fallbackUrl =
        `https://graph.microsoft.com/v1.0/groups?$filter=displayName eq '${normalizedTarget}'&$select=id,displayName,mail`;
      const fallbackResponse = await fetch(fallbackUrl, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!fallbackResponse.ok) {
        throw new Error(`Graph group lookup failed: ${fallbackResponse.status}`);
      }

      const fallbackData = await fallbackResponse.json();
      group = (fallbackData.value || [])[0];
    }

    if (!group?.id) return [];

    const members: { email: string; displayName: string }[] = [];
    let membersUrl =
      `https://graph.microsoft.com/v1.0/groups/${group.id}/members?$select=mail,userPrincipalName,displayName&$top=100`;

    while (membersUrl) {
      const response = await fetch(membersUrl, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok) {
        throw new Error(`Graph members request failed: ${response.status}`);
      }

      const data = await response.json();
      const items = Array.isArray(data.value) ? data.value : [];

      items.forEach((u: any) => {
        const email = (u.mail || u.userPrincipalName || '').trim().toLowerCase();
        const displayName = (u.displayName || '').trim();
        if (email && !email.includes('#ext#')) {
          members.push({ email, displayName });
        }
      });

      membersUrl = data['@odata.nextLink'] || '';
    }

    return members;
  }

  // Get all users from organization (Azure AD)
  async getOrganizationUsers(): Promise<{ email: string; displayName: string }[]> {
    const token = await this.getAccessToken([
      'User.Read.All'
    ]);

    let url = 'https://graph.microsoft.com/v1.0/users?$select=mail,displayName,userPrincipalName&$top=100';
    const users: { email: string; displayName: string }[] = [];

    while (url) {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok) {
        throw new Error(`Graph request failed: ${response.status}`);
      }

      const data = await response.json();
      const items = Array.isArray(data.value) ? data.value : [];

      items.forEach((u: any) => {
        const email = (u.mail || u.userPrincipalName || '').trim().toLowerCase();
        const displayName = (u.displayName || '').trim();
        if (email && !email.includes('#ext#')) {
          users.push({ email, displayName });
        }
      });

      url = data['@odata.nextLink'] || '';
    }

    return users;
  }
}














// import { Injectable, Inject, Optional } from '@angular/core';
// import { PublicClientApplication, AuthenticationResult } from "@azure/msal-browser";

// @Injectable({ providedIn: 'root' })
// export class MsalService {
//   private msal: PublicClientApplication;
//   private initialized = true; // Already initialized in main.ts

//   constructor(@Optional() @Inject('MSAL_INSTANCE') msalInstance?: PublicClientApplication) {
//     if (!msalInstance) {
//       // Fallback: create instance if not provided
//       this.msal = new PublicClientApplication({
//         auth: {
//           clientId: "65368371-568a-4d2b-b2e6-5239833d4f95",
//           authority: "https://login.microsoftonline.com/583bbc8b-b4b7-4e5f-900d-c0554b41e2eb",
//           redirectUri: "http://localhost:3000/auth/callback"
//         }
//       });
//       this.initialized = false;
//     } else {
//       this.msal = msalInstance;
//     }
//   }

//   async ensureInitialized(): Promise<void> {
//     if (!this.initialized) {
//       try {
//         await this.msal.initialize();
//         this.initialized = true;
//       } catch (error) {
//         console.error('Failed to initialize MSAL:', error);
//         throw error;
//       }
//     }
//   }

//   async loginRedirect(scopes: string[]): Promise<void> {
//     await this.ensureInitialized();
//     return this.msal.loginRedirect({ scopes });
//   }

//   async handleRedirectPromise(): Promise<AuthenticationResult | null> {
//     await this.ensureInitialized();
//     return this.msal.handleRedirectPromise();
//   }

//   isInitialized(): boolean {
//     return this.initialized;
//   }
// }

